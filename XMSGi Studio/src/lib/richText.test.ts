import { describe, expect, it } from 'vitest';
import { mergeRichTextEntities, normalizeRichTextEntities, sliceRichText } from './richText';

describe('rich text entities', () => {
  it('normalizes supported entities and clamps their ranges', () => {
    expect(normalizeRichTextEntities([
      { type: 'bold', offset: -2, length: 5 },
      { type: 'text_url', offset: 2, length: 10, url: 'https://example.com' },
      { type: 'text_url', offset: 0, length: 2, url: 'javascript:alert(1)' },
    ], 6)).toEqual([
      { type: 'bold', offset: 0, length: 3 },
      { type: 'text_url', offset: 2, length: 4, url: 'https://example.com' },
    ]);
  });

  it('merges adjacent entities of the same kind', () => {
    expect(mergeRichTextEntities([
      { type: 'bold', offset: 0, length: 2 },
      { type: 'bold', offset: 2, length: 3 },
      { type: 'italic', offset: 2, length: 2 },
    ])).toEqual([
      { type: 'bold', offset: 0, length: 5 },
      { type: 'italic', offset: 2, length: 2 },
    ]);
  });

  it('slices text while preserving overlapping formatting', () => {
    expect(sliceRichText('Hello world', [
      { type: 'bold', offset: 0, length: 11 },
      { type: 'text_url', offset: 6, length: 5, url: 'https://example.com' },
    ], 6, 11)).toEqual({
      text: 'world',
      entities: [
        { type: 'bold', offset: 0, length: 5 },
        { type: 'text_url', offset: 0, length: 5, url: 'https://example.com' },
      ],
    });
  });

  it('returns an empty rich-text value when the limit is zero', () => {
    expect(sliceRichText('Cannot continue', [
      { type: 'bold', offset: 0, length: 15 },
    ], 0, 0)).toEqual({ text: '', entities: [] });
  });

  it('keeps line breaks while truncating a message', () => {
    expect(sliceRichText('First\nSecond', [], 0, 6)).toEqual({
      text: 'First\n',
      entities: [],
    });
  });
});