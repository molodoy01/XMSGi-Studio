const crypto = require('node:crypto');
const { TelegramClient, Api } = require('teleproto');
const { Raw } = require('teleproto/events');
const { StringSession } = require('teleproto/sessions');
const { normalizeTelegramMessage } = require('./packages/shared/telegramText.cjs');
const { prepareInlineKeyboard } = require('./telegram-inline-keyboard.cjs');
const {
  classifyTelegramError,
  createTelegramRateLimitInterceptor,
  isInvalidTelegramSessionError,
} = require('./telegram-errors.cjs');
const {
  loadAccountSecrets,
  saveAccountSecrets,
  getTelegramAuthState: getStoredTelegramAuthState,
  setTelegramSignedOut,
  clearAccountSecrets
} = require('./telegram-account-storage.cjs');
const {
  assertLifecycleRunning,
  beginShutdown,
  createLifecycleState,
  runShared,
  startPendingLogin,
  stopReconnect,
  trackOperation,
  withTimeout
} = require('./telegram-lifecycle.cjs');
const {
  normalizeQuery,
  normalizePhone,
  isPhoneLikeQuery,
  isUsernameQuery
} = require('./telegram-search.cjs');
const { toTelegramFormattingEntities } = require('./telegram-message-entities.cjs');
const {
  createTelegramRandomId,
  getTelegramEntityIdentity,
  getEffectIdentity,
  getScheduleOperationIdentities,
} = require('./telegram-idempotency.cjs');
const { normalizeHistoryMessage, resolveMessageDirection } = require('./telegram-message-direction.cjs');
const {
  logTelegramOperation,
  withTelegramInvokeDiagnostics,
} = require('./telegram-publish-diagnostics.cjs');
const { createTelegramSender } = require('./telegram-send.cjs');
const { createTelegramSendRecovery } = require('./telegram-send-recovery.cjs');
const { createTelegramScheduler } = require('./telegram-scheduling.cjs');
const { createTelegramChatResolver } = require('./telegram-chat-resolution.cjs');
const { createTelegramChatData } = require('./telegram-chat-data.cjs');
const { createTelegramReconnect } = require('./telegram-reconnect.cjs');
const {
  normalizeSessionString,
  updateRuntimeSecretsFromConfig,
  getSecretValue,
  getApplicationApiCredentials,
} = require('./telegram-config.cjs');

function getTelegramUserName(user) {
  return [user?.firstName, user?.lastName]
    .filter(Boolean)
    .join(' ')
    .trim();
}

function getTelegramUsername(user) {
  return typeof user?.username === 'string'
    ? user.username.trim().replace(/^@/, '')
    : '';
}

