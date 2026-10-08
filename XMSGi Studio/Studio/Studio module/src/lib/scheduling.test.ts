import { describe, expect, it } from 'vitest';
import type { ScheduledMessage } from '@/types';
import { applyScheduleResult, formatScheduleSummary, getScheduleDateTimeAfter, getScheduleOccurrences, isFutureSchedule } from './scheduling';

describe('schedule lifecycle', () => {
  it('accepts only valid schedule times strictly in the future', () => {
    const now = new Date(2026, 9, 3, 15, 47);

    expect(isFutureSchedule('2026-10-03', '15:48', now)).toBe(true);
    expect(isFutureSchedule('2026-10-03', '15:47', now)).toBe(false);
    expect(isFutureSchedule('2026-10-03', '12:00', now)).toBe(false);
    expect(isFutureSchedule('2026-02-30', '16:00', now)).toBe(false);
    expect(isFutureSchedule('2026-10-03', '25:00', now)).toBe(false);
  });

  it('rounds quick schedule presets up to a valid future minute and advances the date', () => {
    expect(getScheduleDateTimeAfter(0, new Date(2026, 9, 3, 23, 59, 30))).toEqual({
      date: '2026-10-04',
      time: '00:00',
    });
    expect(getScheduleDateTimeAfter(0, new Date(2026, 9, 3, 23, 59, 0))).toEqual({
      date: '2026-10-04',
      time: '00:00',
    });
    expect(getScheduleDateTimeAfter(15, new Date(2026, 9, 3, 23, 50, 30))).toEqual({
      date: '2026-10-04',
      time: '00:06',
    });
  });

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

  it('formats schedule summaries in English when English is selected', () => {
    const summary = formatScheduleSummary('2026-09-24', '18:30', {
      mode: 'weekly',
      days: ['Thu'],
      occurrences: 3,
    }, 'en');

    expect(summary).toContain('Repeats: 3 times');
    expect(summary).toContain('Every Thursday');
    expect(summary).toContain('until');
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