import { normalizeRichTextEntities } from './richText';
import type { RichTextEntity } from '@/types';
import { load, save } from './storage';
import type { PlannerReminderType, SavedPlannerDraft as SavedPlannerDraftModel } from '@/workspace/historyModel';
import { createDraftRecord, normalizeDraftAttachments, normalizeDraftEntities, type DraftRecord } from '@/domain/messageDraft';
import { createActiveDraftSnapshot, readActiveDraftState, writeActiveDraft } from '@/services/draftStoreService';

export type SavedPlannerDraft = SavedPlannerDraftModel;
export const SAVED_PLANNER_DRAFTS_UPDATED_EVENT = 'xmsgi-saved-planner-drafts-updated';
export const MAX_PLANNER_ATTACHMENTS = 10;

function normalizeDraftChat(value: unknown): SavedPlannerDraft['selectedChat'] {
  if (!value || typeof value !== 'object' || !('id' in value) || !('name' in value)
    || typeof value.id !== 'string' || typeof value.name !== 'string') {
    return null;
  }

  const type = 'type' in value
    && (value.type === 'private' || value.type === 'group' || value.type === 'supergroup'
      || value.type === 'channel' || value.type === 'unknown')
    ? value.type
    : undefined;

  return {
    id: value.id,
    name: value.name,
    ...('username' in value && typeof value.username === 'string' ? { username: value.username } : {}),
    ...(type ? { type } : {}),
  };
}

const PLANNER_DRAFT_STORAGE_KEY = 'xmsgi-planner-draft-text';
const PLANNER_DRAFT_UPDATED_AT_KEY = 'xmsgi-planner-draft-updated-at';
const PLANNER_DRAFT_ENTITIES_KEY = 'xmsgi-planner-draft-entities';
const PLANNER_DRAFT_ATTACHMENTS_KEY = 'xmsgi-planner-draft-attachments';
const PLANNER_DRAFT_SNAPSHOT_KEY = 'xmsgi-planner-draft-snapshot-v1';
const ACTIVE_DRAFT_ID = 'quick-planner:active';
export const SAVED_PLANNER_DRAFT_STORAGE_KEY = 'xmsgi-quick-planner-saved-draft';
const PLANNER_DRAFT_WRITE_DELAY_MS = 180;
let plannerDraftWriteTimer: number | null = null;
let pendingPlannerDraftSnapshot: PlannerDraftSnapshot | null = null;
let failedPlannerDraftSnapshot: PlannerDraftSnapshot | null = null;

type PlannerDraftSnapshot = {
  message: string;
  updatedAt: string;
  entities: RichTextEntity[];
  attachments: string[];
};

function readPlannerDraftSnapshot(): PlannerDraftSnapshot | null {
  try {
    const raw = window.localStorage.getItem(PLANNER_DRAFT_SNAPSHOT_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<PlannerDraftSnapshot> | null;
    if (!value || typeof value.message !== 'string') return null;
    return {
      message: value.message,
      updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : '',
      entities: Array.isArray(value.entities) ? value.entities : [],
      attachments: Array.isArray(value.attachments)
        ? value.attachments.filter((path): path is string => typeof path === 'string')
        : [],
    };
  } catch {
    return null;
  }
}

function clearLegacyPlannerDraft() {
  for (const key of [PLANNER_DRAFT_STORAGE_KEY, PLANNER_DRAFT_UPDATED_AT_KEY, PLANNER_DRAFT_ENTITIES_KEY, PLANNER_DRAFT_ATTACHMENTS_KEY]) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      return;
    }
  }
}

