import type { Chat, PersistedDraftStore, RichTextEntity, SavedDraft } from '@studio/types';
import type { DraftAttachment } from '../domain/types';
import { DRAFT_STORE_SCHEMA_VERSION } from './draftStoreVersion';
import { normalizeAttachments } from './draftAttachments';
import { normalizeWorkspaceDocumentHistories } from './documentHistory';
import { normalizeRichTextEntities } from './richText';
import type { ScheduleRepeatOptions } from './scheduling';
import { createDraftRecord, normalizeDraftAttachments, normalizeDraftEntities, type DraftRecord } from '@/domain/messageDraft';
import { readActiveDraftState } from '@/services/draftStoreService';

export const WORKSPACE_DRAFT_KEY = 'xmsgi-workspace-draft';
export const LEGACY_WORKSPACE_DRAFT_KEY = 'awaitmsg-workspace-draft';
export const SAVED_STUDIO_DRAFTS_UPDATED_EVENT = 'xmsgi-saved-studio-drafts-updated';
export const DEFAULT_DRAFT_SEEDED_KEY = 'xmsgi-default-draft-seeded-v1';
export const DEFAULT_DRAFT_ID = 'xmsgi-default-draft-00-55';
export const DEFAULT_DRAFT_NAME = 'Draft 00:55';
export const DEFAULT_DRAFT_BODY = '💣 **ДЕЙСТВУЙ**\n\n🔥 **[Название]**\n🚀 [Главный результат]\n⚡ [Ключевая фишка]\n\n😈 Остальное увидишь сам.\n\n👉 @username\n';

const DRAFT_STORE_FALLBACK_KEY = 'xmsgi-draft-store-fallback';
const LEGACY_DRAFT_STORE_FALLBACK_KEY = 'awaitmsg-draft-store-fallback';

function getStorageErrorMessage(error: unknown, fallback: string): string {
  return typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
    ? error.message
    : fallback;
}

export type WorkspaceDraft = {
  documentId?: string;
  body: string;
  entities?: RichTextEntity[];
  attachments: DraftAttachment[];
  selectedChat?: Chat | null;
  savedAt: string;
  date?: string;
  time?: string;
  repeatMode?: ScheduleRepeatOptions['mode'];
  repeatDays?: string[];
  repeatOccurrences?: number;
  sendAttemptId?: string;
  sendAttemptFingerprint?: string;
  sendAttemptRecordId?: string;
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
  const activeDraftState = readActiveDraftState();
  if (!activeDraftState.available) {
    throw new Error(activeDraftState.error || 'Active draft could not be read.');
  }
  const unifiedDraft = activeDraftState.draft;
  if (unifiedDraft) {
    if (unifiedDraft.id === 'quick-planner:active') return {};

    return {
      documentId: unifiedDraft.id,
      body: unifiedDraft.message,
      entities: unifiedDraft.entities as unknown as RichTextEntity[],
      attachments: unifyDraftAttachmentPaths(unifiedDraft.attachments as Array<{ id?: string; name?: string; path?: string; size?: number; kind?: string; type?: string; mimeType?: string; sourcePath?: string; previewUrl?: string; position?: number; albumId?: string; unavailable?: boolean }>),
      selectedChat: unifiedDraft.selectedChatId ? { id: unifiedDraft.selectedChatId, name: '', username: '', type: 'unknown' } as Chat : null,
      date: typeof unifiedDraft.date === 'string' ? unifiedDraft.date : '',
      time: typeof unifiedDraft.time === 'string' ? unifiedDraft.time : '',
      repeatMode: ['none', 'daily', 'weekly', 'biweekly', 'monthly'].includes(unifiedDraft.repeatMode ?? 'none') ? (unifiedDraft.repeatMode ?? 'none') : 'none',
      repeatDays: Array.isArray(unifiedDraft.repeatDays) ? unifiedDraft.repeatDays as string[] : [],
      repeatOccurrences: typeof unifiedDraft.repeatOccurrences === 'number' ? unifiedDraft.repeatOccurrences : 1,
      savedAt: unifiedDraft.updatedAt,
    };
  }

  try {
    const primaryRaw = window.localStorage.getItem(WORKSPACE_DRAFT_KEY);
    const raw = primaryRaw ?? window.localStorage.getItem(LEGACY_WORKSPACE_DRAFT_KEY);
    if (raw === null) return {};
    const parsed = JSON.parse(raw) as Partial<WorkspaceDraft>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Saved workspace draft has an invalid structure.');
    }
    if (!primaryRaw && raw) {
      window.localStorage.setItem(WORKSPACE_DRAFT_KEY, raw);
      if (window.localStorage.getItem(WORKSPACE_DRAFT_KEY) !== raw) {
        throw new Error('Legacy workspace draft migration could not be verified.');
      }
    }
    return {
      ...parsed,
      entities: normalizeRichTextEntities(parsed.entities, parsed.body?.length ?? 0),
      attachments: normalizeAttachments(parsed.attachments),
      selectedChat: normalizeDraftChat(parsed.selectedChat),
    };
  } catch (error) {
    throw new Error(getStorageErrorMessage(error, 'Saved workspace draft could not be read.'));
  }
}

