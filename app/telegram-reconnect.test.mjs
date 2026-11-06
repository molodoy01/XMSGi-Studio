import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createTelegramReconnect } = require('./telegram-reconnect.cjs');

function createDeferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

describe('Telegram reconnect watchdog', () => {
  it('checks less frequently and does not overlap internet checks', async () => {
    const firstCheck = createDeferred();
    const checkInternetConnection = vi.fn()
      .mockImplementationOnce(() => firstCheck.promise)
      .mockResolvedValue(true);
    const state = {
      reconnectTimer: null,
      reconnectGeneration: 0,
      reconnectInProgress: false,
      status: 'connected',
    };
    const client = { connected: true };
    let tick;
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval').mockImplementation((callback) => {
      tick = callback;
      return 1;
    });
    const reconnect = createTelegramReconnect({
      assertRunning: vi.fn(),
      getClient: () => client,
      lifecycleState: state,
      notifyStatus: vi.fn(),
      runShared: (_lifecycle, _key, operation) => operation(),
      stopReconnect: vi.fn(),
      telegramRequest: (operation) => operation(),
      trackOperation: (_type, operation) => operation(),
      withTimeout: (operation) => operation(),
      checkInternetConnection,
    });

    try {
      reconnect.startTelegramReconnect();
      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 10_000);

      const firstTick = tick();
      await Promise.resolve();
      expect(checkInternetConnection).toHaveBeenCalledTimes(1);

      await tick();
      expect(checkInternetConnection).toHaveBeenCalledTimes(1);

      firstCheck.resolve(true);
      await firstTick;
      await tick();
      expect(checkInternetConnection).toHaveBeenCalledTimes(2);
    } finally {
      reconnect.stopTelegramReconnect();
      setIntervalSpy.mockRestore();
    }
  });
});
