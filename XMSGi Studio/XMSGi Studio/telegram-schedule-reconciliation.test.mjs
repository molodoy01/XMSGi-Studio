import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createTelegramScheduler } = require('./telegram-scheduling.cjs');

function createReconciler(client, operation = {}) {
  const scheduler = createTelegramScheduler({
    Api: {},
    connectTelegram: vi.fn(),
    getClient: () => client,
    getTelegramRequestTimeout: () => 15000,
    telegramRequest: (operation) => operation(),
    withTimeout: (operation) => Promise.resolve(operation),
  });

  return scheduler.reconcilePendingScheduleInternal({
    chatId: 'chat-1',
    message: 'Pending message',
    targetTimestamp: 2052547200,
    attachments: [],
    entities: [],
    ...operation,
  });
}

describe('Telegram pending schedule reconciliation', () => {
  it('confirms an exact matching schedule without submitting a new operation', async () => {
    const client = {
      getScheduledMessages: vi.fn().mockResolvedValue([{
        id: 42,
        message: 'Pending message',
        date: new Date(2052547200 * 1000),
        entities: [],
        silent: false,
      }]),
      getMessages: vi.fn(),
    };

    await expect(createReconciler(client)).resolves.toEqual({
      state: 'scheduled',
      telegramMessageId: 42,
      telegramMessageIds: [42],
    });
    expect(client.getMessages).not.toHaveBeenCalled();
  });

  it.each([
    ['a manual identical message sent one minute before the schedule', [{
      id: 51, message: 'Pending message', date: new Date(2052547140000), out: true,
    }]],
    ['multiple identical outgoing messages', [
      { id: 51, message: 'Pending message', date: new Date(2052547200000), out: true },
      { id: 52, message: 'Pending message', date: new Date(2052547230000), out: true },
    ]],
    ['one match in an unverified limited history response', [{
      id: 51, message: 'Pending message', date: new Date(2052547230000), out: true,
    }]],
  ])('does not infer sent from %s', async (_description, history) => {
    const client = {
      getScheduledMessages: vi.fn().mockResolvedValue([]),
      getMessages: vi.fn().mockResolvedValue(history),
    };

    await expect(createReconciler(client)).resolves.toEqual({ state: 'unknown' });
    expect(client.getMessages).not.toHaveBeenCalled();
  });

  it('does not mark matching sent history as belonging to an operation with a different timestamp', async () => {
    const client = {
      getScheduledMessages: vi.fn().mockResolvedValue([]),
      getMessages: vi.fn().mockResolvedValue([{
        id: 51,
        message: 'Pending message',
        date: new Date(2052547230000),
        out: true,
      }]),
    };

    await expect(createReconciler(client, { targetTimestamp: 2052543600 })).resolves.toEqual({ state: 'unknown' });
    expect(client.getMessages).not.toHaveBeenCalled();
  });

  it('does not assign identical text history to either of two distinct pending operations', async () => {
    const client = {
      getScheduledMessages: vi.fn().mockResolvedValue([]),
      getMessages: vi.fn().mockResolvedValue([{
        id: 51,
        message: 'Pending message',
        date: new Date(2052547230000),
        out: true,
      }]),
    };

    await expect(Promise.all([
      createReconciler(client, { targetTimestamp: 2052547200 }),
      createReconciler(client, { targetTimestamp: 2052547260 }),
    ])).resolves.toEqual([{ state: 'unknown' }, { state: 'unknown' }]);
    expect(client.getMessages).not.toHaveBeenCalled();
  });

  it('leaves absence in Telegram lists ambiguous instead of claiming rejection', async () => {
    const client = {
      getScheduledMessages: vi.fn().mockResolvedValue([]),
      getMessages: vi.fn().mockResolvedValue([]),
    };

    await expect(createReconciler(client)).resolves.toEqual({ state: 'unknown' });
  });

  it('propagates Telegram lookup failures for the caller to retain Pending', async () => {
    const client = {
      getScheduledMessages: vi.fn().mockRejectedValue(new Error('Telegram timeout')),
    };

    await expect(createReconciler(client)).rejects.toThrow('Telegram timeout');
  });
});
