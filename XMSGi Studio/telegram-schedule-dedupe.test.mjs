import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('electron', () => ({
  app: { getPath: () => 'C:\\temp' },
  safeStorage: { isEncryptionAvailable: () => false },
}));

const nodeRequire = createRequire(import.meta.url);
const nodeModule = nodeRequire('node:module');
const originalLoad = nodeModule._load;
const activeCores = [];
const temporaryDirectories = [];

async function createCoreHarness(coreOptions = {}) {
  vi.resetModules();
  const clientReference = { value: null };

  class FakeInlineKeyboard {
    url() { return this; }
    callback() { return this; }
    row() { return this; }
    build() { return undefined; }
  }

  class FakeSendMessage {
    constructor(payload) {
      Object.assign(this, payload);
      this.className = 'messages.SendMessage';
      this.randomId = { constructor: (value) => value };
    }
  }

  class FakeTelegramClient {
    constructor() {
      this.connected = false;
      this.scheduled = [];
      this.randomIds = new Map();
      this.sendCalls = 0;
      this.scheduledListCalls = 0;
      clientReference.value = this;
    }

    async connect() { this.connected = true; }
    async disconnect() { this.connected = false; }
    async getInputEntity() { return { className: 'InputPeerSelf' }; }
    async getScheduledMessages() {
      this.scheduledListCalls += 1;
      return this.scheduled;
    }
    async deleteScheduledMessages(_target, ids) {
      this.deleteAttempts ??= [];
      this.deleteAttempts.push([...ids]);
      if (this.cleanupFailuresRemaining > 0) {
        this.cleanupFailuresRemaining -= 1;
        if (this.removeOneBeforeCleanupFailure) {
          const removedId = ids[0];
          this.scheduled = this.scheduled.filter((item) => Number(item.id) !== Number(removedId));
        }
        throw new Error('Telegram cleanup failed.');
      }
      this.deletedIds = ids;
      this.scheduled = this.scheduled.filter((item) => !ids.includes(Number(item.id)));
    }

    async sendMessage(_target, options) {
      this.sendCalls += 1;
      const isAlbum = Array.isArray(options.file);
      if (!isAlbum && this.sendCalls === this.failSendCallNumber) {
        throw new Error('Attachment scheduling failed.');
      }
      const request = {
        className: isAlbum ? 'messages.SendMultiMedia' : 'messages.SendMedia',
        randomId: { constructor: (value) => value },
        message: options.message,
        scheduleDate: options.schedule,
        multiMedia: isAlbum ? options.file.map((file) => ({
          randomId: { constructor: (value) => value },
          media: { file },
          message: '',
        })) : undefined,
        entities: options.formattingEntities,
        replyMarkup: options.buttons,
        silent: options.silent === true,
        effect: options.effect,
        media: { className: 'InputMediaUploadedDocument', file: options.file },
      };
      this.lastSendRequest = request;
      const result = await this.invoke(request);
      if (Array.isArray(options.file)) {
        const firstScheduled = this.scheduled.at(-1);
        return options.file.map((file, index) => {
          if (index === 0) return { id: firstScheduled.id };
          const message = {
            ...firstScheduled,
            id: this.scheduled.length + 1,
            media: { ...firstScheduled.media, file },
          };
          this.scheduled.push(message);
          return { id: message.id };
        });
      }
      return this.returnMessageIdUpdateOnly ? undefined : result;
    }

    async invoke(request) {
      if (this.rejectAlbums && request.className === 'messages.SendMultiMedia') {
        const error = new Error('Media invalid. (caused by messages.SendMultiMedia)');
        error.code = 'MEDIA_INVALID';
        error.request = request;
        throw error;
      }
      const idempotencyId = String(request.randomId);
      const existingId = this.randomIds.get(idempotencyId);
      if (existingId !== undefined) return { id: existingId };

      const id = this.scheduled.length + 1;
      this.randomIds.set(idempotencyId, id);
      this.scheduled.push({
        id,
        message: request.message,
        date: new Date(request.scheduleDate * 1000),
        entities: request.entities,
        replyMarkup: request.replyMarkup,
        silent: request.silent,
        effect: request.effect,
        media: request.media,
      });
      if (this.returnMessageIdUpdateOnly) {
        return { updates: [{ className: 'UpdateMessageID', id }] };
      }
      if (this.returnScheduledUpdate) {
        return { updates: [{ className: 'UpdateNewScheduledMessage', message: { id } }] };
      }
      if (this.returnImmediateMessage) {
        this.scheduled.pop();
        return { updates: [{ className: 'UpdateNewMessage', message: { id } }] };
      }
      return { id };
    }
  }

  nodeModule._load = function load(request, parent, isMain) {
    if (request === 'teleproto') {
      return {
        TelegramClient: FakeTelegramClient,
        InlineKeyboard: FakeInlineKeyboard,
        Api: {
          InputPeerSelf: class FakeInputPeerSelf {},
          messages: { SendMessage: FakeSendMessage },
        },
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

  const { createTelegramCore } = await import('./telegram.cjs');
  const core = createTelegramCore({ apiId: 1, apiHash: 'hash', sessionString: 'session', ...coreOptions });
  activeCores.push(core);
  await core.connectTelegram();
  return { core, client: clientReference.value };
}

function createAttachment(name, content) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'xmsgi-schedule-dedupe-'));
  temporaryDirectories.push(directory);
  const filePath = path.join(directory, name);
  fs.writeFileSync(filePath, content);
  return filePath;
}

