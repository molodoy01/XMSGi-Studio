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

async function createCoreHarness() {
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

    async sendMessage(_target, options) {
      this.sendCalls += 1;
      return this.invoke({
        className: 'messages.SendMedia',
        randomId: { constructor: (value) => value },
        message: options.message,
        scheduleDate: options.schedule,
        entities: options.formattingEntities,
        replyMarkup: options.buttons,
        silent: options.silent === true,
        effect: options.effect,
        media: { className: 'InputMediaUploadedDocument', file: options.file },
      });
    }

    async invoke(request) {
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
  const core = createTelegramCore({ apiId: 1, apiHash: 'hash', sessionString: 'session' });
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

  it('skips the unused schedule-list preflight for media operations', async () => {
    const { core, client } = await createCoreHarness();
    const targetTimestamp = Math.floor(Date.now() / 1000) + 7200;
    const attachment = createAttachment('photo.png', 'image bytes');

    await schedule(core, { targetTimestamp, attachments: [attachment] });

    expect(client.scheduledListCalls).toBe(1);
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