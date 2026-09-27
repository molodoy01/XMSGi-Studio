export type InlineButtonActionType = 'url' | 'callback';

export type InlineButton = {
  id: string;
  label: string;
  action: {
    type: InlineButtonActionType;
    value: string;
  };
};

export type InlineButtonRow = InlineButton[];

export type InlineKeyboardButton = {
  text: string;
  url?: string;
  callback_data?: string;
};

export type InlineKeyboardMarkup = {
  inline_keyboard: InlineKeyboardButton[][];
};

export const MAX_INLINE_BUTTONS = 100;
export const MAX_INLINE_BUTTONS_PER_ROW = 8;
export const MAX_INLINE_BUTTON_LABEL_LENGTH = 64;

export function normalizeInlineUrl(value: string): string {
  const normalized = value.trim();
  if (!normalized || /^https?:\/\//i.test(normalized)) return normalized;
  return `https://${normalized}`;
}

export function getInlineButtonError(button: InlineButton): string {
  if (!button.label.trim()) return 'Enter button text.';
  if (button.label.length > MAX_INLINE_BUTTON_LABEL_LENGTH) return 'Button label must be 64 characters or less.';

  if (button.action.type === 'url' && !/^https:\/\/\S+$/i.test(normalizeInlineUrl(button.action.value))) {
    return 'Use a valid https:// URL.';
  }

  if (button.action.type === 'callback' && new TextEncoder().encode(button.action.value).length > 64) {
    return 'Callback must be 64 bytes or less.';
  }

  if (button.action.type === 'callback' && !button.action.value.trim()) {
    return 'Callback command is required.';
  }

  return '';
}

export function isInlineButtonValid(button: InlineButton): boolean {
  return getInlineButtonError(button) === '';
}

export function limitInlineRows(rows: InlineButtonRow[]): InlineButtonRow[] {
  const limitedRows: InlineButtonRow[] = [];
  let buttonCount = 0;

  for (const row of rows) {
    const remaining = MAX_INLINE_BUTTONS - buttonCount;
    if (remaining <= 0) break;

    const limitedRow = row.slice(0, Math.min(MAX_INLINE_BUTTONS_PER_ROW, remaining));
    if (limitedRow.length === 0) continue;

    limitedRows.push(limitedRow);
    buttonCount += limitedRow.length;
  }

  return limitedRows;
}

export function toInlineKeyboardMarkup(rows: InlineButtonRow[]): InlineKeyboardMarkup | undefined {
  const validRows = rows
    .map((row) => row.filter(isInlineButtonValid))
    .filter((row) => row.length > 0);
  const limitedRows = limitInlineRows(validRows);

  if (limitedRows.length === 0) return undefined;

  return {
    inline_keyboard: limitedRows.map((row) => row.map((button) => (
      button.action.type === 'url'
        ? { text: button.label.trim(), url: normalizeInlineUrl(button.action.value) }
        : { text: button.label.trim(), callback_data: button.action.value }
    ))),
  };
}

export function createInlineButton(id: string): InlineButton {
  return {
    id,
    label: '',
    action: { type: 'url', value: 'https://' },
  };
}