function unifyDraftAttachmentPaths(
  attachments: Array<{
    id?: string;
    name?: string;
    path?: string;
    size?: number;
    kind?: string;
    type?: string;
    mimeType?: string;
    sourcePath?: string;
    previewUrl?: string;
    position?: number;
    albumId?: string;
    unavailable?: boolean;
  }> = [],
): DraftAttachment[] {
  return attachments.map((attachment, index) => ({
    id: attachment.id ?? `studio-draft-attachment-${index}`,
    type: attachment.type === 'image' || attachment.kind === 'image' ? 'image' : 'file',
    name: attachment.name ?? attachment.path ?? `attachment-${index}`,
    mimeType: attachment.mimeType ?? 'application/octet-stream',
    size: typeof attachment.size === 'number' ? attachment.size : 0,
    path: attachment.path ?? attachment.sourcePath ?? '',
    sourcePath: attachment.sourcePath ?? attachment.path,
    previewUrl: attachment.previewUrl,
    position: typeof attachment.position === 'number' ? attachment.position : index,
    albumId: attachment.albumId,
    unavailable: attachment.unavailable,
  }));
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
  copyAttachmentPath?: (path: string) => Promise<{
    success: boolean;
    attachment?: { name: string; path: string; size: number };
    error?: string;
  }>;
  readImageDataUrl?: (path: string) => Promise<{
    success: boolean;
    dataUrl?: string;
    error?: string;
  }>;
  importText: () => Promise<{ success: boolean; cancelled?: boolean; text?: string; error?: string }>;
  exportText: (text: string, format?: 'txt' | 'json') => Promise<{ success: boolean; cancelled?: boolean; error?: string }>;
}

export function hasDraftContent(body: string, attachments: DraftAttachment[] = []): boolean {
  return body.trim().length > 0 || attachments.some((attachment) => Boolean(attachment.path || attachment.previewUrl || attachment.name));
}

export function readWorkspaceDraftRecord(): DraftRecord | null {
  const draft = readInitialWorkspaceDraft();
  const body = typeof draft.body === 'string' ? draft.body : '';
  if (!body.trim() && !(draft.attachments?.length)) return null;

  return createDraftRecord({
    id: draft.documentId ?? 'workspace:active',
    message: body,
    entities: normalizeDraftEntities(draft.entities),
    attachments: normalizeDraftAttachments(draft.attachments),
    selectedChatId: draft.selectedChat?.id ?? null,
    updatedAt: typeof draft.savedAt === 'string' ? draft.savedAt : new Date().toISOString(),
  });
}

export function readWorkspaceDraftStoreFallback(): PersistedDraftStore | null {
  let storage: Storage;
  try {
    storage = window.localStorage;
  } catch (error) {
    throw new Error(getStorageErrorMessage(error, 'Browser storage is unavailable.'));
  }

  let primaryRaw: string | null;
  try {
    primaryRaw = storage.getItem(DRAFT_STORE_FALLBACK_KEY);
  } catch (error) {
    throw new Error(getStorageErrorMessage(error, 'Draft storage could not be read.'));
  }
  if (primaryRaw !== null) return parseDraftStoreFallback(primaryRaw);

  let legacyRaw: string | null;
  try {
    legacyRaw = storage.getItem(LEGACY_DRAFT_STORE_FALLBACK_KEY);
  } catch (error) {
    throw new Error(getStorageErrorMessage(error, 'Legacy draft storage could not be read.'));
  }
  if (legacyRaw === null) return null;

  const legacyStore = parseDraftStoreFallback(legacyRaw);
  try {
    storage.setItem(DRAFT_STORE_FALLBACK_KEY, legacyRaw);
    if (storage.getItem(DRAFT_STORE_FALLBACK_KEY) !== legacyRaw) {
      throw new Error('Legacy draft storage migration could not be verified.');
    }
  } catch (error) {
    throw new Error(getStorageErrorMessage(error, 'Legacy draft storage could not be migrated.'));
  }
  return legacyStore;
}

