import { describe, expect, it } from 'vitest';
import { mergeChats, selectNextChat } from './chatDomainService';

describe('chatDomainService', () => {
  it('merges local and remote chats without duplicates', () => {
    const merged = mergeChats(
      [{ id: 'local-1', name: 'Local' }],
      [{ id: 'remote-1', name: 'Remote' }, { id: 'local-1', name: 'Local' }],
      []
    );

    expect(merged).toHaveLength(2);
    expect(merged.some((chat) => chat.id === 'local-1')).toBe(true);
    expect(merged.some((chat) => chat.id === 'remote-1')).toBe(true);
  });

  it('selects a valid current chat fallback', () => {
    const selected = selectNextChat(
      [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
      { id: 'z', name: 'Z' }
    );

    expect(selected?.id).toBe('a');
  });
});
