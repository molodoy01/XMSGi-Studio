import { describe, expect, it } from 'vitest';
import { Api } from 'teleproto';
import {
  getTelegramEntityIdentity,
  getTelegramEntityType,
  toTelegramFormattingEntities,
} from './telegram-message-entities.cjs';

describe('Telegram message entity mapping', () => {
  it('maps Telegram class names to editor entity types', () => {
    expect(getTelegramEntityType({ className: 'MessageEntityBold' })).toBe('bold');
    expect(getTelegramEntityType(new Api.MessageEntityTextUrl({ offset: 1, length: 4, url: 'https://example.com' })))
      .toBe('text_url');
    expect(getTelegramEntityType(new Api.MessageEntityCode({ offset: 1, length: 4 }))).toBe('code');
    expect(getTelegramEntityType(new Api.MessageEntityPre({ offset: 5, length: 8, language: 'ts' }))).toBe('pre');
    expect(getTelegramEntityType(new Api.MessageEntityBlockquote({ offset: 14, length: 6 }))).toBe('blockquote');
    expect(getTelegramEntityType({ className: 'MessageEntityUnsupported' })).toBeNull();
  });

  it('normalizes Telegram entities for scheduled-message identity checks', () => {
    expect(getTelegramEntityIdentity([
      { className: 'MessageEntityBold', offset: 2, length: 5 },
      { className: 'MessageEntityTextUrl', offset: 8, length: 3, url: 'https://example.com' },
      { className: 'MessageEntityPre', offset: 12, length: 7, language: 'ts' },
      { className: 'MessageEntityUnknown', offset: 12, length: 1 },
    ])).toEqual([
      { type: 'bold', offset: 2, length: 5 },
      { type: 'text_url', offset: 8, length: 3, url: 'https://example.com' },
      { type: 'pre', offset: 12, length: 7, language: 'ts' },
      { type: 'MessageEntityUnknown', offset: 12, length: 1 },
    ]);
  });

  it('constructs Teleproto formatting entities and rejects unsupported types', () => {
    const entities = toTelegramFormattingEntities([
      { type: 'bold', offset: 1, length: 4 },
      { type: 'text_url', offset: 7, length: 3, url: 'https://example.com' },
      { type: 'code', offset: 12, length: 4 },
      { type: 'pre', offset: 18, length: 5, language: 'js' },
      { type: 'blockquote', offset: 24, length: 8 },
    ]);

    expect(entities[0]).toBeInstanceOf(Api.MessageEntityBold);
    expect(entities[1]).toBeInstanceOf(Api.MessageEntityTextUrl);
    expect(entities[1].url).toBe('https://example.com');
    expect(entities[2]).toBeInstanceOf(Api.MessageEntityCode);
    expect(entities[3]).toBeInstanceOf(Api.MessageEntityPre);
    expect(entities[3].language).toBe('js');
    expect(entities[4]).toBeInstanceOf(Api.MessageEntityBlockquote);
    expect(() => toTelegramFormattingEntities([{ type: 'unsupported', offset: 0, length: 1 }]))
      .toThrow('Unsupported formatting entity.');
  });
});