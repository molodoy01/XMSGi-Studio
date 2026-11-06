import { createDraftRecord, type DraftAttachment, type DraftRecord, type DraftStoreSnapshot } from '@/domain/messageDraft';

const ACTIVE_DRAFT_KEY = 'xmsgi:active-draft:v1';
const SAVED_DRAFTS_KEY = 'xmsgi:saved-drafts:v1';

function getStorageErrorMessage(error: unknown, fallback: string): string {
  return typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
    ? error.message
    : fallback;
}

function readLocalStorage<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;

  try {
    const value = window.localStorage.getItem(key);
    if (value === null) return fallback;
    return JSON.parse(value) as T;
  } catch (error) {
    throw new Error(getStorageErrorMessage(error, `Local storage key "${key}" could not be read.`));
  }
}

function writeLocalStorage<T>(key: string, value: T): boolean {
  if (typeof window === 'undefined') return false;

  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function normalizeAttachmentValues(attachments?: DraftAttachment[] | string[]): DraftAttachment[] {
  if (!Array.isArray(attachments)) return [];

  return attachments.map((attachment, index) => {
    if (typeof attachment === 'string') {
      return {
        name: attachment.split(/[\\/]/).pop() || attachment,
        path: attachment,
      } as DraftAttachment;
    }

    return {
      ...attachment,
      name: attachment.name || attachment.path || `attachment-${index}`,
      path: attachment.path || attachment.name || '',
    } satisfies DraftAttachment;
  });
}

function normalizeEntityValues(entities?: unknown[]): DraftRecord['entities'] {
  if (!Array.isArray(entities)) return [];

  return entities.filter((entity): entity is DraftRecord['entities'][number] => {
    if (!entity || typeof entity !== 'object') return false;
    const candidate = entity as Partial<DraftRecord['entities'][number]>;
    return typeof candidate.type === 'string'
      && typeof candidate.offset === 'number'
      && typeof candidate.length === 'number';
  });
}

export function readDraftStore(): DraftStoreSnapshot {
  const activeDraft = readLocalStorage<DraftRecord | null>(ACTIVE_DRAFT_KEY, null);
  const savedDrafts = readLocalStorage<DraftRecord[]>(SAVED_DRAFTS_KEY, []);

  if (activeDraft !== null && (!activeDraft || typeof activeDraft !== 'object'
    || typeof activeDraft.message !== 'string')) {
    throw new Error('Active draft has an invalid structure.');
  }
  if (!Array.isArray(savedDrafts)
    || savedDrafts.some((draft) => !draft || typeof draft !== 'object'
      || typeof draft.id !== 'string' || typeof draft.message !== 'string')) {
    throw new Error('Saved drafts have an invalid structure.');
  }

  if (activeDraft !== null && activeDraft !== undefined && typeof activeDraft === 'object') {
    if (activeDraft.date !== undefined && typeof activeDraft.date !== 'string') {
      throw new Error('Active draft date is invalid.');
    }
    if (activeDraft.time !== undefined && typeof activeDraft.time !== 'string') {
      throw new Error('Active draft time is invalid.');
    }
    if (activeDraft.repeatMode !== undefined && !['none', 'daily', 'weekly', 'biweekly', 'monthly'].includes(activeDraft.repeatMode)) {
      throw new Error('Active draft repeat mode is invalid.');
    }
    if (activeDraft.repeatDays !== undefined && !Array.isArray(activeDraft.repeatDays)) {
      throw new Error('Active draft repeat days are invalid.');
    }
    if (activeDraft.repeatOccurrences !== undefined && typeof activeDraft.repeatOccurrences !== 'number') {
      throw new Error('Active draft repeat occurrences are invalid.');
    }
  }

  return {
    activeDraft,
    savedDrafts,
  };
}

export function writeDraftStore(snapshot: DraftStoreSnapshot): boolean {
  const nextSavedDrafts = Array.isArray(snapshot.savedDrafts) ? snapshot.savedDrafts : [];
  const stored = {
    activeDraft: snapshot.activeDraft ?? null,
    savedDrafts: nextSavedDrafts,
  } satisfies DraftStoreSnapshot;

  if (typeof window === 'undefined') return false;

  try {
    readDraftStore();
  } catch {
    return false;
  }

  let previousActive: string | null;
  let previousSaved: string | null;
  let activeValue: string;
  let savedValue: string;
  try {
    previousActive = window.localStorage.getItem(ACTIVE_DRAFT_KEY);
    previousSaved = window.localStorage.getItem(SAVED_DRAFTS_KEY);
    activeValue = JSON.stringify(stored.activeDraft);
    savedValue = JSON.stringify(stored.savedDrafts);
  } catch {
    return false;
  }

  try {
    window.localStorage.setItem(ACTIVE_DRAFT_KEY, activeValue);
    window.localStorage.setItem(SAVED_DRAFTS_KEY, savedValue);
    return true;
  } catch {
    try {
      if (previousActive === null) window.localStorage.removeItem(ACTIVE_DRAFT_KEY);
      else window.localStorage.setItem(ACTIVE_DRAFT_KEY, previousActive);
      if (previousSaved === null) window.localStorage.removeItem(SAVED_DRAFTS_KEY);
      else window.localStorage.setItem(SAVED_DRAFTS_KEY, previousSaved);
    } catch {
      return false;
    }
    return false;
  }
}

export function readActiveDraft(): DraftRecord | null {
  return readActiveDraftState().draft;
}

export function readActiveDraftState(): {
  available: boolean;
  exists: boolean;
  draft: DraftRecord | null;
  error?: string;
} {
  if (typeof window === 'undefined') {
    return { available: false, exists: false, draft: null, error: 'Browser storage is unavailable.' };
  }

  let raw: string | null;
  try {
    raw = window.localStorage.getItem(ACTIVE_DRAFT_KEY);
  } catch (error) {
    return {
      available: false,
      exists: false,
      draft: null,
      error: getStorageErrorMessage(error, 'Active draft could not be read.'),
    };
  }
  if (raw === null) return { available: true, exists: false, draft: null };
  if (raw === 'null') return { available: true, exists: true, draft: null };

  try {
    const value = JSON.parse(raw) as Partial<DraftRecord> | null;
    if (!value || typeof value !== 'object' || typeof value.message !== 'string'
      || typeof value.id !== 'string'
      || (value.entities !== undefined && !Array.isArray(value.entities))
      || (value.attachments !== undefined && !Array.isArray(value.attachments))) {
      return { available: false, exists: true, draft: null, error: 'Active draft has an invalid structure.' };
    }

    return { available: true, exists: true, draft: value as DraftRecord };
  } catch (error) {
    return {
      available: false,
      exists: true,
      draft: null,
      error: getStorageErrorMessage(error, 'Active draft contains invalid JSON.'),
    };
  }
}

export function createActiveDraftSnapshot(input: {
  message: string;
  entities?: unknown[];
  attachments?: DraftAttachment[] | string[];
  selectedChatId?: string | null;
  date?: string;
  time?: string;
  repeatMode?: 'none' | 'daily' | 'weekly' | 'biweekly' | 'monthly';
  repeatDays?: string[];
  repeatOccurrences?: number;
  id?: string;
  updatedAt?: string;
}): DraftRecord {
  return createDraftRecord({
    id: input.id ?? 'shared-active-draft',
    message: input.message,
    entities: normalizeEntityValues(input.entities),
    attachments: normalizeAttachmentValues(input.attachments),
    selectedChatId: input.selectedChatId ?? null,
    date: input.date ?? '',
    time: input.time ?? '',
    repeatMode: input.repeatMode ?? 'none',
    repeatDays: Array.isArray(input.repeatDays) ? input.repeatDays : [],
    repeatOccurrences: typeof input.repeatOccurrences === 'number' ? input.repeatOccurrences : 1,
    updatedAt: input.updatedAt ?? new Date().toISOString(),
  });
}

export function writeActiveDraft(draft: DraftRecord | null): boolean {
  if (!readActiveDraftState().available) return false;
  return writeLocalStorage(ACTIVE_DRAFT_KEY, draft);
}

export function readSavedDrafts(): DraftRecord[] {
  return readDraftStore().savedDrafts;
}

export function writeSavedDrafts(drafts: DraftRecord[]): boolean {
  const snapshot = readDraftStore();
  return writeDraftStore({
    ...snapshot,
    savedDrafts: drafts,
  });
}

export function upsertSavedDraft(draft: DraftRecord): DraftRecord[] {
  const snapshot = readDraftStore();
  const nextSavedDrafts = snapshot.savedDrafts.filter((entry) => entry.id !== draft.id);
  nextSavedDrafts.unshift(draft);
  if (!writeDraftStore({
    ...snapshot,
    savedDrafts: nextSavedDrafts,
  })) throw new Error('Saved drafts could not be written.');
  return nextSavedDrafts;
}

export function replaceSavedDrafts(drafts: DraftRecord[]): DraftRecord[] {
  const snapshot = readDraftStore();
  const nextDrafts = drafts.map((draft) => ({
    ...draft,
    attachments: normalizeAttachmentValues(draft.attachments),
    entities: normalizeEntityValues(draft.entities),
  }));
  writeDraftStore({
    ...snapshot,
    savedDrafts: nextDrafts,
  });
  return nextDrafts;
}
