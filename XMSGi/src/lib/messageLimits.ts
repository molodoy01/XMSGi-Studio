export const MESSAGE_MAX_LENGTH = 4096;
export const MESSAGE_MAX_LENGTH_WITH_ATTACHMENT = 1024;

export function getMessageMaxLength(hasAttachment: boolean) {
  return hasAttachment
    ? MESSAGE_MAX_LENGTH_WITH_ATTACHMENT
    : MESSAGE_MAX_LENGTH;
}

export function limitMessageText(text: string, maxLength: number) {
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

export function insertMessageText(
  text: string,
  insertedText: string,
  selectionStart: number,
  selectionEnd: number,
  maxLength: number,
) {
  const nextText = text.slice(0, selectionStart) + insertedText + text.slice(selectionEnd);
  return limitMessageText(nextText, maxLength);
}

export function getRemainingMessageLength(textLength: number, maxLength: number) {
  return Math.max(0, maxLength - textLength);
}

export function getMessageCounterTone(remaining: number): 'normal' | 'warning' | 'critical' {
  if (remaining <= 100) return 'critical';
  if (remaining <= 250) return 'warning';
  return 'normal';
}