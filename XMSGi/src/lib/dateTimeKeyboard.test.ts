import { describe, expect, it } from 'vitest';
import { getNextDateTimeKeyboardField, isValidDateTimeKeyboardField } from './dateTimeKeyboard';

describe('keyboard date and time entry', () => {
  it('advances through day, month, year, hour, and minute', () => {
    expect(getNextDateTimeKeyboardField('day')).toBe('month');
    expect(getNextDateTimeKeyboardField('month')).toBe('year');
    expect(getNextDateTimeKeyboardField('year')).toBe('hours');
    expect(getNextDateTimeKeyboardField('hours')).toBe('minutes');
    expect(getNextDateTimeKeyboardField('minutes')).toBeNull();
  });

  it('validates field ranges and four-digit years', () => {
    expect(isValidDateTimeKeyboardField('day', '23', '2026-09-23', '18:30')).toBe(true);
    expect(isValidDateTimeKeyboardField('month', '12', '2026-09-23', '18:30')).toBe(true);
    expect(isValidDateTimeKeyboardField('year', '2026', '2026-09-23', '18:30')).toBe(true);
    expect(isValidDateTimeKeyboardField('hours', '23', '2026-09-23', '18:30')).toBe(true);
    expect(isValidDateTimeKeyboardField('minutes', '59', '2026-09-23', '18:30')).toBe(true);
    expect(isValidDateTimeKeyboardField('year', '26', '2026-09-23', '18:30')).toBe(false);
  });

  it('rejects invalid ranges and calendar dates', () => {
    expect(isValidDateTimeKeyboardField('day', '0', '2026-09-23', '18:30')).toBe(false);
    expect(isValidDateTimeKeyboardField('month', '13', '2026-09-23', '18:30')).toBe(false);
    expect(isValidDateTimeKeyboardField('hours', '24', '2026-09-23', '18:30')).toBe(false);
    expect(isValidDateTimeKeyboardField('minutes', '60', '2026-09-23', '18:30')).toBe(false);
    expect(isValidDateTimeKeyboardField('day', '31', '2026-02-31', '18:30')).toBe(false);
    expect(isValidDateTimeKeyboardField('month', '2', '2026-02-31', '18:30')).toBe(false);
  });
});