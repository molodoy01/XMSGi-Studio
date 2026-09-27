import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import lifecycle from './telegram-lifecycle.cjs';

vi.mock('electron', () => ({
  app: { getPath: () => 'C:\\temp' },
  safeStorage: { isEncryptionAvailable: () => false }
}));

const nodeRequire = createRequire(import.meta.url);
const nodeModule = nodeRequire('node:module');

const {
  createLifecycleState,
  beginShutdown,
  runShared,
  startPendingLogin,
  trackOperation,
  withTimeout
} = lifecycle;

function commitLoginIfCurrent(state, loginGeneration, client) {
  if (
    state.status === 'shutting-down' ||
    state.status === 'stopped' ||
    state.loginGeneration !== loginGeneration
  ) {
    return false;
  }

  state.client = client;
  return true;
}

async function finishLoginAfterCredentials(
  state,
  loginGeneration,
  saveCredentials,
  client,
  startReconnect
) {
  await saveCredentials();

  if (!commitLoginIfCurrent(state, loginGeneration, client)) {
    throw new Error('Telegram login was cancelled.');
  }

  startReconnect();
}

function createDeferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

async function shutdownWithDrain(state) {
  return beginShutdown(state, async () => {
    const pending = [...state.pendingOperations.values()]
      .map((operation) => operation.promise)
      .filter(Boolean);

    await Promise.allSettled(pending);
    if (state.pendingLogin) await state.pendingLogin.clear();
  });
}

function runTrackedShared(state, key, type, operation) {
  return runShared(state, key, () => trackOperation(state, type, operation));
}

