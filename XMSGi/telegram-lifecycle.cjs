function createLifecycleState(options = {}) {
  return {
    status: 'idle',
    connectPromise: null,
    reconnectTimer: null,
    reconnectGeneration: 0,
    reconnectInProgress: false,
    shutdownPromise: null,
    pendingLogin: null,
    loginGeneration: 0,
    pendingOperations: new Map(),
    nextOperationId: 1,
    loginTtlMs: options.loginTtlMs ?? 5 * 60 * 1000
  };
}

function assertLifecycleRunning(state) {
  if (state.status === 'shutting-down' || state.status === 'stopped') {
    throw new Error('Telegram core is shutting down.');
  }
}

function trackOperation(state, type, operation) {
  assertLifecycleRunning(state);

  const id = state.nextOperationId++;
  const promise = Promise.resolve()
    .then(operation)
    .finally(() => {
      state.pendingOperations.delete(id);
    });

  state.pendingOperations.set(id, {
    id,
    type,
    startedAt: Date.now(),
    promise
  });

  return promise;
}

function runShared(state, key, operation) {
  assertLifecycleRunning(state);

  if (state[key]) {
    return state[key];
  }

  const promise = Promise.resolve()
    .then(operation)
    .finally(() => {
      if (state[key] === promise) {
        state[key] = null;
      }
    });

  state[key] = promise;
  return promise;
}

function withTimeout(operation, timeoutMs, onTimeout, timerApi = {}) {
  const setTimer = timerApi.setTimeout || setTimeout;
  const clearTimer = timerApi.clearTimeout || clearTimeout;

  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimer(() => {
      if (settled) return;

      settled = true;
      if (onTimeout) onTimeout();
      const error = new Error(`Operation timed out after ${timeoutMs} ms`);
      error.code = 'OPERATION_TIMEOUT';
      reject(error);
    }, timeoutMs);

    Promise.resolve(operation).then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimer(timer);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimer(timer);
        reject(error);
      }
    );
  });
}

function startPendingLogin(state, value, cleanup, timerApi = {}) {
  assertLifecycleRunning(state);

  if (state.pendingLogin) {
    throw new Error('Telegram login is already in progress.');
  }

  const setTimer = timerApi.setTimeout || setTimeout;
  const clearTimer = timerApi.clearTimeout || clearTimeout;
  let cleaned = false;
  const finishCleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    if (cleanup) await cleanup(value);
  };

  const pending = {
    value,
    timer: null,
    clear: async ({ cleanup = true } = {}) => {
      if (pending.timer) clearTimer(pending.timer);
      if (state.pendingLogin === pending) state.pendingLogin = null;
      if (cleanup) await finishCleanup();
    }
  };

  pending.timer = setTimer(() => {
    pending.clear().catch(() => undefined);
  }, state.loginTtlMs);

  state.pendingLogin = pending;
  return pending;
}

function stopReconnect(state) {
  state.reconnectGeneration += 1;
  if (state.reconnectTimer) {
    clearInterval(state.reconnectTimer);
    state.reconnectTimer = null;
  }
  state.reconnectInProgress = false;
}

function beginShutdown(state, cleanup) {
  if (state.shutdownPromise) return state.shutdownPromise;

  state.status = 'shutting-down';
  state.loginGeneration += 1;
  stopReconnect(state);
  state.shutdownPromise = Promise.resolve()
    .then(cleanup)
    .finally(() => {
      state.status = 'stopped';
    });

  return state.shutdownPromise;
}

module.exports = {
  createLifecycleState,
  assertLifecycleRunning,
  trackOperation,
  runShared,
  withTimeout,
  startPendingLogin,
  stopReconnect,
  beginShutdown
};
