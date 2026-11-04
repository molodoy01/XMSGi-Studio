import type { Chat, ScheduledMessage, Template } from '@/types';
import { hasSavedChatStorage, telegramLoadSavedChats, telegramSaveSavedChats } from '@/services/chatAppService';
import { hasScheduleHistoryStorage, saveScheduleHistory } from '@/services/schedulerAppService';

export type MessageHistoryScope = 'personal' | 'workspace';
export type ScheduleHistorySnapshot = { upcoming: ScheduledMessage[]; sent: ScheduledMessage[] };
export type ScheduleHistoryField = 'upcoming' | 'sent' | 'snapshot';

const UPCOMING_KEYS: Record<MessageHistoryScope, string> = {
  personal: 'awaitmsg_upcoming',
  workspace: 'awaitmsg_workspace_upcoming',
};
const SENT_KEYS: Record<MessageHistoryScope, string> = {
  personal: 'awaitmsg_sent',
  workspace: 'awaitmsg_workspace_sent',
};
const HIDDEN_CHATS_KEY = 'awaitmsg_hidden_chats_v2';
const CHATS_KEY = 'awaitmsg_chats';
const TEMPLATES_KEY = 'awaitmsg_templates';
let persistentChatWriteQueue = Promise.resolve();

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function save<T>(key: string, data: T): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

function normalizeScheduleMessage(value: unknown): ScheduledMessage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const message = value as Partial<ScheduledMessage>;
  if (
    typeof message.id !== 'string'
    || typeof message.chatId !== 'string'
    || typeof message.chatName !== 'string'
    || typeof message.text !== 'string'
    || typeof message.when !== 'string'
    || typeof message.createdAt !== 'string'
  ) return null;

  const knownStatuses = ['pending', 'scheduled', 'confirmed', 'sending', 'sent', 'failed', 'unknown'];
  const unknownStatus = typeof message.status !== 'string' || !knownStatuses.includes(message.status);
  const status: ScheduledMessage['status'] = unknownStatus
    ? 'failed'
    : message.status === 'confirmed'
      ? 'scheduled'
      : message.status as ScheduledMessage['status'];
  const interruptedSchedule = status === 'sending' && message.retryAction === 'schedule';

  return {
    ...message as ScheduledMessage,
    status: status === 'sending' ? (interruptedSchedule ? 'failed' : 'unknown') : status,
    ...((unknownStatus || status === 'sending') ? {
      lastError: message.lastError || (status === 'sending'
        ? interruptedSchedule
          ? 'The app closed while this message was being scheduled.'
          : 'The app closed while this message was sending. Studio cannot verify the result automatically after restart; check Telegram before sending again.'
        : 'This message had an unknown saved status and needs review.'),
      retryAction: interruptedSchedule ? 'schedule' : status === 'sending' ? undefined : (message.retryAction ?? 'send'),
    } : {}),
  };
}

function loadScheduleMessages(key: string): ScheduledMessage[] {
  const stored = load<unknown>(key, []);
  if (!Array.isArray(stored)) return [];
  return stored
    .map(normalizeScheduleMessage)
    .filter((message): message is ScheduledMessage => message !== null);
}

export function loadUpcoming(scope: MessageHistoryScope = 'personal'): ScheduledMessage[] {
  return loadScheduleMessages(UPCOMING_KEYS[scope]);
}

export function loadSent(scope: MessageHistoryScope = 'personal'): ScheduledMessage[] {
  return loadScheduleMessages(SENT_KEYS[scope]);
}

export function saveUpcoming(messages: ScheduledMessage[], scope: MessageHistoryScope = 'personal'): void {
  if (!persistScheduleHistory(scope, 'upcoming', messages)) {
    save(UPCOMING_KEYS[scope], messages);
  }
}

export function saveSent(messages: ScheduledMessage[], scope: MessageHistoryScope = 'personal'): void {
  if (!persistScheduleHistory(scope, 'sent', messages)) {
    save(SENT_KEYS[scope], messages);
  }
}

