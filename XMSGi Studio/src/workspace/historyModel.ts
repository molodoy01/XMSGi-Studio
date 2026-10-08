import type { Chat, RichTextEntity, ScheduledMessage } from '@/types';
import type { DraftColor, PersistedDraftStore, SavedDraft } from '$studio';
import { normalizeTelegramMessage } from '@shared/telegramText.cjs';

export type HistorySource = 'personal' | 'workspace';
export type HistoryStatus = 'scheduled' | 'sending' | 'sent' | 'failed' | 'draft' | 'cancelled';

export type HistoryOriginal =
  | { kind: 'scheduled'; message: ScheduledMessage }
  | { kind: 'saved-draft'; draft: SavedDraft };

export interface HistoryItem {
  id: string;
  source: HistorySource;
  status: HistoryStatus;
  title: string;
  text: string;
  channelName: string;
  channelLabel: string;
  scheduledAt?: string;
  sentAt?: string;
  updatedAt?: string;
  lastError?: string;
  retryAction?: 'schedule' | 'send' | 'cancel';
  attachments: string[];
  entities: RichTextEntity[];
  draftColor?: DraftColor;
  silent?: boolean;
  effect?: string;
  original: HistoryOriginal;
}

export function normalizeScheduledMessages(
  messages: ScheduledMessage[],
  source: HistorySource,
  collection: 'upcoming' | 'sent',
  chats: Chat[],
): HistoryItem[] {
  return messages.map((message) => {
    const normalized = normalizeTelegramMessage(message.text, message.entities ?? []);
    const runtimeStatus = String(message.status);
    const status: HistoryStatus = runtimeStatus === 'failed' || runtimeStatus === 'error'
      ? 'failed'
      : runtimeStatus === 'sending'
        ? 'sending'
      : runtimeStatus === 'cancelled'
        ? 'cancelled'
        : runtimeStatus === 'sent' || collection === 'sent'
          ? 'sent'
          : 'scheduled';
    const chat = chats.find((item) => item.id === message.chatId);

    return {
      id: `${source}:message:${String(message.id)}`,
      source,
      status,
      title: message.chatName,
      text: normalized.message,
      channelName: message.chatName,
      channelLabel: chat?.username ? `@${chat.username}` : '',
      scheduledAt: status === 'scheduled' || status === 'sending' || status === 'failed' || status === 'cancelled'
        ? message.when
        : undefined,
      sentAt: status === 'sent' ? message.sentAt || message.when : undefined,
      updatedAt: message.lastAttemptAt || message.createdAt,
      lastError: message.lastError,
      retryAction: message.retryAction,
      attachments: message.attachments ?? [],
      entities: normalized.entities,
      silent: message.silent,
      effect: message.effect,
      original: { kind: 'scheduled', message },
    };
  });
}

export function normalizeSavedDraft(draft: SavedDraft): HistoryItem {
  const normalized = normalizeTelegramMessage(draft.body, draft.entities ?? []);
  return {
    id: `workspace:draft:${String(draft.id)}`,
    source: 'workspace',
    status: 'draft',
    title: draft.name,
    text: normalized.message,
    channelName: draft.selectedChat?.name ?? '',
    channelLabel: draft.selectedChat?.username ? `@${draft.selectedChat.username}` : '',
    updatedAt: draft.updatedAt || draft.createdAt,
    attachments: draft.attachments
      ?.map((attachment) => attachment.path || attachment.name)
      .filter((path): path is string => Boolean(path)) ?? [],
    entities: normalized.entities,
    draftColor: draft.color ?? 'gray',
    original: { kind: 'saved-draft', draft },
  };
}

export function normalizePersistedStudioDrafts(store: PersistedDraftStore | null | undefined) {
  return store?.savedDrafts.map(normalizeSavedDraft) ?? [];
}

export function sortHistoryItems(items: HistoryItem[], category: 'scheduled' | 'sending' | 'sent' | 'failed' | 'drafts') {
  const getTimestamp = (item: HistoryItem) => {
    if (category === 'scheduled') {
      return item.status === 'scheduled'
        ? item.scheduledAt ?? item.updatedAt ?? 0
        : item.updatedAt ?? item.scheduledAt ?? 0;
    }
    return category === 'sent' ? item.sentAt ?? item.updatedAt ?? 0 : item.updatedAt ?? 0;
  };

  return [...items].sort((left, right) => {
    const leftTime = new Date(getTimestamp(left)).getTime();
    const rightTime = new Date(getTimestamp(right)).getTime();

    if (category === 'scheduled') {
      const leftIsScheduled = left.status === 'scheduled';
      const rightIsScheduled = right.status === 'scheduled';
      if (leftIsScheduled !== rightIsScheduled) return leftIsScheduled ? -1 : 1;
      return leftIsScheduled ? leftTime - rightTime : rightTime - leftTime;
    }

    return rightTime - leftTime;
  });
}