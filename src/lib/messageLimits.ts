export const MESSAGE_MAX_LENGTH = 4096;
export const MESSAGE_MAX_LENGTH_WITH_ATTACHMENT = 1024;

export function getMessageMaxLength(hasAttachment: boolean) {
  return hasAttachment
    ? MESSAGE_MAX_LENGTH_WITH_ATTACHMENT
    : MESSAGE_MAX_LENGTH;
}

export function limitMessageText(text: string, maxLength: number) {
  if (text.length <= maxLength) return text;

  let limitedText = '';
  let limitedLength = 0;
  for (const character of text) {
    if (limitedLength + character.length > maxLength) break;
    limitedText += character;
    limitedLength += character.length;
  }
  return limitedText;
}

export function insertMessageText(
  text: string,
  insertedText: string,
  selectionStart: number,
  selectionEnd: number,
) {
  return text.slice(0, selectionStart) + insertedText + text.slice(selectionEnd);
}

export function getRemainingMessageLength(textLength: number, maxLength: number) {
  return Math.max(0, maxLength - textLength);
}

export function getMessageCounterTone(remaining: number): 'normal' | 'warning' | 'critical' {
  if (remaining <= 100) return 'critical';
  if (remaining <= 250) return 'warning';
  return 'normal';
}