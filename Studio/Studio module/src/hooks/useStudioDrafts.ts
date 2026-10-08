import { useEffect, useRef, useState } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { Chat, PersistedDraftStore, SavedDraft, ScheduledMessage } from '@/types';
import type { DraftAttachment } from '@/domain/types';
import { DRAFT_STORE_SCHEMA_VERSION } from '@/lib/draftStoreVersion';
import {
  getDraftStorageApi,
  hasDraftContent,
  isBrowserRuntimeFallback,
  LEGACY_WORKSPACE_DRAFT_KEY,
  markDefaultDraftSeeded,
  readWorkspaceDraftStoreFallback,
  seedDefaultDraft,
  WORKSPACE_DRAFT_KEY,
  writeWorkspaceDraftStoreFallback,
} from '@/lib/draftStore';
import type { WorkspaceDraft } from '@/lib/draftStore';
import { useLocale } from '@/lib/i18n';
import { loadSavedDrafts } from '@/lib/storage';
import type { InlineButtonRow } from '@/lib/inlineKeyboard';
import type { ScheduleRepeatOptions } from '@/lib/scheduling';
import { normalizeAttachments } from '@/lib/draftAttachments';
import { normalizeRichTextEntities } from '@/lib/richText';

type WorkspaceDraftState = {
  body: string;
  entities: WorkspaceDraft['entities'];
  attachments: DraftAttachment[];
  selectedChat: Chat | null;
  inlineButtons: InlineButtonRow[];
  date: string;
  time: string;
  repeatMode: ScheduleRepeatOptions['mode'];
  repeatDays: string[];
  repeatOccurrences: number;
};

type WorkspaceDraftLifecycleOptions = {
  initialWorkspaceDraftRef: MutableRefObject<Partial<WorkspaceDraft> | null>;
  workspace: WorkspaceDraftState;
  chats: Chat[];
  setSelectedChat: Dispatch<SetStateAction<Chat | null>>;
  setDate: Dispatch<SetStateAction<string>>;
  setTime: Dispatch<SetStateAction<string>>;
  rescheduleSourceRef: MutableRefObject<ScheduledMessage | null>;
  onWorkspaceDraftLoaded: (draft: Partial<WorkspaceDraft> | null) => void;
};

