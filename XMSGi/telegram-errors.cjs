const MAX_TIMER_DELAY_MS = 2_147_483_647;
const MAX_FLOOD_WAIT_SECONDS = 31_536_000;
const MAX_FLOOD_WAIT_SECONDS_BIGINT = BigInt(MAX_FLOOD_WAIT_SECONDS);
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const MAX_TIMER_DELAY_BIGINT = BigInt(MAX_TIMER_DELAY_MS);

function parsePositiveInteger(value) {
  if (typeof value === 'bigint') return value > 0n ? value : null;

  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return null;
    return BigInt(Math.ceil(value));
  }

  const text = String(value ?? '').trim();
  if (!/^\d+$/.test(text)) return null;
  const parsed = BigInt(text);
  return parsed > 0n ? parsed : null;
}

function toSafeNumber(value) {
  return value <= MAX_SAFE_INTEGER_BIGINT ? Number(value) : Number.MAX_SAFE_INTEGER;
}

function getSourceError(error) {
  return error instanceof Error ? error : new Error(String(error || 'Telegram request failed.'));
}

function normalizeWaitError(source, type, waitSeconds) {
  const parsedWaitSeconds = parsePositiveInteger(waitSeconds);
  const isFloodWait = type === 'flood';
  if (parsedWaitSeconds === null) {
    const invalid = new Error(`Telegram returned an invalid ${type === 'flood' ? 'FLOOD_WAIT' : 'SLOWMODE_WAIT'} value.`);
    invalid.code = isFloodWait ? 'TELEGRAM_FLOOD_WAIT_INVALID' : 'TELEGRAM_SLOWMODE_WAIT_INVALID';
    invalid.cause = source;
    return invalid;
  }

  if (isFloodWait && parsedWaitSeconds > MAX_FLOOD_WAIT_SECONDS_BIGINT) {
    const exceeded = new Error(
      `Telegram FLOOD_WAIT exceeds the application maximum of ${MAX_FLOOD_WAIT_SECONDS} seconds.`
    );
    exceeded.code = 'TELEGRAM_FLOOD_WAIT_EXCEEDS_MAX';
    exceeded.waitSecondsText = parsedWaitSeconds.toString();
    exceeded.maxWaitSeconds = MAX_FLOOD_WAIT_SECONDS;
    exceeded.cause = source;
    return exceeded;
  }

  const waitSecondsText = parsedWaitSeconds.toString();
  const roundedWaitSeconds = toSafeNumber(parsedWaitSeconds);
  const normalized = new Error(isFloodWait
    ? `Telegram asks to wait ${waitSecondsText} seconds before trying again.`
    : `Telegram chat is in slow mode. Wait ${waitSecondsText} seconds before trying again.`);
  normalized.code = isFloodWait ? 'TELEGRAM_FLOOD_WAIT' : 'TELEGRAM_SLOWMODE_WAIT';
  normalized.waitSeconds = roundedWaitSeconds;
  normalized.waitSecondsText = waitSecondsText;
  normalized.cause = source;
  return normalized;
}

function normalizeRateLimitError(error) {
  const source = getSourceError(error);
  const sourceText = [
    source.code,
    source.errorCode,
    source.errorMessage,
    source.message,
    source.name,
  ].filter(Boolean).join(' ');
  const floodMatch = sourceText.match(/FLOOD_WAIT[_\s:]*(\d+)/i);
  const floodMarker = /FLOOD_WAIT(?:[_\s:]|$)/i.test(sourceText);
  if (floodMatch || floodMarker || source.code === 'TELEGRAM_FLOOD_WAIT') {
    const waitSeconds = floodMatch
      ? floodMatch[1]
      : source.waitSecondsText ?? source.waitSeconds ?? source.seconds;
    const normalized = normalizeWaitError(source, 'flood', waitSeconds);
    return { type: normalized.code === 'TELEGRAM_FLOOD_WAIT' ? 'flood' : 'flood-invalid', error: normalized };
  }

  const slowModeMatch = sourceText.match(/SLOWMODE_WAIT[_\s:]*(\d+)/i);
  const slowModeMarker = /SLOWMODE_WAIT(?:[_\s:]|$)/i.test(sourceText);
  if (slowModeMatch || slowModeMarker || source.code === 'TELEGRAM_SLOWMODE_WAIT') {
    const waitSeconds = slowModeMatch
      ? slowModeMatch[1]
      : source.waitSecondsText ?? source.waitSeconds ?? source.seconds;
    const normalized = normalizeWaitError(source, 'slowmode', waitSeconds);
    return { type: normalized.code === 'TELEGRAM_SLOWMODE_WAIT' ? 'slowmode' : 'slowmode-invalid', error: normalized };
  }

  return null;
}

