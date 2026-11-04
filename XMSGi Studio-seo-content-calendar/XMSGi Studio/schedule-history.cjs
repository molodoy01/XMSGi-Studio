const SCHEDULE_STATUSES = new Set(['pending', 'scheduled', 'confirmed', 'sending', 'sent', 'failed', 'unknown']);
const MAX_SCHEDULE_MESSAGES = 2000;
const MAX_SCHEDULE_LIST_BYTES = 8 * 1024 * 1024;
const SCHEDULE_HISTORY_SCOPES = ['personal', 'workspace'];

function normalizeScheduleMessages(messages, { recoverInterrupted = false } = {}) {
  if (!Array.isArray(messages) || messages.length > MAX_SCHEDULE_MESSAGES) {
    throw new Error('Schedule history has an invalid message list.');
  }
  const serialized = JSON.stringify(messages);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_SCHEDULE_LIST_BYTES) {
    throw new Error('Schedule history exceeds the supported size.');
  }

  return messages.map((message) => {
    if (!message || typeof message !== 'object' || Array.isArray(message)
      || typeof message.id !== 'string'
      || typeof message.chatId !== 'string'
      || typeof message.text !== 'string'
      || typeof message.when !== 'string'
      || !Number.isFinite(Date.parse(message.when))
      || typeof message.createdAt !== 'string') {
      throw new Error('Schedule history contains an invalid message.');
    }

    const unknownStatus = !SCHEDULE_STATUSES.has(message.status);
    const status = unknownStatus
      ? 'failed'
      : message.status === 'confirmed'
        ? 'scheduled'
        : message.status;
    const interrupted = recoverInterrupted && status === 'sending';
    const interruptedSchedule = interrupted && message.retryAction === 'schedule';

    return {
      ...message,
      status: interrupted ? (interruptedSchedule ? 'failed' : 'unknown') : status,
      ...((unknownStatus || interrupted) ? {
        lastError: message.lastError || (interrupted
          ? interruptedSchedule
            ? 'The app closed while this message was being scheduled.'
            : 'The app closed while this message was sending. Studio cannot verify the result automatically after restart; check Telegram before sending again.'
          : 'This message had an unknown saved status and needs review.'),
        retryAction: interruptedSchedule ? 'schedule' : interrupted ? undefined : (message.retryAction || 'send'),
      } : {}),
    };
  });
}

function validateScheduleHistoryStore(store, { recoverInterrupted = false } = {}) {
  if (!store || typeof store !== 'object' || Array.isArray(store)) {
    throw new Error('Schedule history could not be read.');
  }
  if (store.schemaVersion !== undefined && store.schemaVersion !== 1) {
    throw new Error('Schedule history has an unsupported version.');
  }

  const normalized = { ...store };
  for (const scope of SCHEDULE_HISTORY_SCOPES) {
    if (!Object.prototype.hasOwnProperty.call(store, scope)) continue;

    const scopeStore = store[scope];
    if (!scopeStore || typeof scopeStore !== 'object' || Array.isArray(scopeStore)
      || !Object.prototype.hasOwnProperty.call(scopeStore, 'upcoming')
      || !Object.prototype.hasOwnProperty.call(scopeStore, 'sent')) {
      throw new Error(`Schedule history scope "${scope}" is incomplete.`);
    }

    normalized[scope] = {
      upcoming: normalizeScheduleMessages(scopeStore.upcoming, { recoverInterrupted }),
      sent: normalizeScheduleMessages(scopeStore.sent, { recoverInterrupted }),
    };
  }
  return normalized;
}

function loadScheduleHistoryScope(store, scope, { recoverInterrupted = false } = {}) {
  if (!SCHEDULE_HISTORY_SCOPES.includes(scope)) {
    return { success: false, error: 'Schedule history scope is invalid.' };
  }
  if (store === null || store === undefined) {
    return { success: true, history: { upcoming: [], sent: [] }, needsMigration: true };
  }

  try {
    const normalized = validateScheduleHistoryStore(store, { recoverInterrupted });
    if (!Object.prototype.hasOwnProperty.call(normalized, scope)) {
      return { success: true, history: { upcoming: [], sent: [] }, needsMigration: true };
    }
    return {
      success: true,
      history: normalized[scope],
      needsMigration: false,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Schedule history could not be read.',
    };
  }
}