function useSavedDraftCollection(loadInitialDrafts: () => SavedDraft[]) {
  const { t } = useLocale();
  const [savedDrafts, setSavedDrafts] = useState(loadInitialDrafts);
  const savedDraftsRef = useRef(savedDrafts);
  const [draftStoreReady, setDraftStoreReady] = useState(false);
  const [draftStoreSaving, setDraftStoreSaving] = useState(false);
  const [draftStoreError, setDraftStoreError] = useState('');
  const [draftStoreBackups, setDraftStoreBackups] = useState<number[]>([]);
  const draftStoreQueueRef = useRef<Promise<void>>(Promise.resolve());
  const draftStorePendingRef = useRef(0);

  const replaceSavedDrafts = (nextDrafts: SavedDraft[]) => {
    savedDraftsRef.current = nextDrafts;
    setSavedDrafts(nextDrafts);
  };

  const persistDraftStore = (
    getSavedDrafts: SavedDraft[] | (() => SavedDraft[]),
    workspaceDraft: WorkspaceDraft | null,
    onPersisted?: () => void,
  ) => {
    draftStorePendingRef.current += 1;
    setDraftStoreSaving(true);
    const operation = draftStoreQueueRef.current.then(async () => {
      const data: PersistedDraftStore = {
        schemaVersion: DRAFT_STORE_SCHEMA_VERSION,
        migrationVersion: 1,
        savedDrafts: typeof getSavedDrafts === 'function' ? getSavedDrafts() : getSavedDrafts,
        workspaceDraft,
      };

      const draftStorage = getDraftStorageApi();
      if (!draftStorage) {
        writeWorkspaceDraftStoreFallback(data);
        setDraftStoreError('');
        setDraftStoreBackups([]);
        onPersisted?.();
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
        onPersisted?.();
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
  const drafts = useSavedDraftCollection(loadSavedDrafts);
  const { t } = useLocale();
  const optionsRef = useRef(options);
  const translateRef = useRef(t);
  const autosaveTimeoutRef = useRef<number | null>(null);
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
        .map(({ previewUrl: _previewUrl, ...attachment }) => attachment),
      savedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    } satisfies WorkspaceDraft;
  };

  const applyPersistedDraftStore = (store: PersistedDraftStore) => {
    drafts.replaceSavedDrafts(store.savedDrafts);
    const workspaceDraft = store.workspaceDraft as Partial<WorkspaceDraft> | null;
    optionsRef.current.initialWorkspaceDraftRef.current = workspaceDraft ?? {};
    setSavedAt(workspaceDraft?.savedAt ?? '');
    optionsRef.current.onWorkspaceDraftLoaded(workspaceDraft);
    drafts.setDraftStoreBackups([]);
    drafts.setDraftStoreError('');
    drafts.setDraftStoreReady(true);
  };

  const cancelPendingAutosave = () => {
    if (autosaveTimeoutRef.current === null) return;
    window.clearTimeout(autosaveTimeoutRef.current);
    autosaveTimeoutRef.current = null;
  };

  useEffect(() => {
    let cancelled = false;

    const initializeDraftStore = async () => {
      const draftStorage = getDraftStorageApi();
      if (!draftStorage) {
        const fallbackStore = readWorkspaceDraftStoreFallback();
        if (fallbackStore) {
          const seeded = seedDefaultDraft(fallbackStore);
          if (seeded.added) {
            writeWorkspaceDraftStoreFallback(seeded.store);
            markDefaultDraftSeeded();
          }
          applyPersistedDraftStore(seeded.store);
          return;
        }

        if (isBrowserRuntimeFallback()) {
          const emptyStore: PersistedDraftStore = {
            schemaVersion: DRAFT_STORE_SCHEMA_VERSION,
            migrationVersion: 1,
            savedDrafts: [],
            workspaceDraft: null,
          };
          const seeded = seedDefaultDraft(emptyStore);
          writeWorkspaceDraftStoreFallback(seeded.store);
          if (seeded.added) markDefaultDraftSeeded();
          applyPersistedDraftStore(seeded.store);
          return;
        }

        drafts.setDraftStoreError('Saved drafts are unavailable in this runtime.');
        return;
      }

      try {
        let result = await draftStorage.load();
        if (!result.success) {
          const backups = result.backupIndexes ?? [];
          drafts.setDraftStoreBackups(backups);
          if (!backups.length || !window.confirm(translateRef.current('studio.draftsDamagedPrompt'))) {
            drafts.setDraftStoreError(result.error || translateRef.current('studio.draftsCouldNotLoad'));
            return;
          }
          const restored = await draftStorage.restoreBackup(backups[0]);
          if (!restored.success) throw new Error(restored.error || translateRef.current('studio.backupCouldNotRestore'));
          result = await draftStorage.load();
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
        writeWorkspaceDraftStoreFallback(store);
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
    if (!currentOptions.rescheduleSourceRef.current
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
      const workspaceDraft = createWorkspaceDraftSnapshot();
      if (workspaceDraft) setSavedAt(workspaceDraft.savedAt);
      void drafts.persistDraftStore(() => drafts.savedDraftsRef.current, workspaceDraft);
    }, 350);
    return cancelPendingAutosave;
  }, [
    draftStateHydrated,
    drafts.draftStoreReady,
    options.workspace.attachments,
    options.workspace.body,
    options.workspace.date,
    options.workspace.entities,
    options.workspace.inlineButtons,
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
      };
      const draftStorage = getDraftStorageApi();
      if (!draftStorage) {
        writeWorkspaceDraftStoreFallback(data);
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
      const fallback = readWorkspaceDraftStoreFallback();
      if (!fallback) {
        drafts.setDraftStoreError('No saved draft backup is available for this runtime.');
        return;
      }
      applyPersistedDraftStore(fallback);
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
      writeWorkspaceDraftStoreFallback({
        schemaVersion: DRAFT_STORE_SCHEMA_VERSION,
        migrationVersion: 1,
        savedDrafts: drafts.savedDraftsRef.current,
        workspaceDraft,
      });
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
      const fallback = readWorkspaceDraftStoreFallback();
      if (fallback) {
        applyPersistedDraftStore(fallback);
        showFeedback(t('studio.draftsRestored'), 'success');
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
    savedAt,
    setSavedAt,
    createWorkspaceDraftSnapshot,
    applyPersistedDraftStore,
    cancelPendingAutosave,
    handleRestoreDraftBackup,
    handleExportDrafts,
    handleImportDrafts,
  };
}