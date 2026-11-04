import { useState, type Dispatch, type KeyboardEvent, type SetStateAction } from 'react';
import { Check, Download, Pencil, Upload, X } from 'lucide-react';
import type { DraftColor, SavedDraft } from '@studio/types';
import { useLocale } from '@studio/lib/i18n';
import { DraftColorPicker } from '@studio/components/DraftColorPicker';
import type { StageMode } from './types';

type StudioTranslate = ReturnType<typeof useLocale>['t'];

function getDraftAttachmentSummary(draft: SavedDraft, t: StudioTranslate): string {
  const attachments = draft.attachments ?? [];
  if (attachments.length === 0) return '';
  return `${attachments.length} ${t(attachments.length === 1 ? 'studio.attachment' : 'studio.attachments')}`;
}

interface Props {
  mode: StageMode;
  onModeChange: (mode: StageMode) => void;
  savedDrafts: SavedDraft[];
  onInsertDraft: (draft: SavedDraft) => void;
  onRenameDraft: (draft: SavedDraft, name: string) => Promise<boolean>;
  draftEditingId: string | null;
  draftColor: DraftColor;
  setDraftColor: Dispatch<SetStateAction<DraftColor>>;
  draftName: string;
  setDraftName: Dispatch<SetStateAction<string>>;
  draftBodyText: string;
  setDraftBodyText: Dispatch<SetStateAction<string>>;
  openDraftEditor: (draft?: SavedDraft) => void;
  onDeleteDraft: (draft: SavedDraft) => void;
  closeDraftEditor: () => void;
  saveDraftStage: () => void;
  draftStoreReady: boolean;
  draftStoreSaving: boolean;
  onExportDrafts: () => void;
  onImportDrafts: () => void;
  onImportEditorText: () => void;
}

