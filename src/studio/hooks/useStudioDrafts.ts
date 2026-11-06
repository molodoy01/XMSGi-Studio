import { useEffect, useRef, useState } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { Chat, PersistedDraftStore, SavedDraft, ScheduledMessage } from '@studio/types';
import type { DraftAttachment } from '@studio/domain/types';
import { normalizeAttachments } from '@studio/lib/draftAttachments';
import { DRAFT_STORE_SCHEMA_VERSION } from '@studio/lib/draftStoreVersion';
import {
  getDraftStorageApi,
  hasDraftContent,
  isBrowserRuntimeFallback,
  LEGACY_WORKSPACE_DRAFT_KEY,
  markDefaultDraftSeeded,
  readWorkspaceDraftStoreFallback,
  SAVED_STUDIO_DRAFTS_UPDATED_EVENT,
  seedDefaultDraft,
  WORKSPACE_DRAFT_KEY,
  writeWorkspaceDraftStoreFallback,
} from '@studio/lib/draftStore';
import type { WorkspaceDraft } from '@studio/lib/draftStore';
import { useLocale } from '@studio/lib/i18n';
import { loadSavedDrafts } from '@studio/lib/storage';
import type { ScheduleRepeatOptions } from '@studio/lib/scheduling';
import {
  appendWorkspaceDocumentVersion,
  areWorkspaceSnapshotsEqual,
  hasWorkspaceDocumentContent,
} from '@studio/lib/documentHistory';
import { normalizeWorkspaceDocumentHistories } from '@studio/lib/documentHistory';
import type { PersistedWorkspaceDocumentHistories, PersistedWorkspaceDocumentVersion } from '@shared/types';

type WorkspaceDraftState = {
  documentId: string;
  body: string;
  entities: WorkspaceDraft['entities'];
  attachments: DraftAttachment[];
  selectedChat: Chat | null;
  date: string;
  time: string;
  repeatMode: ScheduleRepeatOptions['mode'];
  repeatDays: string[];
  repeatOccurrences: number;
};

type WorkspaceDraftLifecycleOptions = {
  initialWorkspaceDraftRef: MutableRefObject<Partial<WorkspaceDraft> | null>;
  initialWorkspaceDraftError?: string;
  workspace: WorkspaceDraftState;
  chats: Chat[];
  setSelectedChat: Dispatch<SetStateAction<Chat | null>>;
  preserveSelectedChat?: boolean;
  setDate: Dispatch<SetStateAction<string>>;
  setTime: Dispatch<SetStateAction<string>>;
  rescheduleSourceRef: MutableRefObject<ScheduledMessage | null>;
  onWorkspaceDraftLoaded: (draft: Partial<WorkspaceDraft> | null) => void;
};

