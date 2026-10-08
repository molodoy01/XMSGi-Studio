import type { Dispatch, SetStateAction } from 'react';
import { Upload } from 'lucide-react';
import type { DraftColor, SavedDraft } from '@/types';
import { useLocale } from '@/lib/i18n';
import { DraftColorPicker } from '@/components/DraftColorPicker';
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

  return (
    <div className={`workspace-page-rich-text-stage-view workspace-page-rich-text-template-stage workspace-page-rich-text-draft-stage ${mode === 'draft' ? 'is-active' : ''}`} aria-hidden={mode !== 'draft'}>
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
                  <button type="button" onClick={() => onInsertDraft(draft)}>
                    <strong>
                      <span className="workspace-page-draft-color-dot" data-color={draft.color ?? 'gray'} aria-hidden="true" />
                      {draft.name}
                    </strong>
                    <span>
                      {t('studio.characterCount', { count: draft.body.length })}{attachmentSummary ? ` · ${attachmentSummary}` : ''}
                    </span>
                  </button>
                  <div>
                    <button type="button" onClick={() => openDraftEditor(draft)}>{t('studio.edit')}</button>
                    <button type="button" onClick={() => onDeleteDraft(draft)}>{t('studio.delete')}</button>
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
          {!draftEditingId && (
            <>
              <button type="button" className="workspace-page-stage-secondary" onClick={onImportEditorText} aria-label={t('studio.importText')} title={t('studio.importTextTitle')}>
                <Upload size={15} strokeWidth={1.8} aria-hidden="true" /> {t('studio.importTxt')}
              </button>
            </>
          )}
        </div>
        <div className="workspace-page-template-stage-footer-actions">
          {draftEditingId ? (
            <button type="submit" form="workspace-draft-editor-form" className="workspace-page-stage-primary" disabled={!draftStoreReady || draftStoreSaving || !draftName.trim() || !draftBodyText.trim()}>
              {draftStoreSaving ? t('studio.saving') : t('studio.save')}
            </button>
          ) : (
            <>
              <button type="button" className="workspace-page-stage-secondary" onClick={onExportDrafts} disabled={!draftStoreReady || draftStoreSaving}>{t('studio.exportAllDrafts')}</button>
              <button type="button" className="workspace-page-stage-secondary" onClick={onImportDrafts} disabled={!draftStoreReady || draftStoreSaving}>{t('studio.importDrafts')}</button>
              <button type="button" className="workspace-page-stage-primary" onClick={() => openDraftEditor()} disabled={!draftStoreReady || draftStoreSaving}>+ {t('studio.draft')}</button>
            </>
          )}
        </div>
      </footer>
    </div>
  );
}