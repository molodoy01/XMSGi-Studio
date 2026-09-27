export type MessageOption = 'silent' | 'effect' | null;

export function isEffectSelectionIncomplete(
  selectedMessageOption: MessageOption,
  selectedEffectId: string | null,
): boolean {
  return selectedMessageOption === 'effect' && !selectedEffectId;
}

export function getMessageEffectPayload(
  selectedMessageOption: MessageOption,
  selectedEffectId: string | null,
): string | undefined {
  return selectedMessageOption === 'effect' && selectedEffectId
    ? selectedEffectId
    : undefined;
}
