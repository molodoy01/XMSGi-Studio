import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => 'C:\\temp' },
  safeStorage: { isEncryptionAvailable: () => false },
}));

const require = createRequire(import.meta.url);
const nodeModule = require('node:module');

function createFakeClock() {
  let currentTime = 1_000_000;
  let nextTimerId = 0;
  const timers = new Map();

  return {
    timers,
    now: () => currentTime,
    setTimeout(callback, delay) {
      const id = ++nextTimerId;
      timers.set(id, { callback, deadline: currentTime + delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    async advanceBy(milliseconds) {
      const targetTime = currentTime + milliseconds;
      while (true) {
        const next = [...timers.entries()]
          .filter(([, timer]) => timer.deadline <= targetTime)
          .sort((left, right) => left[1].deadline - right[1].deadline)[0];
        if (!next) break;
        const [id, timer] = next;
        timers.delete(id);
        currentTime = timer.deadline;
        timer.callback();
        await Promise.resolve();
        await Promise.resolve();
      }
      currentTime = targetTime;
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

describe('Telegram core FloodWait integration', () => {
  afterEach(() => {
    vi.resetModules();
  });

  it('waits centrally and retries an RPC after FLOOD_WAIT_10', async () => {
    const originalLoad = nodeModule._load;
    const clock = createFakeClock();
    const storageState = {
      API_ID: '1',
      API_HASH: 'hash',
      SESSION_STRING: 'session-for-rate-limit-test',
      signedOut: false,
    };
    let dialogRequests = 0;
    const fakeClientRef = { current: undefined };

    nodeModule._load = function load(request, parent, isMain) {
      if (request === 'teleproto') {
        return {
          TelegramClient: class FakeTelegramClient {
            constructor() {
              this.connected = false;
              fakeClientRef.current = this;
            }

            connect() {
              this.connected = true;
              return Promise.resolve();
            }

            disconnect() {
              this.connected = false;
              return Promise.resolve();
            }

            getDialogs() {
              dialogRequests += 1;
              if (dialogRequests === 1) {
                const error = new Error('A wait of 10 seconds is required');
                error.code = 'FLOOD_WAIT_10';
                throw error;
              }
              return Promise.resolve([]);
            }

            getMe() {
              return Promise.resolve({ id: 41 });
            }
          },
          Api: {},
        };
      }

      if (request === 'teleproto/sessions') {
        return { StringSession: class FakeStringSession {} };
      }

      if (request === './telegram-account-storage.cjs') {
        return {
          loadAccountSecrets: () => ({ ...storageState }),
          saveAccountSecrets: () => true,
          getTelegramAuthState: () => ({ hasSession: true, signedOut: storageState.signedOut, userName: 'Test account' }),
          setTelegramSignedOut: (value) => {
            storageState.signedOut = Boolean(value);
            return true;
          },
          clearAccountSecrets: () => true,
        };
      }

      return originalLoad(request, parent, isMain);
    };

    let core;
    try {
      const { createTelegramCore } = await import('./telegram.cjs');
      core = createTelegramCore({
        apiId: 1,
        apiHash: 'hash',
        sessionString: storageState.SESSION_STRING,
        rateLimitTimers: clock,
      });

      const request = core.getChats();
      await vi.waitFor(() => expect(dialogRequests).toBe(1));

      expect(fakeClientRef.current?.connected).toBe(true);
      expect(core.getTelegramRateLimitState().current).toMatchObject({
        paused: true,
        pausedUntil: clock.now() + 10_000,
        waitSeconds: 10,
        status: 'rate-limited',
      });
      expect(core.getTelegramStatus()).toMatchObject({
        status: 'rate-limited',
      });
      expect(clock.timers.size).toBe(1);

      await clock.advanceBy(9_999);
      expect(dialogRequests).toBe(1);

      await clock.advanceBy(1);
      const chats = await request;

      expect(dialogRequests).toBe(2);
      expect(chats.map((chat) => chat.name)).toContain('Saved Messages');
      expect(core.getTelegramRateLimitState().current.paused).toBe(false);
      expect(core.getTelegramStatus()).toMatchObject({
        status: 'normal',
      });
      expect(clock.timers.size).toBe(0);
    } finally {
      if (core) await core.shutdownTelegram();
      nodeModule._load = originalLoad;
      delete globalThis.__telegramWelcomeClient;
      vi.resetModules();
    }
  });
});