describe('single-account Telegram lifecycle', () => {
  it('covers the lifecycle state vocabulary and terminal shutdown state', async () => {
    const state = createLifecycleState();

    expect(state.status).toBe('idle');
    state.status = 'connecting';
    expect(state.status).toBe('connecting');
    state.status = 'connected';
    expect(state.status).toBe('connected');
    state.status = 'reconnecting';
    expect(state.status).toBe('reconnecting');

    const shutdown = beginShutdown(state, vi.fn());
    expect(state.status).toBe('shutting-down');
    await shutdown;
    expect(state.status).toBe('stopped');
  });

  it('rejects network and reconnect starts after shutdown', async () => {
    const state = createLifecycleState();
    await shutdownWithDrain(state);

    expect(() => trackOperation(state, 'connect', () => undefined)).toThrow('shutting down');
    expect(() => runShared(state, 'connectPromise', () => undefined)).toThrow('shutting down');
    expect(state.client).toBeUndefined();
  });

  it('does not resurrect a client when connect is interrupted by shutdown', async () => {
    const state = createLifecycleState();
    const connectGate = createDeferred();
    let clientCreations = 0;
    const connect = () => runTrackedShared(state, 'connectPromise', 'connect', async () => {
      clientCreations += 1;
      await connectGate.promise;
      if (state.status !== 'idle') throw new Error('connect cancelled');
      state.client = { id: clientCreations };
      return state.client;
    });

    const connecting = connect();
    await Promise.resolve();
    const shutdown = shutdownWithDrain(state);
    connectGate.resolve();

    await expect(connecting).rejects.toThrow('cancelled');
    await shutdown;
    expect(clientCreations).toBe(1);
    expect(state.client).toBeUndefined();
  });

  it('does not resurrect the production Core client after clearSession during connect', async () => {
    vi.resetModules();
    const connectGate = createDeferred();
    const originalLoad = nodeModule._load;
    nodeModule._load = function load(request, parent, isMain) {
      if (request === 'teleproto') {
        return {
          TelegramClient: class FakeTelegramClient {
            constructor() {
              globalThis.__telegramFakeClient = this;
              this.connected = false;
            }

            connect() {
              return connectGate.promise.then(() => {
                this.connected = true;
              });
            }

            disconnect() {
              this.connected = false;
              return Promise.resolve();
            }
          },
          Api: {}
        };
      }

      if (request === 'teleproto/sessions') {
        return { StringSession: class FakeStringSession {} };
      }

      if (request === './telegram-account-storage.cjs') {
        return {
          loadAccountSecrets: () => ({ API_ID: '1', API_HASH: 'hash', SESSION_STRING: 'session' }),
          saveAccountSecrets: () => true,
          clearAccountSecrets: () => true
        };
      }

      return originalLoad(request, parent, isMain);
    };

    try {
      const { createTelegramCore } = await import('./telegram.cjs');
      const core = createTelegramCore({ apiId: 1, apiHash: 'hash', sessionString: 'session' });
      const connecting = core.connectTelegram();

      await Promise.resolve();
      await Promise.resolve();
      expect(globalThis.__telegramFakeClient).toBeDefined();

      await core.clearTelegramSession();
      connectGate.resolve();

      await expect(connecting).rejects.toThrow('cancelled');
      expect(core.lifecycleState.status).not.toBe('connected');
      expect(core.lifecycleState.reconnectTimer).toBeNull();
    } finally {
      connectGate.resolve();
      nodeModule._load = originalLoad;
      delete globalThis.__telegramFakeClient;
      vi.resetModules();
    }
  });

  it('does not resurrect a pending connect after shutdown', async () => {
    vi.resetModules();
    const connectGate = createDeferred();
    const connectStarted = createDeferred();
    const originalLoad = nodeModule._load;
    nodeModule._load = function load(request, parent, isMain) {
      if (request === 'teleproto') {
        return {
          TelegramClient: class FakeTelegramClient {
            constructor() {
              this.connected = false;
              globalThis.__telegramShutdownClient = this;
            }

            connect() {
              connectStarted.resolve();
              return connectGate.promise.then(() => {
                this.connected = true;
              });
            }

            disconnect() {
              this.connected = false;
              return Promise.resolve();
            }
          },
          Api: {}
        };
      }

      if (request === 'teleproto/sessions') {
        return { StringSession: class FakeStringSession {} };
      }

      if (request === './telegram-account-storage.cjs') {
        return {
          loadAccountSecrets: () => ({ API_ID: '1', API_HASH: 'hash', SESSION_STRING: 'session' }),
          saveAccountSecrets: () => true,
          clearAccountSecrets: () => true
        };
      }

      return originalLoad(request, parent, isMain);
    };

    try {
      const { createTelegramCore } = await import('./telegram.cjs');
      const core = createTelegramCore({ apiId: 1, apiHash: 'hash', sessionString: 'session' });
      const connecting = core.connectTelegram();

      await connectStarted.promise;
      const shuttingDown = core.shutdownTelegram();
      connectGate.resolve();

      await expect(connecting).rejects.toThrow('cancelled');
      await shuttingDown;
      await Promise.resolve();

      expect(core.lifecycleState.status).toBe('stopped');
      expect(core.lifecycleState.reconnectTimer).toBeNull();
      expect(globalThis.__telegramShutdownClient.connected).toBe(false);
    } finally {
      connectGate.resolve();
      nodeModule._load = originalLoad;
      delete globalThis.__telegramShutdownClient;
      vi.resetModules();
    }
  });

  it('moves the core out of connected state after an invalid startup session', async () => {
    vi.resetModules();
    const originalLoad = nodeModule._load;
    const statusUpdates = [];
    nodeModule._load = function load(request, parent, isMain) {
      if (request === 'teleproto') {
        return {
          TelegramClient: class FakeTelegramClient {
            constructor() {
              this.connected = false;
            }

            connect() {
              this.connected = true;
              return Promise.resolve();
            }

            getDialogs() {
              const error = new Error('AUTH_KEY_UNREGISTERED');
              error.code = 'AUTH_KEY_UNREGISTERED';
              return Promise.reject(error);
            }

            disconnect() {
              this.connected = false;
              return Promise.resolve();
            }
          },
          Api: {}
        };
      }

      if (request === 'teleproto/sessions') {
        return { StringSession: class FakeStringSession {} };
      }

      if (request === './telegram-account-storage.cjs') {
        return {
          loadAccountSecrets: () => ({ API_ID: '1', API_HASH: 'hash', SESSION_STRING: 'session' }),
          saveAccountSecrets: () => true,
          clearAccountSecrets: () => true
        };
      }

      return originalLoad(request, parent, isMain);
    };

    try {
      const { createTelegramCore } = await import('./telegram.cjs');
      const core = createTelegramCore({ apiId: 1, apiHash: 'hash', sessionString: 'session' });
      core.setTelegramStatusCallback((status) => statusUpdates.push(status));

      await core.connectTelegram();
      await expect(core.getChats()).rejects.toMatchObject({
        code: 'TELEGRAM_SESSION_INVALID'
      });

      expect(core.lifecycleState.status).toBe('disconnected');
      expect(core.lifecycleState.reconnectTimer).toBeNull();
      expect(statusUpdates.at(-1)).toMatchObject({
        status: 'reauth_required',
        connected: false
      });
    } finally {
      nodeModule._load = originalLoad;
      vi.resetModules();
    }
  });

  it('does not complete an in-flight send after clearSession', async () => {
    vi.resetModules();
    const sendGate = createDeferred();
    const sendStarted = createDeferred();
    const originalLoad = nodeModule._load;
    nodeModule._load = function load(request, parent, isMain) {
      if (request === 'teleproto') {
        return {
          TelegramClient: class FakeTelegramClient {
            constructor() {
              this.connected = false;
            }

            connect() {
              this.connected = true;
              return Promise.resolve();
            }

            sendMessage() {
              sendStarted.resolve();
              return sendGate.promise;
            }

            logOut() {
              this.connected = false;
              return Promise.resolve();
            }

            disconnect() {
              this.connected = false;
              return Promise.resolve();
            }
          },
          Api: {}
        };
      }

      if (request === 'teleproto/sessions') {
        return { StringSession: class FakeStringSession {} };
      }

      if (request === './telegram-account-storage.cjs') {
        return {
          loadAccountSecrets: () => ({ API_ID: '1', API_HASH: 'hash', SESSION_STRING: 'session' }),
          saveAccountSecrets: () => true,
          clearAccountSecrets: () => true
        };
      }

      return originalLoad(request, parent, isMain);
    };

    try {
      const { createTelegramCore } = await import('./telegram.cjs');
      const core = createTelegramCore({ apiId: 1, apiHash: 'hash', sessionString: 'session' });

      await core.connectTelegram();
      const sending = core.sendMessage('me', 'in-flight');
      await sendStarted.promise;

      await core.clearTelegramSession();
      const statusAfterClear = core.lifecycleState.status;
      sendGate.resolve();

      await expect(sending).rejects.toThrow();
      expect(statusAfterClear).not.toBe('connected');
      expect(core.lifecycleState.status).toBe(statusAfterClear);
    } finally {
      sendGate.resolve();
      nodeModule._load = originalLoad;
      vi.resetModules();
    }
  });

  it('does not complete an in-flight schedule after clearSession', async () => {
    vi.resetModules();
    const scheduleGate = createDeferred();
    const scheduleStarted = createDeferred();
    const originalLoad = nodeModule._load;
    nodeModule._load = function load(request, parent, isMain) {
      if (request === 'teleproto') {
        return {
          TelegramClient: class FakeTelegramClient {
            constructor() {
              this.connected = false;
              this.scheduleCalls = 0;
            }

            connect() {
              this.connected = true;
              return Promise.resolve();
            }

            getScheduledMessages() {
              this.scheduleCalls += 1;
              if (this.scheduleCalls === 1) {
                scheduleStarted.resolve();
                return scheduleGate.promise;
              }

              return Promise.resolve([
                { id: 42, message: 'scheduled', date: new Date(1700000000 * 1000) }
              ]);
            }

            sendMessage() {
              return Promise.resolve({ id: 42 });
            }

            logOut() {
              this.connected = false;
              return Promise.resolve();
            }

            disconnect() {
              this.connected = false;
              return Promise.resolve();
            }
          },
          Api: {}
        };
      }

      if (request === 'teleproto/sessions') {
        return { StringSession: class FakeStringSession {} };
      }

      if (request === './telegram-account-storage.cjs') {
        return {
          loadAccountSecrets: () => ({ API_ID: '1', API_HASH: 'hash', SESSION_STRING: 'session' }),
          saveAccountSecrets: () => true,
          clearAccountSecrets: () => true
        };
      }

      return originalLoad(request, parent, isMain);
    };

    try {
      const { createTelegramCore } = await import('./telegram.cjs');
      const core = createTelegramCore({ apiId: 1, apiHash: 'hash', sessionString: 'session' });

      await core.connectTelegram();
      const scheduling = core.scheduleMessage('me', 'scheduled', undefined, undefined, 1700000000);
      await scheduleStarted.promise;

      await core.clearTelegramSession();
      scheduleGate.resolve([]);

      await expect(scheduling).rejects.toThrow();
      expect(core.lifecycleState.status).not.toBe('connected');
    } finally {
      scheduleGate.resolve([]);
      nodeModule._load = originalLoad;
      vi.resetModules();
    }
  });

  it('does not complete an in-flight cancel after clearSession', async () => {
    vi.resetModules();
    const cancelGate = createDeferred();
    const cancelStarted = createDeferred();
    const originalLoad = nodeModule._load;
    nodeModule._load = function load(request, parent, isMain) {
      if (request === 'teleproto') {
        return {
          TelegramClient: class FakeTelegramClient {
            constructor() {
              this.connected = false;
            }

            connect() {
              this.connected = true;
              return Promise.resolve();
            }

            deleteScheduledMessages() {
              cancelStarted.resolve();
              return cancelGate.promise;
            }

            logOut() {
              this.connected = false;
              return Promise.resolve();
            }

            disconnect() {
              this.connected = false;
              return Promise.resolve();
            }
          },
          Api: {}
        };
      }

      if (request === 'teleproto/sessions') {
        return { StringSession: class FakeStringSession {} };
      }

      if (request === './telegram-account-storage.cjs') {
        return {
          loadAccountSecrets: () => ({ API_ID: '1', API_HASH: 'hash', SESSION_STRING: 'session' }),
          saveAccountSecrets: () => true,
          clearAccountSecrets: () => true
        };
      }

      return originalLoad(request, parent, isMain);
    };

    try {
      const { createTelegramCore } = await import('./telegram.cjs');
      const core = createTelegramCore({ apiId: 1, apiHash: 'hash', sessionString: 'session' });

      await core.connectTelegram();
      const cancelling = core.cancelScheduledMessage('me', 42);
      await cancelStarted.promise;

      await core.clearTelegramSession();
      cancelGate.resolve();

      await expect(cancelling).rejects.toThrow();
      expect(core.lifecycleState.status).not.toBe('connected');
    } finally {
      cancelGate.resolve();
      nodeModule._load = originalLoad;
      vi.resetModules();
    }
  });

  it('does not resurrect a reconnect after clearSession', async () => {
    vi.resetModules();
    const reconnectGate = createDeferred();
    const reconnectStarted = createDeferred();
    const originalLoad = nodeModule._load;
    nodeModule._load = function load(request, parent, isMain) {
      if (request === 'teleproto') {
        return {
          TelegramClient: class FakeTelegramClient {
            constructor() {
              this.connected = false;
              this.connectCalls = 0;
              globalThis.__telegramReconnectClient = this;
            }

            connect() {
              this.connectCalls += 1;

              if (this.connectCalls === 1) {
                this.connected = true;
                return Promise.resolve();
              }

              reconnectStarted.resolve();
              return reconnectGate.promise.then(() => {
                this.connected = true;
              });
            }

            disconnect() {
              this.connected = false;
              return Promise.resolve();
            }

            logOut() {
              this.connected = false;
              return Promise.resolve();
            }
          },
          Api: {}
        };
      }

      if (request === 'teleproto/sessions') {
        return { StringSession: class FakeStringSession {} };
      }

      if (request === './telegram-account-storage.cjs') {
        return {
          loadAccountSecrets: () => ({ API_ID: '1', API_HASH: 'hash', SESSION_STRING: 'session' }),
          saveAccountSecrets: () => true,
          clearAccountSecrets: () => true
        };
      }

      return originalLoad(request, parent, isMain);
    };

    try {
      const { createTelegramCore } = await import('./telegram.cjs');
      const core = createTelegramCore({ apiId: 1, apiHash: 'hash', sessionString: 'session' });

      await core.connectTelegram();
      globalThis.clearInterval(core.lifecycleState.reconnectTimer);
      core.lifecycleState.reconnectTimer = null;
      globalThis.__telegramReconnectClient.connected = false;

      const reconnecting = core.connectTelegram();
      await reconnectStarted.promise;

      await core.clearTelegramSession();
      reconnectGate.resolve();

      await expect(reconnecting).rejects.toThrow('cancelled');
      expect(core.lifecycleState.status).not.toBe('connected');
      expect(core.lifecycleState.reconnectTimer).toBeNull();
    } finally {
      reconnectGate.resolve();
      nodeModule._load = originalLoad;
      delete globalThis.__telegramReconnectClient;
      vi.resetModules();
    }
  });

  it('cancels login when connect completes after clearSession', async () => {
    vi.resetModules();
    const connectGate = createDeferred();
    const connectStarted = createDeferred();
    const originalLoad = nodeModule._load;
    const saveAccountSecrets = vi.fn(() => true);
    nodeModule._load = function load(request, parent, isMain) {
      if (request === 'teleproto') {
        return {
          TelegramClient: class FakeTelegramClient {
            connect() {
              connectStarted.resolve();
              return connectGate.promise.then(() => {
                this.connected = true;
              });
            }

            sendCode() {
              return Promise.resolve({ phoneCodeHash: 'hash' });
            }

            disconnect() {
              this.connected = false;
              return Promise.resolve();
            }
          },
          Api: {}
        };
      }

      if (request === 'teleproto/sessions') {
        return { StringSession: class FakeStringSession {} };
      }

      if (request === './telegram-account-storage.cjs') {
        return {
          loadAccountSecrets: () => ({ API_ID: '1', API_HASH: 'hash', SESSION_STRING: '' }),
          saveAccountSecrets,
          clearAccountSecrets: () => true
        };
      }

      return originalLoad(request, parent, isMain);
    };

    let core;
    try {
      const { createTelegramCore } = await import('./telegram.cjs');
      core = createTelegramCore({ apiId: 1, apiHash: 'hash', sessionString: '' });
      const loggingIn = core.loginUser({ phoneNumber: '+15550000000' });

      await connectStarted.promise;
      await core.clearTelegramSession();
      connectGate.resolve();

      await expect(loggingIn).rejects.toThrow('cancelled');
      expect(core.lifecycleState.pendingLogin).toBeNull();
      expect(saveAccountSecrets).not.toHaveBeenCalled();
    } finally {
      connectGate.resolve();
      await core?.lifecycleState.pendingLogin?.clear();
      nodeModule._load = originalLoad;
      vi.resetModules();
    }
  });

  it('cancels login when sendCode completes after clearSession', async () => {
    vi.resetModules();
    const sendCodeGate = createDeferred();
    const sendCodeStarted = createDeferred();
    const originalLoad = nodeModule._load;
    const saveAccountSecrets = vi.fn(() => true);
    nodeModule._load = function load(request, parent, isMain) {
      if (request === 'teleproto') {
        return {
          TelegramClient: class FakeTelegramClient {
            connect() {
              this.connected = true;
              return Promise.resolve();
            }

            sendCode() {
              sendCodeStarted.resolve();
              return sendCodeGate.promise;
            }

            disconnect() {
              this.connected = false;
              return Promise.resolve();
            }
          },
          Api: {}
        };
      }

      if (request === 'teleproto/sessions') {
        return { StringSession: class FakeStringSession {} };
      }

      if (request === './telegram-account-storage.cjs') {
        return {
          loadAccountSecrets: () => ({ API_ID: '1', API_HASH: 'hash', SESSION_STRING: '' }),
          saveAccountSecrets,
          clearAccountSecrets: () => true
        };
      }

      return originalLoad(request, parent, isMain);
    };

    let core;
    try {
      const { createTelegramCore } = await import('./telegram.cjs');
      core = createTelegramCore({ apiId: 1, apiHash: 'hash', sessionString: '' });
      const loggingIn = core.loginUser({ phoneNumber: '+15550000000' });

      await sendCodeStarted.promise;
      await core.clearTelegramSession();
      sendCodeGate.resolve({ phoneCodeHash: 'late-hash' });

      await expect(loggingIn).rejects.toThrow('cancelled');
      expect(core.lifecycleState.pendingLogin).toBeNull();
      expect(saveAccountSecrets).not.toHaveBeenCalled();
    } finally {
      sendCodeGate.resolve({ phoneCodeHash: 'late-hash' });
      await core?.lifecycleState.pendingLogin?.clear();
      nodeModule._load = originalLoad;
      vi.resetModules();
    }
  });

  it('shares reconnect and connect execution and cancels both during shutdown', async () => {
    const state = createLifecycleState();
    const reconnectGate = createDeferred();
    let attempts = 0;
    const reconnect = () => runTrackedShared(state, 'connectPromise', 'reconnect', async () => {
      attempts += 1;
      state.reconnectInProgress = true;
      await reconnectGate.promise;
      state.reconnectInProgress = false;
      if (state.status !== 'idle') throw new Error('reconnect cancelled');
      state.client = { id: 'reconnected' };
      return state.client;
    });
    const connect = () => runTrackedShared(state, 'connectPromise', 'connect', async () => {
      attempts += 1;
      return { id: 'connected' };
    });

    const reconnecting = reconnect();
    const connecting = connect();
    expect(connecting).toBe(reconnecting);
    expect(attempts).toBe(0);
    await Promise.resolve();
    await Promise.resolve();
    expect(state.reconnectInProgress).toBe(true);

    const shutdown = shutdownWithDrain(state);
    reconnectGate.resolve();
    await expect(reconnecting).rejects.toThrow('cancelled');
    await shutdown;
    expect(attempts).toBe(1);
    expect(state.client).toBeUndefined();
    expect(state.reconnectInProgress).toBe(false);
  });

  it('drains an in-flight operation during shutdown without affecting another state', async () => {
    const stateA = createLifecycleState();
    const stateB = createLifecycleState();
    const operationA = createDeferred();
    const operationB = createDeferred();
    const trackedA = trackOperation(stateA, 'send', () => operationA.promise);
    const trackedB = trackOperation(stateB, 'send', () => operationB.promise);
    const shutdownA = shutdownWithDrain(stateA);

    operationA.resolve('A');
    await expect(trackedA).resolves.toBe('A');
    await shutdownA;
    expect(stateA.pendingOperations.size).toBe(0);
    expect(stateB.status).toBe('idle');
    expect(stateB.pendingOperations.size).toBe(1);

    operationB.resolve('B');
    await expect(trackedB).resolves.toBe('B');
    expect(stateB.pendingOperations.size).toBe(0);
  });

  it('shares one concurrent connect execution and client', async () => {
    const state = createLifecycleState();
    let clientCreations = 0;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const operation = async () => {
      clientCreations += 1;
      const client = { id: clientCreations };
      await gate;
      state.client = client;
      return client;
    };

    const first = runShared(state, 'connectPromise', operation);
    const second = runShared(state, 'connectPromise', operation);
    release();

    const [firstClient, secondClient] = await Promise.all([first, second]);
    expect(firstClient).toBe(secondClient);
    expect(state.client).toBe(firstClient);
    expect(clientCreations).toBe(1);
    expect(state.connectPromise).toBeNull();
  });

  it('does not commit a pending login after clearSession invalidates its generation', async () => {
    const state = createLifecycleState();
    const client = { id: 'old-login' };
    const pending = startPendingLogin(state, { client }, vi.fn());
    const loginGeneration = state.loginGeneration;
    let release;
    const login = new Promise((resolve) => { release = resolve; })
      .then(() => commitLoginIfCurrent(state, loginGeneration, client));

    state.loginGeneration += 1;
    await pending.clear();
    release();

    await expect(login).resolves.toBe(false);
    expect(state.client).toBeUndefined();
  });

  it('does not commit a pending login after shutdown invalidates its generation', async () => {
    const state = createLifecycleState();
    const client = { id: 'shutdown-login' };
    const pending = startPendingLogin(state, { client }, vi.fn());
    const loginGeneration = state.loginGeneration;
    let release;
    const login = new Promise((resolve) => { release = resolve; })
      .then(() => commitLoginIfCurrent(state, loginGeneration, client));
    const shutdown = beginShutdown(state, () => pending.clear());

    release();
    await expect(login).resolves.toBe(false);
    await shutdown;
    expect(state.client).toBeUndefined();
    expect(state.status).toBe('stopped');
  });

  it('cancels a login when clearSession occurs during credential save', async () => {
    const state = createLifecycleState();
    const client = { id: 'clear-during-save' };
    const saveStarted = Promise.resolve();
    let releaseSave;
    const saveCredentials = vi.fn(() => new Promise((resolve) => { releaseSave = resolve; }));
    const reconnect = vi.fn();
    const login = finishLoginAfterCredentials(
      state,
      state.loginGeneration,
      saveCredentials,
      client,
      reconnect
    );

    await saveStarted;
    await Promise.resolve();
    state.loginGeneration += 1;
    state.client = null;
    releaseSave();

    await expect(login).rejects.toThrow('cancelled');
    expect(state.client).toBeNull();
    expect(reconnect).not.toHaveBeenCalled();
  });

  it('cancels a login when shutdown occurs during credential save', async () => {
    const state = createLifecycleState();
    const client = { id: 'shutdown-during-save' };
    let releaseSave;
    const saveCredentials = vi.fn(() => new Promise((resolve) => { releaseSave = resolve; }));
    const reconnect = vi.fn();
    const login = finishLoginAfterCredentials(
      state,
      state.loginGeneration,
      saveCredentials,
      client,
      reconnect
    );
    const shutdown = beginShutdown(state, vi.fn());

    releaseSave();
    await expect(login).rejects.toThrow('cancelled');
    await shutdown;
    expect(state.client).toBeUndefined();
    expect(reconnect).not.toHaveBeenCalled();
  });

  it('stops the reconnect timer during shutdown', async () => {
    vi.useFakeTimers();
    try {
      const state = createLifecycleState();
      let ticks = 0;
      state.reconnectTimer = globalThis.setInterval(() => { ticks += 1; }, 10);

      await beginShutdown(state, vi.fn());
      await vi.advanceTimersByTimeAsync(100);

      expect(state.reconnectTimer).toBeNull();
      expect(ticks).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('runs shutdown cleanup once when shutdown is repeated', async () => {
    const state = createLifecycleState();
    const cleanup = vi.fn().mockResolvedValue(undefined);

    const first = beginShutdown(state, cleanup);
    const second = beginShutdown(state, cleanup);

    expect(second).toBe(first);
    await Promise.all([first, second]);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('rejects every new operation after shutdown', async () => {
    const state = createLifecycleState();
    await beginShutdown(state, vi.fn());

    expect(() => trackOperation(state, 'connect', () => undefined)).toThrow(
      'shutting down'
    );
    expect(() => runShared(state, 'connectPromise', () => undefined)).toThrow(
      'shutting down'
    );
  });

  it('releases a failed shared operation and permits the next attempt', async () => {
    const state = createLifecycleState();
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new Error('failed'))
      .mockResolvedValueOnce('connected');

    await expect(runShared(state, 'connectPromise', operation)).rejects.toThrow('failed');
    await expect(runShared(state, 'connectPromise', operation)).resolves.toBe('connected');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('tracks operations until their underlying promise settles', async () => {
    const state = createLifecycleState();
    let release;
    const operation = new Promise((resolve) => { release = resolve; });
    const tracked = trackOperation(state, 'getChats', () => operation);

    await Promise.resolve();
    expect(state.pendingOperations.size).toBe(1);
    release([]);
    await tracked;
    expect(state.pendingOperations.size).toBe(0);
  });

  it('times out without treating a late result as a new success', async () => {
    let release;
    const operation = new Promise((resolve) => { release = resolve; });
    const timed = withTimeout(operation, 10);

    await expect(timed).rejects.toMatchObject({ code: 'OPERATION_TIMEOUT' });
    release('late');
    await Promise.resolve();
  });

  it('cleans timeout timers on success', async () => {
    const clearTimeoutMock = vi.fn();
    await expect(withTimeout(
      Promise.resolve('ok'),
      100,
      undefined,
      { setTimeout: globalThis.setTimeout, clearTimeout: clearTimeoutMock }
    )).resolves.toBe('ok');
    expect(clearTimeoutMock).toHaveBeenCalledTimes(1);
  });

  it('enforces one pending login and cleans it on clear/TTL', async () => {
    vi.useFakeTimers();
    const state = createLifecycleState({ loginTtlMs: 100 });
    const cleanup = vi.fn().mockResolvedValue(undefined);
    const pending = startPendingLogin(state, { client: {} }, cleanup);

    expect(() => startPendingLogin(state, { client: {} }, cleanup)).toThrow('already in progress');
    await vi.advanceTimersByTimeAsync(100);
    expect(state.pendingLogin).toBeNull();
    expect(cleanup).toHaveBeenCalledTimes(1);
    await pending.clear();
    expect(cleanup).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('makes shutdown idempotent and blocks new operations', async () => {
    const state = createLifecycleState();
    const cleanup = vi.fn().mockResolvedValue(undefined);
    const first = beginShutdown(state, cleanup);
    const second = beginShutdown(state, cleanup);

    expect(first).toBe(second);
    await first;
    expect(state.status).toBe('stopped');
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(() => trackOperation(state, 'send', () => undefined)).toThrow('shutting down');
  });

  it('supports retained sign out, concurrent welcome back, and account removal', async () => {
    vi.resetModules();
    const originalLoad = nodeModule._load;
    const storageState = {
      API_ID: '1',
      API_HASH: 'hash',
      SESSION_STRING: 'session',
      signedOut: true
    };
    nodeModule._load = function load(request, parent, isMain) {
      if (request === 'teleproto') {
        return {
          TelegramClient: class FakeTelegramClient {
            constructor() {
              this.connected = false;
              this.logOutCalls = 0;
              this.disconnectCalls = 0;
              globalThis.__telegramWelcomeClient = this;
            }

            connect() {
              this.connected = true;
              return Promise.resolve();
            }

            disconnect() {
              this.disconnectCalls += 1;
              this.connected = false;
              return Promise.resolve();
            }

            logOut() {
              this.logOutCalls += 1;
              this.connected = false;
              return Promise.resolve();
            }
          },
          Api: {}
        };
      }

      if (request === 'teleproto/sessions') {
        return { StringSession: class FakeStringSession {} };
      }

      if (request === './telegram-account-storage.cjs') {
        return {
          loadAccountSecrets: () => ({ ...storageState }),
          saveAccountSecrets: () => true,
          getTelegramAuthState: () => ({
            hasSession: Boolean(storageState.SESSION_STRING),
            signedOut: storageState.signedOut
          }),
          setTelegramSignedOut: (value) => {
            storageState.signedOut = Boolean(value);
            return true;
          },
          clearAccountSecrets: () => {
            storageState.SESSION_STRING = '';
            storageState.signedOut = false;
            return true;
          }
        };
      }

      return originalLoad(request, parent, isMain);
    };

    try {
      const { createTelegramCore } = await import('./telegram.cjs');
      const core = createTelegramCore();

      const welcomed = core.welcomeBack();
      const welcomedAgain = core.welcomeBack();
      expect(welcomedAgain).toBe(welcomed);
      await welcomed;
      expect(storageState.signedOut).toBe(false);
      expect(globalThis.__telegramWelcomeClient.logOutCalls).toBe(0);

      await core.signOutKeepSession();
      expect(globalThis.__telegramWelcomeClient.logOutCalls).toBe(0);
      expect(globalThis.__telegramWelcomeClient.disconnectCalls).toBe(1);
      expect(storageState.SESSION_STRING).toBe('session');
      expect(storageState.signedOut).toBe(true);

      await core.forgetTelegramAccount();
      expect(globalThis.__telegramWelcomeClient.logOutCalls).toBe(1);
      expect(storageState.SESSION_STRING).toBe('');
      expect(storageState.signedOut).toBe(false);
    } finally {
      nodeModule._load = originalLoad;
      delete globalThis.__telegramWelcomeClient;
      vi.resetModules();
    }
  });

  it('does not resurrect a client when retained sign out interrupts connect', async () => {
    vi.resetModules();
    const connectGate = createDeferred();
    const originalLoad = nodeModule._load;
    const storageState = {
      API_ID: '1',
      API_HASH: 'hash',
      SESSION_STRING: 'session',
      signedOut: false
    };
    nodeModule._load = function load(request, parent, isMain) {
      if (request === 'teleproto') {
        return {
          TelegramClient: class FakeTelegramClient {
            constructor() {
              this.connected = false;
              globalThis.__telegramConnectClient = this;
            }

            connect() {
              return connectGate.promise.then(() => {
                this.connected = true;
              });
            }

            disconnect() {
              this.connected = false;
              return Promise.resolve();
            }
          },
          Api: {}
        };
      }

      if (request === 'teleproto/sessions') {
        return { StringSession: class FakeStringSession {} };
      }

      if (request === './telegram-account-storage.cjs') {
        return {
          loadAccountSecrets: () => ({ ...storageState }),
          saveAccountSecrets: () => true,
          setTelegramSignedOut: (value) => {
            storageState.signedOut = Boolean(value);
            return true;
          },
          clearAccountSecrets: () => true
        };
      }

      return originalLoad(request, parent, isMain);
    };

    try {
      const { createTelegramCore } = await import('./telegram.cjs');
      const core = createTelegramCore();
      const connecting = core.connectTelegram();

      await Promise.resolve();
      await Promise.resolve();
      expect(globalThis.__telegramConnectClient).toBeDefined();

      const signingOut = core.signOutKeepSession();
      connectGate.resolve();

      await signingOut;
      await expect(connecting).rejects.toThrow('cancelled');
      expect(storageState.signedOut).toBe(true);
      expect(core.lifecycleState.status).toBe('disconnected');
      expect(core.lifecycleState.reconnectTimer).toBeNull();
    } finally {
      connectGate.resolve();
      nodeModule._load = originalLoad;
      delete globalThis.__telegramConnectClient;
      vi.resetModules();
    }
  });

});
