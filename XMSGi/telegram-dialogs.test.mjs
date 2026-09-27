import { describe, expect, it } from 'vitest';
import { normalizeDialogChats } from './telegram-dialogs.cjs';

describe('Telegram dialog loading normalization', () => {
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
});