function useSavedDraftCollection() {
  const { t } = useLocale();
  const [savedDrafts, setSavedDrafts] = useState<SavedDraft[]>([]);
  const savedDraftsRef = useRef(savedDrafts);
  const [draftStoreReady, setDraftStoreReady] = useState(false);
  const [draftStoreSaving, setDraftStoreSaving] = useState(false);
  const [draftStoreError, setDraftStoreError] = useState('');
  const [draftStoreBackups, setDraftStoreBackups] = useState<number[]>([]);
  const [documentHistories, setDocumentHistories] = useState<PersistedWorkspaceDocumentHistories>({});
  const documentHistoriesRef = useRef(documentHistories);
  const draftStoreQueueRef = useRef<Promise<void>>(Promise.resolve());
  const draftStorePendingRef = useRef(0);

  const replaceSavedDrafts = (nextDrafts: SavedDraft[]) => {
    savedDraftsRef.current = nextDrafts;
    setSavedDrafts(nextDrafts);
  };

  const replaceDocumentHistories = (nextHistories: PersistedWorkspaceDocumentHistories) => {
    documentHistoriesRef.current = nextHistories;
    setDocumentHistories(nextHistories);
  };

  const persistDraftStore = (
    getSavedDrafts: SavedDraft[] | (() => SavedDraft[]),
    workspaceDraft: WorkspaceDraft | null,
    onPersisted?: (documentHistories: PersistedWorkspaceDocumentHistories) => void,
    getDocumentHistories: PersistedWorkspaceDocumentHistories | (() => PersistedWorkspaceDocumentHistories) = () => documentHistoriesRef.current,
  ) => {
    draftStorePendingRef.current += 1;
    setDraftStoreSaving(true);
    const operation = draftStoreQueueRef.current.then(async () => {
      const nextDocumentHistories = typeof getDocumentHistories === 'function'
        ? getDocumentHistories()
        : getDocumentHistories;
      const nextSavedDrafts = typeof getSavedDrafts === 'function' ? getSavedDrafts() : getSavedDrafts;
      const savedDraftsChanged = JSON.stringify(savedDraftsRef.current) !== JSON.stringify(nextSavedDrafts);
      const data: PersistedDraftStore = {
        schemaVersion: DRAFT_STORE_SCHEMA_VERSION,
        migrationVersion: 1,
        savedDrafts: nextSavedDrafts,
        workspaceDraft,
        documentHistories: nextDocumentHistories,
      };

      const draftStorage = getDraftStorageApi();
      if (!draftStorage) {
        const fallbackSaved = writeWorkspaceDraftStoreFallback(data);
        if (!fallbackSaved) {
          setDraftStoreError(t('studio.draftsCouldNotSave'));
          draftStorePendingRef.current -= 1;
          setDraftStoreSaving(draftStorePendingRef.current > 0);
          return false;
        }
        setDraftStoreError('');
        setDraftStoreBackups([]);
        onPersisted?.(data.documentHistories ?? {});
        if (savedDraftsChanged) window.dispatchEvent(new Event(SAVED_STUDIO_DRAFTS_UPDATED_EVENT));
        draftStorePendingRef.current -= 1;
        setDraftStoreSaving(draftStorePendingRef.current > 0);
        return true;
      }

      try {
        const result = await draftStorage.save(data);
        if (!result.success) {
          setDraftStoreError(result.error || t('studio.draftsCouldNotSave'));
          setDraftStoreBackups(result.backupIndexes ?? []);
          return false;
        }
        setDraftStoreError('');
        setDraftStoreBackups([]);
        onPersisted?.(data.documentHistories ?? {});
        if (savedDraftsChanged) window.dispatchEvent(new Event(SAVED_STUDIO_DRAFTS_UPDATED_EVENT));
        return true;
      } catch (error) {
        setDraftStoreError(error instanceof Error ? error.message : 'Drafts could not be saved.');
        return false;
      } finally {
        draftStorePendingRef.current -= 1;
        setDraftStoreSaving(draftStorePendingRef.current > 0);
      }
    });
    draftStoreQueueRef.current = operation.then(() => undefined, () => undefined);
    return operation;
  };

  return {
    savedDrafts,
    savedDraftsRef,
    replaceSavedDrafts,
    documentHistories,
    documentHistoriesRef,
    replaceDocumentHistories,
    draftStoreReady,
    setDraftStoreReady,
    draftStoreSaving,
    draftStoreError,
    setDraftStoreError,
    draftStoreBackups,
    setDraftStoreBackups,
    persistDraftStore,
  };
}