function normalizeFloodWaitError(error) {
  const normalized = normalizeRateLimitError(error);
  return normalized?.type === 'flood' ? normalized.error : null;
}

function classifyTelegramError(error) {
  const normalizedRateLimit = normalizeRateLimitError(error);
  if (normalizedRateLimit?.type === 'flood') {
    return {
      category: 'flood',
      retryable: true,
      error: normalizedRateLimit.error,
    };
  }

  if (normalizedRateLimit?.type === 'slowmode') {
    return {
      category: 'slowmode',
      retryable: false,
      error: normalizedRateLimit.error,
    };
  }

  if (normalizedRateLimit?.type === 'flood-invalid' || normalizedRateLimit?.type === 'slowmode-invalid') {
    return { category: 'error', retryable: false, error: normalizedRateLimit.error };
  }

  const source = getSourceError(error);
  const sourceText = [
    source.code,
    source.errorCode,
    source.errorMessage,
    source.message,
    source.name,
  ].filter(Boolean).join(' ');

  if (/AUTH(?:ORIZATION|_KEY|_TOO_MUCH|_SIGN_UP|_SIGN_IN)?|SESSION_(?:REVOKED|EXPIRED|INVALID)|PHONE_CODE|PASSWORD|USER_DEACTIVATED/i.test(sourceText)) {
    return { category: 'auth', retryable: false, error: source };
  }

  if (/CHAT_(?:WRITE_)?FORBIDDEN|CHAT_ADMIN_REQUIRED|USER_(?:IS_)?BLOCKED|USER_BANNED|CHANNEL_(?:PRIVATE|FORBIDDEN)|PERMISSION|NOT_MODERATOR|RIGHTS_FORBIDDEN/i.test(sourceText)) {
    return { category: 'permission', retryable: false, error: source };
  }

  if (/ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENETUNREACH|EAI_AGAIN|ECONNABORTED|NETWORK|TIMEOUT|CONNECTION|(?:^|\D)(?:502|503|504)(?:\D|$)/i.test(sourceText)) {
    return { category: 'network', retryable: true, error: source };
  }

  return { category: 'unknown', retryable: false, error: source };
}

