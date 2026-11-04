const https = require('node:https');

function checkInternetConnection() {
  return new Promise((resolve, reject) => {
    const request = https.get(
      'https://telegram.org',
      { timeout: 5000 },
      (response) => {
        response.resume();
        if (response.statusCode >= 200 && response.statusCode < 500) {
          resolve(true);
        } else {
          reject(new Error(`Internet check failed: HTTP ${response.statusCode}`));
        }
      }
    );

    request.on('error', reject);
    request.on('timeout', () => {
      request.destroy();
      reject(new Error('Internet check timeout'));
    });
  });
}

function createTelegramReconnect({
  assertRunning,
  getClient,
  lifecycleState,
  notifyStatus,
  runShared,
  stopReconnect,
  telegramRequest,
  trackOperation,
  withTimeout,
}) {
  async function reconnectTelegramInternal() {
    assertRunning();
    lifecycleState.status = 'reconnecting';

    const reconnectClient = getClient();
    if (!reconnectClient) return;
    if (lifecycleState.reconnectInProgress) return;

    const reconnectGeneration = lifecycleState.reconnectGeneration;
    lifecycleState.reconnectInProgress = true;
    notifyStatus('reconnecting');

    try {
      try {
        if (reconnectClient.connected) {
          await reconnectClient.disconnect();
        }
      } catch (error) {
        console.error('Telegram disconnect during reconnect failed:', error?.code || error?.name || 'unknown');
      }

      if (
        reconnectGeneration !== lifecycleState.reconnectGeneration
        || getClient() !== reconnectClient
        || lifecycleState.status === 'shutting-down'
        || lifecycleState.status === 'stopped'
      ) {
        return false;
      }

      await telegramRequest(() => withTimeout(
        reconnectClient.connect(),
        15000,
        'Telegram reconnect'
      ));

      if (
        reconnectGeneration !== lifecycleState.reconnectGeneration
        || getClient() !== reconnectClient
        || lifecycleState.status === 'shutting-down'
        || lifecycleState.status === 'stopped'
      ) {
        try {
          await reconnectClient.disconnect();
        } catch (error) {
          console.error('Stale Telegram reconnect disconnect failed:', error?.code || error?.name || 'unknown');
        }

        return false;
      }

      console.log('Telegram reconnected.');
      notifyStatus('connected');
      lifecycleState.status = 'connected';
      return true;
    } catch (error) {
      if (
        reconnectGeneration !== lifecycleState.reconnectGeneration
        || getClient() !== reconnectClient
        || lifecycleState.status === 'shutting-down'
        || lifecycleState.status === 'stopped'
      ) {
        return false;
      }
      if (error?.code === 'TELEGRAM_SESSION_INVALID') throw error;
      console.error('Telegram reconnect failed:', error?.code || error?.name || 'unknown');
      notifyStatus('disconnected');
      lifecycleState.status = 'disconnected';
      return false;
    } finally {
      if (reconnectGeneration === lifecycleState.reconnectGeneration) {
        lifecycleState.reconnectInProgress = false;
      }
    }
  }

  function reconnectTelegram() {
    assertRunning();
    return runShared(lifecycleState, 'connectPromise', () => (
      trackOperation('reconnect', reconnectTelegramInternal)
    ));
  }

  function startTelegramReconnect() {
    if (
      lifecycleState.reconnectTimer
      || lifecycleState.status === 'shutting-down'
      || lifecycleState.status === 'stopped'
    ) {
      return;
    }

    const watchdogGeneration = lifecycleState.reconnectGeneration;
    const watchdogClient = getClient();
    let internetWasOffline = false;
    let reconnectDelay = 3000;
    let nextReconnectAt = 0;

    lifecycleState.reconnectTimer = setInterval(async () => {
      if (
        lifecycleState.reconnectGeneration !== watchdogGeneration
        || getClient() !== watchdogClient
        || !getClient()
      ) {
        return;
      }
      if (lifecycleState.reconnectInProgress) return;

      try {
        await checkInternetConnection();

        if (internetWasOffline) {
          internetWasOffline = false;
          nextReconnectAt = 0;
          reconnectDelay = 3000;
        }

        if (
          !getClient().connected
          && Date.now() >= nextReconnectAt
          && lifecycleState.reconnectGeneration === watchdogGeneration
          && getClient() === watchdogClient
        ) {
          console.log(`Telegram reconnect attempt (backoff ${reconnectDelay} ms)`);
          const reconnected = await reconnectTelegram();
          if (reconnected) {
            reconnectDelay = 3000;
            nextReconnectAt = 0;
          } else if (getClient() === watchdogClient) {
            nextReconnectAt = Date.now() + reconnectDelay;
            reconnectDelay = Math.min(reconnectDelay * 2, 30000);
          }
        }
      } catch {
        if (!internetWasOffline) {
          console.log('Internet connection lost');
          notifyStatus('reconnecting');
        }
        internetWasOffline = true;
      }
    }, 3000);
  }

  function stopTelegramReconnect() {
    stopReconnect(lifecycleState);
  }

  return { reconnectTelegram, startTelegramReconnect, stopTelegramReconnect };
}

module.exports = { createTelegramReconnect };