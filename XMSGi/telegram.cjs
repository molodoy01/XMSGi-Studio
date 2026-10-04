const crypto = require('node:crypto');
const { TelegramClient, Api } = require('teleproto');
const { StringSession } = require('teleproto/sessions');
const { normalizeDialogChats } = require('./telegram-dialogs.cjs');
const { fromTelegramInlineKeyboard, prepareInlineKeyboard } = require('./telegram-inline-keyboard.cjs');
const {
  classifyTelegramError,
  createTelegramRateLimitInterceptor,
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
  withTimeout: withLifecycleTimeout
} = require('./telegram-lifecycle.cjs');
const {
  normalizeQuery,
  normalizePhone,
  isPhoneLikeQuery,
  isUsernameQuery
} = require('./telegram-search.cjs');
const { findDialogByTitle } = require('./telegram-dialog-search.cjs');
const { deriveChatPermissions, isPermissionError } = require('./telegram-permissions.cjs');
const { applyTelegramIdempotency } = require('./telegram-idempotency.cjs');
const { findRecentSentMessage } = require('./schedule-history.cjs');

function normalizeSessionString(value) {
  return typeof value === 'string'
    ? value.trim()
    : '';
}

function getTelegramUserName(user) {
  return [user?.firstName, user?.lastName]
    .filter(Boolean)
    .join(' ')
    .trim();
}

function updateRuntimeSecretsFromConfig(nextSecrets = loadAccountSecrets()) {
  const apiId = nextSecrets.API_ID;
  const apiHash = nextSecrets.API_HASH;
  const sessionString = normalizeSessionString(nextSecrets.SESSION_STRING);

  return {
    apiId: apiId ? Number(apiId) : undefined,
    apiHash,
    sessionString,
    signedOut: nextSecrets.signedOut === true
  };
}

function getSecretValue(key) {
  const secrets = loadAccountSecrets();

  if (secrets[key]) {
    return secrets[key];
  }

  return undefined;
}

