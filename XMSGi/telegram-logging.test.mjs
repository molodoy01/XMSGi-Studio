import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

vi.mock('electron', () => ({
  app: { getPath: () => 'C:\\temp' },
  safeStorage: { isEncryptionAvailable: () => false },
}));

const nodeRequire = createRequire(import.meta.url);
const nodeModule = nodeRequire('node:module');
const originalLoad = nodeModule._load;
const consoleSpies = [];

function captureConsole() {
  for (const method of ['log', 'info', 'debug', 'warn', 'error', 'dir']) {
    consoleSpies.push(vi.spyOn(globalThis.console, method).mockImplementation(() => {}));
  }
}

function capturedOutput() {
  return consoleSpies
    .flatMap((spy) => spy.mock.calls.flat())
    .map((value) => {
      if (typeof value === 'string') return value;
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    })
    .join('\n');
}

function installTelegramMocks() {
  const scheduled = [];
  const sendCalls = [];
  const invokeCalls = [];

  class FakeInlineKeyboard {
    constructor() {
      this.rows = [[]];
    }

    url(text, url) {
      this.rows.at(-1).push({ text, url });
      return this;
    }

    callback(text, callbackData) {
      this.rows.at(-1).push({ text, callback_data: callbackData });
      return this;
    }

    row() {
      this.rows.push([]);
      return this;
    }

    build() {
      return { className: 'ReplyInlineMarkup', rows: this.rows.map((buttons) => ({ buttons })) };
    }
  }

  class FakeTelegramClient {
    constructor() {
      this.connected = false;
    }

    async connect() {
      this.connected = true;
    }

    async disconnect() {
      this.connected = false;
    }

    async getInputEntity() {
      return { className: 'InputPeerSelf' };
    }

    async invoke(request) {
      invokeCalls.push(request);
      if (request.scheduleDate) {
        scheduled.push({ id: 77, message: request.message, date: new Date(request.scheduleDate * 1000) });
      }
      return { id: 77 };
    }

    async sendMessage(_target, options) {
      sendCalls.push(options);
      if (options.message === 'PRIVATE_FAILURE_TEXT') {
        const error = new Error(options.message);
        error.code = 'FAKE_SEND_FAILED';
        error.request = options;
        throw error;
      }
      if (options.schedule) {
        scheduled.push({ id: 77, message: options.message, date: new Date(options.schedule * 1000) });
      }
      return { id: 77 };
    }

    async getScheduledMessages() {
      return scheduled;
    }
  }

  class FakeSendMessage {
    constructor(payload) {
      Object.assign(this, payload);
      this.className = 'messages.SendMessage';
    }
  }

  nodeModule._load = function load(request, parent, isMain) {
    if (request === 'teleproto') {
      return {
        TelegramClient: FakeTelegramClient,
        Api: { InputPeerSelf: class FakeInputPeerSelf {}, messages: { SendMessage: FakeSendMessage } },
        InlineKeyboard: FakeInlineKeyboard,
      };
    }
    if (request === 'teleproto/sessions') {
      return { StringSession: class FakeStringSession {} };
    }
    if (request === './telegram-account-storage.cjs') {
      return {
        loadAccountSecrets: () => ({ API_ID: '1', API_HASH: 'hash', SESSION_STRING: 'session' }),
        saveAccountSecrets: () => true,
        getTelegramAuthState: () => ({ signedOut: false, userName: '' }),
        setTelegramSignedOut: () => true,
        clearAccountSecrets: () => true,
      };
    }
    return originalLoad(request, parent, isMain);
  };

  return { sendCalls, invokeCalls };
}

afterEach(() => {
  nodeModule._load = originalLoad;
  consoleSpies.splice(0).forEach((spy) => spy.mockRestore());
  vi.resetModules();
});

describe('Telegram operation log privacy', () => {
  it('omits message text, button data, and file paths from send, schedule, and error logs', async () => {
    vi.resetModules();
    const { sendCalls, invokeCalls } = installTelegramMocks();
    captureConsole();

    const { createTelegramCore } = await import('./telegram.cjs');
    const core = createTelegramCore({ apiId: 1, apiHash: 'hash', sessionString: 'session' });
    const privateMarkup = {
      inline_keyboard: [[
        { text: 'PRIVATE_BUTTON_TEXT', url: 'https://example.com/PRIVATE_BUTTON_URL' },
        { text: 'Callback label', callback_data: 'PRIVATE_CALLBACK_DATA' },
      ]],
    };

    try {
      await core.connectTelegram();
      await core.sendMessage('me', 'PRIVATE_DIRECT_SEND_TEXT');
      expect(invokeCalls.at(-1).message).toBe('PRIVATE_DIRECT_SEND_TEXT');

      await core.sendMessage(
        'me',
        'PRIVATE_SEND_TEXT',
        ['C:\\private\\photo-secret.png'],
        [],
        privateMarkup,
      );
      expect(sendCalls.at(-1).message).toBe('PRIVATE_SEND_TEXT');

      const scheduleTimestamp = Math.floor(Date.now() / 1000) + 3600;
      const scheduled = await core.scheduleMessage(
        'me',
        'PRIVATE_SCHEDULE_TEXT',
        undefined,
        undefined,
        scheduleTimestamp,
        ['C:\\private\\scheduled-secret.png'],
        [],
        privateMarkup,
      );
      expect(scheduled.confirmed).toBe(true);

      await expect(core.sendMessage(
        'me',
        'PRIVATE_FAILURE_TEXT',
        ['C:\\private\\failure-secret.png'],
        [],
        privateMarkup,
      )).rejects.toMatchObject({ code: 'FAKE_SEND_FAILED' });

      const output = capturedOutput();
      for (const secret of [
        'PRIVATE_SEND_TEXT',
        'PRIVATE_SCHEDULE_TEXT',
        'PRIVATE_FAILURE_TEXT',
        'PRIVATE_BUTTON_TEXT',
        'PRIVATE_BUTTON_URL',
        'PRIVATE_CALLBACK_DATA',
        'C:\\private\\photo-secret.png',
        'C:\\private\\scheduled-secret.png',
        'C:\\private\\failure-secret.png',
      ]) {
        expect(output).not.toContain(secret);
      }
      expect(output).toContain('FAKE_SEND_FAILED');
      expect(output).toContain('schedule');
    } finally {
      await core.shutdownTelegram();
    }
  });
});