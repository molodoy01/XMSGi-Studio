import type { Chat, ScheduledMessage, Template } from '@/types';

export type MessageHistoryScope = 'personal' | 'workspace';

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

export function save<T>(key: string, data: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch {
    // ignore
  }
}

export function loadUpcoming(scope: MessageHistoryScope = 'personal'): ScheduledMessage[] {
  return load<ScheduledMessage[]>(UPCOMING_KEYS[scope], []);
}

export function loadSent(scope: MessageHistoryScope = 'personal'): ScheduledMessage[] {
  return load<ScheduledMessage[]>(SENT_KEYS[scope], []);
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

function persistScheduleHistory(
  scope: MessageHistoryScope,
  field: 'upcoming' | 'sent',
  messages: ScheduledMessage[],
): boolean {
  if (typeof window === 'undefined' || typeof window.telegram?.saveScheduleHistory !== 'function') return false;

  void window.telegram.saveScheduleHistory({ scope, field, messages }).then((result) => {
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
