export type DraftAttachment = {
  name: string;
  path: string;
  size?: number;
  kind?: 'image' | 'video' | 'document' | 'audio' | 'unknown';
};

export type DraftMessageEntity = {
  type: string;
  offset: number;
  length: number;
  url?: string;
};

export type DraftRecord = {
  id: string;
  message: string;
  entities: DraftMessageEntity[];
  attachments: DraftAttachment[];
  selectedChatId: string | null;
  date?: string;
  time?: string;
  repeatMode?: 'none' | 'daily' | 'weekly' | 'biweekly' | 'monthly';
  repeatDays?: string[];
  repeatOccurrences?: number;
  inlineButtons?: unknown[];
  updatedAt: string;
};

export type DraftStoreSnapshot = {
  activeDraft: DraftRecord | null;
  savedDrafts: DraftRecord[];
};

export type PublishAction = 'send-now' | 'schedule' | 'draft';

export type PublishRequest = {
  action: PublishAction;
  chatId: string;
  text: string;
  entities?: DraftMessageEntity[];
  attachments?: Array<DraftAttachment | string>;
  inlineButtons?: unknown[];
  replyMarkup?: unknown;
  scheduledAt?: string;
  targetTimestamp?: number;
  accountId?: string;
  sendAttemptId?: string;
  silent?: boolean;
  effect?: string;
  telegramMessageId?: string | number;
  telegramMessageIds?: Array<string | number>;
};

export function createDraftRecord(input: Partial<DraftRecord> & Pick<DraftRecord, 'message'>): DraftRecord {
  const timestamp = new Date().toISOString();
  const id = input.id ?? globalThis.crypto?.randomUUID?.() ?? `draft-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  return {
    id,
    message: input.message,
    entities: Array.isArray(input.entities) ? input.entities : [],
    attachments: Array.isArray(input.attachments) ? input.attachments : [],
    selectedChatId: input.selectedChatId ?? null,
    date: typeof input.date === 'string' ? input.date : '',
    time: typeof input.time === 'string' ? input.time : '',
    repeatMode: input.repeatMode ?? 'none',
    repeatDays: Array.isArray(input.repeatDays) ? input.repeatDays : [],
    repeatOccurrences: typeof input.repeatOccurrences === 'number' ? input.repeatOccurrences : 1,
    inlineButtons: Array.isArray(input.inlineButtons) ? input.inlineButtons : [],
    updatedAt: input.updatedAt ?? timestamp,
  };
}

export function normalizeDraftAttachments(value: unknown): DraftAttachment[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry) => {
    if (typeof entry === 'string') {
      return [{ name: entry.split(/[\\/]/).pop() || entry, path: entry }];
    }

    if (!entry || typeof entry !== 'object') return [];

    const attachment = entry as Partial<DraftAttachment>;
    if (typeof attachment.path !== 'string' && typeof attachment.name !== 'string') return [];

    return [{
      name: typeof attachment.name === 'string' ? attachment.name : attachment.path || 'attachment',
      path: typeof attachment.path === 'string' ? attachment.path : attachment.name || '',
      size: typeof attachment.size === 'number' ? attachment.size : undefined,
      kind: typeof attachment.kind === 'string' ? attachment.kind : undefined,
    }];
  });
}

export function normalizeDraftEntities(value: unknown): DraftMessageEntity[] {
  if (!Array.isArray(value)) return [];

  return value.filter((entity): entity is DraftMessageEntity => {
    if (!entity || typeof entity !== 'object') return false;
    const candidate = entity as Partial<DraftMessageEntity>;
    return typeof candidate.type === 'string'
      && typeof candidate.offset === 'number'
      && typeof candidate.length === 'number';
  });
}
