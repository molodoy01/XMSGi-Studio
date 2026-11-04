import { describe, expect, it } from 'vitest';
import {
  getInlineButtonError,
  limitInlineRows,
  normalizeInlineUrl,
  toInlineKeyboardMarkup,
  type InlineButtonRow,
} from './inlineKeyboard';

const validRows: InlineButtonRow[] = [[{
  id: 'one',
  label: 'Open',
  action: { type: 'url', value: 'https://example.com' },
}]];

describe('Inline keyboard', () => {
  it('accepts https URLs and creates Telegram-shaped markup', () => {
    expect(toInlineKeyboardMarkup(validRows)).toEqual({
      inline_keyboard: [[{ text: 'Open', url: 'https://example.com' }]],
    });
  });

  it('normalizes a bare domain to https in the outgoing markup', () => {
    expect(normalizeInlineUrl('site.ru')).toBe('https://site.ru');
    expect(toInlineKeyboardMarkup([[
      { ...validRows[0][0], action: { type: 'url', value: 'site.ru' } },
    ]])).toEqual({
      inline_keyboard: [[{ text: 'Open', url: 'https://site.ru' }]],
    });
  });

  it('rejects non-https URLs', () => {
    expect(getInlineButtonError({
      ...validRows[0][0],
      action: { type: 'url', value: 'http://example.com' },
    })).toContain('https://');
  });

  it('rejects callback data above 64 bytes', () => {
    expect(getInlineButtonError({
      ...validRows[0][0],
      action: { type: 'callback', value: 'x'.repeat(65) },
    })).toContain('64 bytes');
  });

  it('rejects button labels above 64 characters', () => {
    expect(getInlineButtonError({
      ...validRows[0][0],
      label: 'x'.repeat(65),
    })).toContain('64 characters');
  });

  it('filters invalid buttons while preserving valid rows', () => {
    expect(toInlineKeyboardMarkup([[
      ...validRows[0],
      { id: 'bad', label: '', action: { type: 'url', value: 'nope' } },
    ]])).toEqual({
      inline_keyboard: [[{ text: 'Open', url: 'https://example.com' }]],
    });
  });

  it('returns no markup for empty or incomplete button grids', () => {
    expect(toInlineKeyboardMarkup([])).toBeUndefined();
    expect(toInlineKeyboardMarkup([[{
      id: 'empty',
      label: 'Open',
      action: { type: 'url', value: '' },
    }]])).toBeUndefined();
  });

  it('caps the outgoing keyboard at 100 valid buttons', () => {
    const rows = Array.from({ length: 13 }, (_, rowIndex) => Array.from({ length: 8 }, (_, buttonIndex) => ({
      id: `${rowIndex}-${buttonIndex}`,
      label: `Button ${rowIndex}-${buttonIndex}`,
      action: { type: 'callback' as const, value: `${rowIndex}-${buttonIndex}` },
    })));
    const markup = toInlineKeyboardMarkup(rows);
    expect(markup?.inline_keyboard.flat()).toHaveLength(100);
  });

  it('limits rows to eight buttons and the whole grid to 100 buttons', () => {
    const rows = Array.from({ length: 13 }, (_, rowIndex) => Array.from({ length: 9 }, (_, buttonIndex) => ({
      id: `${rowIndex}-${buttonIndex}`,
      label: `Button ${rowIndex}-${buttonIndex}`,
      action: { type: 'callback' as const, value: `${rowIndex}-${buttonIndex}` },
    })));

    const limitedRows = limitInlineRows(rows);

    expect(limitedRows.every((row) => row.length <= 8)).toBe(true);
    expect(limitedRows.flat()).toHaveLength(100);
  });
});