function createTelegramRateLimitInterceptor(timerApi = {}) {
  const now = timerApi.now || Date.now;
  const setTimer = timerApi.setTimeout || setTimeout;
  const clearTimer = timerApi.clearTimeout || clearTimeout;
  const pauses = new Map();

  function getAccountKey(accountId) {
    const key = String(accountId ?? '').trim();
    if (!key) throw new Error('A Telegram account/session key is required.');
    return key;
  }

  function finishPause(accountId, pause) {
    if (pause.timer !== null) {
      clearTimer(pause.timer);
      pause.timer = null;
    }
    if (pauses.get(accountId) === pause) pauses.delete(accountId);
    const resolve = pause.resolve;
    pause.resolve = null;
    pause.waitPromise = null;
    resolve?.();
  }

  function scheduleResume(accountId, pause) {
    const remainingMs = pause.pausedUntilMs - BigInt(Math.max(0, Math.trunc(Number(now()))));
    const safeRemainingMs = remainingMs > 0n ? remainingMs : 0n;
    pause.timer = setTimer(() => {
      pause.timer = null;
      if (pause.pausedUntilMs > BigInt(Math.max(0, Math.trunc(Number(now()))))) {
        scheduleResume(accountId, pause);
        pause.timer?.unref?.();
        return;
      }
      finishPause(accountId, pause);
    }, Number(safeRemainingMs > MAX_TIMER_DELAY_BIGINT ? MAX_TIMER_DELAY_BIGINT : safeRemainingMs));
    pause.timer?.unref?.();
  }

  function getState(accountId) {
    const key = getAccountKey(accountId);
    const pause = pauses.get(key);
    if (!pause) {
      return { accountId: key, paused: false, pausedUntil: null, remainingMs: 0 };
    }

    const remainingMs = pause.pausedUntilMs - BigInt(Math.max(0, Math.trunc(Number(now()))));
    if (remainingMs <= 0n) {
      finishPause(key, pause);
      return { accountId: key, paused: false, pausedUntil: null, remainingMs: 0 };
    }

    const safeRemainingMs = toSafeNumber(remainingMs);
    const safePausedUntil = pause.pausedUntilMs <= MAX_SAFE_INTEGER_BIGINT
      ? Number(pause.pausedUntilMs)
      : null;

    return {
      accountId: key,
      paused: true,
      reason: 'FLOOD_WAIT',
      pausedUntil: safePausedUntil,
      pausedUntilText: pause.pausedUntilMs.toString(),
      remainingMs: safeRemainingMs,
      remainingMsText: remainingMs.toString(),
      waitSeconds: Math.ceil(safeRemainingMs / 1000),
      waitSecondsText: ((remainingMs + 999n) / 1000n).toString(),
    };
  }

  function pauseAccount(accountId, waitSeconds) {
    const key = getAccountKey(accountId);
    const seconds = parsePositiveInteger(waitSeconds?.waitSecondsText ?? waitSeconds);
    if (seconds === null) return getState(key);

    const requestedDeadline = BigInt(Math.max(0, Math.trunc(Number(now())))) + seconds * 1000n;
    let pause = pauses.get(key);
    if (!pause) {
      pause = {
        pausedUntilMs: requestedDeadline,
        timer: null,
        waitPromise: null,
        resolve: null,
      };
      pause.waitPromise = new Promise((resolve) => { pause.resolve = resolve; });
      pauses.set(key, pause);
      scheduleResume(key, pause);
      return getState(key);
    }

    if (requestedDeadline > pause.pausedUntilMs) {
      pause.pausedUntilMs = requestedDeadline;
      if (pause.timer !== null) clearTimer(pause.timer);
      pause.timer = null;
      scheduleResume(key, pause);
    }

    return getState(key);
  }

  async function waitUntilAvailable(accountId) {
    const key = getAccountKey(accountId);
    const state = getState(key);
    if (!state.paused) return state;

    const pause = pauses.get(key);
    await pause.waitPromise;
    return waitUntilAvailable(key);
  }

  async function run(accountId, operation) {
    const key = getAccountKey(accountId);

    while (true) {
      await waitUntilAvailable(key);
      try {
        return await operation();
      } catch (error) {
        const classification = classifyTelegramError(error);
        if (classification.category === 'slowmode') {
          classification.error.category = classification.category;
          classification.error.retryable = classification.retryable;
          throw classification.error;
        }
        if (classification.category !== 'flood') {
          classification.error.category = classification.category;
          classification.error.retryable = classification.retryable;
          throw classification.error;
        }
        pauseAccount(key, classification.error);
      }
    }
  }

  function getSnapshot() {
    return [...pauses.keys()]
      .map((accountId) => getState(accountId))
      .filter((state) => state.paused);
  }

  function clear(accountId) {
    const key = getAccountKey(accountId);
    const pause = pauses.get(key);
    if (pause) finishPause(key, pause);
  }

  function clearAll() {
    for (const accountId of [...pauses.keys()]) {
      clear(accountId);
    }
  }

  return {
    run,
    pauseAccount,
    waitUntilAvailable,
    getState,
    getSnapshot,
    clear,
    clearAll,
  };
}

module.exports = {
  MAX_FLOOD_WAIT_SECONDS,
  createTelegramRateLimitInterceptor,
  classifyTelegramError,
  normalizeFloodWaitError,
  normalizeRateLimitError,
};