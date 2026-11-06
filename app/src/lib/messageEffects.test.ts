import { describe, expect, it } from 'vitest';
import { getMessageEffectPayload, isEffectSelectionIncomplete } from './messageEffects';

describe('message effect selection', () => {
  it('blocks effect mode without a selected effect id', () => {
    expect(isEffectSelectionIncomplete('effect', null)).toBe(true);
    expect(getMessageEffectPayload('effect', null)).toBeUndefined();
  });

  it('allows a selected effect id for sending and scheduling', () => {
    expect(isEffectSelectionIncomplete('effect', '123456')).toBe(false);
    expect(getMessageEffectPayload('effect', '123456')).toBe('123456');
  });

  it('does not use the effect emoticon as the payload', () => {
    expect(getMessageEffectPayload('effect', '123456')).not.toBe('✨');
  });

  it('keeps ordinary messages without an effect', () => {
    expect(isEffectSelectionIncomplete(null, null)).toBe(false);
    expect(getMessageEffectPayload(null, null)).toBeUndefined();
    expect(getMessageEffectPayload('silent', null)).toBeUndefined();
  });
});
