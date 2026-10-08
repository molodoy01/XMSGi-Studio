import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const nodeRequire = createRequire(import.meta.url);
const search = nodeRequire('./telegram-search.cjs');

describe('Telegram chat search routing', () => {
  it.each([
    '@alice_12345',
    'alice_12345',
    't.me/alice_12345',
    'https://t.me/alice_12345'
  ])('recognizes %s as a global username query', (query) => {
    expect(search.isUsernameQuery(query)).toBe(true);
  });

  it('normalizes phone formatting for contacts-only matching', () => {
    expect(search.normalizePhone('+358 (40) 123-4567')).toBe('358401234567');
    expect(search.normalizePhone('+7-999-123-45-67')).toBe('79991234567');
    expect(search.isPhoneLikeQuery('+358 (40) 123-4567')).toBe(true);
  });

  it('does not classify phone queries as global username lookups', () => {
    expect(search.isUsernameQuery('+358 (40) 123-4567')).toBe(false);
    expect(search.isUsernameQuery('+7-999-123-45-67')).toBe(false);
  });

  it('maps a globally resolved Telegram user to a private chat', () => {
    expect(readFileSync(resolve('telegram.cjs'), 'utf8')).toContain("return 'private';");
  });

  it('does not introduce a global phone resolver', () => {
    const source = readFileSync(resolve('telegram.cjs'), 'utf8');
    expect(source).not.toMatch(/ResolvePhone|resolvePhone/);
  });
});