export function writeWorkspaceDraftStoreFallback(store: PersistedDraftStore): boolean {
  let storage: Storage;
  try {
    storage = window.localStorage;
  } catch {
    return false;
  }
  try {
    parseDraftStoreFallback(JSON.stringify(store));
    readWorkspaceDraftStoreFallback();
  } catch {
    return false;
  }

  const serialized = JSON.stringify(store);
  try {
    storage.setItem(DRAFT_STORE_FALLBACK_KEY, serialized);
    if (storage.getItem(DRAFT_STORE_FALLBACK_KEY) !== serialized) return false;
  } catch {
    return false;
  }

  try {
    storage.setItem(LEGACY_DRAFT_STORE_FALLBACK_KEY, serialized);
  } catch {
    // The primary fallback is authoritative; the legacy copy remains available.
  }
  return true;
}

function parseDraftStoreFallback(raw: string): PersistedDraftStore {
  let parsed: Partial<PersistedDraftStore>;
  try {
    parsed = JSON.parse(raw) as Partial<PersistedDraftStore>;
  } catch (error) {
    throw new Error(`Saved drafts contain invalid JSON: ${getStorageErrorMessage(error, 'parse failed')}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
    || !Array.isArray(parsed.savedDrafts)
    || parsed.savedDrafts.some((draft) => !draft || typeof draft !== 'object' || Array.isArray(draft)
      || typeof draft.id !== 'string'
      || typeof draft.name !== 'string'
      || typeof draft.body !== 'string')
    || (parsed.workspaceDraft !== undefined
      && parsed.workspaceDraft !== null
      && (typeof parsed.workspaceDraft !== 'object' || Array.isArray(parsed.workspaceDraft)))
    || (parsed.documentHistories !== undefined
      && (!parsed.documentHistories || typeof parsed.documentHistories !== 'object' || Array.isArray(parsed.documentHistories)))) {
    throw new Error('Saved drafts have an invalid structure.');
  }

  const storedSchemaVersion = typeof parsed.schemaVersion === 'number' ? parsed.schemaVersion : 1;
  if (!Number.isInteger(storedSchemaVersion)
    || storedSchemaVersion < 1
    || storedSchemaVersion > DRAFT_STORE_SCHEMA_VERSION) {
    throw new Error('Saved drafts have an unsupported version.');
  }

  return {
    ...parsed,
    schemaVersion: DRAFT_STORE_SCHEMA_VERSION,
    migrationVersion: typeof parsed.migrationVersion === 'number' ? parsed.migrationVersion : 1,
    savedDrafts: parsed.savedDrafts,
    workspaceDraft: parsed.workspaceDraft ?? null,
    documentHistories: normalizeWorkspaceDocumentHistories(parsed.documentHistories),
  };
}

export function getDraftStorageApi(): DraftStorageApi | null {
  if (typeof window === 'undefined') return null;
  const storage = (window as typeof window & { draftStorage?: DraftStorageApi }).draftStorage;
  return storage && typeof storage.load === 'function' ? storage : null;
}

export async function updateSavedStudioDrafts(
  update: (drafts: SavedDraft[]) => SavedDraft[],
): Promise<boolean> {
  try {
    const draftStorage = getDraftStorageApi();
    const loaded = draftStorage
      ? await draftStorage.load()
      : { success: true, store: readWorkspaceDraftStoreFallback() };
    if (!loaded.success) return false;
    if (!loaded.store) return true;

    const updatedStore = {
      ...loaded.store,
      savedDrafts: update(loaded.store.savedDrafts),
    };
    const saved = draftStorage
      ? await draftStorage.save(updatedStore)
      : { success: writeWorkspaceDraftStoreFallback(updatedStore) };
    if (saved.success) window.dispatchEvent(new Event(SAVED_STUDIO_DRAFTS_UPDATED_EVENT));
    return saved.success;
  } catch (error) {
    console.error('Failed to update saved Studio drafts.', error);
    return false;
  }
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