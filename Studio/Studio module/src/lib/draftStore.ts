import type { Chat, InlineButtonRow, PersistedDraftStore, RichTextEntity, SavedDraft } from '@/types';
import type { DraftAttachment } from '../domain/types';
import { DRAFT_STORE_SCHEMA_VERSION } from './draftStoreVersion';
import { normalizeAttachments } from './draftAttachments';
import { normalizeRichTextEntities } from './richText';
import type { ScheduleRepeatOptions } from './scheduling';

export const WORKSPACE_DRAFT_KEY = 'xmsgi-workspace-draft';
export const LEGACY_WORKSPACE_DRAFT_KEY = 'awaitmsg-workspace-draft';
export const DEFAULT_DRAFT_SEEDED_KEY = 'xmsgi-default-draft-seeded-v1';
export const DEFAULT_DRAFT_ID = 'xmsgi-default-draft-00-55';
export const DEFAULT_DRAFT_NAME = 'Draft 00:55';
export const DEFAULT_DRAFT_BODY = '💣 **ДЕЙСТВУЙ**\n\n🔥 **[Название]**\n🚀 [Главный результат]\n⚡ [Ключевая фишка]\n\n😈 Остальное увидишь сам.\n\n👉 @username\n';

const DRAFT_STORE_FALLBACK_KEY = 'xmsgi-draft-store-fallback';
const LEGACY_DRAFT_STORE_FALLBACK_KEY = 'awaitmsg-draft-store-fallback';

export type WorkspaceDraft = {
  body: string;
  entities?: RichTextEntity[];
  attachments: DraftAttachment[];
  selectedChat?: Chat | null;
  savedAt: string;
  inlineButtons?: InlineButtonRow[];
  date?: string;
  time?: string;
  repeatMode?: ScheduleRepeatOptions['mode'];
  repeatDays?: string[];
  repeatOccurrences?: number;
};

function normalizeDraftChat(value: unknown): Chat | null {
  if (!value || typeof value !== 'object') return null;
  const chat = value as Partial<Chat>;
  if (typeof chat.id !== 'string' || typeof chat.name !== 'string') return null;
  return {
    id: chat.id,
    name: chat.name,
    username: typeof chat.username === 'string' ? chat.username : '',
    type: chat.type,
    avatarDataUrl: typeof chat.avatarDataUrl === 'string' ? chat.avatarDataUrl : '',
  };
}

export function readInitialWorkspaceDraft(): Partial<WorkspaceDraft> {
  try {
    const primaryRaw = window.localStorage.getItem(WORKSPACE_DRAFT_KEY);
    const raw = primaryRaw ?? window.localStorage.getItem(LEGACY_WORKSPACE_DRAFT_KEY);
    const parsed = raw ? JSON.parse(raw) as Partial<WorkspaceDraft> : {};
    if (!primaryRaw && raw) window.localStorage.setItem(WORKSPACE_DRAFT_KEY, raw);
    return {
      ...parsed,
      entities: normalizeRichTextEntities(parsed.entities, parsed.body?.length ?? 0),
      attachments: normalizeAttachments(parsed.attachments),
      selectedChat: normalizeDraftChat(parsed.selectedChat),
    };
  } catch {
    return {};
  }
}

export interface DraftStorageApi {
  load: () => Promise<{
    success: boolean;
    store?: PersistedDraftStore;
    backupIndexes?: number[];
    error?: string;
    needsMigration?: boolean;
    schemaMigrated?: boolean;
    migrated?: boolean;
    recovered?: boolean;
  }>;
  migrate: (legacy: { savedDrafts: unknown[]; workspaceDraft: Record<string, unknown> | null }) => Promise<{
    success: boolean;
    store?: PersistedDraftStore;
    error?: string;
  }>;
  save: (store: PersistedDraftStore) => Promise<{
    success: boolean;
    store?: PersistedDraftStore;
    backupIndexes?: number[];
    error?: string;
  }>;
  flush: (store: PersistedDraftStore) => { success: boolean; store?: PersistedDraftStore; error?: string };
  restoreBackup: (index: number) => Promise<{ success: boolean; store?: PersistedDraftStore; error?: string }>;
  exportBackup: () => Promise<{ success: boolean; cancelled?: boolean; error?: string }>;
  importBackup: () => Promise<{ success: boolean; cancelled?: boolean; store?: PersistedDraftStore; error?: string }>;
  copyAttachment: (file: File) => Promise<{
    success: boolean;
    attachment?: { name: string; path: string; size: number };
    error?: string;
  }>;
  importText: () => Promise<{ success: boolean; cancelled?: boolean; text?: string; error?: string }>;
}

