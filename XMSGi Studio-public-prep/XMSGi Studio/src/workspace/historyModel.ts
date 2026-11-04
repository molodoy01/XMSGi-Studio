import type { Chat, RichTextEntity, ScheduledMessage } from '@/types';
import type { DraftColor, PersistedDraftStore, SavedDraft } from '@shared/types';
import { normalizeTelegramMessage } from '@shared/telegramText.cjs';

export type HistorySource = 'personal' | 'workspace';
export type HistoryStatus = 'scheduled' | 'sending' | 'sent' | 'failed' | 'unknown' | 'draft' | 'cancelled';
export type PlannerReminderType = 'task' | 'meeting' | 'reminder' | 'event' | 'idea';
export type SavedPlannerDraft = {
  id: string;
  message: string;
  attachments: string[];
  entities: RichTextEntity[];
  reminderType: PlannerReminderType | null;
  savedAt: string;
  pinned?: boolean;
};

export type HistoryOriginal =
  | { kind: 'scheduled'; message: ScheduledMessage }
  | { kind: 'saved-draft'; draft: SavedDraft }
  | { kind: 'saved-planner-draft'; draft: SavedPlannerDraft }
  | { kind: 'planner-draft'; text: string; entities: RichTextEntity[]; attachments: string[]; reminderType: PlannerReminderType | null };

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
      : runtimeStatus === 'unknown'
        ? 'unknown'
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
      scheduledAt: status === 'scheduled' || status === 'sending' || status === 'failed' || status === 'unknown' || status === 'cancelled'
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

export function normalizePlannerDraft(
  text: string,
  chat: Chat | null,
  updatedAt: string,
  entities: RichTextEntity[] = [],
  attachments: string[] = [],
  reminderType: PlannerReminderType | null = null,
): HistoryItem | null {
  const normalized = normalizeTelegramMessage(text, entities);
  if (!normalized.message.trim() && attachments.length === 0) return null;

  const normalizedAttachments = attachments.filter((attachment) => typeof attachment === 'string' && attachment.length > 0);

  return {
    id: 'personal:draft:quick-planner',
    source: 'personal',
    status: 'draft',
    title: 'Quick Planner draft',
    text: normalized.message,
    channelName: chat?.name ?? '',
    channelLabel: chat?.username ? `@${chat.username}` : '',
    updatedAt: updatedAt || new Date().toISOString(),
    attachments: normalizedAttachments,
    entities: normalized.entities,
    draftColor: 'teal',
    original: { kind: 'planner-draft', text, entities: normalized.entities, attachments: normalizedAttachments, reminderType },
  };
}

export function normalizeSavedPlannerDraft(draft: SavedPlannerDraft): HistoryItem {
  const normalized = normalizeTelegramMessage(draft.message, draft.entities);
  const updatedAt = Number.isFinite(Date.parse(draft.savedAt))
    ? draft.savedAt
    : new Date().toISOString();
  return {
    id: `personal:saved-planner-draft:${draft.id}`,
    source: 'personal',
    status: 'draft',
    title: 'Saved Quick Planner draft',
    text: normalized.message,
    channelName: '',
    channelLabel: '',
    updatedAt,
    attachments: draft.attachments,
    entities: normalized.entities,
    draftColor: 'teal',
    original: { kind: 'saved-planner-draft', draft },
  };
}