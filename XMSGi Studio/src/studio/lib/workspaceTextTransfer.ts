import type { Dispatch, SetStateAction } from 'react';
import type { ConfirmAction } from '@/components/useConfirm';
import { getDraftStorageApi, readWorkspaceDraftStoreFallback } from './draftStore';
import type { WorkspaceDraft } from './draftStore';
import type { PersistedWorkspaceDocumentVersion } from '@shared/types';
import type { useLocale } from '@studio/lib/i18n';
import type { RichTextEntity } from '../types';

type TranslationFunction = ReturnType<typeof useLocale>['t'];

type WorkspaceTextTransferOptions = {
  draftBody: string;
  maxDraftLength: number;
  setDraftBody: Dispatch<SetStateAction<string>>;
  setDraftEntities: Dispatch<SetStateAction<RichTextEntity[]>>;
  setTextFileError: Dispatch<SetStateAction<string>>;
  confirm: ConfirmAction;
  t: TranslationFunction;
  createWorkspaceDraftSnapshot: () => WorkspaceDraft | null;
  recordWorkspaceVersion: (
    snapshot: WorkspaceDraft | null,
    reason: PersistedWorkspaceDocumentVersion['reason'],
  ) => Promise<{ success: boolean; error?: string }>;
  showPublishFeedback: (message: string, kind?: 'warning' | 'success') => void;
  changeStageMode: (mode: 'editor') => void;
};

export function createWorkspaceTextTransferHandlers({
  draftBody,
  maxDraftLength,
  setDraftBody,
  setDraftEntities,
  setTextFileError,
  confirm,
  t,
  createWorkspaceDraftSnapshot,
  recordWorkspaceVersion,
  showPublishFeedback,
  changeStageMode,
}: WorkspaceTextTransferOptions) {
  const handleExportEditorText = async (editorText: string, format: 'txt' | 'json') => {
    if (!editorText.trim()) {
      showPublishFeedback(t('studio.textExportEmpty'));
      return;
    }

    const draftStorage = getDraftStorageApi();
    if (!draftStorage || typeof draftStorage.exportText !== 'function') {
      setTextFileError(t('studio.textExportFailed'));
      return;
    }

    const payload = format === 'json'
      ? JSON.stringify({ exportedAt: new Date().toISOString(), text: editorText }, null, 2)
      : editorText;

    try {
      const result = await draftStorage.exportText(payload, format);
      if (result.cancelled) return;
      if (!result.success) {
        setTextFileError(result.error || t('studio.textExportFailed'));
        return;
      }
      setTextFileError('');
      showPublishFeedback(t('studio.textExported'), 'success');
    } catch (error) {
      setTextFileError(error instanceof Error ? error.message : t('studio.textExportFailed'));
    }
  };

  const handleImportEditorText = async () => {
    setTextFileError('');
    try {
      const draftStorage = getDraftStorageApi();
      if (!draftStorage) {
        const fallback = readWorkspaceDraftStoreFallback();
        const body = fallback?.workspaceDraft && typeof fallback.workspaceDraft === 'object' && typeof (fallback.workspaceDraft as { body?: unknown }).body === 'string'
          ? (fallback.workspaceDraft as { body: string }).body
          : '';
        if (!body) {
          setTextFileError(t('studio.textImportUnavailable'));
          return;
        }
        const checkpoint = await recordWorkspaceVersion(createWorkspaceDraftSnapshot(), 'before-replacement');
        if (!checkpoint.success) {
          showPublishFeedback(t('studio.historyCouldNotSave'), 'warning');
          return;
        }
        setDraftBody(body);
        setDraftEntities([]);
        setTextFileError('');
        changeStageMode('editor');
        showPublishFeedback(t('studio.textImported'), 'success');
        return;
      }

      const result = await draftStorage.importText();
      if (!result.success) {
        if (!result.cancelled) setTextFileError(result.error || t('studio.textFileReadFailed'));
        return;
      }
      if (typeof result.text !== 'string') {
        setTextFileError(t('studio.textFileEmpty'));
        return;
      }
      if (result.text.length > maxDraftLength) {
        setTextFileError(t('studio.textImportLimit', { limit: maxDraftLength }));
        return;
      }
      if (draftBody.length > 0 && result.text !== draftBody && !await confirm({
        message: t('studio.confirmReplaceText'),
        confirmLabel: t('common.apply'),
        cancelLabel: t('common.cancel'),
        destructive: true,
      })) return;
      if (result.text !== draftBody) {
        const checkpoint = await recordWorkspaceVersion(createWorkspaceDraftSnapshot(), 'before-replacement');
        if (!checkpoint.success) {
          showPublishFeedback(t('studio.historyCouldNotSave'), 'warning');
          return;
        }
      }

      setDraftBody(result.text);
      setDraftEntities([]);
      setTextFileError('');
      changeStageMode('editor');
      showPublishFeedback(t('studio.textImported'), 'success');
    } catch (error) {
      setTextFileError(error instanceof Error ? error.message : t('studio.textFileReadFailed'));
    }
  };

  return { handleExportEditorText, handleImportEditorText };
}