export function hasDraftContent(body: string, attachments: DraftAttachment[] = []): boolean {
  return body.trim().length > 0 || attachments.some((attachment) => Boolean(attachment.path || attachment.previewUrl || attachment.name));
}

export function readWorkspaceDraftStoreFallback(): PersistedDraftStore | null {
  try {
    const primaryRaw = window.localStorage.getItem(DRAFT_STORE_FALLBACK_KEY);
    const raw = primaryRaw ?? window.localStorage.getItem(LEGACY_DRAFT_STORE_FALLBACK_KEY);
    if (!raw) return null;
    if (!primaryRaw) window.localStorage.setItem(DRAFT_STORE_FALLBACK_KEY, raw);

    const parsed = JSON.parse(raw) as Partial<PersistedDraftStore>;
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.savedDrafts)) return null;
    const storedSchemaVersion = typeof parsed.schemaVersion === 'number' ? parsed.schemaVersion : 1;
    if (!Number.isInteger(storedSchemaVersion)
      || storedSchemaVersion < 1
      || storedSchemaVersion > DRAFT_STORE_SCHEMA_VERSION) return null;

    return {
      schemaVersion: DRAFT_STORE_SCHEMA_VERSION,
      migrationVersion: typeof parsed.migrationVersion === 'number' ? parsed.migrationVersion : 1,
      savedDrafts: parsed.savedDrafts,
      workspaceDraft: parsed.workspaceDraft ?? null,
    };
  } catch {
    return null;
  }
}

export function writeWorkspaceDraftStoreFallback(store: PersistedDraftStore): void {
  try {
    const serialized = JSON.stringify(store);
    window.localStorage.setItem(DRAFT_STORE_FALLBACK_KEY, serialized);
    window.localStorage.setItem(LEGACY_DRAFT_STORE_FALLBACK_KEY, serialized);
  } catch {
    // ignore
  }
}

export function getDraftStorageApi(): DraftStorageApi | null {
  if (typeof window === 'undefined') return null;
  const storage = (window as typeof window & { draftStorage?: DraftStorageApi }).draftStorage;
  return storage && typeof storage.load === 'function' ? storage : null;
}

export function isBrowserRuntimeFallback(): boolean {
  if (typeof window === 'undefined') return false;
  return window.location.protocol === 'http:' || window.location.protocol === 'https:';
}

export function seedDefaultDraft(store: PersistedDraftStore): { store: PersistedDraftStore; added: boolean } {
  try {
    if (window.localStorage.getItem(DEFAULT_DRAFT_SEEDED_KEY) === '1') return { store, added: false };

    const alreadyPresent = store.savedDrafts.some((draft) => (
      draft.id === DEFAULT_DRAFT_ID
      || (draft.name === DEFAULT_DRAFT_NAME && draft.body === DEFAULT_DRAFT_BODY)
    ));
    if (alreadyPresent) {
      window.localStorage.setItem(DEFAULT_DRAFT_SEEDED_KEY, '1');
      return { store, added: false };
    }
  } catch {
    return { store, added: false };
  }

  const now = new Date().toISOString();
  const defaultDraft: SavedDraft = {
    id: DEFAULT_DRAFT_ID,
    name: DEFAULT_DRAFT_NAME,
    body: DEFAULT_DRAFT_BODY,
    color: 'coral',
    entities: [],
    attachments: [],
    selectedChat: null,
    inlineButtons: [],
    date: '',
    time: '',
    repeatMode: 'none',
    repeatDays: [],
    repeatOccurrences: 1,
    createdAt: now,
    updatedAt: now,
  };

  return { store: { ...store, savedDrafts: [...store.savedDrafts, defaultDraft] }, added: true };
}

export function markDefaultDraftSeeded(): void {
  try {
    window.localStorage.setItem(DEFAULT_DRAFT_SEEDED_KEY, '1');
  } catch {
    // The saved draft remains available for the current session.
  }
}