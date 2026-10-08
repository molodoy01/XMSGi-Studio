import { describe, expect, it } from 'vitest';
import { Api } from 'teleproto';
import { applyTelegramIdempotency, createTelegramRandomId } from './telegram-idempotency.cjs';

describe('Telegram send idempotency', () => {
  it('derives a stable random ID for retries and a distinct ID for each album item', () => {
    const key = `${Date.now()}:schedule-send-attempt`;

    expect(createTelegramRandomId(key)).toBe(createTelegramRandomId(key));
    expect(createTelegramRandomId(key, 0)).not.toBe(createTelegramRandomId(key, 1));
  });

  it('replaces Teleproto message and media random IDs with the retry-stable ID', () => {
    const key = `${Date.now()}:schedule-send-attempt`;
    const messageRequest = new Api.messages.SendMessage({ peer: new Api.InputPeerSelf(), message: 'test' });
    const mediaRequest = new Api.messages.SendMedia({
      peer: new Api.InputPeerSelf(),
      media: new Api.InputMediaEmpty(),
      message: 'test',
    });

    applyTelegramIdempotency(messageRequest, key);
    applyTelegramIdempotency(mediaRequest, key);

    expect(String(messageRequest.randomId)).toBe(createTelegramRandomId(key).toString());
    expect(String(mediaRequest.randomId)).toBe(createTelegramRandomId(key).toString());
  });

  it('assigns stable distinct IDs to album items', () => {
    const key = `${Date.now()}:schedule-send-attempt`;
    const media = [0, 1].map(() => new Api.InputSingleMedia({
      media: new Api.InputMediaEmpty(),
      message: '',
    }));
    const request = { multiMedia: media };

    applyTelegramIdempotency(request, key);

    expect(media.map((item) => String(item.randomId))).toEqual([
      createTelegramRandomId(key, 0).toString(),
      createTelegramRandomId(key, 1).toString(),
    ]);
  });
});