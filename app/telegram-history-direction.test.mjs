import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import bigInt from 'big-integer';

const nodeRequire = createRequire(import.meta.url);
const { resolveMessageDirection, normalizeHistoryMessage } = nodeRequire('./telegram-message-direction.cjs');

describe('Telegram preview message direction', () => {
  it('uses the outgoing flag when present', () => {
    expect(resolveMessageDirection({ out: true }, '42')).toBe(true);
    expect(resolveMessageDirection({ outgoing: false }, '42')).toBe(false);
  });

  it('recognizes the current user as sender when Telegram direction flags conflict', () => {
    expect(resolveMessageDirection({ out: false, senderId: bigInt(42) }, '42')).toBe(true);
  });

  it('derives direction from sender metadata when the outgoing field is missing', () => {
    expect(resolveMessageDirection({ senderId: { userId: '42' } }, '42')).toBe(true);
    expect(resolveMessageDirection({ senderId: { userId: '99' }, sender: { id: '42' } }, '42')).toBe(true);
    expect(resolveMessageDirection({ senderId: { userId: '99' } }, '42')).toBe(false);
  });

  it('keeps normalized history messages aligned after reloads', () => {
    const normalized = normalizeHistoryMessage({
      id: '1',
      message: 'hello',
      date: 1700000000,
      senderId: { userId: '42' },
    }, '42');

    expect(normalized.outgoing).toBe(true);
    expect(typeof normalized.date).toBe('string');
    expect(Number.isFinite(Date.parse(normalized.date))).toBe(true);
  });
});
