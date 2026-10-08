import { useEffect, useRef, useState } from 'react';
import type { InlineButton, InlineButtonRow } from '@/lib/inlineKeyboard';
import { createInlineButton, getInlineButtonError, limitInlineRows, MAX_INLINE_BUTTONS, MAX_INLINE_BUTTON_LABEL_LENGTH, normalizeInlineUrl } from '@/lib/inlineKeyboard';
import { useLocale } from '@/lib/i18n';
import './InlineKeyboardBuilder.css';

type InlineKeyboardBuilderProps = {
  rows: InlineButtonRow[];
  onChange: (rows: InlineButtonRow[]) => void;
  open: boolean;
  onClose: () => void;
};

type InlineKeyboardPreset = {
  id: string;
  name: string;
  rows: InlineButtonRow[];
};

const PRESETS_STORAGE_KEY = 'awaitmsg-inline-button-presets';

function loadPresets(): InlineKeyboardPreset[] {
  try {
    const raw = window.localStorage.getItem(PRESETS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function updateRow(rows: InlineButtonRow[], rowIndex: number, nextRow: InlineButtonRow) {
  return rows.map((row, index) => (index === rowIndex ? nextRow : row));
}

export function InlineKeyboardBuilder({ rows, onChange, open, onClose }: InlineKeyboardBuilderProps) {
  const { t } = useLocale();
  const [presets, setPresets] = useState<InlineKeyboardPreset[]>(loadPresets);
  const [presetsOpen, setPresetsOpen] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const currentSectionRef = useRef<HTMLElement | null>(null);
  const limitedRows = limitInlineRows(rows);
  const buttonCount = limitedRows.reduce((total, row) => total + row.length, 0);

  useEffect(() => {
    const rowsChanged = limitedRows.length !== rows.length
      || limitedRows.some((row, index) => row.length !== rows[index]?.length || row.some((button, buttonIndex) => button !== rows[index]?.[buttonIndex]));
    if (rowsChanged) onChange(limitedRows);
  }, [onChange, rows, limitedRows]);

  const addButton = () => {
    if (buttonCount >= MAX_INLINE_BUTTONS) return;
    onChange([...limitedRows, [createInlineButton(`${Date.now()}-button`)]].slice(0, MAX_INLINE_BUTTONS));
  };

  const updateButton = (rowIndex: number, buttonIndex: number, nextButton: InlineButton) => {
    const nextRow = limitedRows[rowIndex].map((button, index) => index === buttonIndex ? nextButton : button);
    onChange(updateRow(limitedRows, rowIndex, nextRow));
  };

  useEffect(() => {
    if (!open) return undefined;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onClose, open]);

  useEffect(() => {
    if (!editorOpen) return;

    requestAnimationFrame(() => {
      currentSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }, [editorOpen]);

  const applyPreset = (preset: InlineKeyboardPreset) => {
    onChange(limitInlineRows(preset.rows).map((row) => row.map((button) => ({ ...button, id: `${button.id}-${Date.now()}` }))));
  };

  const savePreset = () => {
    if (!rows.length) return;

    const name = `${t('inline.defaultPresetName')} ${presets.length + 1}`;
    const nextPresets = [...presets, { id: `${Date.now()}-preset`, name, rows: limitedRows }];
    setPresets(nextPresets);

    try {
      window.localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(nextPresets));
    } catch {
      // Keep the preset available for this session if storage is unavailable.
    }
  };

  const deletePreset = (presetId: string) => {
    const nextPresets = presets.filter((preset) => preset.id !== presetId);
    setPresets(nextPresets);
    window.localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(nextPresets));
  };

  if (!open) return null;

  const translateError = (error: string) => {
    const errorKeys: Record<string, Parameters<typeof t>[0]> = {
      'Enter button text.': 'inline.errorTextRequired',
      'Button label must be 64 characters or less.': 'inline.errorTextTooLong',
      'Use a valid https:// URL.': 'inline.errorHttps',
      'Callback must be 64 bytes or less.': 'inline.errorCallbackTooLong',
      'Callback command is required.': 'inline.errorCallbackRequired',
    };
    const key = errorKeys[error];
    return key ? t(key) : error;
  };

  return (
      <section className="inline-keyboard-builder" aria-label={t('inline.title')}>
        <h2 className="inline-keyboard-view-title">{t('inline.title')}</h2>

        <div className="inline-keyboard-modal-body">
          <section className="inline-keyboard-presets" aria-labelledby="inline-keyboard-presets-title">
            <section className="workspace-page-schedule-row-section inline-keyboard-section">
              <button
                type="button"
                className="workspace-page-schedule-row-heading workspace-page-schedule-row-toggle"
                onClick={() => setPresetsOpen((current) => !current)}
                aria-expanded={presetsOpen}
              >
                <span id="inline-keyboard-presets-title">{t('inline.presets')}</span>
                <strong>{presets.length ? t('inline.savedCount', { count: presets.length }) : t('inline.noSavedPresets')}</strong>
                <span className="workspace-page-schedule-chevron" aria-hidden="true">{presetsOpen ? '−' : '+'}</span>
              </button>
              {presetsOpen && (presets.length ? (
                <div className="workspace-page-template-stage-list inline-keyboard-preset-list">
                  {presets.map((preset) => (
                    <div className="workspace-page-template-stage-item inline-keyboard-preset-item" key={preset.id}>
                      <button type="button" onClick={() => applyPreset(preset)}>
                        <strong>{preset.name}</strong>
                        <span>{t('inline.buttonCount', { count: preset.rows.reduce((total, row) => total + row.length, 0) })}</span>
                      </button>
                      <div>
                        <button type="button" onClick={() => applyPreset(preset)}>{t('inline.applyPreset')}</button>
                        <button type="button" onClick={() => deletePreset(preset.id)}>{t('inline.deletePreset')}</button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : <p className="inline-keyboard-presets-empty">{t('inline.noSavedPresets')}</p>)}
            </section>
          </section>

          <section className="inline-keyboard-constructor" aria-labelledby="inline-keyboard-constructor-title">
            <section ref={currentSectionRef} className="workspace-page-schedule-row-section inline-keyboard-current-section">
              <button
                type="button"
                className="workspace-page-schedule-row-heading workspace-page-schedule-row-toggle"
                onClick={() => setEditorOpen((current) => !current)}
                aria-expanded={editorOpen}
              >
                <span>{t('inline.buttons')}</span>
                <strong>{buttonCount ? t('inline.activeCount', { count: buttonCount }) : t('inline.noButtons')}</strong>
                <span className="workspace-page-schedule-chevron" aria-hidden="true">{editorOpen ? '−' : '+'}</span>
              </button>
              {buttonCount > 0 && !editorOpen && (
                <div className="inline-keyboard-active-summary" aria-label={t('inline.activeButtons')}>
                  {limitedRows.flatMap((row) => row.map((button) => button.label.trim() || t('inline.unnamedButton'))).join(' · ')}
                </div>
              )}
            </section>

            {editorOpen && <div className="inline-keyboard-create-section">
              <div className="workspace-page-template-stage-list-header">
                <strong id="inline-keyboard-constructor-title">{t('inline.addButtons')}</strong>
                <span className="inline-keyboard-section-note">{t('inline.editCurrentPost')}</span>
              </div>
              <div className="inline-keyboard-current-list" aria-label={t('inline.currentButtons')}>
                {limitedRows.flatMap((row, rowIndex) => row.map((button, buttonIndex) => {
                  const buttonNumber = limitedRows.slice(0, rowIndex).reduce((total, currentRow) => total + currentRow.length, 0) + buttonIndex + 1;
                    const error = getInlineButtonError(button);
                    return (
                      <div className={`inline-keyboard-button-editor ${error ? 'has-error' : ''}`} key={button.id}>
                        <div className="inline-keyboard-button-fields">
                          <input value={button.label} maxLength={MAX_INLINE_BUTTON_LABEL_LENGTH} onChange={(event) => updateButton(rowIndex, buttonIndex, { ...button, label: event.target.value })} placeholder={t('inline.buttonTextPlaceholder')} aria-label={t('inline.buttonTextLabel', { number: buttonNumber })} title={t('inline.buttonTextTitle')} />
                          <span className="inline-keyboard-action-arrow" aria-hidden="true">→</span>
                          <input value={button.action.value} onChange={(event) => updateButton(rowIndex, buttonIndex, { ...button, action: { ...button.action, value: event.target.value } })} onBlur={() => { if (button.action.type === 'url') updateButton(rowIndex, buttonIndex, { ...button, action: { ...button.action, value: normalizeInlineUrl(button.action.value) } }); }} placeholder="https://..." aria-label={t('inline.buttonLinkLabel', { number: buttonNumber })} title={t('inline.buttonLinkTitle')} />
                          <button type="button" className="inline-keyboard-remove-button" onClick={() => onChange(row.length === 1 ? limitedRows.filter((_, index) => index !== rowIndex) : updateRow(limitedRows, rowIndex, row.filter((_, index) => index !== buttonIndex)))} aria-label={t('inline.removeButton')}>✕</button>
                        </div>
                        {error && <span className="inline-keyboard-error">{translateError(error)}</span>}
                      </div>
                    );
                }))}
              </div>
              {!limitedRows.length && <p className="inline-keyboard-presets-empty">{t('inline.noPostButtons')}</p>}
            </div>}
          </section>

        </div>
        <footer className="workspace-page-stage-actions workspace-page-template-stage-footer inline-keyboard-footer">
          <button type="button" className="workspace-page-stage-secondary" onClick={onClose}>← {t('inline.back')}</button>
          <div className="inline-keyboard-footer-actions">
            <button type="button" className="workspace-page-stage-primary" onClick={() => { setEditorOpen(true); addButton(); }} disabled={buttonCount >= MAX_INLINE_BUTTONS}>{t('inline.addButton')}</button>
            <button type="button" className="workspace-page-stage-primary" onClick={savePreset} disabled={!rows.length}>{t('inline.savePreset')}</button>
          </div>
        </footer>
      </section>
  );
}
