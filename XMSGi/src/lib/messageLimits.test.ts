import { describe, expect, it } from 'vitest';
import {
  getMessageCounterTone,
  getMessageMaxLength,
  getRemainingMessageLength,
  insertMessageText,
  limitMessageText,
  MESSAGE_MAX_LENGTH,
  MESSAGE_MAX_LENGTH_WITH_ATTACHMENT,
} from './messageLimits';

describe('message limits', () => {
  it('uses Telegram limits with and without attachments', () => {
    expect(getMessageMaxLength(false)).toBe(MESSAGE_MAX_LENGTH);
    expect(getMessageMaxLength(true)).toBe(MESSAGE_MAX_LENGTH_WITH_ATTACHMENT);
    expect(MESSAGE_MAX_LENGTH).toBe(4096);
    expect(MESSAGE_MAX_LENGTH_WITH_ATTACHMENT).toBe(1024);
  });

  it('never displays a negative remaining count', () => {
    expect(getRemainingMessageLength(1023, 1024)).toBe(1);
    expect(getRemainingMessageLength(1024, 1024)).toBe(0);
    expect(getRemainingMessageLength(1200, 1024)).toBe(0);
  });

  it('changes only the counter tone at the requested thresholds', () => {
    expect(getMessageCounterTone(4096)).toBe('normal');
    expect(getMessageCounterTone(251)).toBe('normal');
    expect(getMessageCounterTone(250)).toBe('warning');
    expect(getMessageCounterTone(101)).toBe('warning');
    expect(getMessageCounterTone(100)).toBe('critical');
    expect(getMessageCounterTone(0)).toBe('critical');
  });

  it('keeps the attachment limit independent from the full message limit', () => {
    expect(getRemainingMessageLength(1024, getMessageMaxLength(true))).toBe(0);
    expect(getRemainingMessageLength(1024, getMessageMaxLength(false))).toBe(3072);
  });

  it('limits input to 4096 UTF-16 code units without attachments', () => {
    expect(limitMessageText('a'.repeat(4097), getMessageMaxLength(false))).toHaveLength(4096);
  });

  it('limits input to 1024 UTF-16 code units with an attachment', () => {
    expect(limitMessageText('a'.repeat(1025), getMessageMaxLength(true))).toHaveLength(1024);
  });

  it('limits pasted text after replacing the current selection', () => {
    expect(insertMessageText('a'.repeat(1020), 'bcdef', 1020, 1020, 1024)).toBe('a'.repeat(1020) + 'bcde');
  });

  it('trims existing text when an attachment lowers the limit', () => {
    const text = 'a'.repeat(3000);
    expect(limitMessageText(text, getMessageMaxLength(true))).toHaveLength(1024);
    expect(limitMessageText(text.slice(0, 1024), getMessageMaxLength(false))).toHaveLength(1024);
  });

  it('keeps the remaining text unchanged when the last attachment is removed', () => {
    const text = 'a'.repeat(1024);
    expect(limitMessageText(text, getMessageMaxLength(false))).toBe(text);
  });

  it('uses UTF-16 boundaries for emoji', () => {
    const text = '😀'.repeat(512) + 'x';
    expect(text.length).toBe(1025);
    expect(limitMessageText(text, getMessageMaxLength(true))).toBe('😀'.repeat(512));
  });
});