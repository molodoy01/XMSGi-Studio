import { useEffect, useMemo, useRef, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react';
import { Upload } from 'lucide-react';
import type { DraftColor, SavedDraft } from '@studio/types';
import { useLocale } from '@studio/lib/i18n';
import { DraftColorPicker } from '@studio/components/DraftColorPicker';
import { DRAFT_COLOR_OPTIONS } from '@studio/components/DraftColorOptions';
import type { StageMode } from './types';

type StudioTranslate = ReturnType<typeof useLocale>['t'];
const SAVED_DRAFT_COLOR_FILTER_KEY = 'xmsgi_saved_draft_color_filter';

function getDraftColorLabelKey(color: DraftColor): 'studio.colorGray' | 'studio.colorCoral' | 'studio.colorAmber' | 'studio.colorGreen' | 'studio.colorTeal' | 'studio.colorBlue' {
  switch (color) {
    case 'coral': return 'studio.colorCoral';
    case 'amber': return 'studio.colorAmber';
    case 'green': return 'studio.colorGreen';
    case 'teal': return 'studio.colorTeal';
    case 'blue': return 'studio.colorBlue';
    case 'gray': return 'studio.colorGray';
    default: return 'studio.colorGray';
  }
}

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
  onImportDrafts,
  onImportEditorText,
}: Props) {
  const { t } = useLocale();
  const draftNameInputRef = useRef<HTMLInputElement>(null);
  const draftBodyInputRef = useRef<HTMLTextAreaElement>(null);
  const [attentionField, setAttentionField] = useState<'name' | 'body' | null>(null);
  const [selectedDraftColor, setSelectedDraftColor] = useState<DraftColor | null>(() => {
    const storedColor = window.localStorage.getItem(SAVED_DRAFT_COLOR_FILTER_KEY);
    return DRAFT_COLOR_OPTIONS.find((option) => option.value === storedColor)?.value ?? null;
  });
  const [previewDraftColor, setPreviewDraftColor] = useState<DraftColor | null>(null);
  const displayedDraftColor = previewDraftColor ?? selectedDraftColor;
  const visibleDrafts = useMemo(
    () => selectedDraftColor
      ? savedDrafts.filter((draft) => (draft.color ?? 'gray') === selectedDraftColor)
      : savedDrafts,
    [savedDrafts, selectedDraftColor],
  );
  const draftColorCounts = new Map<DraftColor, number>();
  savedDrafts.forEach((draft) => {
    const color = draft.color ?? 'gray';
    draftColorCounts.set(color, (draftColorCounts.get(color) ?? 0) + 1);
  });

  useEffect(() => {
    if (selectedDraftColor) {
      window.localStorage.setItem(SAVED_DRAFT_COLOR_FILTER_KEY, selectedDraftColor);
    } else {
      window.localStorage.removeItem(SAVED_DRAFT_COLOR_FILTER_KEY);
    }
  }, [selectedDraftColor]);

  const handleDraftSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const missingField = !draftName.trim()
      ? { field: 'name' as const, input: draftNameInputRef.current }
      : !draftBodyText.trim()
        ? { field: 'body' as const, input: draftBodyInputRef.current }
        : null;

    if (missingField?.input) {
      missingField.input.scrollIntoView({ behavior: 'smooth', block: 'center' });
      missingField.input.focus({ preventScroll: true });
      setAttentionField(null);
      window.requestAnimationFrame(() => setAttentionField(missingField.field));
      return;
    }

    if (draftStoreReady && !draftStoreSaving) saveDraftStage();
  };

  return (
    <div className={`workspace-page-rich-text-stage-view workspace-page-rich-text-template-stage workspace-page-rich-text-draft-stage ${mode === 'draft' ? 'is-active' : ''}${draftEditingId ? ' has-draft-editor' : ''}`} aria-hidden={mode !== 'draft'}>
      <header className={`workspace-page-stage-header workspace-page-template-stage-header${!draftEditingId ? ' workspace-page-draft-list-header' : ''}`}>
        <div className="workspace-page-draft-header-info">
          <strong>{draftEditingId ? t('studio.draft') : t('studio.savedDrafts')}</strong>
          <span>{draftEditingId ? t('studio.editSavedContent') : (() => {
            const savedCountLabel = t('studio.savedCount', { count: savedDrafts.length });
            const statusLabel = draftStoreSaving
              ? t('studio.saving')
              : !draftStoreReady
                ? t('studio.loading')
                : '';
            return statusLabel ? `${savedCountLabel} · ${statusLabel}` : savedCountLabel;
          })()}</span>
        </div>
        {!draftEditingId && savedDrafts.length > 0 && (
          <div className="workspace-page-draft-color-filters" role="group" aria-label={t('studio.savedDraftColor')}>
            {displayedDraftColor && (
              <span className="workspace-page-draft-selected-color" data-color={displayedDraftColor}>
                {t(DRAFT_COLOR_OPTIONS.find((option) => option.value === displayedDraftColor)?.labelKey ?? 'studio.colorGray')}
              </span>
            )}
            {DRAFT_COLOR_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className="workspace-page-draft-color-filter"
                aria-label={t('studio.colorOption', { color: t(option.labelKey) })}
                aria-pressed={selectedDraftColor === option.value}
                title={t('studio.colorOption', { color: t(option.labelKey) })}
                onMouseEnter={() => setPreviewDraftColor(option.value)}
                onMouseLeave={() => setPreviewDraftColor(null)}
                onFocus={() => setPreviewDraftColor(option.value)}
                onBlur={() => setPreviewDraftColor(null)}
                onClick={() => {
                  if (!draftColorCounts.has(option.value)) return;
                  setSelectedDraftColor((current) => current === option.value ? null : option.value);
                }}
              >
                <span
                  className={`workspace-page-draft-color-dot${selectedDraftColor === option.value ? ' is-selected' : ''}`}
                  data-color={option.value}
                  aria-hidden="true"
                />
                <span>{draftColorCounts.get(option.value) ?? 0}</span>
              </button>
            ))}
          </div>
        )}
      </header>
      {draftEditingId ? (
        <form id="workspace-draft-editor-form" className="workspace-page-stage-main workspace-page-template-stage-editor" onSubmit={handleDraftSubmit}>
          <div className="workspace-page-draft-name-row">
            <label className={`workspace-page-draft-name-field${attentionField === 'name' ? ' workspace-page-draft-field-attention' : ''}`}>
              <span>{t('studio.name')}</span>
              <input
                ref={draftNameInputRef}
                type="text"
                value={draftName}
                onChange={(event) => { setDraftName(event.target.value); setAttentionField(null); }}
                aria-label={t('studio.draftName')}
                autoFocus
              />
            </label>
            <div className="workspace-page-draft-color-field">
              <DraftColorPicker color={draftColor} onChange={setDraftColor} ariaLabel={t('studio.savedDraftColor')} />
            </div>
          </div>
          <label className={attentionField === 'body' ? 'workspace-page-draft-field-attention' : undefined}>
            <span>{t('studio.body')}</span>
            <textarea ref={draftBodyInputRef} value={draftBodyText} onChange={(event) => { setDraftBodyText(event.target.value); setAttentionField(null); }} rows={5} aria-label={t('studio.draftBody')} />
          </label>
        </form>
      ) : (
        <div className="workspace-page-stage-main workspace-page-template-stage-list-area workspace-page-draft-list-area">
          <div className="workspace-page-template-stage-list">
            {visibleDrafts.length > 0 ? visibleDrafts.map((draft) => {
              const attachmentSummary = getDraftAttachmentSummary(draft, t);
              const draftColor = draft.color ?? 'gray';
              return (
                <div className="workspace-page-template-stage-item" key={draft.id}>
                  <button type="button" onClick={() => onInsertDraft(draft)}>
                    <strong>
                      <span
                        className="workspace-page-draft-color-indicator"
                        data-color-label={t(getDraftColorLabelKey(draftColor))}
                        title={t(getDraftColorLabelKey(draftColor))}
                      >
                        <span className="workspace-page-draft-color-dot" data-color={draftColor} aria-hidden="true" />
                      </span>
                      <span className="workspace-page-draft-name">{draft.name}</span>
                      {attachmentSummary && <span className="workspace-page-draft-attachment-summary">{attachmentSummary}</span>}
                    </strong>
                    <span className="workspace-page-draft-row-summary">
                      {t('studio.characterCount', { count: draft.body.length })}
                    </span>
                  </button>
                  <div>
                    <button type="button" onClick={() => openDraftEditor(draft)}>{t('studio.edit')}</button>
                    <button type="button" onClick={() => onDeleteDraft(draft)}>{t('studio.delete')}</button>
                  </div>
                </div>
              );
            }) : <div className="workspace-page-template-stage-empty">{savedDrafts.length ? t('studio.noDraftsFound') : t('studio.noDrafts')}</div>}
          </div>
        </div>
      )}
      <footer className="workspace-page-stage-actions workspace-page-template-stage-footer workspace-page-draft-stage-footer">
        <div className="workspace-page-draft-stage-footer-left">
          <button type="button" className="workspace-page-stage-secondary" onClick={draftEditingId ? closeDraftEditor : () => onModeChange('editor')}>← {t('studio.back')}</button>
        </div>
        {draftEditingId ? (
          <div className="workspace-page-template-stage-footer-actions">
            <button type="submit" form="workspace-draft-editor-form" className="workspace-page-stage-primary" disabled={!draftStoreReady || draftStoreSaving}>
              {draftStoreSaving ? t('studio.saving') : t('studio.save')}
            </button>
          </div>
        ) : (
          <>
            <div className="workspace-page-draft-stage-tools">
              <button type="button" className="workspace-page-stage-secondary" onClick={onImportEditorText} aria-label={t('studio.importText')} title={t('studio.importTextTitle')}>
                <Upload size={15} strokeWidth={1.8} aria-hidden="true" /> {t('studio.importTxt')}
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