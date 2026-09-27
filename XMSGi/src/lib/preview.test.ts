import { describe, expect, it } from 'vitest';
import { appendPreviewMessage } from './preview';

describe('live chat preview', () => {
  it('appends a sent message to the active chat only', () => {
    const history = {
      chat: { id: 'chat-1', title: 'Saved Messages' },
      messages: [],
    };
    const replyMarkup = { inline_keyboard: [[{ text: 'Open', url: 'https://example.com' }]] };

    const updated = appendPreviewMessage(history, 'chat-1', 'Published now', replyMarkup);

    expect(updated.messages).toHaveLength(1);
    expect(updated.messages[0]).toMatchObject({
      text: 'Published now',
      outgoing: true,
      replyMarkup,
    });
  });

  it('does not append a sent message to another active chat', () => {
    const history = {
      chat: { id: 'chat-1', title: 'Saved Messages' },
      messages: [],
    };

    expect(appendPreviewMessage(history, 'chat-2', 'Wrong chat')).toBe(history);
  });

  it('preserves existing history when appending a local sent message', () => {
    const history = {
      chat: { id: 'chat-1', title: 'Saved Messages' },
      messages: [{
        id: 'telegram-1',
        text: 'Earlier message',
        date: '2026-09-18T00:00:00.000Z',
        outgoing: false,
      }],
    };

    const updated = appendPreviewMessage(history, 'chat-1', 'New message');

    expect(updated.messages.map((message) => message.text)).toEqual([
      'Earlier message',
      'New message',
    ]);
  });
});