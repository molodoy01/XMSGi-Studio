import { describe, expect, it } from 'vitest';
import { createScheduledEntries } from './scheduleDomainService';

describe('scheduleDomainService', () => {
  it('creates one scheduled entry for a single run', () => {
    const entries = createScheduledEntries({
      chatId: 'chat-1',
      chatName: 'Demo Chat',
      message: 'Hello world',
      date: '2026-09-27',
      time: '10:15',
      attachments: ['file.png'],
    });

    expect(entries).toHaveLength(1);
    expect(entries[0].status).toBe('scheduled');
    expect(entries[0].chatId).toBe('chat-1');
    expect(entries[0].attachments).toEqual(['file.png']);
  });

  it('expands repeated schedules into multiple occurrences', () => {
    const entries = createScheduledEntries({
      chatId: 'chat-2',
      chatName: 'Loop',
      message: 'Daily update',
      date: '2026-09-27',
      time: '09:00',
      repeat: { mode: 'daily', occurrences: 3 },
    });

    expect(entries).toHaveLength(3);
    expect(entries.map((entry) => entry.when)).toEqual([
      '2026-09-27T09:00',
      '2026-09-28T09:00',
      '2026-09-29T09:00',
    ]);
  });
});
