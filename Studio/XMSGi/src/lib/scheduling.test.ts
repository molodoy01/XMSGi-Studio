import { describe, expect, it } from 'vitest';
import type { ScheduledMessage } from '@/types';
import { applyScheduleResult, formatScheduleSummary, getScheduleOccurrences } from './scheduling';

describe('schedule lifecycle', () => {
  it('formats a plain schedule summary', () => {
    expect(formatScheduleSummary('2026-09-24', '18:30', {
      mode: 'none',
      occurrences: 1,
    })).toContain('Запланировано:');
  });

  it('formats repeat summary from the existing recurrence calculation', () => {
    const summary = formatScheduleSummary('2026-09-24', '18:30', {
      mode: 'daily',
      occurrences: 5,
    });

    expect(summary).toContain('Повтор: 5 раз');
    expect(summary).toContain('Каждый день');
    expect(summary).toContain('18:30');
    expect(summary).toContain('до');
  });

  it('creates the requested repeat occurrences', () => {
    const occurrences = getScheduleOccurrences(
      new Date('2026-01-10T09:00:00'),
      { mode: 'daily', occurrences: 3 },
    );

    expect(occurrences).toHaveLength(3);
    expect(occurrences.map((value) => `${value.getFullYear()}-${value.getMonth() + 1}-${value.getDate()} ${value.getHours()}:00`)).toEqual([
      '2026-1-10 9:00',
      '2026-1-11 9:00',
      '2026-1-12 9:00',
    ]);
  });

  it('marks a pending schedule failed when scheduling fails', () => {
    const message: ScheduledMessage = {
      id: 'operation-1',
      operationId: 'operation-1',
      chatId: 'chat-1',
      chatName: 'Alpha Team',
      text: 'Scheduled text',
      when: '2026-01-10T09:00:00.000Z',
      createdAt: '2026-01-09T12:00:00.000Z',
      status: 'pending',
    };

    expect(applyScheduleResult([message], 'operation-1', { success: false })).toEqual([
      { ...message, status: 'failed' },
    ]);
  });
});