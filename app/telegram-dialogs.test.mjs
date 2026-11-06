import { describe, expect, it } from 'vitest';
import {
  getEntityDisplayName,
  getPublicChatType,
  getResolvedChatType,
  getStableChatId,
  normalizeDialogChats,
} from './telegram-dialogs.cjs';

describe('Telegram dialog loading normalization', () => {
  it('preserves a marked channel dialog ID in history when the entity ID is raw', () => {
    expect(getStableChatId('-1001234567890', 1234567890)).toBe('-1001234567890');
  });

  it('falls back to the entity ID when no requested dialog ID is available', () => {
    expect(getStableChatId(undefined, 1234567890)).toBe('1234567890');
  });

  it('keeps all batches and removes duplicate or invalid dialog ids', () => {
    const firstBatch = [
      { id: 1, name: 'First', entity: { username: 'first' } },
      { id: 2, name: 'Second', entity: { username: 'second' } },
    ];
    const secondBatch = [
      { id: 2, name: 'Second duplicate', entity: { username: 'second' } },
      { id: 3, name: 'Third', entity: { username: 'third' } },
      { id: null, name: 'Invalid' },
    ];

    expect(normalizeDialogChats(
      [...firstBatch, ...secondBatch],
      () => 'private',
      (entity) => entity?.name || '',
    )).toEqual([
      { id: '1', name: 'First', username: 'first', type: 'private' },
      { id: '2', name: 'Second duplicate', username: 'second', type: 'private' },
      { id: '3', name: 'Third', username: 'third', type: 'private' },
    ]);
  });

  it('resolves Telegram chat types from entity classes', () => {
    expect(getPublicChatType({ className: 'Channel', megagroup: false })).toBe('channel');
    expect(getPublicChatType({ className: 'Channel', megagroup: true })).toBe('supergroup');
    expect(getPublicChatType({ className: 'Chat' })).toBe('group');
    expect(getPublicChatType({ className: 'ChatForbidden' })).toBe('group');
    expect(getPublicChatType({ className: 'User' })).toBeNull();
    expect(getResolvedChatType({ className: 'User' })).toBe('private');
    expect(getResolvedChatType({ className: 'Unknown' })).toBeNull();
  });

  it('prefers title, then full name, username, and fallback for chat display names', () => {
    expect(getEntityDisplayName({ title: 'Channel', username: 'channel' })).toBe('Channel');
    expect(getEntityDisplayName({ firstName: 'Ada', lastName: 'Lovelace' })).toBe('Ada Lovelace');
    expect(getEntityDisplayName({ username: 'ada' })).toBe('ada');
    expect(getEntityDisplayName({ className: 'Channel' })).toBe('Unnamed chat');
    expect(getEntityDisplayName(null)).toBe('');
  });
});