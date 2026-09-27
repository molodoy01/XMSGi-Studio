import { describe, expect, it } from 'vitest';
import { resetMessageOptionsForNewMessage, shouldResetMessageOptions } from './messageComposer';

describe('new message option reset', () => {
  it('resets options when typing starts after a successful send cleared the composer', () => {
    expect(resetMessageOptionsForNewMessage(true, 'New message', {
      selectedMessageOption: 'silent',
      selectedEffectId: null,
    })).toEqual({ selectedMessageOption: null, selectedEffectId: null });
    expect(resetMessageOptionsForNewMessage(true, 'New message', {
      selectedMessageOption: 'effect',
      selectedEffectId: 'effect-1',
    })).toEqual({ selectedMessageOption: null, selectedEffectId: null });
  });

  it('does not reset options while the current message is still being edited', () => {
    expect(shouldResetMessageOptions(false, 'Current message')).toBe(false);
    expect(resetMessageOptionsForNewMessage(false, 'Current message', {
      selectedMessageOption: 'effect',
      selectedEffectId: 'effect-1',
    })).toEqual({ selectedMessageOption: 'effect', selectedEffectId: 'effect-1' });
  });

  it('does not change options when the composer remains empty', () => {
    expect(shouldResetMessageOptions(true, '   ')).toBe(false);
  });
});