export function useStudioDrafts(options: WorkspaceDraftLifecycleOptions) {
  const drafts = useSavedDraftCollection();
  const { t } = useLocale();
  const optionsRef = useRef(options);
  const translateRef = useRef(t);
  const autosaveTimeoutRef = useRef<number | null>(null);
  const lastPersistedWorkspaceSnapshotRef = useRef<WorkspaceDraft | null>(null);
  const editHistoryCheckpointedDocumentsRef = useRef(new Set<string>());
  const activeEditDocumentIdRef = useRef('');
  const [savedAt, setSavedAt] = useState(options.initialWorkspaceDraftRef.current?.savedAt ?? '');
  const [draftStateHydrated, setDraftStateHydrated] = useState(false);
  optionsRef.current = options;
  translateRef.current = t;

  const createWorkspaceDraftSnapshot = () => {
    const workspace = optionsRef.current.workspace;
    if (!hasDraftContent(workspace.body, workspace.attachments)) return null;
    return {
      ...workspace,
      attachments: workspace.attachments
        .filter((attachment) => attachment.path)
        .map((attachment) => {
          const persistedAttachment = { ...attachment };
          delete persistedAttachment.previewUrl;
          return persistedAttachment;
        }),
      savedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    } satisfies WorkspaceDraft;
  };

  const persistableWorkspaceSnapshot = (snapshot: WorkspaceDraft | null) => {
    if (!snapshot) return null;
    return {
      ...snapshot,
      attachments: snapshot.attachments.map((attachment) => ({ ...attachment })),
      entities: snapshot.entities ? [...snapshot.entities] : [],
      repeatDays: snapshot.repeatDays ? [...snapshot.repeatDays] : [],
      selectedChat: snapshot.selectedChat ? { ...snapshot.selectedChat } : null,
    } satisfies WorkspaceDraft;
  };

  const applyPersistedDraftStore = (store: PersistedDraftStore) => {
    drafts.replaceSavedDrafts(store.savedDrafts);
    drafts.replaceDocumentHistories(normalizeWorkspaceDocumentHistories(store.documentHistories));
    const workspaceDraft = store.workspaceDraft as Partial<WorkspaceDraft> | null;
    optionsRef.current.initialWorkspaceDraftRef.current = workspaceDraft ?? {};
    setSavedAt(workspaceDraft?.savedAt ?? '');
    optionsRef.current.onWorkspaceDraftLoaded(workspaceDraft);
    const appliedWorkspace = optionsRef.current.initialWorkspaceDraftRef.current;
    lastPersistedWorkspaceSnapshotRef.current = workspaceDraft
      && typeof appliedWorkspace?.body === 'string'
      && Array.isArray(appliedWorkspace.attachments)
      && hasWorkspaceDocumentContent(appliedWorkspace as WorkspaceDraft)
      ? {
          ...appliedWorkspace,
          documentId: appliedWorkspace.documentId ?? workspaceDraft.documentId,
          body: appliedWorkspace.body,
          entities: appliedWorkspace.entities ?? [],
          attachments: normalizeAttachments(appliedWorkspace.attachments),
          selectedChat: appliedWorkspace.selectedChat ?? null,
          savedAt: workspaceDraft.savedAt ?? '',
          date: appliedWorkspace.date ?? '',
          time: appliedWorkspace.time ?? '',
          repeatMode: appliedWorkspace.repeatMode ?? 'none',
          repeatDays: appliedWorkspace.repeatDays ?? [],
          repeatOccurrences: appliedWorkspace.repeatOccurrences ?? 1,
        }
      : null;
    drafts.setDraftStoreBackups([]);
    drafts.setDraftStoreError('');
    drafts.setDraftStoreReady(true);
  };

  const cancelPendingAutosave = () => {
    if (autosaveTimeoutRef.current === null) return;
    window.clearTimeout(autosaveTimeoutRef.current);
    autosaveTimeoutRef.current = null;
  };

  const flushWorkspaceDraftNow = async () => {
    if (!drafts.draftStoreReady || !draftStateHydrated) {
      return { success: false, error: t('studio.waitForDrafts') };
    }

    cancelPendingAutosave();
    const workspaceDraft = createWorkspaceDraftSnapshot();
    if (workspaceDraft) setSavedAt(workspaceDraft.savedAt);
    const previousSnapshot = lastPersistedWorkspaceSnapshotRef.current;
    const documentId = workspaceDraft?.documentId ?? '';
    if (activeEditDocumentIdRef.current !== documentId) {
      if (documentId) editHistoryCheckpointedDocumentsRef.current.delete(documentId);
      activeEditDocumentIdRef.current = documentId;
    }
    const shouldCheckpointEdit = Boolean(
      previousSnapshot
      && !areWorkspaceSnapshotsEqual(previousSnapshot, workspaceDraft)
      && previousSnapshot.documentId
      && !editHistoryCheckpointedDocumentsRef.current.has(previousSnapshot.documentId),
    );
    let nextSnapshot = previousSnapshot;
    if (shouldCheckpointEdit && previousSnapshot) {
      const archived = await makeHistorySnapshot(previousSnapshot, false);
      nextSnapshot = archived.snapshot ?? previousSnapshot;
      if (archived.error) drafts.setDraftStoreError(archived.error);
    }

    const success = await drafts.persistDraftStore(
      () => drafts.savedDraftsRef.current,
      workspaceDraft,
      (histories) => {
        if (histories !== drafts.documentHistoriesRef.current) drafts.replaceDocumentHistories(histories);
        lastPersistedWorkspaceSnapshotRef.current = workspaceDraft ? persistableWorkspaceSnapshot(workspaceDraft) : null;
        if (shouldCheckpointEdit && previousSnapshot?.documentId) {
          editHistoryCheckpointedDocumentsRef.current.add(previousSnapshot.documentId);
        }
      },
      () => shouldCheckpointEdit && previousSnapshot && nextSnapshot
        ? appendWorkspaceDocumentVersion(
            drafts.documentHistoriesRef.current,
            previousSnapshot.documentId ?? workspaceDraft?.documentId ?? '',
            nextSnapshot,
            'edit',
          )
        : drafts.documentHistoriesRef.current,
    );
    if (!success) {
      return { success: false, error: drafts.draftStoreError || t('studio.draftsCouldNotSave') };
    }

    return { success: true, error: '' };
  };

  const makeHistorySnapshot = async (snapshot: WorkspaceDraft, strict: boolean) => {
    if (!snapshot.attachments.length) return { snapshot, error: '' };
    const storage = getDraftStorageApi();
    const attachments: DraftAttachment[] = [];
    let error = '';

    for (const attachment of snapshot.attachments) {
      if (!attachment.path || attachment.unavailable) {
        error ||= t('studio.historyAttachmentUnavailable', { name: attachment.name });
        if (strict) return { snapshot: null, error };
        attachments.push({ ...attachment, path: '', sourcePath: attachment.sourcePath || undefined, unavailable: true });
        continue;
      }

      if (attachment.path.startsWith('data:')) {
        error ||= t('studio.historyAttachmentCopyFailed', { name: attachment.name });
        if (strict) return { snapshot: null, error };
        attachments.push({ ...attachment, path: '', sourcePath: undefined, previewUrl: undefined, unavailable: true });
        continue;
      }

      if (!storage?.copyAttachmentPath) {
        error ||= t('studio.historyAttachmentUnavailable', { name: attachment.name });
        if (strict) return { snapshot: null, error };
        attachments.push({ ...attachment, path: '', sourcePath: attachment.sourcePath || attachment.path, unavailable: true });
        continue;
      }

      try {
        const result = await storage.copyAttachmentPath(attachment.path);
        if (!result.success || !result.attachment) {
          error ||= t('studio.historyAttachmentCopyFailed', { name: attachment.name });
          if (strict) return { snapshot: null, error };
          attachments.push({ ...attachment, path: '', sourcePath: attachment.sourcePath || attachment.path, unavailable: true });
          continue;
        }
        attachments.push({
          ...attachment,
          name: attachment.name || result.attachment.name,
          path: result.attachment.path,
          sourcePath: attachment.sourcePath ?? attachment.path,
          size: result.attachment.size,
          unavailable: undefined,
        });
      } catch {
        error ||= t('studio.historyAttachmentCopyFailed', { name: attachment.name });
        if (strict) return { snapshot: null, error };
        attachments.push({ ...attachment, path: '', sourcePath: attachment.sourcePath || attachment.path, unavailable: true });
      }
    }

    return { snapshot: { ...snapshot, attachments }, error };
  };

  const prepareWorkspaceVersionSnapshot = (snapshot: WorkspaceDraft) => makeHistorySnapshot(snapshot, true);

  const recordWorkspaceVersion = async (
    snapshot: WorkspaceDraft | null,
    reason: PersistedWorkspaceDocumentVersion['reason'],
    requireAvailableAttachments = true,
  ) => {
    if (!hasWorkspaceDocumentContent(snapshot)) return { success: true, snapshot, error: '' };
    const archived = await makeHistorySnapshot(snapshot, requireAvailableAttachments);
    if (!archived.snapshot) {
      drafts.setDraftStoreError(archived.error);
      return { success: false, snapshot: null, error: archived.error };
    }

    const documentId = archived.snapshot.documentId;
    if (!documentId) {
      const error = t('studio.historyCouldNotSave');
      drafts.setDraftStoreError(error);
      return { success: false, snapshot: null, error };
    }

    let persistedHistories = drafts.documentHistoriesRef.current;
    const workspaceDraft = createWorkspaceDraftSnapshot();
    const persisted = await drafts.persistDraftStore(
      () => drafts.savedDraftsRef.current,
      workspaceDraft,
      (histories) => {
        persistedHistories = histories;
        drafts.replaceDocumentHistories(histories);
      },
      () => appendWorkspaceDocumentVersion(
        drafts.documentHistoriesRef.current,
        documentId,
        archived.snapshot!,
        reason,
      ),
    );
    if (!persisted) return { success: false, snapshot: null, error: drafts.draftStoreError };
    return { success: true, snapshot: archived.snapshot, error: '', documentHistories: persistedHistories };
  };

  useEffect(() => {
    let cancelled = false;

    const initializeDraftStore = async () => {
      const draftStorage = getDraftStorageApi();
      if (!draftStorage) {
        let fallbackStore: PersistedDraftStore | null;
        try {
          fallbackStore = readWorkspaceDraftStoreFallback();
        } catch (error) {
          drafts.setDraftStoreError(error instanceof Error ? error.message : translateRef.current('studio.draftsCouldNotLoad'));
          return;
        }
        if (fallbackStore) {
          const seeded = seedDefaultDraft(fallbackStore);
          if (seeded.added) {
            if (!writeWorkspaceDraftStoreFallback(seeded.store)) {
              drafts.setDraftStoreError(translateRef.current('studio.defaultDraftCouldNotSave'));
              return;
            }
            markDefaultDraftSeeded();
          }
          applyPersistedDraftStore(seeded.store);
          return;
        }

        if (isBrowserRuntimeFallback()) {
          if (optionsRef.current.initialWorkspaceDraftError) {
            drafts.setDraftStoreError(optionsRef.current.initialWorkspaceDraftError);
            return;
          }
          let legacySavedDrafts: SavedDraft[];
          try {
            legacySavedDrafts = loadSavedDrafts();
          } catch (error) {
            drafts.setDraftStoreError(error instanceof Error ? error.message : translateRef.current('studio.draftsCouldNotLoad'));
            return;
          }
          const initialWorkspaceDraft = optionsRef.current.initialWorkspaceDraftRef.current;
          const emptyStore: PersistedDraftStore = {
            schemaVersion: DRAFT_STORE_SCHEMA_VERSION,
            migrationVersion: 1,
            savedDrafts: legacySavedDrafts,
            workspaceDraft: initialWorkspaceDraft && (
              typeof initialWorkspaceDraft.body === 'string'
              || Boolean(initialWorkspaceDraft.attachments?.length)
            ) ? initialWorkspaceDraft as Record<string, unknown> : null,
            documentHistories: {},
          };
          const seeded = seedDefaultDraft(emptyStore);
          if (!writeWorkspaceDraftStoreFallback(seeded.store)) {
            drafts.setDraftStoreError(translateRef.current('studio.draftsCouldNotSave'));
            return;
          }
          if (seeded.added) markDefaultDraftSeeded();
          applyPersistedDraftStore(seeded.store);
          return;
        }

        drafts.setDraftStoreError('Saved drafts are unavailable in this runtime.');
        return;
      }

      try {
        const result = await draftStorage.load();
        if (!result.success) {
          const backups = result.backupIndexes ?? [];
          drafts.setDraftStoreBackups(backups);
          drafts.setDraftStoreError(result.error || translateRef.current('studio.draftsCouldNotLoad'));
          return;
        }
        if (!result.success || !result.store) throw new Error(result.error || translateRef.current('studio.draftsCouldNotLoad'));

        let store = result.store;
        if (result.needsMigration || store.migrationVersion < 1) {
          const migrated = await draftStorage.migrate({
            savedDrafts: loadSavedDrafts(),
            workspaceDraft: optionsRef.current.initialWorkspaceDraftRef.current as Record<string, unknown> | null,
          });
          if (!migrated.success || !migrated.store) {
            throw new Error(migrated.error || translateRef.current('studio.draftsMigrationFailed'));
          }
          store = migrated.store;
        }

        const seeded = seedDefaultDraft(store);
        store = seeded.store;
        if (seeded.added) {
          const saved = await draftStorage.save(store);
          if (saved.success) {
            store = saved.store ?? store;
            markDefaultDraftSeeded();
          } else {
            drafts.setDraftStoreError(saved.error || translateRef.current('studio.defaultDraftCouldNotSave'));
          }
        }

        if (cancelled) return;
        window.localStorage.removeItem('xmsgi_saved_drafts');
        window.localStorage.removeItem(WORKSPACE_DRAFT_KEY);
        window.localStorage.removeItem(LEGACY_WORKSPACE_DRAFT_KEY);
        if (!writeWorkspaceDraftStoreFallback(store)) {
          drafts.setDraftStoreError(translateRef.current('studio.draftsCouldNotSave'));
        }
        applyPersistedDraftStore(store);
      } catch (error) {
        if (!cancelled) {
          drafts.setDraftStoreError(error instanceof Error ? error.message : 'Saved drafts could not be loaded.');
        }
      }
    };

    void initializeDraftStore();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!drafts.draftStoreReady || draftStateHydrated) return;
    const currentOptions = optionsRef.current;
    const savedDraft = currentOptions.initialWorkspaceDraftRef.current;
    if (!currentOptions.preserveSelectedChat
      && !currentOptions.rescheduleSourceRef.current
      && savedDraft?.selectedChat
      && currentOptions.chats.some((chat) => chat.id === savedDraft.selectedChat?.id)) {
      currentOptions.setSelectedChat(savedDraft.selectedChat);
    }
    setDraftStateHydrated(true);
  }, [drafts.draftStoreReady, draftStateHydrated, options.chats, options.setSelectedChat]);

  useEffect(() => {
    if (!drafts.draftStoreReady || !draftStateHydrated) return undefined;
    cancelPendingAutosave();
    autosaveTimeoutRef.current = window.setTimeout(() => {
      void (async () => {
        const workspaceDraft = createWorkspaceDraftSnapshot();
        if (workspaceDraft) setSavedAt(workspaceDraft.savedAt);
        const previousSnapshot = lastPersistedWorkspaceSnapshotRef.current;
        const documentId = workspaceDraft?.documentId ?? '';
        if (activeEditDocumentIdRef.current !== documentId) {
          if (documentId) editHistoryCheckpointedDocumentsRef.current.delete(documentId);
          activeEditDocumentIdRef.current = documentId;
        }
        const shouldCheckpointEdit = Boolean(
          previousSnapshot
          && !areWorkspaceSnapshotsEqual(previousSnapshot, workspaceDraft)
          && previousSnapshot.documentId
          && !editHistoryCheckpointedDocumentsRef.current.has(previousSnapshot.documentId),
        );
        let nextSnapshot = previousSnapshot;
        let historyError = '';
        if (shouldCheckpointEdit && previousSnapshot) {
          const archived = await makeHistorySnapshot(previousSnapshot, false);
          nextSnapshot = archived.snapshot ?? previousSnapshot;
          historyError = archived.error;
        }
        if (historyError) drafts.setDraftStoreError(historyError);

        await drafts.persistDraftStore(
          () => drafts.savedDraftsRef.current,
          workspaceDraft,
          (histories) => {
            if (histories !== drafts.documentHistoriesRef.current) drafts.replaceDocumentHistories(histories);
            lastPersistedWorkspaceSnapshotRef.current = workspaceDraft ? persistableWorkspaceSnapshot(workspaceDraft) : null;
            if (shouldCheckpointEdit && previousSnapshot?.documentId) {
              editHistoryCheckpointedDocumentsRef.current.add(previousSnapshot.documentId);
            }
          },
          () => shouldCheckpointEdit && previousSnapshot && nextSnapshot
            ? appendWorkspaceDocumentVersion(
                drafts.documentHistoriesRef.current,
                previousSnapshot.documentId ?? workspaceDraft?.documentId ?? '',
                nextSnapshot,
                'edit',
              )
            : drafts.documentHistoriesRef.current,
        );
      })();
    }, 350);
    return cancelPendingAutosave;
  }, [
    draftStateHydrated,
    drafts.draftStoreReady,
    options.workspace.attachments,
    options.workspace.body,
    options.workspace.date,
    options.workspace.entities,
    options.workspace.repeatDays,
    options.workspace.repeatMode,
    options.workspace.repeatOccurrences,
    options.workspace.selectedChat,
    options.workspace.time,
  ]);

  useEffect(() => {
    if (!drafts.draftStoreReady || !draftStateHydrated) return;
    const flushDraftOnClose = (event: BeforeUnloadEvent) => {
      const data: PersistedDraftStore = {
        schemaVersion: DRAFT_STORE_SCHEMA_VERSION,
        migrationVersion: 1,
        savedDrafts: drafts.savedDraftsRef.current,
        workspaceDraft: createWorkspaceDraftSnapshot(),
        documentHistories: drafts.documentHistoriesRef.current,
      };
      const draftStorage = getDraftStorageApi();
      if (!draftStorage) {
        let errorMessage: string;
        try {
          if (writeWorkspaceDraftStoreFallback(data)) return;
          errorMessage = translateRef.current('studio.latestDraftCouldNotSave');
        } catch (error) {
          errorMessage = error instanceof Error
            ? error.message
            : translateRef.current('studio.latestDraftCouldNotSave');
        }
        event.preventDefault();
        event.returnValue = 'Draft data could not be saved. Keep this page open and retry.';
        drafts.setDraftStoreError(errorMessage);
        return;
      }

      try {
        const result = draftStorage.flush(data);
        if (result.success) return;
        event.preventDefault();
        event.returnValue = 'Draft data could not be saved. Keep this page open and retry.';
        drafts.setDraftStoreError(result.error || translateRef.current('studio.latestDraftCouldNotSave'));
      } catch (error) {
        event.preventDefault();
        event.returnValue = 'Draft data could not be saved. Keep this page open and retry.';
        drafts.setDraftStoreError(error instanceof Error ? error.message : 'The latest draft could not be saved. Keep this window open and retry.');
      }
    };
    window.addEventListener('beforeunload', flushDraftOnClose);
    return () => window.removeEventListener('beforeunload', flushDraftOnClose);
  }, [draftStateHydrated, drafts.draftStoreReady]);

  const handleRestoreDraftBackup = async (index: number) => {
    const draftStorage = getDraftStorageApi();
    if (!draftStorage) {
      try {
        const fallback = readWorkspaceDraftStoreFallback();
        if (!fallback) {
          drafts.setDraftStoreError('No saved draft backup is available for this runtime.');
          return;
        }
        applyPersistedDraftStore(fallback);
      } catch (error) {
        drafts.setDraftStoreError(error instanceof Error ? error.message : t('studio.selectedBackupCouldNotRestore'));
      }
      return;
    }

    const result = await draftStorage.restoreBackup(index);
    if (!result.success || !result.store) {
      drafts.setDraftStoreError(result.error || t('studio.selectedBackupCouldNotRestore'));
      return;
    }
    applyPersistedDraftStore(result.store);
  };

  const handleExportDrafts = async (showFeedback: (message: string, kind?: 'warning' | 'success') => void) => {
    cancelPendingAutosave();
    const workspaceDraft = createWorkspaceDraftSnapshot();
    if (workspaceDraft) setSavedAt(workspaceDraft.savedAt);
    if (!await drafts.persistDraftStore(() => drafts.savedDraftsRef.current, workspaceDraft)) return;

    const draftStorage = getDraftStorageApi();
    if (!draftStorage) {
      const saved = writeWorkspaceDraftStoreFallback({
        schemaVersion: DRAFT_STORE_SCHEMA_VERSION,
        migrationVersion: 1,
        savedDrafts: drafts.savedDraftsRef.current,
        workspaceDraft,
        documentHistories: drafts.documentHistoriesRef.current,
      });
      if (!saved) {
        drafts.setDraftStoreError(t('studio.draftsCouldNotSave'));
        return;
      }
      showFeedback(t('studio.draftStorageSaved'), 'success');
      return;
    }

    const result = await draftStorage.exportBackup();
    if (!result.success && !result.cancelled) drafts.setDraftStoreError(result.error || t('studio.backupCouldNotExport'));
    else if (result.success) {
      drafts.setDraftStoreError('');
      showFeedback(t('studio.draftExported'), 'success');
    }
  };

  const handleImportDrafts = async (showFeedback: (message: string, kind?: 'warning' | 'success') => void) => {
    const draftStorage = getDraftStorageApi();
    if (!draftStorage) {
      try {
        const fallback = readWorkspaceDraftStoreFallback();
        if (fallback) {
          applyPersistedDraftStore(fallback);
          showFeedback(t('studio.draftsRestored'), 'success');
        }
      } catch (error) {
        drafts.setDraftStoreError(error instanceof Error ? error.message : t('studio.backupCouldNotImport'));
      }
      return;
    }

    const result = await draftStorage.importBackup();
    if (!result.success) {
      if (!result.cancelled) drafts.setDraftStoreError(result.error || t('studio.backupCouldNotImport'));
      return;
    }
    if (result.store) {
      applyPersistedDraftStore(result.store);
      showFeedback(t('studio.draftsImported'), 'success');
    }
  };
  return {
    ...drafts,
    draftStateHydrated,
    savedAt,
    setSavedAt,
    createWorkspaceDraftSnapshot,
    applyPersistedDraftStore,
    cancelPendingAutosave,
    flushWorkspaceDraftNow,
    handleRestoreDraftBackup,
    handleExportDrafts,
    handleImportDrafts,
    prepareWorkspaceVersionSnapshot,
    recordWorkspaceVersion,
  };
}