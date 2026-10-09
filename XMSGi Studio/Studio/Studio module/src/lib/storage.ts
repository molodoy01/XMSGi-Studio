import type { SavedDraft, ScheduledMessage, Template } from '@/types';
import { draftRepository } from '../repositories/draftRepository';
import { templateRepository } from '../repositories/templateRepository';
import {
  convertDomainDraftToLegacy,
  convertDomainTemplateToLegacy,
  convertLegacyDraftToDomain,
  convertLegacyTemplateToDomain,
} from '../services/domainBridge';

export type MessageHistoryScope = 'personal' | 'workspace';

const LEGACY_UPCOMING_KEYS: Record<MessageHistoryScope, string> = {
  personal: 'awaitmsg_upcoming',
  workspace: 'awaitmsg_workspace_upcoming',
};
const XMSGI_UPCOMING_KEYS: Record<MessageHistoryScope, string> = {
  personal: 'xmsgi_upcoming',
  workspace: 'xmsgi_workspace_upcoming',
};
const LEGACY_SENT_KEYS: Record<MessageHistoryScope, string> = {
  personal: 'awaitmsg_sent',
  workspace: 'awaitmsg_workspace_sent',
};
const XMSGI_SENT_KEYS: Record<MessageHistoryScope, string> = {
  personal: 'xmsgi_sent',
  workspace: 'xmsgi_workspace_sent',
};
const LEGACY_HIDDEN_CHATS_KEY = 'awaitmsg_hidden_chats';
const XMSGI_HIDDEN_CHATS_KEY = 'xmsgi_hidden_chats';
const LEGACY_CHATS_KEY = 'awaitmsg_chats';
const XMSGI_CHATS_KEY = 'xmsgi_chats';

function getStorage(): Storage | null {
  if (typeof globalThis === 'undefined') return null;

  try {
    if ('localStorage' in globalThis && globalThis.localStorage) {
      return globalThis.localStorage;
    }
  } catch {
    return null;
  }

  return null;
}

export function load<T>(key: string, fallback: T, legacyKey?: string): T {
  const storage = getStorage();

  if (!storage) {
    return fallback;
  }

  const primaryRaw = storage.getItem(key);
  if (primaryRaw !== null) {
    try {
      return JSON.parse(primaryRaw) as T;
    } catch {
      return fallback;
    }
  }

  if (!legacyKey) {
    return fallback;
  }

  const legacyRaw = storage.getItem(legacyKey);
  if (legacyRaw === null) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(legacyRaw) as T;
    storage.setItem(key, legacyRaw);
    return parsed;
  } catch {
    return fallback;
  }
}

export function save<T>(key: string, data: T, legacyKey?: string): void {
  const storage = getStorage();

  if (!storage) {
    return;
  }

  try {
    const serialized = JSON.stringify(data);
    storage.setItem(key, serialized);
    if (legacyKey) {
      storage.setItem(legacyKey, serialized);
    }
  } catch {
    // ignore
  }
}

function isScheduledMessage(value: unknown): value is ScheduledMessage {
  if (!value || typeof value !== 'object') return false;

  const message = value as Partial<ScheduledMessage>;

  return (
    typeof message.id === 'string' &&
    typeof message.chatId === 'string' &&
    typeof message.chatName === 'string' &&
    typeof message.text === 'string' &&
    typeof message.when === 'string' &&
    typeof message.createdAt === 'string' &&
    (message.status === 'pending' ||
      message.status === 'scheduled' ||
      message.status === 'confirmed' ||
      message.status === 'sent' ||
      message.status === 'failed')
  );
}

function normalizeScheduledMessages(value: unknown): ScheduledMessage[] {
  if (!Array.isArray(value)) return [];

  return value.filter(isScheduledMessage);
}

export function loadUpcoming(scope: MessageHistoryScope = 'personal'): ScheduledMessage[] {
  return normalizeScheduledMessages(load<unknown>(XMSGI_UPCOMING_KEYS[scope], [], LEGACY_UPCOMING_KEYS[scope]));
}

export function loadSent(scope: MessageHistoryScope = 'personal'): ScheduledMessage[] {
  return normalizeScheduledMessages(load<unknown>(XMSGI_SENT_KEYS[scope], [], LEGACY_SENT_KEYS[scope]));
}

export function saveUpcoming(messages: ScheduledMessage[], scope: MessageHistoryScope = 'personal'): void {
  save(XMSGI_UPCOMING_KEYS[scope], messages, LEGACY_UPCOMING_KEYS[scope]);
}

export function saveSent(messages: ScheduledMessage[], scope: MessageHistoryScope = 'personal'): void {
  save(XMSGI_SENT_KEYS[scope], messages, LEGACY_SENT_KEYS[scope]);
}

export function loadHiddenChats(): string[] {
  const stored = load<unknown>(XMSGI_HIDDEN_CHATS_KEY, [], LEGACY_HIDDEN_CHATS_KEY);

  if (!Array.isArray(stored)) return [];

  return stored.filter((value): value is string => typeof value === 'string');
}

export function saveHiddenChats(chats: string[]): void {
  save(XMSGI_HIDDEN_CHATS_KEY, chats, LEGACY_HIDDEN_CHATS_KEY);
}

export function loadChats(): { id: string; name: string }[] {
  const stored = load<unknown>(XMSGI_CHATS_KEY, [], LEGACY_CHATS_KEY);

  if (!Array.isArray(stored)) return [];

  return stored.filter((value): value is { id: string; name: string } => {
    return !!value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string' && typeof (value as { name?: unknown }).name === 'string';
  });
}

export function saveChats(chats: { id: string; name: string }[]): void {
  save(XMSGI_CHATS_KEY, chats, LEGACY_CHATS_KEY);
}

export function loadTemplates(): Template[] {
  const templates = templateRepository.list();
  return templates
    .filter((template) => Boolean((template as { id?: unknown }).id))
    .map((template) => convertDomainTemplateToLegacy(template as never));
}

export function saveTemplates(templates: Template[]): void {
  const current = templateRepository.list();
  const ids = new Set(templates.map((template) => template.id));

  for (const template of templates) {
    const domainTemplate = convertLegacyTemplateToDomain(template);
    templateRepository.save(domainTemplate as never);
  }

  for (const item of current) {
    if (!ids.has(item.id)) {
      templateRepository.remove(item.id);
    }
  }
}

export function loadSavedDrafts(): SavedDraft[] {
  const drafts = draftRepository.list();
  return drafts
    .filter((draft) => Boolean((draft as { id?: unknown }).id))
    .map((draft) => convertDomainDraftToLegacy(draft as never));
}

export function saveSavedDrafts(drafts: SavedDraft[]): void {
  const current = draftRepository.list();
  const ids = new Set(drafts.map((draft) => draft.id));

  for (const draft of drafts) {
    const domainDraft = convertLegacyDraftToDomain(draft);
    draftRepository.save(domainDraft as never);
  }

  for (const item of current) {
    if (!ids.has(item.id)) {
      draftRepository.remove(item.id);
    }
  }
}
