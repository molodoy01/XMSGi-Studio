import type { Chat, ScheduledMessage, Template } from '@/types';

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

  const knownStatuses = ['pending', 'scheduled', 'confirmed', 'sending', 'sent', 'failed'];
  const unknownStatus = typeof message.status !== 'string' || !knownStatuses.includes(message.status);
  const legacyPending = message.status === 'pending';
  const status: ScheduledMessage['status'] = unknownStatus || legacyPending
    ? 'failed'
    : message.status === 'confirmed'
      ? 'scheduled'
      : message.status as ScheduledMessage['status'];

  return {
    ...message as ScheduledMessage,
    status: status === 'sending' ? 'failed' : status,
    ...((unknownStatus || legacyPending || status === 'sending') ? {
      lastError: message.lastError || (legacyPending
        ? 'This schedule was interrupted before Telegram confirmed it.'
        : status === 'sending'
          ? 'The app closed while this message was sending. Check Telegram before retrying.'
          : 'This message had an unknown saved status and needs review.'),
      retryAction: message.retryAction ?? (legacyPending ? 'schedule' : 'send'),
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
  if (typeof window !== 'undefined' && typeof window.telegram?.saveScheduleHistory === 'function') {
    try {
      const payload = field === 'snapshot'
        ? { scope, field, messages: messages as ScheduleHistorySnapshot }
        : { scope, field, messages: messages as ScheduledMessage[] };
      const result = await window.telegram.saveScheduleHistory(payload);
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
  if (typeof window === 'undefined' || typeof window.telegram?.saveScheduleHistory !== 'function') return false;

  const payload = field === 'snapshot'
    ? { scope, field, messages: messages as ScheduleHistorySnapshot }
    : { scope, field, messages: messages as ScheduledMessage[] };
  void window.telegram.saveScheduleHistory(payload).then((result) => {
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
  return load<{ id: string; name: string }[]>(CHATS_KEY, []);
}

export function saveChats(chats: { id: string; name: string }[]): void {
  save(CHATS_KEY, chats);
}

export async function loadPersistentChats(): Promise<Chat[]> {
  if (typeof window !== 'undefined' && typeof window.telegram?.loadSavedChats === 'function') {
    const persistedChats = await window.telegram.loadSavedChats();
    if (persistedChats.length > 0) return persistedChats;

    const legacyChats = loadChats() as Chat[];
    if (legacyChats.length > 0 && typeof window.telegram.saveSavedChats === 'function') {
      await savePersistentChats(legacyChats);
    }

    return legacyChats;
  }

  return loadChats() as Chat[];
}

export async function savePersistentChats(chats: Chat[]): Promise<void> {
  const write = async () => {
    save(CHATS_KEY, chats);

    if (typeof window !== 'undefined' && typeof window.telegram?.saveSavedChats === 'function') {
      await window.telegram.saveSavedChats(chats);
    }
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
