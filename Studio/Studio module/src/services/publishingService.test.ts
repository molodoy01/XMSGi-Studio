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

  it('returns normalized FloodWait details for a rejected publish', async () => {
    vi.stubGlobal('telegram', {
      send: vi.fn().mockResolvedValue({
        success: false,
        error: 'Telegram asks to wait 12 seconds before trying again.',
        code: 'TELEGRAM_FLOOD_WAIT',
        category: 'flood',
        retryable: true,
        waitSeconds: 12,
      }),
    });

    const result = await publishToChannel({ accountId: 'account-1', channelId: 'channel-1', body: 'Send me' });

    expect(result.publishResult).toMatchObject({
      ok: false,
      error: 'Telegram asks to wait 12 seconds before trying again.',
      errorDetails: {
        operation: 'publish',
        category: 'flood',
        retryable: true,
        code: 'TELEGRAM_FLOOD_WAIT',
        waitSeconds: 12,
      },
    });
  });

  it('uses the same publish error layer for scheduled sends', async () => {
    vi.stubGlobal('telegram', {
      schedule: vi.fn().mockResolvedValue({
        success: false,
        error: 'Telegram asks to wait 8 seconds before trying again.',
        code: 'TELEGRAM_FLOOD_WAIT',
        category: 'flood',
        retryable: true,
        waitSeconds: 8,
      }),
    });

    const result = await scheduleToChannel({
      accountId: 'account-1',
      channelId: 'channel-1',
      body: 'Schedule me',
      scheduleAt: '2026-01-01T10:00:00.000Z',
    });

    expect(result.publishResult.errorDetails).toMatchObject({
      operation: 'publish',
      category: 'flood',
      retryable: true,
      waitSeconds: 8,
    });
  });

  it('keeps invalid FloodWait errors non-retryable when IPC already classified them', async () => {
    vi.stubGlobal('telegram', {
      send: vi.fn().mockResolvedValue({
        success: false,
        error: 'Telegram FLOOD_WAIT value exceeds the supported limit.',
        code: 'TELEGRAM_FLOOD_WAIT_EXCEEDS_MAX',
        category: 'error',
        retryable: false,
      }),
    });

    const result = await publishToChannel({ accountId: 'account-1', channelId: 'channel-1', body: 'Send me' });

    expect(result.publishResult.errorDetails).toMatchObject({
      operation: 'publish',
      category: 'error',
      retryable: false,
      code: 'TELEGRAM_FLOOD_WAIT_EXCEEDS_MAX',
    });
  });

  it('classifies cancelled Telegram requests on publish', async () => {
    vi.stubGlobal('telegram', {
      send: vi.fn().mockResolvedValue({
        success: false,
        error: 'Telegram request was cancelled after the account changed.',
        code: 'TELEGRAM_REQUEST_CANCELLED',
        category: 'cancelled',
        retryable: false,
        cancelled: true,
      }),
    });

    const result = await publishToChannel({ accountId: 'account-1', channelId: 'channel-1', body: 'Send me' });

    expect(result.publishResult.errorDetails).toMatchObject({
      operation: 'publish',
      category: 'cancelled',
      retryable: false,
      code: 'TELEGRAM_REQUEST_CANCELLED',
    });
  });

  it('classifies cancellation failures without changing the existing error text', async () => {
    vi.stubGlobal('telegram', {
      cancel: vi.fn().mockResolvedValue({
        success: false,
        error: 'Telegram request was cancelled after the account changed.',
        code: 'TELEGRAM_REQUEST_CANCELLED',
        category: 'cancelled',
        retryable: false,
        cancelled: true,
      }),
    });

    await expect(telegramChannelAdapter.cancelScheduled('channel-1', 42)).resolves.toMatchObject({
      ok: false,
      error: 'Telegram request was cancelled after the account changed.',
      errorDetails: {
        operation: 'cancel',
        category: 'cancelled',
        retryable: false,
        code: 'TELEGRAM_REQUEST_CANCELLED',
      },
    });
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