function createTelegramCore(options = {}) {
  const lifecycleState = createLifecycleState();
  const rateLimitInterceptor = createTelegramRateLimitInterceptor(options.rateLimitTimers);
  const applicationApiCredentials = getApplicationApiCredentials(loadAccountSecrets());
  let runtimeApiId = Number(options.apiId ?? applicationApiCredentials.apiId);
  let runtimeApiHash = options.apiHash ?? applicationApiCredentials.apiHash;
  let runtimeSessionString = normalizeSessionString(
    options.sessionString ?? getSecretValue('SESSION_STRING', loadAccountSecrets())
  );
  let runtimeSignedOut = false;

function refreshRuntimeSecrets() {
  const next = updateRuntimeSecretsFromConfig(loadAccountSecrets());
  const applicationApiCredentials = getApplicationApiCredentials(loadAccountSecrets());
  runtimeApiId = Number(applicationApiCredentials.apiId ?? next.apiId);
  runtimeApiHash = applicationApiCredentials.apiHash ?? next.apiHash;
  runtimeSessionString = next.sessionString || '';
  runtimeSignedOut = next.signedOut === true;
  return {
    apiId: runtimeApiId,
    sessionString: runtimeSessionString,
    signedOut: runtimeSignedOut
  };
}

function getTelegramConfig() {
  const secrets = loadAccountSecrets();
  const storedAuthState = typeof getStoredTelegramAuthState === 'function'
    ? getStoredTelegramAuthState()
    : { signedOut: secrets.signedOut, userName: '', username: '' };
  const apiCredentials = getApplicationApiCredentials(secrets);
  const sessionString = normalizeSessionString(secrets.SESSION_STRING);

  return {
    hasCredentials: Boolean(apiCredentials.apiId && apiCredentials.apiHash),
    apiId: apiCredentials.apiId ? String(apiCredentials.apiId) : '',
    hasSession: Boolean(sessionString),
    signedOut: storedAuthState.signedOut === true,
    userName: storedAuthState.userName || '',
    username: storedAuthState.username || '',
    connected: Boolean(client && client.connected)
  };
}

async function saveTelegramCredentials(data = {}) {
  const rawApiId = data.API_ID ?? data.apiId;
  const rawApiHash = data.API_HASH ?? data.apiHash;
  const rawSession = data.SESSION_STRING ?? data.sessionString;
  const rawUserName = data.userName;
  const rawUsername = data.username;

  const secrets = {};

  if (rawApiId !== undefined && rawApiId !== null && rawApiId !== '') {
    secrets.API_ID = String(rawApiId);
  }

  if (rawApiHash !== undefined && rawApiHash !== null && rawApiHash !== '') {
    secrets.API_HASH = String(rawApiHash);
  }

  if (rawSession !== undefined && rawSession !== null && rawSession !== '') {
    secrets.SESSION_STRING = normalizeSessionString(rawSession);
  }

  if (rawUserName !== undefined) {
    secrets.userName = String(rawUserName || '').trim();
  }

  if (rawUsername !== undefined) {
    secrets.username = String(rawUsername || '').trim().replace(/^@/, '');
  }

  secrets.signedOut = false;

  const saved = saveAccountSecrets(secrets);

  if (saved) {
    refreshRuntimeSecrets();
  }

  return {
    saved,
    config: getTelegramConfig()
  };
}

function saveTelegramApiCredentials(data = {}) {
  const saved = saveAccountSecrets({
    API_ID: String(data.API_ID ?? data.apiId ?? ''),
    API_HASH: String(data.API_HASH ?? data.apiHash ?? '')
  });

  if (saved) {
    refreshRuntimeSecrets();
  }

  return {
    saved,
    config: getTelegramConfig()
  };
}

async function signOutKeepSessionInternal() {
  const clientToClear = client;

  stopTelegramReconnect();
  lifecycleState.loginGeneration += 1;
  client = null;
  lifecycleState.status = 'disconnected';
  await clearPendingLogin();

  if (clientToClear) {
    try {
      await clientToClear.disconnect();
    } catch (error) {
      console.error('Telegram disconnect during sign out failed:', error?.code || error?.name || 'unknown');
      throw error;
    }
  }

  if (!setTelegramSignedOut(true)) {
    throw new Error('Telegram signed-out state could not be saved securely.');
  }

  runtimeSignedOut = true;
  return { signedOut: true, config: getTelegramConfig() };
}

function signOutKeepSession() {
  return trackTelegramOperation('sign-out', signOutKeepSessionInternal);
}

async function forgetTelegramAccountInternal() {
  stopTelegramReconnect();
  lifecycleState.loginGeneration += 1;
  await clearPendingLogin();

  let logoutError = null;
  let clientToClear = client;

  if (!clientToClear && runtimeSessionString) {
    try {
      clientToClear = await connectTelegramInternal({ allowSignedOut: true });
    } catch (error) {
      logoutError = error;
      clientToClear = client;
    }
  }

  client = null;
  lifecycleState.status = 'disconnected';
  stopTelegramReconnect();

  if (clientToClear) {
    try {
      if (clientToClear.connected) {
        await clientToClear.logOut();
      } else {
        await clientToClear.disconnect();
      }
    } catch (error) {
      logoutError = error;
      console.error('Telegram server logout failed; continuing local cleanup:', error?.code || error?.name || 'unknown');
      try {
        await clientToClear.disconnect();
      } catch (disconnectError) {
        console.error('Error disconnecting Telegram client during session clear:', disconnectError?.code || disconnectError?.name || 'unknown');
      }
    }
  }

  const configSaved = clearAccountSecrets();

  if (!configSaved) {
    throw new Error('Telegram session could not be cleared from secure storage.');
  }

  runtimeSessionString = '';
  runtimeSignedOut = false;

  if (logoutError) {
    throw logoutError;
  }

  return { cleared: true, config: getTelegramConfig() };
}

function forgetTelegramAccount() {
  return trackTelegramOperation('forget-account', forgetTelegramAccountInternal);
}

function clearTelegramSession() {
  return forgetTelegramAccount();
}

async function loginUserInternal(params = {}) {
  const apiIdValue = params.API_ID ?? params.apiId ?? runtimeApiId;
  const apiHashValue = params.API_HASH ?? params.apiHash ?? runtimeApiHash;
  const phone = params.phoneNumber ?? params.phone ?? '';
  const password = params.password ?? '';
  const code = params.phoneCode ?? '';

  if (!apiIdValue || !apiHashValue) {
    throw new Error('Telegram API credentials are missing. Save API_ID and API_HASH first.');
  }

  const loginApiId = Number(apiIdValue);

  if (!loginApiId) {
    throw new Error('Telegram API_ID must be a valid number.');
  }

  if (!phone) {
    throw new Error('Phone number is required for Telegram login.');
  }

  const loginGeneration = lifecycleState.loginGeneration;

  const pending = lifecycleState.pendingLogin?.value;
  const samePendingLogin =
    pending &&
    pending.phone === phone &&
    pending.apiId === loginApiId &&
    pending.apiHash === String(apiHashValue);

  if (!samePendingLogin) {
    if (pending?.client) {
      throw new Error('Telegram login is already in progress.');
    }

    const loginClient = new TelegramClient(
      new StringSession(''),
      loginApiId,
      String(apiHashValue),
      { connectionRetries: 3 }
    );

    await loginClient.connect();

    if (
      loginGeneration !== lifecycleState.loginGeneration ||
      lifecycleState.status === 'shutting-down' ||
      lifecycleState.status === 'stopped'
    ) {
      await disconnectPendingLogin({ client: loginClient });
      throw new Error('Telegram login was cancelled.');
    }

    const sendCodeResult = await loginClient.sendCode({
      apiId: loginApiId,
      apiHash: String(apiHashValue)
    }, phone);

    if (
      loginGeneration !== lifecycleState.loginGeneration ||
      lifecycleState.status === 'shutting-down' ||
      lifecycleState.status === 'stopped'
    ) {
      await disconnectPendingLogin({ client: loginClient });
      throw new Error('Telegram login was cancelled.');
    }

    startPendingLogin(lifecycleState, {
      client: loginClient,
      phone,
      apiId: loginApiId,
      apiHash: String(apiHashValue),
      phoneCodeHash: sendCodeResult.phoneCodeHash,
      isCodeViaApp: sendCodeResult.isCodeViaApp,
      requiresPassword: false
    }, disconnectPendingLogin);

    if (!code) {
      return {
        requiresCode: true,
        phoneCodeHash: sendCodeResult.phoneCodeHash,
        isCodeViaApp: sendCodeResult.isCodeViaApp,
        nextStep: 'code'
      };
    }
  }

  if (!code) {
    return {
      requiresCode: true,
      phoneCodeHash: lifecycleState.pendingLogin.value.phoneCodeHash,
      isCodeViaApp: lifecycleState.pendingLogin.value.isCodeViaApp,
      nextStep: 'code'
    };
  }

  const pendingLogin = lifecycleState.pendingLogin.value;
  const loginClient = pendingLogin.client;

  try {
    let user;

    if (pendingLogin.requiresPassword) {
      if (!password) {
        return {
          requiresPassword: true,
          nextStep: 'password'
        };
      }

      user = await loginClient.signInWithPassword(
        {
          apiId: loginApiId,
          apiHash: String(apiHashValue)
        },
        {
          password: async () => password,
          onError: async (passwordError) => {
            console.error('Telegram 2FA error:', passwordError?.code || passwordError?.name || 'unknown');
            return true;
          }
        }
      );
    } else {
      try {
        const authorization = await loginClient.invoke(
          new Api.auth.SignIn({
            phoneNumber: pendingLogin.phone,
            phoneCodeHash: pendingLogin.phoneCodeHash,
            phoneCode: code
          })
        );

        user = authorization.user;
      } catch (error) {
        const errorMessage = error?.errorMessage || error?.message || '';

        if (!/SESSION_PASSWORD_NEEDED/i.test(errorMessage)) {
          throw error;
        }

        pendingLogin.requiresPassword = true;

        if (!password) {
          return {
            requiresPassword: true,
            nextStep: 'password'
          };
        }

        user = await loginClient.signInWithPassword(
          {
            apiId: loginApiId,
            apiHash: String(apiHashValue)
          },
          {
            password: async () => password,
            onError: async (passwordError) => {
              console.error('Telegram 2FA error:', passwordError?.code || passwordError?.name || 'unknown');
              return true;
            }
          }
        );
      }
    }

    const session = loginClient.session.save();

    assertTelegramRunning();
    if (loginGeneration !== lifecycleState.loginGeneration) {
      throw new Error('Telegram login was cancelled.');
    }

    const hasEnvironmentCredentials = Boolean(
      typeof process.env.API_ID === 'string' && process.env.API_ID.trim()
      && typeof process.env.API_HASH === 'string' && process.env.API_HASH.trim()
    );
    const credentialsResult = await saveTelegramCredentials({
      ...(!hasEnvironmentCredentials ? {
        API_ID: loginApiId,
        API_HASH: String(apiHashValue),
      } : {}),
      SESSION_STRING: session,
      userName: getTelegramUserName(user),
      username: getTelegramUsername(user),
      signedOut: false
    });

    assertTelegramRunning();
    if (loginGeneration !== lifecycleState.loginGeneration) {
      throw new Error('Telegram login was cancelled.');
    }

    if (!credentialsResult.saved) {
      throw new Error('New Telegram session could not be saved securely.');
    }

    const savedSession = normalizeSessionString(session);

    runtimeSessionString = savedSession;
    runtimeSignedOut = false;
    client = loginClient;
    await clearPendingLogin({ cleanup: false });
    startTelegramReconnect();

    return {
      success: true,
      user,
      session: savedSession,
      requiresCode: false,
      nextStep: 'done'
    };
  } finally {
    if (!pendingLogin && client !== loginClient) {
      try {
        await loginClient.disconnect();
      } catch (error) {
        console.error('Telegram login disconnect cleanup failed:', error?.code || error?.name || 'unknown');
      }
    }
  }
}

function loginUser(params = {}) {
  assertTelegramRunning();

  if (loginPromise) {
    return loginPromise;
  }

  loginPromise = trackTelegramOperation('login', () => loginUserInternal(params))
    .catch(async (error) => {
      await clearPendingLogin();
      throw error;
    })
    .finally(() => {
      loginPromise = null;
    });

  return loginPromise;
}

let client = null;
let loginPromise = null;
let telegramStatusCallback = null;
let telegramSendResultCallback = null;
let activeTelegramStatus = 'normal';
let activeTelegramStatusError = null;
let activeTelegramStatusCategory = null;
let invalidSessionCleanupPromise = null;
let shutdownPromise = null;
const telegramSendRecovery = createTelegramSendRecovery({
  createRandomId: createTelegramRandomId,
  onConfirmed: (idempotencyKey, result) => {
    try {
      telegramSendResultCallback?.(idempotencyKey, result);
    } catch (error) {
      console.error('Telegram send recovery callback failed:', error?.code || error?.name || 'unknown');
    }
  },
});

const REQUEST_TIMEOUT = 15000;
const MEDIA_REQUEST_TIMEOUT = 120000;
const MAX_PREVIEW_ORIGINAL_PHOTO_BYTES = 12 * 1024 * 1024;
const INVALID_SESSION_MESSAGE = 'Telegram session expired or revoked. Please sign in again.';

function getTelegramRequestTimeout(attachments) {
  return attachments.length > 0 ? MEDIA_REQUEST_TIMEOUT : REQUEST_TIMEOUT;
}

function assertTelegramRunning() {
  assertLifecycleRunning(lifecycleState);
}

function trackTelegramOperation(type, operation) {
  return trackOperation(lifecycleState, type, operation);
}

async function disconnectPendingLogin(pending) {
  if (!pending?.client) return;

  try {
    await pending.client.disconnect();
  } catch (error) {
    console.error('Pending Telegram login cleanup failed:', error?.code || error?.name || 'unknown');
  }
}

async function clearPendingLogin(options) {
  const pending = lifecycleState.pendingLogin;
  if (pending) {
    await pending.clear(options);
  }
}

async function invalidateTelegramSession() {
  if (invalidSessionCleanupPromise) {
    return invalidSessionCleanupPromise;
  }

  invalidSessionCleanupPromise = (async () => {
    stopTelegramReconnect();

    if (!clearAccountSecrets()) {
      console.error('Invalid Telegram session cleanup write failed.');
    }

    const clientToClear = client;
    client = null;
    lifecycleState.status = 'disconnected';
    lifecycleState.loginGeneration += 1;
    await clearPendingLogin();
    runtimeSessionString = '';

    if (clientToClear) {
      try {
        await clientToClear.disconnect();
      } catch (disconnectError) {
        console.error('Invalid Telegram session disconnect failed:', disconnectError?.code || disconnectError?.name || 'unknown');
      }
    }

    console.log('Telegram reauth required.');
    notifyTelegramStatus({
      status: 'reauth_required',
      connected: false,
      error: INVALID_SESSION_MESSAGE
    });
  })();

  try {
    await invalidSessionCleanupPromise;
  } finally {
    invalidSessionCleanupPromise = null;
  }
}

function getTelegramRateLimitAccountId() {
  const sessionString = normalizeSessionString(runtimeSessionString);
  const identity = sessionString
    ? crypto.createHash('sha256').update(sessionString).digest('hex')
    : `login:${runtimeApiId || 'unknown'}:${lifecycleState.loginGeneration}`;
  return `telegram-session:${identity}`;
}

function getTelegramRateLimitState() {
  const accountId = getTelegramRateLimitAccountId();
  const current = rateLimitInterceptor.getState(accountId);
  return {
    success: true,
    current: {
      ...current,
      status: current.paused ? 'rate-limited' : activeTelegramStatus,
      category: current.paused ? 'flood' : activeTelegramStatusCategory,
      ...(activeTelegramStatusError ? { error: activeTelegramStatusError } : {}),
    },
    pausedAccounts: rateLimitInterceptor.getSnapshot(),
  };
}

function getTelegramStatus() {
  const rateLimitState = getTelegramRateLimitState().current;
  return {
    success: true,
    accountId: rateLimitState.accountId,
    status: rateLimitState.status,
    category: rateLimitState.category,
    ...(rateLimitState.error ? { error: rateLimitState.error } : {}),
  };
}

async function waitForTelegramRateLimit() {
  const accountId = getTelegramRateLimitAccountId();
  const state = await rateLimitInterceptor.waitUntilAvailable(accountId);
  return { success: true, state };
}

function enqueueTelegramPublish(type, operation) {
  const accountId = getTelegramRateLimitAccountId();
  const loginGeneration = lifecycleState.loginGeneration;
  return trackTelegramOperation(type, () => rateLimitInterceptor.enqueue(accountId, async () => {
    assertTelegramRunning();
    if (
      loginGeneration !== lifecycleState.loginGeneration
      || accountId !== getTelegramRateLimitAccountId()
    ) {
      const cancelledError = new Error('Telegram operation was cancelled after the account changed.');
      cancelledError.code = 'TELEGRAM_REQUEST_CANCELLED';
      throw cancelledError;
    }
    return operation();
  }));
}

async function telegramRequest(request) {
  assertTelegramRunning();
  const accountId = getTelegramRateLimitAccountId();
  const loginGeneration = lifecycleState.loginGeneration;

  return rateLimitInterceptor.run(accountId, async () => {
    assertTelegramRunning();
    if (
      loginGeneration !== lifecycleState.loginGeneration ||
      accountId !== getTelegramRateLimitAccountId()
    ) {
      const cancelledError = new Error('Telegram request was cancelled after the account changed.');
      cancelledError.code = 'TELEGRAM_REQUEST_CANCELLED';
      throw cancelledError;
    }

    try {
      const result = await request();
      activeTelegramStatus = 'normal';
      activeTelegramStatusError = null;
      activeTelegramStatusCategory = null;
      return result;
    } catch (error) {
      const classification = classifyTelegramError(error);
      if (classification.category === 'cancelled') {
        throw classification.error;
      }
      const statusByCategory = {
        slowmode: 'slowmode',
        auth: 'auth required',
        network: 'network/retrying',
        permission: 'error',
        unknown: 'error',
      };

      activeTelegramStatus = statusByCategory[classification.category] || 'error';
      activeTelegramStatusError = error instanceof Error ? error.message : String(error);
      activeTelegramStatusCategory = classification.category;
      notifyTelegramStatus({
        status: activeTelegramStatus,
        connected: Boolean(client?.connected),
        error: activeTelegramStatusError,
        category: classification.category,
        retryable: classification.retryable,
      });

      if (!isInvalidTelegramSessionError(error)) {
        throw error;
      }

      await invalidateTelegramSession();
      const reauthError = new Error(INVALID_SESSION_MESSAGE);
      reauthError.code = 'TELEGRAM_SESSION_INVALID';
      throw reauthError;
    }
  });
}

// =========================================================
// TELEGRAM STATUS
// =========================================================

function setTelegramStatusCallback(callback) {
  telegramStatusCallback = callback;
}

function notifyTelegramStatus(status) {
  if (typeof telegramStatusCallback === 'function') {
    telegramStatusCallback(status);
  }
}

const {
  reconnectTelegram,
  startTelegramReconnect,
  stopTelegramReconnect,
} = createTelegramReconnect({
  assertRunning: assertTelegramRunning,
  getClient: () => client,
  lifecycleState,
  notifyStatus: notifyTelegramStatus,
  runShared,
  stopReconnect,
  telegramRequest,
  trackOperation: trackTelegramOperation,
  withTimeout,
});

// =========================================================
// CONNECT
// =========================================================

async function connectTelegramInternal({ allowSignedOut = false } = {}) {

  assertTelegramRunning();
  lifecycleState.status = 'connecting';

  refreshRuntimeSecrets();

  if (!runtimeApiId || !runtimeApiHash) {
    lifecycleState.status = 'disconnected';
    const error = new Error('Telegram API credentials are missing in the secure Electron userData config.');
    error.code = 'TELEGRAM_CREDENTIALS_MISSING';
    throw error;
  }

  if (!runtimeSessionString) {
    lifecycleState.status = 'disconnected';
    const error = new Error('No saved Telegram session is available. Sign in again to continue.');
    error.code = 'TELEGRAM_SESSION_MISSING';
    throw error;
  }

  if (runtimeSignedOut && !allowSignedOut) {
    const error = new Error('Telegram account is signed out. Welcome back to reconnect.');
    error.code = 'TELEGRAM_SIGNED_OUT';
    lifecycleState.status = 'disconnected';
    throw error;
  }

  // =======================================================
  // УЖЕ ПОДКЛЮЧЕН
  // =======================================================

  if (client && client.connected) {

    notifyTelegramStatus('connected');
    lifecycleState.status = 'connected';

    return client;
  }

  // =======================================================
  // ПЕРЕПОДКЛЮЧЕНИЕ СУЩЕСТВУЮЩЕГО CLIENT
  // =======================================================

  if (client && !client.connected) {

    console.log(
      'Telegram disconnected. Reconnecting...'
    );

    notifyTelegramStatus('reconnecting');

    const reconnectGeneration = lifecycleState.reconnectGeneration;
    const clientToReconnect = client;

    try {

      await telegramRequest(() => withTimeout(
        clientToReconnect.connect(),
        REQUEST_TIMEOUT,
        'Telegram reconnect'
      ));

      if (
        reconnectGeneration !== lifecycleState.reconnectGeneration ||
        lifecycleState.status === 'shutting-down' ||
        lifecycleState.status === 'stopped' ||
        client !== clientToReconnect
      ) {
        try {
          await clientToReconnect.disconnect();
        } catch (disconnectError) {
          console.error('Stale Telegram reconnect disconnect failed:', disconnectError?.code || disconnectError?.name || 'unknown');
        }

        throw new Error('Telegram reconnect was cancelled.');
      }

      console.log(
        'Telegram reconnected'
      );

      notifyTelegramStatus('connected');


      startTelegramReconnect();
      lifecycleState.status = 'connected';

      return clientToReconnect;

    } catch (error) {

      console.error('Telegram reconnect error:', error?.code || error?.name || 'unknown');

      if (error?.code !== 'TELEGRAM_SESSION_INVALID') {
        notifyTelegramStatus('disconnected');
      }

      throw error;
    }
  }

  // =======================================================
  // СОЗДАЁМ НОВЫЙ CLIENT
  // =======================================================

  client = new TelegramClient(
    new StringSession(runtimeSessionString),
    runtimeApiId,
    runtimeApiHash,
    {
      connectionRetries: 5
    }
  );

  const connectGeneration = lifecycleState.reconnectGeneration;
  const clientToConnect = client;
  const recoveryUpdateTypes = [Api.UpdateMessageID, Api.UpdateNewMessage, Api.UpdateNewChannelMessage];
  if (typeof clientToConnect.addEventHandler === 'function'
    && recoveryUpdateTypes.every((type) => typeof type === 'function')) {
    clientToConnect.addEventHandler(
      (update) => telegramSendRecovery.observeUpdate(update),
      new Raw({ types: recoveryUpdateTypes }),
    );
  }

  notifyTelegramStatus('connecting');

  try {
    await telegramRequest(() => withTimeout(
      clientToConnect.connect(),
      REQUEST_TIMEOUT,
      'Telegram connect'
    ));
  } catch (error) {
    if (client === clientToConnect) {
      client = null;
      if (lifecycleState.status !== 'shutting-down' && lifecycleState.status !== 'stopped') {
        lifecycleState.status = 'disconnected';
        if (error?.code !== 'TELEGRAM_SESSION_INVALID') {
          notifyTelegramStatus('disconnected');
        }
      }
    }

    void Promise.resolve()
      .then(() => clientToConnect.disconnect())
      .catch((disconnectError) => {
        console.error('Telegram disconnect after connect failure failed:', disconnectError?.code || disconnectError?.name || 'unknown');
      });

    throw error;
  }

  if (
    connectGeneration !== lifecycleState.reconnectGeneration ||
    lifecycleState.status === 'shutting-down' ||
    lifecycleState.status === 'stopped' ||
    client !== clientToConnect
  ) {
    if (client === clientToConnect) {
      client = null;
    }

    try {
      await clientToConnect.disconnect();
    } catch (error) {
      console.error('Stale Telegram client disconnect failed:', error?.code || error?.name || 'unknown');
    }

    throw new Error('Telegram connect was cancelled.');
  }

  console.log(
    'Telegram connected'
  );

  notifyTelegramStatus('connected');
  lifecycleState.status = 'connected';

  startTelegramReconnect();

  return client;
}

function connectTelegram() {
  assertTelegramRunning();
  return runShared(lifecycleState, 'connectPromise', () =>
    trackTelegramOperation('connect', connectTelegramInternal)
  );
}

async function welcomeBackInternal() {
  const connectedClient = await connectTelegramInternal({ allowSignedOut: true });

  if (!setTelegramSignedOut(false)) {
    stopTelegramReconnect();
    client = null;
    lifecycleState.status = 'disconnected';

    try {
      await connectedClient.disconnect();
    } catch (error) {
      console.error('Telegram disconnect after signed-out state failure:', error?.code || error?.name || 'unknown');
    }

    throw new Error('Telegram signed-out state could not be cleared securely.');
  }

  runtimeSignedOut = false;
  return connectedClient;
}

function welcomeBack() {
  assertTelegramRunning();
  return runShared(lifecycleState, 'connectPromise', () =>
    trackTelegramOperation('welcome-back', welcomeBackInternal)
  );
}

async function shutdownTelegram() {
  if (shutdownPromise) return shutdownPromise;

  shutdownPromise = beginShutdown(lifecycleState, async () => {
    rateLimitInterceptor.clearAll();
    await clearPendingLogin();

    const pending = [...lifecycleState.pendingOperations.values()]
      .map((operation) => operation.promise)
      .filter(Boolean);

    if (pending.length > 0) {
      try {
        await withTimeout(
          Promise.allSettled(pending),
          REQUEST_TIMEOUT,
          'Telegram shutdown drain'
        );
      } catch (error) {
        console.error('Telegram shutdown drain timed out. Underlying operations may still be running.');
      }
    }

    const clientToClear = client;
    client = null;
    runtimeSessionString = '';

    if (clientToClear) {
      try {
        await clientToClear.disconnect();
      } catch (error) {
        console.error('Telegram shutdown disconnect failed:', error?.code || error?.name || 'unknown');
      }
    }

    console.log('Telegram disconnected.');
    notifyTelegramStatus({ status: 'disconnected', connected: false });
  });

  return shutdownPromise;
}

// =========================================================
// GET CHATS
// =========================================================

const chatData = createTelegramChatData({
  Api,
  connectTelegram,
  getClient: () => client,
  telegramRequest,
  withTimeout,
});
const {
  getChatAvatarDataUrl,
  getChatsInternal,
  getChatAvatarInternal,
  getAccountAvatarInternal,
  getChatPermissionsInternal,
  getChatHistoryInternal,
  deleteSavedMessageInternal,
  getContactsInternal,
  getAvailableEffectsInternal,
} = chatData;

function getChats() {
  return trackTelegramOperation('getChats', getChatsInternal);
}

function getChatAvatar(chatId) {
  return trackTelegramOperation('getChatAvatar', () => getChatAvatarInternal(chatId));
}

function getAccountAvatar() {
  return trackTelegramOperation('getAccountAvatar', getAccountAvatarInternal);
}

function getChatPermissions(chatId) {
  return trackTelegramOperation('getChatPermissions', () => getChatPermissionsInternal(chatId));
}

function getChatHistory(chatId, limit, offsetId) {
  return trackTelegramOperation('getChatHistory', () =>
    getChatHistoryInternal(chatId, limit, offsetId)
  );
}

function deleteSavedMessage(chatId, messageId) {
  return trackTelegramOperation('deleteSavedMessage', () =>
    deleteSavedMessageInternal(chatId, messageId)
  );
}

// =========================================================
// GET TELEGRAM CONTACTS
// =========================================================

function getContacts() {
  return trackTelegramOperation('getContacts', getContactsInternal);
}

function getAvailableEffects() {
  return trackTelegramOperation('getAvailableEffects', getAvailableEffectsInternal);
}

const { resolveChatInternal } = createTelegramChatResolver({
  connectTelegram,
  getChatAvatarDataUrl,
  getClient: () => client,
  getContacts,
  telegramRequest,
  withTimeout,
});

function resolveChat(query) {
  return trackTelegramOperation('resolveChat', () => resolveChatInternal(query));
}

// =========================================================
// SEND MESSAGE
// =========================================================

const sendMessageInternal = createTelegramSender({
  connectTelegram,
  getClient: () => client,
  getTelegramRequestTimeout,
  logTelegramOperation,
  normalizeTelegramMessage,
  prepareInlineKeyboard,
  observeTelegramResponse: telegramSendRecovery.observeResponse,
  telegramRequest,
  trackSendAttempt: telegramSendRecovery.trackSendAttempt,
  toTelegramFormattingEntities,
  withTelegramInvokeDiagnostics,
  withTimeout,
});

function sendMessage(chatId, message, attachments, entities, replyMarkup, silent, effect, idempotencyKey) {
  return enqueueTelegramPublish('send', () => sendMessageInternal(
    chatId,
    message,
    attachments,
    entities,
    replyMarkup,
    silent,
    effect,
    idempotencyKey,
  ));
}

async function reconcileSendAttempt(idempotencyKey, attachmentCount = 0) {
  telegramSendRecovery.trackSendAttempt(idempotencyKey, attachmentCount);
  try {
    const connectedClient = await connectTelegram();
    if (typeof connectedClient.catchUp === 'function') {
      await telegramRequest(() => withTimeout(
        connectedClient.catchUp(),
        REQUEST_TIMEOUT,
        'Telegram send recovery',
      ));
    }
    const result = telegramSendRecovery.getResult(idempotencyKey, attachmentCount);
    return result
      ? { success: true, state: 'sent', ...result }
      : { success: true, state: 'unknown' };
  } catch (error) {
    return {
      success: false,
      state: 'unknown',
      error: error instanceof Error ? error.message : 'Telegram send result could not be checked.',
    };
  }
}

function setTelegramSendResultCallback(callback) {
  telegramSendResultCallback = typeof callback === 'function' ? callback : null;
}

// =========================================================
// SCHEDULE MESSAGE
// =========================================================

const {
  reconcilePendingScheduleInternal,
  scheduleMessageInternal,
  cancelScheduledMessageInternal,
} = createTelegramScheduler({
  Api,
  connectTelegram,
  getClient: () => client,
  getTelegramRequestTimeout,
  scheduleCleanupRetryDelay: options.scheduleCleanupRetryDelay,
  telegramRequest,
  withTimeout,
});

function scheduleMessage(chatId, message, date, time, targetTimestamp, attachments, entities, replyMarkup, silent, effect) {
  return enqueueTelegramPublish('schedule', () => scheduleMessageInternal(
    chatId,
    message,
    date,
    time,
    targetTimestamp,
    attachments,
    entities,
    replyMarkup,
    silent,
    effect,
  ));
}

function reconcilePendingSchedule(operation) {
  return trackTelegramOperation('reconcilePendingSchedule', () => reconcilePendingScheduleInternal(operation));
}

// =========================================================
// CANCEL SCHEDULED MESSAGE
// =========================================================

function cancelScheduledMessage(chatId, messageId, message, targetTimestamp) {
  return trackTelegramOperation('cancel', () => cancelScheduledMessageInternal(
    chatId,
    messageId,
    message,
    targetTimestamp
  ));
}

// =========================================================
// EXPORTS
// =========================================================

  return {
    getTelegramConfig,
    saveTelegramApiCredentials,
    saveTelegramCredentials,
    signOutKeepSession,
    welcomeBack,
    forgetTelegramAccount,
    clearTelegramSession,
    loginUser,
    connectTelegram,
    getChats,
    getChatPermissions,
    getChatAvatar,
    getAccountAvatar,
    getChatHistory,
    deleteSavedMessage,
    getContacts,
    getAvailableEffects,
    resolveChat,
    getScheduleOperationIdentities,
    sendMessage,
    reconcileSendAttempt,
    scheduleMessage,
    reconcilePendingSchedule,
    cancelScheduledMessage,
    getTelegramRateLimitState,
    getTelegramStatus,
    waitForTelegramRateLimit,
    shutdownTelegram,
    setTelegramStatusCallback,
    setTelegramSendResultCallback,
    lifecycleState,
    resolveMessageDirection,
    normalizeHistoryMessage,
  };
}

