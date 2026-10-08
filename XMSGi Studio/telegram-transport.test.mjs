import { describe, expect, it } from 'vitest';
import { Api } from 'teleproto';
import { InlineKeyboard } from 'teleproto';
import { prepareInlineKeyboard } from './telegram-inline-keyboard.cjs';
import { normalizeFloodWaitError } from './telegram-errors.cjs';

describe('MTProto inline keyboard transport construction', () => {
  it('normalizes Telegram flood wait errors without retrying', () => {
    const error = new Error('A wait of 12 seconds is required');
    error.code = 'FLOOD_WAIT_12';

    const normalized = normalizeFloodWaitError(error);

    expect(normalized?.code).toBe('TELEGRAM_FLOOD_WAIT');
    expect(normalized?.waitSeconds).toBe(12);
    expect(normalized?.message).toContain('12 seconds');
  });

  it('builds URL markup as ReplyInlineMarkup', () => {
    const markup = new InlineKeyboard().url('Open', 'https://example.com').build();
    expect(markup).toBeInstanceOf(Api.ReplyInlineMarkup);
    expect(markup.rows[0].buttons[0].type).toBeInstanceOf(Api.InlineButtonTypeUrl);
    expect(markup.rows[0].buttons[0].type.url).toBe('https://example.com');
  });

  it('builds callback markup as ReplyInlineMarkup', () => {
    const markup = new InlineKeyboard().callback('Click', 'test_callback').build();
    expect(markup.rows[0].buttons[0].type).toBeInstanceOf(Api.InlineButtonTypeCallback);
    expect(markup.rows[0].buttons[0].type.data.toString('utf8')).toBe('test_callback');
  });

  it('preserves mixed buttons and multiple rows', () => {
    const markup = new InlineKeyboard()
      .url('Open', 'https://example.com')
      .callback('Click', 'test_callback')
      .row()
      .url('Telegram', 'https://t.me/example')
      .build();

    expect(markup.rows).toHaveLength(2);
    expect(markup.rows[0].buttons).toHaveLength(2);
    expect(markup.rows[1].buttons).toHaveLength(1);
  });

  it('accepts ReplyInlineMarkup through teleproto buildReplyMarkup', () => {
    const markup = new InlineKeyboard().url('Open', 'https://example.com').build();
    const rebuilt = { buildReplyMarkup: (value) => value } .buildReplyMarkup(markup);
    expect(rebuilt).toBe(markup);
  });

  it('places the prepared markup in SendMessage.replyMarkup', () => {
    const replyMarkup = prepareInlineKeyboard({
      inline_keyboard: [[{ text: 'Open', url: 'https://example.com' }]],
    });
    const request = new Api.messages.SendMessage({
      peer: new Api.InputPeerSelf(),
      message: 'text',
      replyMarkup,
    });

    expect(request.replyMarkup).toBeInstanceOf(Api.ReplyInlineMarkup);
    expect(request.replyMarkup.rows[0].buttons[0].type.url).toBe('https://example.com');
  });

  it('places the prepared markup in SendMedia.replyMarkup', () => {
    const replyMarkup = prepareInlineKeyboard({
      inline_keyboard: [[{ text: 'Click', callback_data: 'test_callback' }]],
    });
    const request = new Api.messages.SendMedia({
      peer: new Api.InputPeerSelf(),
      media: new Api.InputMediaEmpty(),
      message: 'media',
      replyMarkup,
    });

    expect(request.replyMarkup).toBeInstanceOf(Api.ReplyInlineMarkup);
    expect(request.replyMarkup.rows[0].buttons[0].type.data.toString('utf8')).toBe('test_callback');
  });
});