export function readPlannerDraft() {
  const pendingSnapshot = pendingPlannerDraftSnapshot;
  if (pendingSnapshot) return pendingSnapshot.message;

  const snapshot = getCommittedPlannerSnapshot();
  if (snapshot) return snapshot.message;

  try {
    return window.localStorage.getItem(PLANNER_DRAFT_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function readPlannerDraftEntities(): RichTextEntity[] {
  const pendingSnapshot = pendingPlannerDraftSnapshot;
  if (pendingSnapshot) return normalizeRichTextEntities(pendingSnapshot.entities, pendingSnapshot.message.length);

  const snapshot = getCommittedPlannerSnapshot();
  if (snapshot) return normalizeRichTextEntities(snapshot.entities, snapshot.message.length);

  try {
    const value = JSON.parse(window.localStorage.getItem(PLANNER_DRAFT_ENTITIES_KEY) || '[]');
    return normalizeRichTextEntities(value, readPlannerDraft().length);
  } catch {
    return [];
  }
}

export function readPlannerDraftAttachments(): string[] {
  const pendingSnapshot = pendingPlannerDraftSnapshot;
  if (pendingSnapshot) return pendingSnapshot.attachments;

  const snapshot = getCommittedPlannerSnapshot();
  if (snapshot) return snapshot.attachments;

  try {
    const value = JSON.parse(window.localStorage.getItem(PLANNER_DRAFT_ATTACHMENTS_KEY) || '[]');
    return Array.isArray(value) ? value.filter((path): path is string => typeof path === 'string') : [];
  } catch {
    return [];
  }
}

export function writePlannerDraft(message: string, entities: RichTextEntity[] = [], attachments: string[] = []) {
  const snapshot = {
    message,
    updatedAt: message || attachments.length ? new Date().toISOString() : '',
    entities: [...entities],
    attachments: [...attachments],
  } satisfies PlannerDraftSnapshot;

  pendingPlannerDraftSnapshot = snapshot;
  failedPlannerDraftSnapshot = null;

  if (plannerDraftWriteTimer !== null) {
    window.clearTimeout(plannerDraftWriteTimer);
  }

  plannerDraftWriteTimer = window.setTimeout(() => {
    plannerDraftWriteTimer = null;
    if (pendingPlannerDraftSnapshot !== snapshot) return;
    const persisted = persistPlannerDraftSnapshot(snapshot);
    failedPlannerDraftSnapshot = persisted ? null : snapshot;
    pendingPlannerDraftSnapshot = persisted ? null : getCommittedPlannerSnapshot();
  }, PLANNER_DRAFT_WRITE_DELAY_MS);
}

export function flushPlannerDraftWrite(): boolean {
  if (plannerDraftWriteTimer !== null) {
    window.clearTimeout(plannerDraftWriteTimer);
    plannerDraftWriteTimer = null;
  }

  const pendingSnapshot = failedPlannerDraftSnapshot ?? pendingPlannerDraftSnapshot;
  if (!pendingSnapshot) return true;

  const persisted = persistPlannerDraftSnapshot(pendingSnapshot);
  failedPlannerDraftSnapshot = persisted ? null : pendingSnapshot;
  pendingPlannerDraftSnapshot = persisted ? null : getCommittedPlannerSnapshot();
  return persisted;
}

export function readSavedPlannerDraft(): SavedPlannerDraft | null {
  const stored = load<unknown>(SAVED_PLANNER_DRAFT_STORAGE_KEY, null);
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return null;

  const value = stored as Partial<SavedPlannerDraft>;
  if (typeof value.message !== 'string' || !Array.isArray(value.attachments)) return null;
  const reminderTypes: PlannerReminderType[] = ['task', 'meeting', 'reminder', 'event', 'idea'];
  const selectedChat = normalizeDraftChat(value.selectedChat);

  return {
    id: typeof value.id === 'string' ? value.id : 'legacy-draft',
    message: value.message,
    attachments: value.attachments.filter((attachment): attachment is string => typeof attachment === 'string'),
    entities: normalizeRichTextEntities(value.entities, value.message.length),
    ...(selectedChat ? { selectedChat } : {}),
    reminderType: reminderTypes.includes(value.reminderType as PlannerReminderType)
      ? value.reminderType as PlannerReminderType
      : null,
    savedAt: typeof value.savedAt === 'string' ? value.savedAt : '',
    pinned: value.pinned === true,
  };
}

export function readSavedPlannerDrafts(): SavedPlannerDraft[] {
  const stored = load<unknown>(SAVED_PLANNER_DRAFT_STORAGE_KEY, null);
  const values = Array.isArray(stored) ? stored : stored ? [stored] : [];
  const reminderTypes: PlannerReminderType[] = ['task', 'meeting', 'reminder', 'event', 'idea'];

  return values.flatMap((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const value = item as Partial<SavedPlannerDraft>;
    if (typeof value.message !== 'string' || !Array.isArray(value.attachments)) return [];
    const selectedChat = normalizeDraftChat(value.selectedChat);

    return [{
      id: typeof value.id === 'string' && value.id
        ? value.id
        : `legacy-draft-${index}`,
      message: value.message,
      attachments: value.attachments.filter((attachment): attachment is string => typeof attachment === 'string'),
      entities: normalizeRichTextEntities(value.entities, value.message.length),
      ...(selectedChat ? { selectedChat } : {}),
      reminderType: reminderTypes.includes(value.reminderType as PlannerReminderType)
        ? value.reminderType as PlannerReminderType
        : null,
      savedAt: typeof value.savedAt === 'string' ? value.savedAt : '',
      pinned: value.pinned === true,
    }];
  });
}

export function writeSavedPlannerDraft(draft: SavedPlannerDraft) {
  const wasSaved = save(SAVED_PLANNER_DRAFT_STORAGE_KEY, draft);
  if (wasSaved && typeof window !== 'undefined') {
    window.dispatchEvent(new Event(SAVED_PLANNER_DRAFTS_UPDATED_EVENT));
  }
  return wasSaved;
}

export function readActiveDraftRecord(): DraftRecord | null {
  const message = readPlannerDraft();
  const entities = readPlannerDraftEntities();
  const attachments = readPlannerDraftAttachments();
  if (!message.trim() && attachments.length === 0) return null;

  return createDraftRecord({
    id: 'quick-planner:active',
    message,
    entities: normalizeDraftEntities(entities),
    attachments: normalizeDraftAttachments(attachments),
    selectedChatId: null,
    updatedAt: readPlannerDraftUpdatedAt() || new Date().toISOString(),
  });
}

export function writeActiveDraftRecord(record: DraftRecord): boolean {
  writePlannerDraft(record.message, record.entities as RichTextEntity[], record.attachments.map((attachment) => attachment.path));
  return true;
}

export function readSavedDraftRecords(): DraftRecord[] {
  return readSavedPlannerDrafts().map((draft) => createDraftRecord({
    id: draft.id,
    message: draft.message,
    entities: normalizeDraftEntities(draft.entities),
    attachments: normalizeDraftAttachments(draft.attachments),
    selectedChatId: null,
    updatedAt: draft.savedAt || new Date().toISOString(),
  }));
}

export function writeSavedPlannerDrafts(drafts: SavedPlannerDraft[]) {
  const wasSaved = save(SAVED_PLANNER_DRAFT_STORAGE_KEY, drafts);
  if (wasSaved && typeof window !== 'undefined') {
    window.dispatchEvent(new Event(SAVED_PLANNER_DRAFTS_UPDATED_EVENT));
  }
  return wasSaved;
}

export function readPlannerDraftUpdatedAt() {
  const pendingSnapshot = pendingPlannerDraftSnapshot;
  if (pendingSnapshot) return pendingSnapshot.updatedAt;

  const snapshot = getCommittedPlannerSnapshot();
  if (snapshot) return snapshot.updatedAt;

  try {
    return window.localStorage.getItem(PLANNER_DRAFT_UPDATED_AT_KEY) ?? '';
  } catch {
    return '';
  }
}

function readLegacyPlannerDraftSnapshot(): PlannerDraftSnapshot | null {
  try {
    const message = window.localStorage.getItem(PLANNER_DRAFT_STORAGE_KEY);
    if (message === null) return null;
    return {
      message,
      updatedAt: window.localStorage.getItem(PLANNER_DRAFT_UPDATED_AT_KEY) ?? '',
      entities: JSON.parse(window.localStorage.getItem(PLANNER_DRAFT_ENTITIES_KEY) || '[]'),
      attachments: JSON.parse(window.localStorage.getItem(PLANNER_DRAFT_ATTACHMENTS_KEY) || '[]'),
    };
  } catch {
    return null;
  }
}

function getCommittedPlannerSnapshot(): PlannerDraftSnapshot | null {
  const activeState = readActiveDraftState();
  if (activeState.available && activeState.exists) {
    const draft = activeState.draft;
    return {
      message: draft?.message ?? '',
      updatedAt: draft?.updatedAt ?? '',
      entities: (draft?.entities ?? []) as RichTextEntity[],
      attachments: (draft?.attachments ?? []).map((attachment) => attachment.path),
    };
  }

  return readPlannerDraftSnapshot() ?? readLegacyPlannerDraftSnapshot();
}

function persistPlannerDraftSnapshot(snapshot: PlannerDraftSnapshot): boolean {
  let storage: Storage;
  let previousSnapshotRaw: string | null;
  try {
    storage = window.localStorage;
    previousSnapshotRaw = storage.getItem(PLANNER_DRAFT_SNAPSHOT_KEY);
  } catch {
    return false;
  }

  const activeState = readActiveDraftState();
  if (!activeState.available) return false;

  const previousSnapshot = getCommittedPlannerSnapshot();
  const previousDraft = activeState.exists
    ? activeState.draft
    : createActiveDraftSnapshot({
        message: previousSnapshot?.message ?? '',
        updatedAt: previousSnapshot?.updatedAt,
        entities: previousSnapshot?.entities,
        attachments: previousSnapshot?.attachments,
        id: ACTIVE_DRAFT_ID,
      });

  if (!activeState.exists && !writeActiveDraft(previousDraft)) return false;

  try {
    storage.setItem(PLANNER_DRAFT_SNAPSHOT_KEY, JSON.stringify(snapshot));
  } catch {
    return false;
  }

  const nextDraft = createActiveDraftSnapshot({
    message: snapshot.message,
    entities: snapshot.entities,
    attachments: snapshot.attachments.map((path) => ({ name: path.split(/[\\/]/).pop() || path, path })),
    selectedChatId: null,
    id: ACTIVE_DRAFT_ID,
    updatedAt: snapshot.updatedAt,
  });

  if (!writeActiveDraft(nextDraft)) {
    try {
      if (previousSnapshotRaw === null) storage.removeItem(PLANNER_DRAFT_SNAPSHOT_KEY);
      else storage.setItem(PLANNER_DRAFT_SNAPSHOT_KEY, previousSnapshotRaw);
    } catch {
      // The canonical active draft still contains the previous committed value.
    }
    return false;
  }

  clearLegacyPlannerDraft();
  return true;
}