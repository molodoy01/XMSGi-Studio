import { describe, expect, it } from 'vitest';
import { normalizeFloodWaitError } from './telegram-errors.cjs';

describe('Telegram transport errors', () => {
  it('normalizes Telegram flood wait errors without retrying', () => {
    const error = new Error('A wait of 12 seconds is required');
    error.code = 'FLOOD_WAIT_12';

    const normalized = normalizeFloodWaitError(error);

    expect(normalized?.code).toBe('TELEGRAM_FLOOD_WAIT');
    expect(normalized?.waitSeconds).toBe(12);
    expect(normalized?.message).toContain('12 seconds');
  });

});
