import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { createTelegramSender } = require('./telegram-send.cjs');
const { normalizeTelegramMessage } = require('./packages/shared/telegramText.cjs');

describe('Telegram sender whitespace', () => {
  it('sends indentation unchanged after Telegram text normalization', async () => {
    const message = 'Title\n    indented line\n\tTabbed line';
    const client = {
      connected: true,
      sendMessage: vi.fn(async () => ({ id: 1, date: new Date('2026-11-03T14:00:00.000Z') })),
    };
    const sendMessage = createTelegramSender({
      connectTelegram: vi.fn(),
      getClient: () => client,
      getTelegramRequestTimeout: () => 1000,
      logTelegramOperation: vi.fn(),
      normalizeTelegramMessage,
      telegramRequest: (operation) => operation(),
      toTelegramFormattingEntities: (entities) => entities,
      withTimeout: (operation) => operation,
      withTelegramInvokeDiagnostics: (_client, _action, operation) => operation(),
    });

    await sendMessage('chat-1', message);

    expect(client.sendMessage).toHaveBeenCalledWith('chat-1', { message });
  });
});