export function DraftsStage({
  mode,
  onModeChange,
  savedDrafts,
  onInsertDraft,
  onRenameDraft,
  draftEditingId,
  draftColor,
  setDraftColor,
  draftName,
  setDraftName,
  draftBodyText,
  setDraftBodyText,
  openDraftEditor,
  onDeleteDraft,
  closeDraftEditor,
  saveDraftStage,
  draftStoreReady,
  draftStoreSaving,
  onExportDrafts,
  onImportDrafts,
  onImportEditorText,
}: Props) {
  const { t } = useLocale();
  const [renamingDraftId, setRenamingDraftId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameSaving, setRenameSaving] = useState(false);

  const cancelRename = () => {
    setRenamingDraftId(null);
    setRenameValue('');
  };

  const saveRename = async (draft: SavedDraft) => {
    const name = renameValue.trim();
    if (!name || renameSaving) return;
    if (name === draft.name) {
      cancelRename();
      return;
    }

    setRenameSaving(true);
    try {
      if (await onRenameDraft(draft, name)) cancelRename();
    } finally {
      setRenameSaving(false);
    }
  };

  const handleRenameKeyDown = (event: KeyboardEvent<HTMLInputElement>, draft: SavedDraft) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelRename();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      void saveRename(draft);
    }
  };

  return (
    <div className={`workspace-page-rich-text-stage-view workspace-page-rich-text-template-stage workspace-page-rich-text-draft-stage ${mode === 'draft' ? 'is-active' : ''}${draftEditingId ? ' has-draft-editor' : ''}`} aria-hidden={mode !== 'draft'}>
      <header className="workspace-page-stage-header workspace-page-template-stage-header">
        <strong>{draftEditingId ? t('studio.draft') : t('studio.savedDrafts')}</strong>
        <span>{draftEditingId ? t('studio.editSavedContent') : `${t('studio.savedCount', { count: savedDrafts.length })} · ${draftStoreSaving ? t('studio.saving') : draftStoreReady ? t('studio.savedLocally') : t('studio.loading')}`}</span>
      </header>
      {draftEditingId ? (
        <form id="workspace-draft-editor-form" className="workspace-page-stage-main workspace-page-template-stage-editor" onSubmit={(event) => { event.preventDefault(); saveDraftStage(); }}>
          <div className="workspace-page-draft-name-row">
            <label className="workspace-page-draft-name-field">
              <span>{t('studio.name')}</span>
              <input
                type="text"
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                aria-label={t('studio.draftName')}
                autoFocus
              />
            </label>
            <div className="workspace-page-draft-color-field">
              <DraftColorPicker color={draftColor} onChange={setDraftColor} ariaLabel={t('studio.savedDraftColor')} />
            </div>
          </div>
          <label>
            <span>{t('studio.body')}</span>
            <textarea value={draftBodyText} onChange={(event) => setDraftBodyText(event.target.value)} rows={5} aria-label={t('studio.draftBody')} />
          </label>
        </form>
      ) : (
        <div className="workspace-page-stage-main workspace-page-template-stage-list-area">
          <div className="workspace-page-template-stage-list">
            {savedDrafts.length > 0 ? savedDrafts.map((draft) => {
              const attachmentSummary = getDraftAttachmentSummary(draft, t);
              return (
                <div className="workspace-page-template-stage-item" key={draft.id}>
                  {renamingDraftId === draft.id ? (
                    <div className="workspace-page-draft-rename">
                      <input
                        type="text"
                        value={renameValue}
                        onChange={(event) => setRenameValue(event.target.value)}
                        onKeyDown={(event) => handleRenameKeyDown(event, draft)}
                        aria-label={t('studio.newDraftName')}
                        autoFocus
                        disabled={renameSaving || draftStoreSaving}
                      />
                      <span>{t('studio.characterCount', { count: draft.body.length })}{attachmentSummary ? ` · ${attachmentSummary}` : ''}</span>
                    </div>
                  ) : (
                    <button type="button" onClick={() => onInsertDraft(draft)}>
                      <strong>
                        <span className="workspace-page-draft-color-dot" data-color={draft.color ?? 'gray'} aria-hidden="true" />
                        {draft.name}
                      </strong>
                      <span>
                        {t('studio.characterCount', { count: draft.body.length })}{attachmentSummary ? ` · ${attachmentSummary}` : ''}
                      </span>
                    </button>
                  )}
                  <div>
                    {renamingDraftId === draft.id ? (
                      <>
                        <button
                          type="button"
                          aria-label={t('studio.saveDraftName')}
                          title={t('studio.saveDraftName')}
                          onClick={() => { void saveRename(draft); }}
                          disabled={!renameValue.trim() || renameSaving || draftStoreSaving}
                        >
                          <Check size={15} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          aria-label={t('common.cancel')}
                          title={t('common.cancel')}
                          onClick={cancelRename}
                          disabled={renameSaving}
                        >
                          <X size={15} aria-hidden="true" />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          aria-label={t('studio.renameDraft', { name: draft.name })}
                          title={t('studio.renameDraft', { name: draft.name })}
                          onClick={() => {
                            setRenamingDraftId(draft.id);
                            setRenameValue(draft.name);
                          }}
                          disabled={!draftStoreReady || draftStoreSaving}
                        >
                          <Pencil size={14} aria-hidden="true" />
                        </button>
                        <button type="button" onClick={() => openDraftEditor(draft)}>{t('studio.edit')}</button>
                        <button type="button" onClick={() => onDeleteDraft(draft)}>{t('studio.delete')}</button>
                      </>
                    )}
                  </div>
                </div>
              );
            }) : <div className="workspace-page-template-stage-empty">{t('studio.noDrafts')}</div>}
          </div>
        </div>
      )}
      <footer className="workspace-page-stage-actions workspace-page-template-stage-footer workspace-page-draft-stage-footer">
        <div className="workspace-page-draft-stage-footer-left">
          <button type="button" className="workspace-page-stage-secondary" onClick={draftEditingId ? closeDraftEditor : () => onModeChange('editor')}>← {t('studio.back')}</button>
        </div>
        {draftEditingId ? (
          <div className="workspace-page-template-stage-footer-actions">
            <button type="submit" form="workspace-draft-editor-form" className="workspace-page-stage-primary" disabled={!draftStoreReady || draftStoreSaving || !draftName.trim() || !draftBodyText.trim()}>
              {draftStoreSaving ? t('studio.saving') : t('studio.save')}
            </button>
          </div>
        ) : (
          <>
            <div className="workspace-page-draft-stage-tools">
              <button type="button" className="workspace-page-stage-secondary" onClick={onImportEditorText} aria-label={t('studio.importText')} title={t('studio.importTextTitle')}>
                <Upload size={15} strokeWidth={1.8} aria-hidden="true" /> {t('studio.importTxt')}
              </button>
              <button type="button" className="workspace-page-stage-secondary" onClick={onExportDrafts} disabled={!draftStoreReady || draftStoreSaving} aria-label={t('studio.exportAllDrafts')} title={t('studio.exportAllDrafts')}>
                <Download size={14} strokeWidth={1.8} aria-hidden="true" /> <span>{t('studio.exportAllDraftsCompact')}</span>
              </button>
              <button type="button" className="workspace-page-stage-secondary" onClick={onImportDrafts} disabled={!draftStoreReady || draftStoreSaving} aria-label={t('studio.importDrafts')} title={t('studio.importDrafts')}>
                <Upload size={14} strokeWidth={1.8} aria-hidden="true" /> <span>{t('studio.importDraftsCompact')}</span>
              </button>
            </div>
            <button type="button" className="workspace-page-stage-primary workspace-page-draft-stage-add" onClick={() => openDraftEditor()} disabled={!draftStoreReady || draftStoreSaving}>+ {t('studio.draft')}</button>
          </>
        )}
      </footer>
    </div>
  );
}