import { describe, expect, it } from 'vitest';
import { findRecentSentMessage, normalizeScheduleMessages } from './schedule-history.cjs';

function record(id, status) {
  return {
    id,
    chatId: 'chat-1',
    text: `Message ${id}`,
    when: '2035-01-15T18:00:00.000Z',
    createdAt: '2035-01-15T17:00:00.000Z',
    status,
  };
}

describe('schedule history persistence migration', () => {
  it('preserves terminal/current states and migrates legacy confirmed', () => {
    expect(normalizeScheduleMessages([
      record('scheduled', 'scheduled'),
      record('sent', 'sent'),
      record('confirmed', 'confirmed'),
      record('failed', 'failed'),
    ], { recoverInterrupted: true }).map(({ id, status }) => ({ id, status }))).toEqual([
      { id: 'scheduled', status: 'scheduled' },
      { id: 'sent', status: 'sent' },
      { id: 'confirmed', status: 'scheduled' },
      { id: 'failed', status: 'failed' },
    ]);
  });

  it('migrates interrupted Sending/Pending and unknown states to retryable Failed', () => {
    expect(normalizeScheduleMessages([
      record('sending', 'sending'),
      record('pending', 'pending'),
      record('unknown', 'future-state'),
    ], { recoverInterrupted: true })).toMatchObject([
      { id: 'sending', status: 'failed', retryAction: 'send' },
      { id: 'pending', status: 'failed', retryAction: 'schedule' },
      { id: 'unknown', status: 'failed', retryAction: 'send' },
    ]);
  });

  it('rejects corrupt records without rewriting or silently dropping the store', () => {
    expect(() => normalizeScheduleMessages([
      record('valid', 'scheduled'),
      { id: 'corrupt', status: 'sent' },
    ])).toThrow('invalid message');
  });
});

describe('scheduled message reconciliation', () => {
  it('matches only outgoing history with the same text and near schedule time', () => {
    const timestamp = 2052547200;
    const sent = { id: 42, message: 'Scheduled text', date: timestamp + 30, out: true };

    expect(findRecentSentMessage([
      { ...sent, id: 40, out: false },
      { ...sent, id: 41, message: 'Different text' },
      { ...sent, id: 42 },
    ], 'Scheduled text', timestamp)).toEqual(sent);
    expect(findRecentSentMessage([{ ...sent, date: timestamp + 400 }], 'Scheduled text', timestamp)).toBeNull();
  });
});