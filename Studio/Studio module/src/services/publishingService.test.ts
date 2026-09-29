import { afterEach, describe, expect, it, vi } from 'vitest';
import { createScheduledPost, publishToChannel, scheduleToChannel } from './publishingService';
import { telegramCapabilities, telegramChannelAdapter } from './telegramChannelAdapter';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('publishingService', () => {
  it('creates a post and schedule together', () => {
    const { post, schedule } = createScheduledPost({
      accountId: 'account-1',
      channelId: 'channel-1',
      body: 'Hello from publish service',
      scheduleAt: '2026-01-01T10:00:00.000Z',
      timezone: 'UTC',
    });

    expect(post.status).toBe('draft');
    expect(schedule.postId).toBe(post.id);
    expect(schedule.channelId).toBe('channel-1');
  });

  it('publishes normalized text and media through the Telegram bridge', async () => {
    const send = vi.fn().mockResolvedValue({ success: true });
    vi.stubGlobal('telegram', { send });
    const replyMarkup = { inline_keyboard: [[{ text: 'Open', url: 'https://example.com' }]] };

    const result = await publishToChannel({
      accountId: 'account-1',
      channelId: 'channel-1',
      body: 'Send me',
      entities: [{ type: 'bold', offset: 0, length: 4 }],
      mediaIds: ['/tmp/image.png'],
      replyMarkup,
    });

    expect(result.normalized.text).toBe('Send me');
    expect(result.publishResult.ok).toBe(true);
    expect(result.publishResult.provider).toBe('telegram');
    expect(send).toHaveBeenCalledWith(
      'channel-1',
      'Send me',
      ['/tmp/image.png'],
      [{ type: 'bold', offset: 0, length: 4 }],
      replyMarkup,
    );
  });

  it('does not claim publish success when Telegram rejects the message', async () => {
    vi.stubGlobal('telegram', {
      send: vi.fn().mockResolvedValue({ success: false, error: 'Telegram is disconnected.' }),
    });

    const result = await publishToChannel({ accountId: 'account-1', channelId: 'channel-1', body: 'Send me' });

    expect(result.publishResult).toMatchObject({
      ok: false,
      provider: 'telegram',
      error: 'Telegram is disconnected.',
    });
  });

  it('routes scheduled posts through the channel adapter', async () => {
    const schedule = vi.fn().mockResolvedValue({ success: true, telegramMessageId: 42, confirmed: true });
    vi.stubGlobal('telegram', { schedule });

    const result = await scheduleToChannel({
      accountId: 'account-1',
      channelId: 'channel-1',
      body: 'Schedule me',
      scheduleAt: '2026-01-01T10:00:00.000Z',
    });

    expect(schedule).toHaveBeenCalledWith({
      chatId: 'channel-1',
      message: 'Schedule me',
      targetTimestamp: 1767261600,
      attachments: [],
      entities: [],
      replyMarkup: undefined,
    });
    expect(result.publishResult).toMatchObject({
      ok: true,
      provider: 'telegram',
      messageId: '42',
      confirmed: true,
    });
  });

  it('cancels scheduled messages through the Telegram adapter', async () => {
    const cancel = vi.fn().mockResolvedValue({ success: true });
    vi.stubGlobal('telegram', { cancel });

    await expect(telegramChannelAdapter.cancelScheduled('channel-1', 42)).resolves.toMatchObject({
      ok: true,
      provider: 'telegram',
    });
    expect(cancel).toHaveBeenCalledWith({ chatId: 'channel-1', telegramMessageId: 42 });
  });

  it('advertises only capabilities implemented by the Telegram bridge', () => {
    expect(telegramCapabilities).toEqual({
      supportsTextPublishing: true,
      supportsRichText: true,
      supportsMedia: true,
      supportsScheduling: true,
      supportsScheduleCancellation: true,
      supportsEditing: false,
      supportsDeletion: false,
      supportsInlineKeyboard: true,
    });
  });
});