const defaultCore = createTelegramCore();

module.exports = {
  createTelegramCore,
  getTelegramConfig: (...args) => defaultCore.getTelegramConfig(...args),
  saveTelegramApiCredentials: (...args) => defaultCore.saveTelegramApiCredentials(...args),
  saveTelegramCredentials: (...args) => defaultCore.saveTelegramCredentials(...args),
  signOutKeepSession: (...args) => defaultCore.signOutKeepSession(...args),
  welcomeBack: (...args) => defaultCore.welcomeBack(...args),
  forgetTelegramAccount: (...args) => defaultCore.forgetTelegramAccount(...args),
  clearTelegramSession: (...args) => defaultCore.clearTelegramSession(...args),
  loginUser: (...args) => defaultCore.loginUser(...args),
  connectTelegram: (...args) => defaultCore.connectTelegram(...args),
  getChats: (...args) => defaultCore.getChats(...args),
  getChatPermissions: (...args) => defaultCore.getChatPermissions(...args),
  getChatAvatar: (...args) => defaultCore.getChatAvatar(...args),
  getAccountAvatar: (...args) => defaultCore.getAccountAvatar(...args),
  getChatHistory: (...args) => defaultCore.getChatHistory(...args),
  deleteSavedMessage: (...args) => defaultCore.deleteSavedMessage(...args),
  getContacts: (...args) => defaultCore.getContacts(...args),
  normalizeQuery,
  normalizePhone,
  isPhoneLikeQuery,
  isUsernameQuery,
  getAvailableEffects: (...args) => defaultCore.getAvailableEffects(...args),
  resolveChat: (...args) => defaultCore.resolveChat(...args),
  getScheduleOperationIdentities: (...args) => defaultCore.getScheduleOperationIdentities(...args),
  sendMessage: (...args) => defaultCore.sendMessage(...args),
  reconcileSendAttempt: (...args) => defaultCore.reconcileSendAttempt(...args),
  setTelegramSendResultCallback: (...args) => defaultCore.setTelegramSendResultCallback(...args),
  scheduleMessage: (...args) => defaultCore.scheduleMessage(...args),
  reconcilePendingSchedule: (...args) => defaultCore.reconcilePendingSchedule(...args),
  cancelScheduledMessage: (...args) => defaultCore.cancelScheduledMessage(...args),
  getTelegramRateLimitState: (...args) => defaultCore.getTelegramRateLimitState(...args),
  getTelegramStatus: (...args) => defaultCore.getTelegramStatus(...args),
  waitForTelegramRateLimit: (...args) => defaultCore.waitForTelegramRateLimit(...args),
  shutdownTelegram: (...args) => defaultCore.shutdownTelegram(...args),
  setTelegramStatusCallback: (...args) => defaultCore.setTelegramStatusCallback(...args),
  resolveMessageDirection,
  normalizeHistoryMessage,
};