/* global console */
import { Buffer } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createTelegramChatData } = require('./telegram-chat-data.cjs');
const { getPreviewMediaDataBytes } = require('./telegram-media-preview.cjs');

class User {}
class Chat {}
class Channel {}
class ChatForbidden {}

function createChatData(client) {
  return createTelegramChatData({
    Api: { User, Chat, Channel, ChatForbidden },
    connectTelegram: vi.fn(),
    getClient: () => client,
    telegramRequest: (request) => request(),
    withTimeout: (request) => request,
  });
}

describe('Telegram chat history peer resolution', () => {
  it('resolves Saved Messages using Telegram’s self peer when the selected chat has the account ID', async () => {
    const self = Object.assign(new User(), { id: 42, firstName: 'Account' });
    const client = {
      getMe: vi.fn().mockResolvedValue(self),
      getEntity: vi.fn(),
      getMessages: vi.fn().mockResolvedValue([]),
      downloadProfilePhoto: vi.fn().mockResolvedValue(null),
    };

    const result = await createChatData(client).getChatHistoryInternal('42', 50);

    expect(client.getEntity).not.toHaveBeenCalled();
    expect(client.getMessages).toHaveBeenCalledWith('me', { limit: 50 });
    expect(result.chat.title).toBe('Account');
  });

  it('continues resolving regular chats by their selected chat ID', async () => {
    const chat = Object.assign(new Chat(), { id: 73, title: 'Group' });
    const self = Object.assign(new User(), { id: 42, firstName: 'Account' });
    const client = {
      getMe: vi.fn().mockResolvedValue(self),
      getEntity: vi.fn().mockResolvedValue(chat),
      getMessages: vi.fn().mockResolvedValue([]),
      downloadProfilePhoto: vi.fn().mockResolvedValue(null),
    };

    await createChatData(client).getChatHistoryInternal('73', 50);

    expect(client.getEntity).toHaveBeenCalledWith('73');
    expect(client.getMessages).toHaveBeenCalledWith(chat, { limit: 50 });
  });

  it('retries once when Telegram briefly returns an empty channel history', async () => {
    const channel = Object.assign(new Channel(), { id: 73, title: 'Channel' });
    const self = Object.assign(new User(), { id: 42, firstName: 'Account' });
    const client = {
      getMe: vi.fn().mockResolvedValue(self),
      getEntity: vi.fn().mockResolvedValue(channel),
      getMessages: vi.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 1, date: 1793880000, message: 'Recent post' }]),
      downloadProfilePhoto: vi.fn().mockResolvedValue(null),
    };

    const result = await createChatData(client).getChatHistoryInternal('73', 50);

    expect(client.getMessages).toHaveBeenCalledTimes(2);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].text).toBe('Recent post');
  });

  it('uses the cached avatar instead of downloading it while loading chat history', async () => {
    const chat = Object.assign(new Chat(), { id: 73, title: 'Group' });
    const self = Object.assign(new User(), { id: 42, firstName: 'Account' });
    const cachedAvatarDataUrl = 'data:image/jpeg;base64,YXZhdGFy';
    const client = {
      getMe: vi.fn().mockResolvedValue(self),
      getEntity: vi.fn().mockResolvedValue(chat),
      getMessages: vi.fn().mockResolvedValue([]),
      downloadProfilePhoto: vi.fn(),
    };

    const result = await createChatData(client)
      .getChatHistoryInternal('73', 50, undefined, cachedAvatarDataUrl);

    expect(client.downloadProfilePhoto).not.toHaveBeenCalled();
    expect(result.chat.avatarDataUrl).toBe(cachedAvatarDataUrl);
  });

  it('bounds media downloads and the total media payload for a large history', async () => {
    const self = Object.assign(new User(), { id: 42, firstName: 'Account' });
    let activeDownloads = 0;
    let maximumConcurrentDownloads = 0;
    const messages = Array.from({ length: 12 }, (_, index) => ({
      id: index + 1,
      date: 1700000000 + index,
      video: true,
      file: { name: `clip-${index}.mp4`, size: 1024 * 1024 },
      downloadMedia: vi.fn(async () => {
        activeDownloads += 1;
        maximumConcurrentDownloads = Math.max(maximumConcurrentDownloads, activeDownloads);
        await Promise.resolve();
        activeDownloads -= 1;
        return Buffer.alloc(1024 * 1024);
      }),
    }));
    const client = {
      getMe: vi.fn().mockResolvedValue(self),
      getEntity: vi.fn().mockResolvedValue(self),
      getMessages: vi.fn().mockResolvedValue(messages),
      downloadProfilePhoto: vi.fn().mockResolvedValue(null),
    };

    const result = await createChatData(client).getChatHistoryInternal('42', 50);

    const payloadBytes = result.messages.reduce((total, message) => total + getPreviewMediaDataBytes(message.media), 0);
    expect(maximumConcurrentDownloads).toBeLessThanOrEqual(3);
    expect(payloadBytes).toBeLessThanOrEqual(8 * 1024 * 1024);
    expect(result.messages).toHaveLength(12);
  });

  it('limits image downloads while preserving all messages in a photo-heavy history', async () => {
    const self = Object.assign(new User(), { id: 42, firstName: 'Account' });
    const messages = Array.from({ length: 50 }, (_, index) => ({
      id: index + 1,
      date: 1700000000 + index,
      photo: true,
      file: { name: `photo-${index}.jpg`, size: 1024 },
      downloadMedia: vi.fn().mockResolvedValue(null),
    }));
    const client = {
      getMe: vi.fn().mockResolvedValue(self),
      getEntity: vi.fn().mockResolvedValue(self),
      getMessages: vi.fn().mockResolvedValue(messages),
      downloadProfilePhoto: vi.fn().mockResolvedValue(null),
    };

    const result = await createChatData(client).getChatHistoryInternal('42', 50);

    expect(result.messages).toHaveLength(50);
    expect(messages.filter((message) => message.downloadMedia.mock.calls.length > 0)).toHaveLength(8);
  });

  it('keeps channel text history when a photo preview has unreadable metadata', async () => {
    const self = Object.assign(new User(), { id: 42, firstName: 'Account' });
    const message = {
      id: 1,
      date: 1793880000,
      message: 'Channel post text',
      photo: true,
    };
    Object.defineProperty(message, 'file', {
      get() {
        throw new Error('Photo metadata unavailable');
      },
    });
    const client = {
      getMe: vi.fn().mockResolvedValue(self),
      getEntity: vi.fn().mockResolvedValue(self),
      getMessages: vi.fn().mockResolvedValue([message]),
      downloadProfilePhoto: vi.fn().mockResolvedValue(null),
    };
    const logError = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const result = await createChatData(client).getChatHistoryInternal('42', 50);

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].text).toBe('Channel post text');
      expect(logError).toHaveBeenCalledWith('Telegram chat message preview unavailable:', 'Error');
    } finally {
      logError.mockRestore();
    }
  });
});