function findRecentSentMessage(messages, text, targetTimestamp, toleranceSeconds = 180) {
  if (!Array.isArray(messages) || typeof text !== 'string' || !Number.isFinite(targetTimestamp)) return null;
  return messages.find((message) => {
    if (!message || message.out !== true || (message.message ?? message.text) !== text) return false;
    const messageTimestamp = message.date instanceof Date
      ? Math.floor(message.date.getTime() / 1000)
      : Number(message.date);
    return Number.isFinite(messageTimestamp) && Math.abs(messageTimestamp - targetTimestamp) <= toleranceSeconds;
  }) ?? null;
}

function applyConfirmedImmediateSend(history, idempotencyKey, result) {
  if (!history || typeof history !== 'object' || Array.isArray(history)
    || typeof idempotencyKey !== 'string' || !idempotencyKey
    || !result || typeof result !== 'object') {
    return null;
  }
  const isValidMessageId = (id) => (
    (typeof id === 'number' && Number.isSafeInteger(id) && id > 0)
    || (typeof id === 'string' && /^\d{1,20}$/.test(id) && Number(id) > 0)
  );
  if (result.telegramMessageIds !== undefined
    && (!Array.isArray(result.telegramMessageIds)
      || result.telegramMessageIds.length === 0
      || !result.telegramMessageIds.every(isValidMessageId)
      || new Set(result.telegramMessageIds.map(String)).size !== result.telegramMessageIds.length)) {
    return null;
  }
  const telegramMessageId = result.telegramMessageId ?? result.telegramMessageIds?.[0];
  if (!isValidMessageId(telegramMessageId)
    || (result.telegramMessageIds?.length > 0
      && String(result.telegramMessageIds[0]) !== String(telegramMessageId))) {
    return null;
  }

  let validatedHistory;
  try {
    validatedHistory = validateScheduleHistoryStore(history);
  } catch {
    return null;
  }

  for (const scope of SCHEDULE_HISTORY_SCOPES) {
    const scopeHistory = validatedHistory[scope];
    if (!scopeHistory) continue;

    const upcoming = scopeHistory.upcoming;
    const sent = scopeHistory.sent;
    const attempt = upcoming.find((message) => message.sendAttemptId === idempotencyKey)
      ?? sent.find((message) => message.sendAttemptId === idempotencyKey);
    if (!attempt) continue;

    const sentMessage = {
      ...attempt,
      status: 'sent',
      ...(typeof result.sentAt === 'string' && Number.isFinite(Date.parse(result.sentAt))
        ? { sentAt: result.sentAt }
        : {}),
      telegramMessageId,
      ...(Array.isArray(result.telegramMessageIds) ? { telegramMessageIds: result.telegramMessageIds } : {}),
      lastError: undefined,
      lastErrorDetails: undefined,
      retryAction: undefined,
    };

    const updatedSent = [sentMessage, ...sent.filter((message) => message.sendAttemptId !== idempotencyKey)];
    let sentBytes = Buffer.byteLength(JSON.stringify(updatedSent), 'utf8');
    while (updatedSent.length > MAX_SCHEDULE_MESSAGES || sentBytes > MAX_SCHEDULE_LIST_BYTES) {
      if (updatedSent.length <= 1) return null;
      const removed = updatedSent.pop();
      sentBytes -= Buffer.byteLength(JSON.stringify(removed), 'utf8') + 1;
    }

    const updated = {
      ...validatedHistory,
      schemaVersion: validatedHistory.schemaVersion ?? 1,
      [scope]: {
        upcoming: upcoming.filter((message) => message.sendAttemptId !== idempotencyKey),
        sent: updatedSent,
      },
    };
    try {
      return validateScheduleHistoryStore(updated);
    } catch {
      return null;
    }
  }

  return null;
}

function commitConfirmedImmediateSend(history, idempotencyKey, result, writeHistory) {
  if (typeof writeHistory !== 'function') {
    return { success: false, error: 'Schedule history writer is unavailable.' };
  }

  const updated = applyConfirmedImmediateSend(history, idempotencyKey, result);
  if (!updated) {
    return {
      success: false,
      error: 'Confirmed send could not be applied because its history is invalid, missing, or exceeds supported limits.',
    };
  }

  try {
    writeHistory(updated);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Confirmed Telegram send history could not be saved.',
    };
  }
}

module.exports = {
  applyConfirmedImmediateSend,
  commitConfirmedImmediateSend,
  findRecentSentMessage,
  loadScheduleHistoryScope,
  normalizeScheduleMessages,
  validateScheduleHistoryStore,
};