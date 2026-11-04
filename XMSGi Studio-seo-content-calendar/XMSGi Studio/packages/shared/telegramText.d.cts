export type TelegramTextEntity = {
  type: string;
  offset: number;
  length: number;
  url?: string;
};

export function markdownToRichText(source: string): {
  text: string;
  entities: TelegramTextEntity[];
  sourceOffsetMap: number[];
  changed: boolean;
};

export function normalizeTelegramText(message: string): string;

export function normalizeTelegramMessage<T extends TelegramTextEntity>(
  message: string,
  entities?: T[],
): { message: string; entities: T[] };