async function schedule(core, { message = 'Same text', targetTimestamp, attachments = [] }) {
  return core.scheduleMessage(
    'me', message, undefined, undefined, targetTimestamp, attachments, [], undefined, false, undefined,
  );
}

afterEach(async () => {
  await Promise.all(activeCores.splice(0).map((core) => core.shutdownTelegram()));
  nodeModule._load = originalLoad;
  temporaryDirectories.splice(0).forEach((directory) => fs.rmSync(directory, { recursive: true, force: true }));
  vi.resetModules();
});

describe('Telegram scheduled operation deduplication', () => {
  it('reuses a scheduled item with the same text and exact time', async () => {
    const { core, client } = await createCoreHarness();
    const targetTimestamp = Math.floor(Date.now() / 1000) + 7200;

    const first = await schedule(core, { targetTimestamp });
    const retry = await schedule(core, { targetTimestamp });

    expect(retry.telegramMessageId).toBe(first.telegramMessageId);
    expect(client.scheduled).toHaveLength(1);
    expect(client.sendCalls).toBe(0);
  });

  it('keeps schedules with the same text but a different second separate', async () => {
    const { core, client } = await createCoreHarness();
    const targetTimestamp = Math.floor(Date.now() / 1000) + 7200;

    await schedule(core, { targetTimestamp });
    const second = await schedule(core, { targetTimestamp: targetTimestamp + 1 });

    expect(second.telegramMessageId).not.toBe(1);
    expect(client.scheduled).toHaveLength(2);
  });

  it('keeps different text at the same time separate', async () => {
    const { core, client } = await createCoreHarness();
    const targetTimestamp = Math.floor(Date.now() / 1000) + 7200;

    await schedule(core, { targetTimestamp, message: 'First text' });
    const second = await schedule(core, { targetTimestamp, message: 'Second text' });

    expect(second.telegramMessageId).not.toBe(1);
    expect(client.scheduled).toHaveLength(2);
  });

  it('keeps different attachments at the same text and time separate', async () => {
    const { core, client } = await createCoreHarness();
    const targetTimestamp = Math.floor(Date.now() / 1000) + 7200;
    const firstFile = createAttachment('photo.png', 'image A bytes');
    const secondFile = createAttachment('photo.png', 'image B bytes');

    const first = await schedule(core, { targetTimestamp, attachments: [firstFile] });
    const second = await schedule(core, { targetTimestamp, attachments: [secondFile] });

    expect(second.telegramMessageId).not.toBe(first.telegramMessageId);
    expect(client.scheduled).toHaveLength(2);
  });

  it('verifies media responses against schedule history unless Telegram returns a scheduled update', async () => {
    const { core, client } = await createCoreHarness();
    const targetTimestamp = Math.floor(Date.now() / 1000) + 7200;
    const attachment = createAttachment('photo.png', 'image bytes');

    await schedule(core, { targetTimestamp, attachments: [attachment] });

    expect(client.scheduledListCalls).toBe(1);
  });

  it('confirms attachment-only schedules from the RPC message ID update', async () => {
    const { core, client } = await createCoreHarness();
    const targetTimestamp = Math.floor(Date.now() / 1000) + 7200;
    const attachment = createAttachment('attachment-only.png', 'image bytes');
    client.returnMessageIdUpdateOnly = true;

    const result = await schedule(core, { targetTimestamp, message: '', attachments: [attachment] });

    expect(result.confirmed).toBe(true);
    expect(result.telegramMessageId).toBe(1);
    expect(client.scheduledListCalls).toBe(1);
  });

  it('confirms a seven-file album from the RPC response when schedule history is incomplete', async () => {
    const { core, client } = await createCoreHarness();
    const targetTimestamp = Math.floor(Date.now() / 1000) + 7200;
    const attachments = Array.from({ length: 7 }, (_, attachmentIndex) => createAttachment(
      `album-${attachmentIndex + 1}.png`,
      `image ${attachmentIndex + 1}`,
    ));
    client.returnScheduledUpdate = true;
    const result = await schedule(core, { targetTimestamp, message: '', attachments });

    expect(result.confirmed).toBe(true);
    expect(result.telegramMessageId).toBe(1);
    expect(client.lastSendRequest.className).toBe('messages.SendMultiMedia');
    expect(client.lastSendRequest.scheduleDate).toBe(targetTimestamp);
    expect(client.lastSendRequest.multiMedia).toHaveLength(7);
    expect(client.scheduled).toHaveLength(7);
    expect(client.scheduledListCalls).toBe(0);
  });

  it('schedules attachments individually when Telegram rejects the album', async () => {
    const { core, client } = await createCoreHarness();
    const targetTimestamp = Math.floor(Date.now() / 1000) + 7200;
    const attachments = Array.from({ length: 7 }, (_, attachmentIndex) => createAttachment(
      `fallback-${attachmentIndex + 1}.png`,
      `image ${attachmentIndex + 1}`,
    ));
    client.rejectAlbums = true;

    const result = await schedule(core, { targetTimestamp, message: '', attachments });

    expect(result.confirmed).toBe(true);
    expect(result.telegramMessageId).toBe(1);
    expect(result.telegramMessageIds).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(client.sendCalls).toBe(8);
    expect(client.scheduled).toHaveLength(7);
    expect(client.scheduled.every((item) => Math.floor(item.date.getTime() / 1000) === targetTimestamp)).toBe(true);
    expect(new Set(client.scheduled.map((item) => String(item.message))).size).toBe(1);
  });

  it('cancels every Telegram message created by the fallback', async () => {
    const { core, client } = await createCoreHarness();
    const targetTimestamp = Math.floor(Date.now() / 1000) + 7200;
    const attachments = [
      createAttachment('cancel-1.png', 'image one'),
      createAttachment('cancel-2.png', 'image two'),
      createAttachment('cancel-3.png', 'image three'),
    ];
    client.rejectAlbums = true;

    const result = await schedule(core, { targetTimestamp, message: '', attachments });
    await core.cancelScheduledMessage('me', result.telegramMessageIds, '', targetTimestamp);

    expect(client.deletedIds).toEqual([1, 2, 3]);
    expect(client.scheduled).toHaveLength(0);
  });

  it('keeps cancellation compatible with a legacy single Telegram ID', async () => {
    const { core, client } = await createCoreHarness();
    const targetTimestamp = Math.floor(Date.now() / 1000) + 7200;
    const attachment = createAttachment('legacy-id.png', 'image bytes');
    const result = await schedule(core, { targetTimestamp, attachments: [attachment] });

    await core.cancelScheduledMessage('me', result.telegramMessageId, '', targetTimestamp);

    expect(client.deletedIds).toEqual([result.telegramMessageId]);
    expect(client.scheduled).toHaveLength(0);
  });

  it('cleans up five already scheduled attachments if the sixth fallback send fails', async () => {
    const { core, client } = await createCoreHarness();
    const targetTimestamp = Math.floor(Date.now() / 1000) + 7200;
    const attachments = Array.from({ length: 7 }, (_, index) => createAttachment(
      `partial-${index + 1}.png`,
      `image ${index + 1}`,
    ));
    client.rejectAlbums = true;
    client.failSendCallNumber = 7;

    await expect(schedule(core, { targetTimestamp, message: '', attachments }))
      .rejects.toThrow('Attachment scheduling failed.');

    expect(client.deletedIds).toEqual([1, 2, 3, 4, 5]);
    expect(client.scheduled).toHaveLength(0);
  });

  it('returns only undeleted partial IDs after three cleanup attempts', async () => {
    const cleanupDelays = [];
    const { core, client } = await createCoreHarness({
      scheduleCleanupRetryDelay: async (milliseconds) => cleanupDelays.push(milliseconds),
    });
    const targetTimestamp = Math.floor(Date.now() / 1000) + 7200;
    const attachments = Array.from({ length: 7 }, (_, index) => createAttachment(
      `cleanup-${index + 1}.png`,
      `image ${index + 1}`,
    ));
    client.rejectAlbums = true;
    client.failSendCallNumber = 7;
    client.cleanupFailuresRemaining = 3;
    client.removeOneBeforeCleanupFailure = true;

    await expect(schedule(core, { targetTimestamp, message: '', attachments }))
      .rejects.toMatchObject({
        telegramMessageId: 4,
        telegramMessageIds: [4, 5],
      });

    expect(cleanupDelays).toEqual([1000, 2000, 5000]);
    expect(client.deleteAttempts).toEqual([[1, 2, 3, 4, 5], [2, 3, 4, 5], [3, 4, 5]]);
    expect(client.scheduled.map((item) => item.id)).toEqual([4, 5]);
  });

  it('does not mistake an immediate media update for a scheduled confirmation', async () => {
    const { core, client } = await createCoreHarness();
    const targetTimestamp = Math.floor(Date.now() / 1000) + 7200;
    const attachment = createAttachment('immediate.png', 'image bytes');
    client.returnImmediateMessage = true;

    await expect(schedule(core, { targetTimestamp, message: '', attachments: [attachment] }))
      .rejects.toThrow('Telegram sent the message immediately instead of scheduling it.');
  });

  it('does not create a duplicate when retrying the same media operation', async () => {
    const { core, client } = await createCoreHarness();
    const targetTimestamp = Math.floor(Date.now() / 1000) + 7200;
    const attachment = createAttachment('same.png', 'same image bytes');

    const first = await schedule(core, { targetTimestamp, attachments: [attachment] });
    const retry = await schedule(core, { targetTimestamp, attachments: [attachment] });

    expect(retry.telegramMessageId).toBe(first.telegramMessageId);
    expect(client.scheduled).toHaveLength(1);
    expect(client.sendCalls).toBe(2);
  });

  it('includes formatting, silent, markup, and effect in schedule identity', async () => {
    const { core } = await createCoreHarness();
    const base = {
      chatId: 'me',
      message: 'Same text',
      targetTimestamp: Math.floor(Date.now() / 1000) + 7200,
      attachments: [],
      entities: [],
      silent: false,
    };
    const variants = [
      { ...base, entities: [{ type: 'bold', offset: 0, length: 4 }] },
      { ...base, silent: true },
      { ...base, replyMarkup: { inline_keyboard: [[{ text: 'Open', url: 'https://example.com' }]] } },
      { ...base, effect: '123' },
    ];

    const identities = await core.getScheduleOperationIdentities([base, ...variants]);

    expect(identities).toHaveLength(5);
    expect(identities.every(Boolean)).toBe(true);
    expect(new Set(identities).size).toBe(5);
  });

  it('treats identical attachment bytes at different paths as the same operation', async () => {
    const { core, client } = await createCoreHarness();
    const targetTimestamp = Math.floor(Date.now() / 1000) + 7200;
    const firstFile = createAttachment('first.png', 'same image bytes');
    const secondFile = createAttachment('second.png', 'same image bytes');
    const first = await schedule(core, { targetTimestamp, attachments: [firstFile] });
    const second = await schedule(core, { targetTimestamp, attachments: [secondFile] });
    const identities = await core.getScheduleOperationIdentities([
      { chatId: 'me', message: 'Same text', targetTimestamp, attachments: [firstFile], entities: [], silent: false },
      { chatId: 'me', message: 'Same text', targetTimestamp, attachments: [secondFile], entities: [], silent: false },
    ]);

    expect(identities[0]).toBe(identities[1]);
    expect(second.telegramMessageId).toBe(first.telegramMessageId);
    expect(client.scheduled).toHaveLength(1);
    expect(client.sendCalls).toBe(2);
  });

  it('changes attachment identity when a file changes at the same path', async () => {
    const { core, client } = await createCoreHarness();
    const targetTimestamp = Math.floor(Date.now() / 1000) + 7200;
    const attachment = createAttachment('mutable.png', 'original bytes');
    const operation = {
      chatId: 'me',
      message: 'Same text',
      targetTimestamp,
      attachments: [attachment],
      entities: [],
      silent: false,
    };
    const [originalIdentity] = await core.getScheduleOperationIdentities([operation]);
    const first = await schedule(core, { targetTimestamp, attachments: [attachment] });
    expect(first.operationIdentity).toBe(originalIdentity);

    fs.writeFileSync(attachment, 'changed bytes');

    const [changedIdentity] = await core.getScheduleOperationIdentities([operation]);
    const second = await schedule(core, { targetTimestamp, attachments: [attachment] });

    expect(changedIdentity).not.toBe(originalIdentity);
    expect(second.operationIdentity).toBe(changedIdentity);
    expect(second.telegramMessageId).not.toBe(first.telegramMessageId);
    expect(client.scheduled).toHaveLength(2);
  });
});