function createTelegramCore(options = {}) {
  const lifecycleState = createLifecycleState();
  const rateLimitInterceptor = createTelegramRateLimitInterceptor(options.rateLimitTimers);
  let runtimeApiId = Number(options.apiId ?? getSecretValue('API_ID'));
  let runtimeApiHash = options.apiHash ?? getSecretValue('API_HASH');
  let runtimeSessionString = normalizeSessionString(
    options.sessionString ?? getSecretValue('SESSION_STRING')
  );
  let runtimeSignedOut = false;

function refreshRuntimeSecrets() {
  const next = updateRuntimeSecretsFromConfig(loadAccountSecrets());
  runtimeApiId = Number(next.apiId);
  runtimeApiHash = next.apiHash;
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
    : { signedOut: secrets.signedOut, userName: '' };
  const apiId = secrets.API_ID;
  const apiHash = secrets.API_HASH;
  const sessionString = normalizeSessionString(secrets.SESSION_STRING);

  return {
    hasCredentials: Boolean(apiId && apiHash),
    hasSession: Boolean(sessionString),
    signedOut: storedAuthState.signedOut === true,
    userName: storedAuthState.userName || '',
    connected: Boolean(client && client.connected)
  };
}

async function saveTelegramCredentials(data = {}) {
  const rawApiId = data.API_ID ?? data.apiId;
  const rawApiHash = data.API_HASH ?? data.apiHash;
  const rawSession = data.SESSION_STRING ?? data.sessionString;
  const rawUserName = data.userName;

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
  const apiIdValue = params.API_ID ?? params.apiId ?? getSecretValue('API_ID');
  const apiHashValue = params.API_HASH ?? params.apiHash ?? getSecretValue('API_HASH');
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

    const credentialsResult = await saveTelegramCredentials({
      API_ID: loginApiId,
      API_HASH: String(apiHashValue),
      SESSION_STRING: session,
      userName: getTelegramUserName(user),
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
let activeTelegramStatus = 'normal';
let activeTelegramStatusError = null;
let activeTelegramStatusCategory = null;
let invalidSessionCleanupPromise = null;
let shutdownPromise = null;

const REQUEST_TIMEOUT = 15000;
const INVALID_SESSION_MESSAGE = 'Telegram session expired or revoked. Please sign in again.';

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

function getTelegramErrorText(error) {
  if (!error) return '';

  return [
    error.code,
    error.errorCode,
    error.errorMessage,
    error.message,
    error.name
  ]
    .filter(Boolean)
    .join(' ');
}

function isInvalidTelegramSessionError(error) {
  const text = getTelegramErrorText(error);

  return /AUTH_KEY_UNREGISTERED|AUTH_KEY_INVALID|SESSION_REVOKED|SESSION_EXPIRED|AUTHORIZATION_REVOKED|AUTHORIZATION_EXPIRED|(?:revoked|expired|invalid)\s+(?:telegram\s+)?(?:session|authorization)|(?:telegram\s+)?(?:session|authorization)\s+(?:revoked|expired|invalid)/i.test(text);
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

// =========================================================
// TIMEOUT
// =========================================================
function withTimeout(promise, timeout, operation) {
  return withLifecycleTimeout(
    promise,
    timeout,
    operation
  );
}

async function checkInternetConnection() {
  return new Promise((resolve, reject) => {
    const request = https.get(
      'https://telegram.org',
      {
        timeout: 5000
      },
      (response) => {
        response.resume();
        if (
          response.statusCode >= 200 &&
          response.statusCode < 500
        ) {
          resolve(true);
        } else {
          reject(
            new Error(
              'Internet check failed: HTTP ' +
              response.statusCode
            )
          );
        }
      }
    );

    request.on('error', reject);

    request.on('timeout', () => {
      request.destroy();

      reject(
        new Error(
          'Internet check timeout'
        )
      );
    });
  });
}

// =========================================================
// TELEGRAM FORCE RECONNECT
// =========================================================

async function reconnectTelegramInternal() {

  assertTelegramRunning();
  lifecycleState.status = 'reconnecting';

  if (!client) {
    return;
  }

  if (lifecycleState.reconnectInProgress) {
    return;
  }

  lifecycleState.reconnectInProgress = true;

  notifyTelegramStatus('reconnecting');

  try {

    try {

      if (client.connected) {
        await client.disconnect();
      }

    } catch (error) {

      console.error('Telegram disconnect during reconnect failed:', error?.code || error?.name || 'unknown');
    }

    await telegramRequest(() => withTimeout(
      client.connect(),
      REQUEST_TIMEOUT,
      'Telegram reconnect'
    ));

    console.log('Telegram reconnected.');

    notifyTelegramStatus('connected');
    lifecycleState.status = 'connected';

    return true;

  } catch (error) {

    if (error?.code === 'TELEGRAM_SESSION_INVALID') {
      throw error;
    }

    console.error('Telegram reconnect failed:', error?.code || error?.name || 'unknown');

    notifyTelegramStatus('disconnected');
    lifecycleState.status = 'disconnected';

    return false;

  } finally {

    lifecycleState.reconnectInProgress = false;
  }
}

function reconnectTelegram() {
  assertTelegramRunning();
  return runShared(lifecycleState, 'connectPromise', () =>
    trackTelegramOperation('reconnect', reconnectTelegramInternal)
  );
}

// =========================================================
// TELEGRAM AUTO RECONNECT WATCHDOG
// =========================================================

function startTelegramReconnect() {

  if (lifecycleState.reconnectTimer || lifecycleState.status === 'shutting-down' || lifecycleState.status === 'stopped') {
    return;
  }

  const watchdogGeneration = lifecycleState.reconnectGeneration;
  const watchdogClient = client;
  let internetWasOffline = false;
  let reconnectDelay = 3000;
  let nextReconnectAt = 0;

  lifecycleState.reconnectTimer = setInterval(async () => {

    if (
      lifecycleState.reconnectGeneration !== watchdogGeneration ||
      client !== watchdogClient ||
      !client
    ) {
      return;
    }

    if (lifecycleState.reconnectInProgress) {
      return;
    }

    try {

      // ===================================================
      // ПРОВЕРКА ИНТЕРНЕТА
      // ===================================================

      await checkInternetConnection();

      if (internetWasOffline) {
        internetWasOffline = false;
        nextReconnectAt = 0;
        reconnectDelay = 3000;
      }

      if (
        !client.connected &&
        Date.now() >= nextReconnectAt &&
        lifecycleState.reconnectGeneration === watchdogGeneration &&
        client === watchdogClient
      ) {
        console.log(
          `Telegram reconnect attempt (backoff ${reconnectDelay} ms)`
        );

        const reconnected = await reconnectTelegram();

        if (reconnected) {
          reconnectDelay = 3000;
          nextReconnectAt = 0;
        } else if (client === watchdogClient) {
          nextReconnectAt = Date.now() + reconnectDelay;
          reconnectDelay = Math.min(reconnectDelay * 2, 30000);
        }
      }

    } catch (error) {

      // ===================================================
      // ИНТЕРНЕТ ПОТЕРЯН
      // ===================================================

      if (!internetWasOffline) {

        console.log(
          'Internet connection lost'
        );

        notifyTelegramStatus('reconnecting');
      }

      internetWasOffline = true;
    }

  }, 3000);
}

function stopTelegramReconnect() {
  stopReconnect(lifecycleState);
}

// =========================================================
// CONNECT
// =========================================================

async function connectTelegramInternal({ allowSignedOut = false } = {}) {

  assertTelegramRunning();
  lifecycleState.status = 'connecting';

  refreshRuntimeSecrets();

  if (!runtimeApiId || !runtimeApiHash || !runtimeSessionString) {

    throw new Error(
      'Telegram credentials are missing in the secure Electron userData config'
    );
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

  notifyTelegramStatus('connecting');

  await telegramRequest(() => clientToConnect.connect());

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

async function getChatAvatarDataUrl(entity) {
  if (!entity) return '';

  try {
    const avatar = await telegramRequest(() => withTimeout(
      client.downloadProfilePhoto(entity),
      REQUEST_TIMEOUT,
      'Loading Telegram chat avatar'
    ));

    if (avatar && (Buffer.isBuffer(avatar) || avatar instanceof Uint8Array)) {
      return `data:image/jpeg;base64,${Buffer.from(avatar).toString('base64')}`;
    }
  } catch (error) {
    console.error('Telegram chat avatar unavailable:', error?.code || error?.name || 'unknown');
  }

  return '';
}

async function getChatsInternal() {

  if (!client) {
    await connectTelegram();
  }

  const dialogs = await telegramRequest(() => client.getDialogs({
    limit: undefined
  }));

  const chats = normalizeDialogChats(dialogs, getPublicChatType, getEntityDisplayName);

  try {

    const me = await telegramRequest(() => client.getMe());

    const myId = me.id?.toString();

    if (myId) {

      const filteredChats = chats.filter(
        (chat) => chat.id !== myId
      );

      filteredChats.unshift({
        id: myId,
        name: 'Saved Messages',
        username: '',
        type: 'private',
        avatarDataUrl: ''
      });

      return filteredChats;
    }

  } catch (error) {

    if (error?.code === 'TELEGRAM_SESSION_INVALID') {
      throw error;
    }

    console.error('Failed to add Saved Messages:', error?.code || error?.name || 'unknown');
  }

  return chats;
}

function getChats() {
  return trackTelegramOperation('getChats', getChatsInternal);
}

async function getChatAvatarInternal(chatId) {
  if (!client) await connectTelegram();
  const entity = await telegramRequest(() => client.getEntity(chatId));
  return getChatAvatarDataUrl(entity);
}

function getChatAvatar(chatId) {
  return trackTelegramOperation('getChatAvatar', () => getChatAvatarInternal(chatId));
}

function getPermissionStatus({ canView = true, canSend = null, canSchedule = null, error = '' } = {}) {
  return { canView, canSend, canSchedule, ...(error ? { error } : {}) };
}

async function getChatPermissionsInternal(chatId) {
  if (!client) await connectTelegram();

  try {
    const entity = await telegramRequest(() => client.getEntity(chatId));
    if (!entity) return getPermissionStatus({ canView: false });

    if (entity instanceof Api.User || entity?.className === 'User') {
      return getPermissionStatus(deriveChatPermissions({ entityClass: 'User' }));
    }

    if (entity instanceof Api.Chat || entity?.className === 'Chat') {
      const full = await telegramRequest(() => client.api.messages.getFullChat({ chatId: entity.id }));
      const fullChat = full?.fullChat;
      const rights = entity.defaultBannedRights || fullChat?.defaultBannedRights;
      return getPermissionStatus(deriveChatPermissions({ entityClass: 'Chat', defaultBannedRights: rights }));
    }

    if (entity instanceof Api.Channel || entity?.className === 'Channel') {
      const full = await telegramRequest(() => client.api.channels.getFullChannel({ channel: entity }));
      let participant = null;

      try {
        participant = await telegramRequest(() => client.getParticipant(entity, 'me'));
      } catch (error) {
        if (isPermissionError(error)) {
          return getPermissionStatus({ canView: true, canSend: false, canSchedule: false, error: 'CHAT_WRITE_FORBIDDEN' });
        }
      }

      const participantClass = participant?.participant?.className || participant?.className || '';
      const participantRights = participant?.participant?.bannedRights || participant?.bannedRights;
      const adminRights = participant?.participant?.adminRights || participant?.adminRights;
      const isCreator = participantClass === 'ChannelParticipantCreator';
      const isAdmin = participantClass === 'ChannelParticipantAdmin';
      const isBroadcast = entity.megagroup !== true;

      const defaultRights = entity.defaultBannedRights || full?.fullChat?.defaultBannedRights;
      return getPermissionStatus(deriveChatPermissions({
        entityClass: 'Channel',
        megagroup: entity.megagroup === true,
        defaultBannedRights: defaultRights,
        participantClass: isCreator
          ? 'ChannelParticipantCreator'
          : isAdmin
            ? 'ChannelParticipantAdmin'
            : participantClass,
        participantRights,
        adminRights,
      }));
    }

    return getPermissionStatus();
  } catch (error) {
    if (isPermissionError(error)) {
      return getPermissionStatus({ canView: true, canSend: false, canSchedule: false, error: 'CHAT_WRITE_FORBIDDEN' });
    }

    return getPermissionStatus({ error: 'PERMISSION_UNKNOWN' });
  }
}

function getChatPermissions(chatId) {
  return trackTelegramOperation('getChatPermissions', () => getChatPermissionsInternal(chatId));
}

function toPreviewNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

async function getPreviewMedia(message) {
  const file = message.file;
  const media = message.photo
    ? { kind: 'photo' }
    : message.video
      ? { kind: 'video' }
      : message.audio
        ? { kind: 'audio' }
        : message.document
          ? { kind: 'document' }
          : null;

  if (!media) return undefined;

  const result = {
    ...media,
    name: file?.name || '',
    mimeType: file?.mimeType || '',
    size: toPreviewNumber(file?.size),
    duration: toPreviewNumber(file?.duration),
    width: toPreviewNumber(file?.width),
    height: toPreviewNumber(file?.height)
  };

  if (media.kind === 'photo' || media.kind === 'video') {
    try {
      const useOriginalPhoto = media.kind === 'photo'
        && (!result.size || result.size <= 8 * 1024 * 1024);
      const downloadedMedia = await message.downloadMedia(
        useOriginalPhoto ? undefined : { thumb: 1 },
      );

      if (downloadedMedia && (Buffer.isBuffer(downloadedMedia) || downloadedMedia instanceof Uint8Array)) {
        const mimeType = media.kind === 'photo' ? 'image/jpeg' : 'video/jpeg';
        const dataUrl = `data:${mimeType};base64,${Buffer.from(downloadedMedia).toString('base64')}`;
        if (useOriginalPhoto) {
          result.dataUrl = dataUrl;
        } else {
          result.thumbnailDataUrl = dataUrl;
        }
      } else if (media.kind === 'photo') {
        const thumbnail = await message.downloadMedia({ thumb: 1 });
        if (thumbnail && (Buffer.isBuffer(thumbnail) || thumbnail instanceof Uint8Array)) {
          result.thumbnailDataUrl = `data:image/jpeg;base64,${Buffer.from(thumbnail).toString('base64')}`;
        }
      }
    } catch (error) {
      console.error('Telegram media thumbnail unavailable:', error?.code || error?.name || 'unknown');
    }
  }

  if (media.kind === 'audio' && result.size && result.size <= 10 * 1024 * 1024) {
    try {
      const audio = await message.downloadMedia();

      if (audio && (Buffer.isBuffer(audio) || audio instanceof Uint8Array)) {
        result.dataUrl = `data:${result.mimeType || 'audio/mpeg'};base64,${Buffer.from(audio).toString('base64')}`;
      }
    } catch (error) {
      console.error('Telegram audio preview unavailable:', error?.code || error?.name || 'unknown');
    }
  }

  return result;
}

async function getChatHistoryInternal(chatId, limit = 50) {
  if (!client) {
    await connectTelegram();
  }

  const target = chatId === 'me' ? 'me' : chatId;
  const entity = await telegramRequest(() => withTimeout(
    client.getEntity(target),
    REQUEST_TIMEOUT,
    'Resolving Telegram chat for history'
  ));
  const messages = await telegramRequest(() => withTimeout(
    client.getMessages(entity, { limit }),
    REQUEST_TIMEOUT,
    'Loading Telegram chat history'
  ));

  let avatarDataUrl = '';

  try {
    const avatar = await telegramRequest(() => withTimeout(
      client.downloadProfilePhoto(entity),
      REQUEST_TIMEOUT,
      'Loading Telegram chat avatar'
    ));

    if (avatar && (Buffer.isBuffer(avatar) || avatar instanceof Uint8Array)) {
      avatarDataUrl = `data:image/jpeg;base64,${Buffer.from(avatar).toString('base64')}`;
    }
  } catch (error) {
    console.error('Telegram chat avatar unavailable:', error?.code || error?.name || 'unknown');
  }

  const normalizedMessages = (await Promise.all([...(messages || [])]
    .filter((message) => message && message.id !== undefined)
    .map(async (message) => {
      const rawDate = message.date instanceof Date
        ? message.date
        : new Date(Number(message.date || 0) * 1000);

      return {
        id: String(message.id),
        text: String(message.message || message.text || ''),
        date: Number.isNaN(rawDate.getTime()) ? new Date(0).toISOString() : rawDate.toISOString(),
        outgoing: message.out === true,
        senderName: getEntityDisplayName(message.sender),
        entities: (message.entities || []).flatMap((entity) => {
          const typeByClassName = {
            MessageEntityBold: 'bold',
            MessageEntityItalic: 'italic',
            MessageEntityUnderline: 'underline',
            MessageEntityStrike: 'strikethrough',
            MessageEntityTextUrl: 'text_url',
          };
          const entityType = entity.className || entity.constructor?.name;
          const type = typeByClassName[entityType];
          return type && Number.isInteger(entity.offset) && Number.isInteger(entity.length)
            ? [{ type, offset: entity.offset, length: entity.length, ...(type === 'text_url' && entity.url ? { url: entity.url } : {}) }]
            : [];
        }),
        mediaType: message.media?.className || '',
        mediaName: message.file?.name || '',
        media: await getPreviewMedia(message),
        replyMarkup: fromTelegramInlineKeyboard(message.replyMarkup),
        groupId: message.groupedId ? String(message.groupedId) : ''
      };
    })))
    .sort((left, right) => new Date(left.date).getTime() - new Date(right.date).getTime());

  return {
    chat: {
      id: String(entity.id || chatId),
      title: getEntityDisplayName(entity),
      username: entity.username || '',
      type: getPublicChatType(entity) || 'private',
      avatarDataUrl,
      topic: ''
    },
    messages: normalizedMessages
  };
}

function getChatHistory(chatId, limit) {
  return trackTelegramOperation('getChatHistory', () =>
    getChatHistoryInternal(chatId, limit)
  );
}

// =========================================================
// GET TELEGRAM CONTACTS
// =========================================================

async function getContactsInternal() {

  if (!client) {
    await connectTelegram();
  }

  try {

    const result = await telegramRequest(() => client.invoke(
      new Api.contacts.GetContacts({
        hash: 0
      })
    ));

    return (result.users || []).map((user) => ({

      id: user.id?.toString(),

      name:
        [
          user.firstName,
          user.lastName
        ]
          .filter(Boolean)
          .join(' ') ||
        'Unnamed contact',

      username: user.username || '',
      phone: user.phone || ''

    }));

  } catch (error) {

    console.error('Failed to get Telegram contacts:', error?.code || error?.name || 'unknown');

    throw error;
  }
}

function getContacts() {
  return trackTelegramOperation('getContacts', getContactsInternal);
}

async function getAvailableEffectsInternal() {
  if (!client) {
    await connectTelegram();
  }

  const result = await telegramRequest(() => withTimeout(
    client.invoke(new Api.messages.GetAvailableEffects({ hash: 0 })),
    REQUEST_TIMEOUT,
    'Loading Telegram effects'
  ));

  const effects = Array.isArray(result?.effects)
    ? result.effects
        .map((effect) => ({
          id: effect?.id != null ? String(effect.id) : '',
          emoticon: typeof effect?.emoticon === 'string' && effect.emoticon.trim() ? effect.emoticon : '✨',
          premiumRequired: Boolean(effect?.premiumRequired)
        }))
        .filter((effect) => effect.id)
    : [];

  return effects;
}

function getAvailableEffects() {
  return trackTelegramOperation('getAvailableEffects', getAvailableEffectsInternal);
}

function getResolvedChatType(entity) {
  const publicType = getPublicChatType(entity);

  if (publicType) {
    return publicType;
  }

  if (entity instanceof Api.User || entity?.className === 'User') {
    return 'private';
  }

  return null;
}

function getPublicChatType(entity) {
  if (!entity) {
    return null;
  }

  if (entity instanceof Api.User || entity?.className === 'User') {
    return null;
  }

  if (entity instanceof Api.Channel || entity?.className === 'Channel') {
    return entity.megagroup ? 'supergroup' : 'channel';
  }

  if (entity instanceof Api.Chat || entity?.className === 'Chat') {
    return 'group';
  }

  if (entity instanceof Api.ChatForbidden || entity?.className === 'ChatForbidden') {
    return 'group';
  }

  return null;
}

function getEntityDisplayName(entity) {
  if (!entity) {
    return '';
  }

  return (
    entity.title ||
    [entity.firstName, entity.lastName].filter(Boolean).join(' ') ||
    entity.username ||
    'Unnamed chat'
  );
}

async function resolveChatByTitleInDialogs(query) {
  const normalized = normalizeQuery(query);

  if (!normalized) {
    return null;
  }

  let me = null;

  try {
    me = await telegramRequest(() => client.getMe());
  } catch (error) {
    if (error?.code === 'TELEGRAM_SESSION_INVALID') {
      throw error;
    }

    console.error('Could not load Telegram profile for dialog title lookup:', error?.code || error?.name || 'unknown');
  }

  const myId = me?.id?.toString();

  try {
    return await findDialogByTitle(client, normalized, {
      excludeId: myId,
      maxResults: 500,
      getName: (entity, dialog) => dialog?.name || getEntityDisplayName(entity),
      getType: (entity) => getResolvedChatType(entity),
      getUsername: (entity) => entity?.username || '',
      getPhone: (entity) => entity?.phone || ''
    });
  } catch (error) {
    if (error?.code === 'TELEGRAM_SESSION_INVALID') {
      throw error;
    }

    console.error('Telegram dialog title lookup failed:', error?.code || error?.name || 'unknown');
  }

  return null;
}

// =========================================================
// RESOLVE TELEGRAM CHAT
// =========================================================

async function resolveChatInternal(query) {

  if (!client) {
    await connectTelegram();
  }

  const originalQuery =
    String(query || '').trim();

  if (!originalQuery) {

    throw new Error(
      'Username, name or phone is empty'
    );
  }

  // =======================================================
  // 1. LOAD OWN CONTACTS
  // =======================================================

  let contacts = [];

  try {

    contacts = await getContacts();

  } catch (error) {

    if (error?.code === 'TELEGRAM_SESSION_INVALID') {
      throw error;
    }

    console.error('Could not load Telegram contacts:', error?.code || error?.name || 'unknown');
  }

  const normalized =
    normalizeQuery(originalQuery);

  const normalizedPhone =
    normalizePhone(originalQuery);

  // =======================================================
  // 2. SEARCH BY PHONE
  // =======================================================

  if (normalizedPhone.length >= 5) {

    const phoneMatch = contacts.find(
      (contact) => {

        const contactPhone =
          normalizePhone(contact.phone);

        return (
          contactPhone &&
          contactPhone === normalizedPhone
        );
      }
    );

    if (phoneMatch) {

      return {

        id: String(phoneMatch.id),

        name: phoneMatch.name,

        username:
          phoneMatch.username || '',

        phone:
          phoneMatch.phone || ''

      };
    }
  }

  // =======================================================
  // 3. SEARCH BY USERNAME
  // =======================================================

  const usernameMatch =
    contacts.find(
      (contact) => {

        const username =
          String(
            contact.username || ''
          )
            .trim()
            .toLowerCase()
            .replace(
              /^@/,
              ''
            );

        return (
          username &&
          username === normalized
        );
      }
    );

  if (usernameMatch) {
    return {

      id: String(usernameMatch.id),

      name: usernameMatch.name,

      username:
        usernameMatch.username || '',

      phone:
        usernameMatch.phone || ''

    };
  }

  // =======================================================
  // 4. SEARCH BY FULL NAME
  // =======================================================

  const nameMatch =
    contacts.find(
      (contact) => {

        const name =
          String(
            contact.name || ''
          )
            .trim()
            .toLowerCase();

        return name === normalized;
      }
    );

  if (nameMatch) {
    return {

      id: String(nameMatch.id),

      name: nameMatch.name,

      username:
        nameMatch.username || '',

      phone:
        nameMatch.phone || ''

    };
  }

  // =======================================================
  // 5. SEARCH BY PARTIAL NAME
  // =======================================================

  const partialNameMatch =
    contacts.find(
      (contact) => {

        const name =
          String(
            contact.name || ''
          )
            .trim()
            .toLowerCase();

        return (
          name &&
          normalized &&
          name.includes(normalized)
        );
      }
    );

  if (partialNameMatch) {
    return {

      id:
        String(partialNameMatch.id),

      name:
        partialNameMatch.name,

      username:
        partialNameMatch.username || '',

      phone:
        partialNameMatch.phone || ''

    };
  }

  if (isPhoneLikeQuery(originalQuery)) {
    throw new Error(
      'Could not find a Telegram contact for phone: ' + originalQuery
    );
  }

  // =======================================================
  // 6. CLEAN USERNAME
  // =======================================================

  const cleanUsername =
    normalizeQuery(originalQuery);

  if (!cleanUsername) {

    throw new Error(
      'Invalid Telegram username or link'
    );
  }

  // =======================================================
  // 7. DIALOG ENTITY SEARCH BY TITLE
  // =======================================================

  const dialogMatch = await resolveChatByTitleInDialogs(originalQuery);

  if (dialogMatch) {
    return dialogMatch;
  }

  if (!isUsernameQuery(originalQuery)) {
    throw new Error(
      'Could not find a Telegram chat: ' + originalQuery
    );
  }

  // =======================================================
  // 8. DIRECT TELEGRAM SEARCH
  // =======================================================

  try {

    const entity =
      await telegramRequest(() => withTimeout(
        client.getEntity(
          cleanUsername
        ),
        REQUEST_TIMEOUT,
        'Telegram entity search'
      ));

    if (!entity) {

      throw new Error(
        'Telegram returned no result'
      );
    }

    const type = getResolvedChatType(entity);

    if (!type) {
      throw new Error(
        'Resolved Telegram entity is not a supported chat'
      );
    }

    const name =
      getEntityDisplayName(entity);

    const avatarDataUrl = await getChatAvatarDataUrl(entity);

    return {

      id:
        entity.id?.toString(),

      name,

      username:
        entity.username || '',

      phone:
        entity.phone || '',

      type,
      avatarDataUrl

    };

  } catch (error) {

    if (error?.code === 'TELEGRAM_SESSION_INVALID') {
      throw error;
    }

    console.error('Telegram direct search failed:', error?.code || error?.name || 'unknown');

    throw new Error(
      'Could not find Telegram chat: ' +
      originalQuery
    );
  }
}

function resolveChat(query) {
  return trackTelegramOperation('resolveChat', () => resolveChatInternal(query));
}

// =========================================================
// SEND MESSAGE
// =========================================================

function toTelegramFormattingEntities(entities = []) {
  return entities.map((entity) => {
    const range = { offset: entity.offset, length: entity.length };
    switch (entity.type) {
      case 'bold': return new Api.MessageEntityBold(range);
      case 'italic': return new Api.MessageEntityItalic(range);
      case 'underline': return new Api.MessageEntityUnderline(range);
      case 'strikethrough': return new Api.MessageEntityStrike(range);
      case 'text_url': return new Api.MessageEntityTextUrl({ ...range, url: entity.url });
      default: throw new Error('Unsupported formatting entity.');
    }
  });
}

function toDebugJson(value) {
  const seen = new WeakSet();
  return JSON.stringify(value, (key, currentValue) => {
    if (typeof currentValue === 'bigint') return `${currentValue}n`;
    if (Buffer.isBuffer(currentValue)) return `<Buffer ${currentValue.toString('hex')}>`;
    if (currentValue && typeof currentValue === 'object') {
      if (seen.has(currentValue)) return '[Circular]';
      seen.add(currentValue);
    }
    return currentValue;
  }, 2);
}

function logTelegramPayload(label, payload) {
  console.log(`[Telegram ${label}] JSON payload:`);
  console.log(toDebugJson(payload));
}

function logTelegramMarkupDiagnostics(label, sendOptions, clientAtStart) {
  const buttons = sendOptions.buttons;
  console.log(`[Telegram ${label}] sendOptions:`);
  console.dir(sendOptions, { depth: null });
  logTelegramPayload(`${label} sendOptions`, sendOptions);
  console.log(`[Telegram ${label}] buttons type:`, {
    constructor: buttons?.constructor?.name || typeof buttons,
    className: buttons?.className,
    subclassOfId: buttons?.SUBCLASS_OF_ID,
    rows: buttons?.rows?.map((row) => ({
      constructor: row?.constructor?.name,
      className: row?.className,
      buttons: row?.buttons?.map((button) => ({
        constructor: button?.constructor?.name,
        className: button?.className,
        text: button?.text,
        type: button?.type?.constructor?.name || button?.type?.className,
        url: button?.type?.url,
        data: button?.type?.data,
      })),
    })),
  });

  try {
    const rebuiltMarkup = buttons ? clientAtStart.buildReplyMarkup(buttons, true) : undefined;
    console.log(`[Telegram ${label}] teleproto buildReplyMarkup result:`, {
      constructor: rebuiltMarkup?.constructor?.name || typeof rebuiltMarkup,
      className: rebuiltMarkup?.className,
      rows: rebuiltMarkup?.rows?.length || 0,
    });
  } catch (error) {
    console.error(`[Telegram ${label}] teleproto buildReplyMarkup failed:`, error);
  }
}

async function withTelegramInvokeDiagnostics(clientAtStart, label, operation, idempotencyKey) {
  const originalInvoke = clientAtStart.invoke;
  const hadOwnInvoke = Object.prototype.hasOwnProperty.call(clientAtStart, 'invoke');

  clientAtStart.invoke = async function invokeWithDiagnostics(request, ...args) {
    applyTelegramIdempotency(request, idempotencyKey);
    console.log(`[Telegram ${label}] final client.invoke request:`);
    console.dir(request, { depth: null });
    console.log(`[Telegram ${label}] final request summary:`, {
      constructor: request?.constructor?.name,
      className: request?.className,
      replyMarkup: request?.replyMarkup?.className || request?.replyMarkup?.constructor?.name,
      replyMarkupRows: request?.replyMarkup?.rows?.length || 0,
      media: request?.media?.className || request?.media?.constructor?.name,
      file: request?.file,
    });
    logTelegramPayload(`${label} final invoke`, request);
    return originalInvoke.call(this, request, ...args);
  };

  try {
    return await operation();
  } finally {
    if (hadOwnInvoke) {
      clientAtStart.invoke = originalInvoke;
    } else {
      delete clientAtStart.invoke;
    }
  }
}

async function sendMessageInternal(
  chatId,
  message,
  attachments = [],
  entities = [],
  replyMarkup,
  silent = false,
  effect,
  idempotencyKey
) {

  if (!client) {
    await connectTelegram();
  }

  const target =
    chatId === 'me'
      ? 'me'
      : chatId;

  const clientAtStart = client;

  try {

    const sendOptions = { message };

    if (silent) {
      sendOptions.silent = true;
    }

    if (effect !== undefined) {
      sendOptions.effect = BigInt(effect);
    }

    if (entities.length > 0) {
      sendOptions.formattingEntities = toTelegramFormattingEntities(entities);
    }

    if (attachments.length > 0) {
      sendOptions.file = attachments.length === 1 ? attachments[0] : attachments;
    }

    const preparedMarkup = prepareInlineKeyboard(replyMarkup);

    if (attachments.length > 0) {
      sendOptions.buttons = preparedMarkup;
    }

    const useDirectSendMessage = attachments.length === 0
      && typeof clientAtStart.getInputEntity === 'function'
      && typeof clientAtStart.invoke === 'function';
    const sendOperation = !useDirectSendMessage
      ? () => clientAtStart.sendMessage(target, sendOptions)
      : async () => {
        const peer = await clientAtStart.getInputEntity(target);
        const request = new Api.messages.SendMessage({
          peer,
          message,
          entities: sendOptions.formattingEntities,
          replyMarkup: preparedMarkup,
          silent: sendOptions.silent === true,
          ...(sendOptions.effect !== undefined ? { effect: sendOptions.effect } : {}),
        });
        const response = await clientAtStart.invoke(request);

        if (request.effect !== undefined) {
          const updates = Array.isArray(response?.updates) ? response.updates : [];
          const newMessageUpdate = updates.find((update) => update?.className === 'UpdateNewMessage');
          const messageEffect = newMessageUpdate?.message?.effect;

          if (newMessageUpdate) {
            console.error('[MESSAGE-EFFECT-RESPONSE-DEBUG]', {
              messageClassName: newMessageUpdate.message?.className,
              messageId: newMessageUpdate.message?.id,
              peerIdClassName: newMessageUpdate.message?.peerId?.className,
              effect: messageEffect === undefined
                ? undefined
                : typeof messageEffect === 'bigint'
                  ? `${messageEffect}n`
                  : String(messageEffect),
              effectClassName: messageEffect?.className,
              effectId: messageEffect?.effectId?.toString?.() ?? messageEffect?.effectId,
            });
          }
        }

        return response;
      };

    logTelegramMarkupDiagnostics('send', { ...sendOptions, buttons: preparedMarkup }, clientAtStart);

      await withTelegramInvokeDiagnostics(clientAtStart, 'send', () => telegramRequest(() => withTimeout(
        sendOperation(),
        REQUEST_TIMEOUT,
        'Sending Telegram message'
      )), idempotencyKey);

    if (client !== clientAtStart) {
      throw new Error('Telegram send was cancelled.');
    }

    return true;

  } catch (error) {

    console.error('Telegram send failed:', error?.code || error?.name || 'unknown', error);

    throw error;
  }
}

function sendMessage(chatId, message, attachments, entities, replyMarkup, silent, effect, idempotencyKey) {
  return trackTelegramOperation('send', () => sendMessageInternal(chatId, message, attachments, entities, replyMarkup, silent, effect, idempotencyKey));
}

// =========================================================
// SCHEDULE MESSAGE
// =========================================================

async function scheduleMessageInternal(
  chatId,
  message,
  date,
  time,
  targetTimestamp,
  attachments = [],
  entities = [],
  replyMarkup,
  silent = false,
  effect
) {

  if (!client) {
    await connectTelegram();
  }

  const target =
    chatId === 'me'
      ? 'me'
      : chatId;

  const scheduledDate =
    typeof targetTimestamp === 'number' &&
    Number.isFinite(targetTimestamp)
      ? targetTimestamp
      : Math.floor(
          new Date(
            date + 'T' + time
          ).getTime() / 1000
        );

  if (!Number.isFinite(scheduledDate)) {

    throw new Error(
      'Invalid schedule date or time'
    );
  }

  const existingScheduledMessages = await telegramRequest(() => withTimeout(
    client.getScheduledMessages(target),
    REQUEST_TIMEOUT,
    'Checking existing Telegram schedule'
  ));

  const existingScheduledMessage = existingScheduledMessages.find((msg) => {
    const msgTimestamp = msg.date instanceof Date
      ? Math.floor(msg.date.getTime() / 1000)
      : Number(msg.date);

    return (
      msg.message === message &&
      Math.abs(msgTimestamp - scheduledDate) <= 10
    );
  });

  if (existingScheduledMessage) {
    return {
      id: existingScheduledMessage.id,
      telegramMessageId: existingScheduledMessage.id,
      confirmed: true
    };
  }

  const sendOptions = {
    message,
    schedule: scheduledDate
  };

  if (silent) {
    sendOptions.silent = true;
  }

  if (effect !== undefined) {
    sendOptions.effect = BigInt(effect);
  }

  if (entities.length > 0) {
    sendOptions.formattingEntities = toTelegramFormattingEntities(entities);
  }

  if (attachments.length > 0) {
    sendOptions.file = attachments.length === 1 ? attachments[0] : attachments;
  }

  const preparedMarkup = prepareInlineKeyboard(replyMarkup);
  sendOptions.buttons = attachments.length > 0 ? preparedMarkup : undefined;

  const useDirectSchedule = attachments.length === 0
    && typeof client.getInputEntity === 'function'
    && typeof client.invoke === 'function';
  const scheduleOperation = !useDirectSchedule
    ? () => client.sendMessage(target, sendOptions)
    : async () => {
      const peer = await client.getInputEntity(target);
      const request = new Api.messages.SendMessage({
        peer,
        message,
        entities: sendOptions.formattingEntities,
        replyMarkup: preparedMarkup,
        scheduleDate: scheduledDate,
        silent: sendOptions.silent === true,
        ...(sendOptions.effect !== undefined ? { effect: sendOptions.effect } : {}),
      });
      return client.invoke(request);
    };

  logTelegramMarkupDiagnostics('schedule', { ...sendOptions, buttons: preparedMarkup }, client);

  const sendResult = await withTelegramInvokeDiagnostics(client, 'schedule', () => telegramRequest(() => withTimeout(
    scheduleOperation(),
    REQUEST_TIMEOUT,
    'Scheduling Telegram message'
  )));

  let telegramMessageId = null;

  if (
    sendResult &&
    sendResult.id !== undefined &&
    sendResult.id !== null
  ) {

    telegramMessageId =
      sendResult.id;

  }

  const scheduledMessages = await telegramRequest(() => withTimeout(
    client.getScheduledMessages(target),
    REQUEST_TIMEOUT,
    'Verifying scheduled Telegram message'
  ));

  let confirmedMessage = null;

  if (telegramMessageId !== null) {

    confirmedMessage =
      scheduledMessages.find(
        (msg) =>
          String(msg.id) ===
          String(telegramMessageId)
      );
  }

  if (!confirmedMessage) {

    confirmedMessage =
      scheduledMessages.find(
        (msg) => {

          const msgTimestamp =
            msg.date instanceof Date
              ? Math.floor(
                  msg.date.getTime() /
                    1000
                )
              : Number(msg.date);

          return (
            msg.message === message &&
            Math.abs(
              msgTimestamp -
              scheduledDate
            ) <= 10
          );
        }
      );
  }

  if (!confirmedMessage) {

    console.error(
      'Telegram did not confirm the scheduled message.'
    );

    throw new Error(
      'Telegram did not confirm that the reminder was saved.'
    );
  }

  console.log('Telegram schedule confirmed.');

  return {

    id:
      confirmedMessage.id,

    telegramMessageId:
      confirmedMessage.id,

    confirmed: true

  };
}

function scheduleMessage(chatId, message, date, time, targetTimestamp, attachments, entities, replyMarkup, silent, effect) {
  return trackTelegramOperation('schedule', async () => {
    try {
      return await scheduleMessageInternal(
        chatId,
        message,
        date,
        time,
        targetTimestamp,
        attachments,
        entities,
        replyMarkup,
        silent,
        effect
      );
    } catch (error) {
      throw error;
    }
  });
}

// =========================================================
// CANCEL SCHEDULED MESSAGE
// =========================================================

async function cancelScheduledMessageInternal(
  chatId,
  messageId,
  message,
  targetTimestamp
) {

  if (!client) {
    await connectTelegram();
  }

  const target =
    chatId === 'me'
      ? 'me'
      : chatId;

  const clientAtStart = client;

  let telegramMessageId =
    messageId;

  const findAlreadySentMessage = async () => {
    if (!message || !Number.isFinite(targetTimestamp)) return null;
    try {
      const entity = await telegramRequest(() => withTimeout(
        clientAtStart.getEntity(target),
        REQUEST_TIMEOUT,
        'Resolving Telegram chat to reconcile a scheduled message'
      ));
      const recentMessages = await telegramRequest(() => withTimeout(
        clientAtStart.getMessages(entity, { limit: 50 }),
        REQUEST_TIMEOUT,
        'Checking whether Telegram already sent a scheduled message'
      ));
      if (client !== clientAtStart) return null;
      return findRecentSentMessage(recentMessages, message, targetTimestamp);
    } catch {
      return null;
    }
  };

  if (!telegramMessageId) {
    const scheduledMessages =
      await telegramRequest(() => clientAtStart.getScheduledMessages(
        target
      ));

    if (client !== clientAtStart) {
      throw new Error('Telegram cancel was cancelled.');
    }

    const foundMessage =
      scheduledMessages.find(
        (msg) => {

          const msgTimestamp =
            msg.date instanceof Date
              ? Math.floor(
                  msg.date.getTime() /
                    1000
                )
              : Number(msg.date);

          return (
            msg.message === message &&
            Math.abs(
              msgTimestamp -
              targetTimestamp
            ) <= 10
          );
        }
      );

    if (!foundMessage) {
      const sentMessage = await findAlreadySentMessage();
      if (sentMessage) {
        return {
          success: true,
          alreadySent: true,
          telegramMessageId: String(sentMessage.id),
          sentAt: sentMessage.date instanceof Date
            ? sentMessage.date.toISOString()
            : new Date(Number(sentMessage.date) * 1000).toISOString(),
        };
      }
      throw new Error(
        'Scheduled message was not found in Telegram.'
      );
    }

    telegramMessageId =
      foundMessage.id;

  }

  try {
    await telegramRequest(() => clientAtStart.deleteScheduledMessages(
      target,
      [Number(telegramMessageId)]
    ));
  } catch (error) {
    const sentMessage = await findAlreadySentMessage();
    if (sentMessage) {
      return {
        success: true,
        alreadySent: true,
        telegramMessageId: String(sentMessage.id),
        sentAt: sentMessage.date instanceof Date
          ? sentMessage.date.toISOString()
          : new Date(Number(sentMessage.date) * 1000).toISOString(),
      };
    }
    throw error;
  }

  if (client !== clientAtStart) {
    throw new Error('Telegram cancel was cancelled.');
  }

  console.log(
    'Scheduled message cancelled successfully'
  );

  return { success: true, alreadySent: false };
}

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
    getChatHistory,
    getContacts,
    getAvailableEffects,
    resolveChat,
    sendMessage,
    scheduleMessage,
    cancelScheduledMessage,
    getTelegramRateLimitState,
    getTelegramStatus,
    waitForTelegramRateLimit,
    shutdownTelegram,
    setTelegramStatusCallback,
    lifecycleState
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
  getChatHistory: (...args) => defaultCore.getChatHistory(...args),
  getContacts: (...args) => defaultCore.getContacts(...args),
  normalizeQuery,
  normalizePhone,
  isPhoneLikeQuery,
  isUsernameQuery,
  getAvailableEffects: (...args) => defaultCore.getAvailableEffects(...args),
  resolveChat: (...args) => defaultCore.resolveChat(...args),
  sendMessage: (...args) => defaultCore.sendMessage(...args),
  scheduleMessage: (...args) => defaultCore.scheduleMessage(...args),
  cancelScheduledMessage: (...args) => defaultCore.cancelScheduledMessage(...args),
  getTelegramRateLimitState: (...args) => defaultCore.getTelegramRateLimitState(...args),
  getTelegramStatus: (...args) => defaultCore.getTelegramStatus(...args),
  waitForTelegramRateLimit: (...args) => defaultCore.waitForTelegramRateLimit(...args),
  shutdownTelegram: (...args) => defaultCore.shutdownTelegram(...args),
  setTelegramStatusCallback: (...args) => defaultCore.setTelegramStatusCallback(...args)
};