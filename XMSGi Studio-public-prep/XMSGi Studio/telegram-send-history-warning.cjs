const MAX_TRACKED_WARNINGS = 2000;

function createTelegramSendHistoryWarningNotifier(getWindow) {
  const queuedAttemptIds = new Set();
  const notifiedAttemptIds = new Set();

  function getReadyWebContents() {
    const window = getWindow?.();
    if (!window || window.isDestroyed?.()) return null;

    const webContents = window.webContents;
    if (!webContents || webContents.isDestroyed?.() || webContents.isLoading?.()) return null;
    return webContents;
  }

  function flush() {
    const webContents = getReadyWebContents();
    if (!webContents) return;

    for (const attemptId of queuedAttemptIds) {
      try {
        webContents.send('telegram-send-history-warning');
        queuedAttemptIds.delete(attemptId);
      } catch (error) {
        console.error(
          'Could not notify the renderer about an unsaved Telegram send:',
          error?.code || error?.name || 'unknown',
        );
        return;
      }
    }
  }

  function report(attemptId) {
    if (typeof attemptId !== 'string' || !attemptId || notifiedAttemptIds.has(attemptId)) return;

    notifiedAttemptIds.add(attemptId);
    queuedAttemptIds.add(attemptId);
    while (notifiedAttemptIds.size > MAX_TRACKED_WARNINGS) {
      const oldestAttemptId = notifiedAttemptIds.values().next().value;
      notifiedAttemptIds.delete(oldestAttemptId);
      queuedAttemptIds.delete(oldestAttemptId);
    }
    flush();
  }

  function resolve(attemptId) {
    queuedAttemptIds.delete(attemptId);
    notifiedAttemptIds.delete(attemptId);
  }

  return { report, resolve, flush };
}

function createRendererSendHistoryWarningSubscription(ipcRenderer) {
  const callbacks = new Set();
  let pending = false;

  ipcRenderer.on('telegram-send-history-warning', () => {
    if (callbacks.size === 0) {
      pending = true;
      return;
    }
    for (const callback of callbacks) callback();
  });

  return (callback) => {
    if (typeof callback !== 'function') return () => {};

    callbacks.add(callback);
    if (pending) {
      pending = false;
      callback();
    }
    return () => callbacks.delete(callback);
  };
}

function persistConfirmedSendResult(idempotencyKey, result, { persist, notifier, reportFailure = true }) {
  const historyResult = persist(idempotencyKey, result);
  if (historyResult?.historyPersisted === false) {
    if (reportFailure) notifier.report(idempotencyKey);
  } else if (historyResult?.historyPersisted === true) {
    notifier.resolve(idempotencyKey);
  }
  return historyResult;
}

module.exports = {
  createTelegramSendHistoryWarningNotifier,
  createRendererSendHistoryWarningSubscription,
  persistConfirmedSendResult,
};