export async function persistScheduleHistoryAndWait(
  scope: MessageHistoryScope,
  field: ScheduleHistoryField,
  messages: ScheduledMessage[] | ScheduleHistorySnapshot,
): Promise<boolean> {
  if (hasScheduleHistoryStorage()) {
    try {
      const payload = field === 'snapshot'
        ? { scope, field, messages: messages as ScheduleHistorySnapshot }
        : { scope, field, messages: messages as ScheduledMessage[] };
      const result = await saveScheduleHistory(payload);
      return result.success;
    } catch {
      return false;
    }
  }

  if (field === 'snapshot') {
    const snapshot = messages as ScheduleHistorySnapshot;
    return save(UPCOMING_KEYS[scope], snapshot.upcoming)
      && save(SENT_KEYS[scope], snapshot.sent);
  }

  return save(field === 'upcoming' ? UPCOMING_KEYS[scope] : SENT_KEYS[scope], messages);
}

function persistScheduleHistory(
  scope: MessageHistoryScope,
  field: ScheduleHistoryField,
  messages: ScheduledMessage[] | ScheduleHistorySnapshot,
): boolean {
  if (!hasScheduleHistoryStorage()) return false;

  const payload = field === 'snapshot'
    ? { scope, field, messages: messages as ScheduleHistorySnapshot }
    : { scope, field, messages: messages as ScheduledMessage[] };
  void saveScheduleHistory(payload).then((result) => {
    if (!result.success) console.error(result.error || 'Schedule history could not be saved.');
  }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Schedule history could not be saved.');
  });
  return true;
}

export function loadHiddenChats(): string[] {
  return load<string[]>(HIDDEN_CHATS_KEY, []);
}

export function saveHiddenChats(chats: string[]): void {
  save(HIDDEN_CHATS_KEY, chats);
}

export function loadChats(): { id: string; name: string }[] {
  let raw: string | null;
  try {
    raw = localStorage.getItem(CHATS_KEY);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Saved chats could not be read.');
  }
  if (raw === null) return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)
      || parsed.some((chat) => !chat || typeof chat !== 'object' || Array.isArray(chat)
        || typeof chat.id !== 'string' || !chat.id.trim()
        || typeof chat.name !== 'string')) {
      throw new Error('Saved chats have an invalid structure.');
    }
    return parsed as { id: string; name: string }[];
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Saved chats could not be read.');
  }
}

export function saveChats(chats: { id: string; name: string }[]): void {
  loadChats();
  if (!Array.isArray(chats)
    || chats.some((chat) => !chat || typeof chat !== 'object'
      || typeof chat.id !== 'string' || !chat.id.trim()
      || typeof chat.name !== 'string')) {
    throw new Error('Saved chats have an invalid structure.');
  }
  try {
    localStorage.setItem(CHATS_KEY, JSON.stringify(chats));
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Saved chats could not be written.');
  }
}

export async function loadPersistentChats(): Promise<Chat[]> {
  const persistedChats = await telegramLoadSavedChats();
  if (persistedChats !== undefined) {
    if (persistedChats.length > 0) return persistedChats;

    const legacyChats = loadChats() as Chat[];
    if (legacyChats.length > 0) {
      await savePersistentChats(legacyChats);
    }

    return legacyChats;
  }

  return loadChats() as Chat[];
}

export async function savePersistentChats(chats: Chat[]): Promise<void> {
  const write = async () => {
    if (hasSavedChatStorage()) {
      const result = await telegramSaveSavedChats(chats);
      if (!result.success) throw new Error(result.error || 'Chats could not be saved.');
    }
    saveChats(chats);
  };

  const queuedWrite = persistentChatWriteQueue.then(write, write);
  persistentChatWriteQueue = queuedWrite.catch(() => undefined);
  return queuedWrite;
}

function isTemplate(value: unknown): value is Template {
  if (!value || typeof value !== 'object') return false;

  const template = value as Partial<Template>;

  return (
    typeof template.id === 'string' &&
    typeof template.name === 'string' &&
    typeof template.body === 'string' &&
    typeof template.createdAt === 'string' &&
    typeof template.updatedAt === 'string'
  );
}

export function loadTemplates(): Template[] {
  const stored = load<unknown>(TEMPLATES_KEY, []);

  if (!Array.isArray(stored)) return [];

  return stored.filter(isTemplate);
}

export function saveTemplates(templates: Template[]): void {
  save(TEMPLATES_KEY, templates);
}
