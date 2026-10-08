export type MessageComposerOptions = {
  selectedMessageOption: 'silent' | 'effect' | null;
  selectedEffectId: string | null;
};

export function shouldResetMessageOptions(
  resetArmed: boolean,
  nextMessage: string,
): boolean {
  return resetArmed && nextMessage.trim().length > 0;
}

export function resetMessageOptionsForNewMessage(
  resetArmed: boolean,
  nextMessage: string,
  options: MessageComposerOptions,
): MessageComposerOptions {
  return shouldResetMessageOptions(resetArmed, nextMessage)
    ? { selectedMessageOption: null, selectedEffectId: null }
    : options;
}