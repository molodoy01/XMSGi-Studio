import { describe, expect, it, vi } from 'vitest';
import { Api, TelegramClient } from 'teleproto';
import { StringSession } from 'teleproto/sessions';
import { _getResponseMessage } from 'teleproto/client/messageParse';
import { UpdateManager } from 'teleproto/client/updates/manager';
import { createTelegramRandomId } from './telegram-idempotency.cjs';
import { withTelegramInvokeDiagnostics } from './telegram-publish-diagnostics.cjs';
import { createTelegramSendRecovery } from './telegram-send-recovery.cjs';
import { createTelegramSender } from './telegram-send.cjs';

describe('immediate Telegram send recovery', () => {
  it('documents the installed Teleproto cold-start catch-up limitation without network access', async () => {
    const client = {
      api: { updates: { getState: vi.fn().mockResolvedValue({ pts: 10, qts: 0, date: 1, seq: 0 }) } },
      _log: { debug: vi.fn(), error: vi.fn() },
    };
    const manager = new UpdateManager(client);
    const fetchDifference = vi.spyOn(manager, 'fetchCommonDifference').mockResolvedValue();

    await manager.catchUp();

    expect(client.api.updates.getState).toHaveBeenCalledOnce();
    expect(fetchDifference).not.toHaveBeenCalled();

    await manager.catchUp();
    expect(fetchDifference).toHaveBeenCalledOnce();
  });

  it('uses the installed Teleproto UpdateMessageID parser to return the actual message', () => {
    const client = new TelegramClient(new StringSession(''), 1, 'hash', {});
    const peer = new Api.InputPeerSelf();
    const request = new Api.messages.SendMessage({ peer, message: 'Correlated message', randomId: 123n });
    const date = 1761150000;
    const message = new Api.Message({
      id: 42,
      peerId: new Api.PeerUser({ userId: 1n }),
      message: 'Correlated message',
      date,
      out: true,
    });
    const updates = new Api.Updates({
      updates: [
        new Api.UpdateMessageID({ id: 42, randomId: request.randomId }),
        new Api.UpdateNewMessage({ message, pts: 1, ptsCount: 1 }),
      ],
      users: [],
      chats: [],
      date,
      seq: 0,
    });

    const sent = _getResponseMessage(client, request, updates, peer);

    expect(sent).toMatchObject({ id: 42, date, message: 'Correlated message' });
  });

  it('recovers a send only from the matching random_id update', () => {
    const key = '1736962920000:stable-attempt';
    const onConfirmed = vi.fn();
    const recovery = createTelegramSendRecovery({ createRandomId: createTelegramRandomId, onConfirmed });
    recovery.trackSendAttempt(key);

    recovery.observeUpdate({
      className: 'UpdateMessageID',
      id: 42,
      randomId: createTelegramRandomId(key),
    });

    expect(recovery.getResult(key)).toEqual({
      telegramMessageId: 42,
      telegramMessageIds: [42],
    });
    expect(onConfirmed).toHaveBeenCalledWith(key, {
      telegramMessageId: 42,
      telegramMessageIds: [42],
    });
    expect(recovery.getResult('1736962920000:another-attempt')).toBeNull();
  });

  it('keeps an attempt random_id stable when it is tracked repeatedly', () => {
    const key = '1736962920000:stable-random-id';
    const recovery = createTelegramSendRecovery({ createRandomId: createTelegramRandomId });
    recovery.trackSendAttempt(key, 2);
    const firstPartRandomId = createTelegramRandomId(key, 0);

    recovery.trackSendAttempt(key, 2);
    recovery.observeUpdate({
      className: 'UpdateMessageID',
      id: 51,
      randomId: firstPartRandomId,
    });

    expect(recovery.getResult(key, 2)).toBeNull();
    recovery.observeUpdate({
      className: 'UpdateMessageID',
      id: 52,
      randomId: createTelegramRandomId(key, 1),
    });
    expect(recovery.getResult(key, 2)).toMatchObject({
      telegramMessageId: 51,
      telegramMessageIds: [51, 52],
    });
  });

  it('rejects a random_id collision without replacing the existing attempt mapping', () => {
    const ids = new Map([
      ['attempt-first', 123n],
      ['attempt-second', 123n],
    ]);
    const recovery = createTelegramSendRecovery({
      createRandomId: (key) => ids.get(key),
    });
    recovery.trackSendAttempt('attempt-first');

    let collisionError;
    try {
      recovery.trackSendAttempt('attempt-second');
    } catch (error) {
      collisionError = error;
    }
    expect(collisionError?.code).toBe('RANDOM_ID_COLLISION');

    recovery.observeUpdate({
      className: 'UpdateMessageID',
      id: 61,
      randomId: 123n,
    });
    expect(recovery.getResult('attempt-first')).toMatchObject({
      telegramMessageId: 61,
      telegramMessageIds: [61],
    });

    ids.set('attempt-second', 456n);
    recovery.trackSendAttempt('attempt-second');
    recovery.observeUpdate({
      className: 'UpdateMessageID',
      id: 62,
      randomId: 456n,
    });
    expect(recovery.getResult('attempt-second')).toMatchObject({
      telegramMessageId: 62,
      telegramMessageIds: [62],
    });
  });

  it('rejects a collision between parts of the same album', () => {
    let collideParts = true;
    const recovery = createTelegramSendRecovery({
      createRandomId: (_key, part) => (collideParts ? 123n : BigInt(200 + part)),
    });

    let collisionError;
    try {
      recovery.trackSendAttempt('attempt-album', 2);
    } catch (error) {
      collisionError = error;
    }
    expect(collisionError?.code).toBe('RANDOM_ID_COLLISION');

    collideParts = false;
    recovery.trackSendAttempt('attempt-album', 2);
    recovery.observeUpdate({ className: 'UpdateMessageID', id: 71, randomId: 200n });
    recovery.observeUpdate({ className: 'UpdateMessageID', id: 72, randomId: 201n });
    expect(recovery.getResult('attempt-album', 2)).toMatchObject({
      telegramMessageId: 71,
      telegramMessageIds: [71, 72],
    });
  });

  it('rejects a changed random_id for an already tracked attempt', () => {
    let randomId = 123n;
    const recovery = createTelegramSendRecovery({
      createRandomId: () => randomId,
    });
    recovery.trackSendAttempt('attempt-stable');
    randomId = 456n;

    let mismatchError;
    try {
      recovery.trackSendAttempt('attempt-stable');
    } catch (error) {
      mismatchError = error;
    }
    expect(mismatchError?.code).toBe('RANDOM_ID_ATTEMPT_MISMATCH');
  });

  it('does not contact Telegram when a random_id collision is detected before sending', async () => {
    const client = { sendMessage: vi.fn() };
    const sender = createTelegramSender({
      connectTelegram: vi.fn(),
      getClient: () => client,
      getTelegramRequestTimeout: () => 1000,
      logTelegramOperation: vi.fn(),
      normalizeTelegramMessage: (message, entities) => ({ message, entities }),
      prepareInlineKeyboard: vi.fn(),
      trackSendAttempt: () => {
        const error = new Error('Telegram random_id conflicts with another tracked send attempt.');
        error.code = 'RANDOM_ID_COLLISION';
        throw error;
      },
      telegramRequest: (operation) => operation(),
      toTelegramFormattingEntities: vi.fn(),
      withTelegramInvokeDiagnostics: (_client, _label, operation) => operation(),
      withTimeout: (operation) => operation,
    });

    await expect(sender('chat-1', 'Text', [], [], undefined, false, undefined, 'attempt-1'))
      .rejects.toMatchObject({ code: 'RANDOM_ID_COLLISION' });
    expect(client.sendMessage).not.toHaveBeenCalled();
  });

  it('reconnects a disconnected client before sending', async () => {
    const client = {
      connected: false,
      sendMessage: vi.fn().mockResolvedValue({ id: 42 }),
    };
    const connectTelegram = vi.fn(async () => {
      client.connected = true;
      return client;
    });
    const sender = createTelegramSender({
      connectTelegram,
      getClient: () => client,
      getTelegramRequestTimeout: () => 1000,
      logTelegramOperation: vi.fn(),
      normalizeTelegramMessage: (message, entities) => ({ message, entities }),
      prepareInlineKeyboard: vi.fn(),
      telegramRequest: (operation) => operation(),
      toTelegramFormattingEntities: vi.fn(),
      withTelegramInvokeDiagnostics: (_client, _label, operation) => operation(),
      withTimeout: (operation) => operation,
    });

    const result = await sender('chat-1', 'Reconnect then send');

    expect(connectTelegram).toHaveBeenCalledOnce();
    expect(client.sendMessage).toHaveBeenCalledWith('chat-1', { message: 'Reconnect then send' });
    expect(result).toMatchObject({ success: true, telegramMessageId: 42 });
  });

  it('uses the Telegram message date paired with the ID correlation update', () => {
    const key = '1736962920000:dated-attempt';
    const recovery = createTelegramSendRecovery({ createRandomId: createTelegramRandomId });
    const date = 1761150000;
    const request = { randomId: createTelegramRandomId(key) };
    recovery.trackSendAttempt(key);

    recovery.observeResponse({
      updates: [
        { className: 'UpdateNewMessage', message: { id: 42, date, out: true } },
        { className: 'UpdateMessageID', id: 42, randomId: request.randomId },
      ],
    }, request, key);

    expect(recovery.getResult(key)).toEqual({
      telegramMessageId: 42,
      telegramMessageIds: [42],
      sentAt: new Date(date * 1000).toISOString(),
    });
  });

  it('does not confirm an unlinked message update or a partially mapped album', () => {
    const key = '1736962920000:album-attempt';
    const recovery = createTelegramSendRecovery({ createRandomId: createTelegramRandomId });
    recovery.trackSendAttempt(key, 2);

    recovery.observeUpdate({
      className: 'UpdateNewMessage',
      message: { id: 42, message: 'Same text', out: true },
    });
    recovery.observeUpdate({
      className: 'UpdateMessageID',
      id: 42,
      randomId: createTelegramRandomId(key, 0),
    });

    expect(recovery.getResult(key, 2)).toBeNull();

    recovery.observeUpdate({
      className: 'UpdateMessageID',
      id: 43,
      randomId: createTelegramRandomId(key, 1),
    });

    expect(recovery.getResult(key, 2)).toEqual({
      telegramMessageId: 42,
      telegramMessageIds: [42, 43],
    });

    const duplicateKey = '1736962920000:duplicate-album-attempt';
    recovery.trackSendAttempt(duplicateKey, 2);
    recovery.observeUpdate({
      className: 'UpdateMessageID',
      id: 44,
      randomId: createTelegramRandomId(duplicateKey, 0),
    });
    recovery.observeUpdate({
      className: 'UpdateMessageID',
      id: 44,
      randomId: createTelegramRandomId(duplicateKey, 1),
    });
    expect(recovery.getResult(duplicateKey, 2)).toBeNull();
  });

  it('returns the ID and actual Telegram date from Teleproto sendMessage results', async () => {
    const client = {
      sendMessage: vi.fn().mockResolvedValue({ id: 42, date: 1761150000 }),
    };
    const sender = createTelegramSender({
      connectTelegram: vi.fn(),
      getClient: () => client,
      getTelegramRequestTimeout: () => 1000,
      logTelegramOperation: vi.fn(),
      normalizeTelegramMessage: (message, entities) => ({ message, entities }),
      prepareInlineKeyboard: vi.fn(),
      telegramRequest: (operation) => operation(),
      toTelegramFormattingEntities: vi.fn(),
      withTelegramInvokeDiagnostics: (_client, _label, operation) => operation(),
      withTimeout: (operation) => operation,
    });

    const result = await sender('chat-1', 'Sent text', [], [], undefined, false, undefined, 'attempt-key');

    expect(client.sendMessage).toHaveBeenCalledWith('chat-1', { message: 'Sent text' });
    expect(result).toEqual({
      success: true,
      telegramMessageId: 42,
      telegramMessageIds: [42],
      sentAt: new Date(1761150000 * 1000).toISOString(),
    });
  });

  it('connects random_id injection, Teleproto parsing, and recovery without a network request', async () => {
    const key = '1736962920000:integrated-attempt';
    const recovery = createTelegramSendRecovery({ createRandomId: createTelegramRandomId });
    const date = 1761150000;
    const peer = new Api.InputPeerSelf();
    const client = {
      invoke: vi.fn(async (request) => new Api.Updates({
        updates: [
          new Api.UpdateMessageID({ id: 77, randomId: request.randomId }),
          new Api.UpdateNewMessage({
            message: new Api.Message({
              id: 77,
              peerId: new Api.PeerUser({ userId: 1n }),
              message: 'Integrated message',
              date,
              out: true,
            }),
            pts: 1,
            ptsCount: 1,
          }),
        ],
        users: [],
        chats: [],
        date,
        seq: 0,
      })),
      sendMessage: async (_target, options) => {
        const request = new Api.messages.SendMessage({
          peer,
          message: options.message,
          randomId: 1n,
        });
        const response = await client.invoke(request);
        return _getResponseMessage(client, request, response, peer);
      },
    };
    const sender = createTelegramSender({
      connectTelegram: vi.fn(),
      getClient: () => client,
      getTelegramRequestTimeout: () => 1000,
      logTelegramOperation: vi.fn(),
      normalizeTelegramMessage: (message, entities) => ({ message, entities }),
      observeTelegramResponse: recovery.observeResponse,
      prepareInlineKeyboard: vi.fn(),
      telegramRequest: (operation) => operation(),
      trackSendAttempt: recovery.trackSendAttempt,
      toTelegramFormattingEntities: vi.fn(),
      withTelegramInvokeDiagnostics,
      withTimeout: (operation) => operation,
    });

    const result = await sender('chat-1', 'Integrated message', [], [], undefined, false, undefined, key);

    expect(result).toMatchObject({
      success: true,
      telegramMessageId: 77,
      telegramMessageIds: [77],
      sentAt: new Date(date * 1000).toISOString(),
    });
    expect(client.invoke.mock.calls[0][0].randomId).toBe(createTelegramRandomId(key));
    expect(recovery.getResult(key)).toMatchObject({
      telegramMessageId: 77,
      sentAt: new Date(date * 1000).toISOString(),
    });
  });
});
