import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { fromTelegramInlineKeyboard } from './telegram-inline-keyboard.cjs';

function urlButton(text, url) {
  return { text, type: { className: 'InlineButtonTypeUrl', url } };
}

function callbackButton(text, data) {
  return { text, type: { className: 'InlineButtonTypeCallback', data: Buffer.from(data) } };
}

function row(...buttons) {
  return { className: 'KeyboardInlineButtonRow', buttons };
}

describe('Telegram inline keyboard history mapper', () => {
  it('maps one URL button', () => {
    expect(fromTelegramInlineKeyboard({ rows: [row(urlButton('Site', 'https://example.com'))] })).toEqual({
      inline_keyboard: [[{ text: 'Site', url: 'https://example.com' }]],
    });
  });

  it('maps one callback button', () => {
    expect(fromTelegramInlineKeyboard({ rows: [row(callbackButton('Run', 'run'))] })).toEqual({
      inline_keyboard: [[{ text: 'Run', callback_data: 'run' }]],
    });
  });

  it('preserves URL and callback buttons in one row', () => {
    expect(fromTelegramInlineKeyboard({ rows: [row(
      urlButton('Site', 'https://example.com'),
      callbackButton('Run', 'run'),
    )] })).toEqual({
      inline_keyboard: [[
        { text: 'Site', url: 'https://example.com' },
        { text: 'Run', callback_data: 'run' },
      ]],
    });
  });

  it('preserves two rows', () => {
    expect(fromTelegramInlineKeyboard({ rows: [
      row(urlButton('One', 'https://one.example')),
      row(callbackButton('Two', 'two')),
    ] })).toEqual({
      inline_keyboard: [
        [{ text: 'One', url: 'https://one.example' }],
        [{ text: 'Two', callback_data: 'two' }],
      ],
    });
  });

  it('returns undefined for missing or empty markup', () => {
    expect(fromTelegramInlineKeyboard(undefined)).toBeUndefined();
    expect(fromTelegramInlineKeyboard({ rows: [] })).toBeUndefined();
  });

  it('skips unsupported button types without dropping supported rows', () => {
    expect(fromTelegramInlineKeyboard({ rows: [row(
      { text: 'Web app', type: { className: 'InlineButtonTypeWebView', url: 'https://example.com' } },
      urlButton('Site', 'https://example.com'),
    )] })).toEqual({
      inline_keyboard: [[{ text: 'Site', url: 'https://example.com' }]],
    });
  });

  it('skips invalid UTF-8 callback data without failing history normalization', () => {
    expect(fromTelegramInlineKeyboard({ rows: [row(
      { text: 'Broken', type: { className: 'InlineButtonTypeCallback', data: Buffer.from([0xc3, 0x28]) } },
      urlButton('Site', 'https://example.com'),
    )] })).toEqual({
      inline_keyboard: [[{ text: 'Site', url: 'https://example.com' }]],
    });
  });

  it('keeps the normalized history message shape at the boundary', () => {
    const message = {
      id: '42',
      text: 'Incoming post',
      replyMarkup: fromTelegramInlineKeyboard({ rows: [row(urlButton('Site', 'https://example.com'))] }),
    };

    expect(message).toEqual({
      id: '42',
      text: 'Incoming post',
      replyMarkup: {
        inline_keyboard: [[{ text: 'Site', url: 'https://example.com' }]],
      },
    });
  });
});
