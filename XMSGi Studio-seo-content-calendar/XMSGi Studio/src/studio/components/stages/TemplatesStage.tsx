import { useRef, useState, type FormEvent } from 'react';
import type { Template } from '@studio/types';
import { useLocale } from '@studio/lib/i18n';
import type { StageMode } from './types';

interface Props {
  mode: StageMode;
  onModeChange: (mode: StageMode) => void;
  templates: Template[];
  onInsertTemplate: (body: string) => void;
  templateEditingId: string | null;
  templateDraftName: string;
  setTemplateDraftName: (name: string) => void;
  templateDraftBody: string;
  setTemplateDraftBody: (body: string) => void;
  openTemplateEditor: (template?: Template) => void;
  onDeleteTemplate: (template: Template) => void;
  closeTemplateEditor: () => void;
  saveTemplateStage: () => void;
}

export function TemplatesStage({
  mode,
  onModeChange,
  templates,
  onInsertTemplate,
  templateEditingId,
  templateDraftName,
  setTemplateDraftName,
  templateDraftBody,
  setTemplateDraftBody,
  openTemplateEditor,
  onDeleteTemplate,
  closeTemplateEditor,
  saveTemplateStage,
}: Props) {
  const { t } = useLocale();
  const [templateSearch, setTemplateSearch] = useState('');
  const templateNameInputRef = useRef<HTMLInputElement>(null);
  const templateBodyInputRef = useRef<HTMLTextAreaElement>(null);
  const normalizedTemplateSearch = templateSearch.trim().toLocaleLowerCase();
  const filteredTemplates = normalizedTemplateSearch
    ? templates.filter((template) => `${template.name}\n${template.body}`.toLocaleLowerCase().includes(normalizedTemplateSearch))
    : templates;

  const handleTemplateSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const missingInput = !templateDraftName.trim()
      ? templateNameInputRef.current
      : !templateDraftBody.trim()
        ? templateBodyInputRef.current
        : null;

    if (missingInput) {
      missingInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
      missingInput.focus({ preventScroll: true });
      return;
    }

    saveTemplateStage();
  };

  return (
    <div className={`workspace-page-rich-text-stage-view workspace-page-rich-text-template-stage ${mode === 'template' ? 'is-active' : ''}`} aria-hidden={mode !== 'template'}>
      <header className="workspace-page-stage-header workspace-page-template-stage-header">
        <div className="workspace-page-template-header-info">
          <strong>{templateEditingId ? t('studio.templateTitle') : t('studio.templatesTitle')}</strong>
          <span>{templateEditingId ? t('studio.editSavedContent') : t('studio.savedCount', { count: templates.length })}</span>
        </div>
        {!templateEditingId && templates.length > 0 && (
          <label className="workspace-page-template-stage-search">
            <input
              type="search"
              value={templateSearch}
              onChange={(event) => setTemplateSearch(event.target.value)}
              placeholder={t('studio.searchTemplates')}
              aria-label={t('studio.searchTemplates')}
            />
          </label>
        )}
      </header>
      {templateEditingId ? (
        <form id="workspace-template-editor-form" className="workspace-page-stage-main workspace-page-template-stage-editor" onSubmit={handleTemplateSubmit}>
          <label>
            <span>{t('studio.name')}</span>
            <input
              ref={templateNameInputRef}
              type="text"
              value={templateDraftName}
              onChange={(event) => setTemplateDraftName(event.target.value)}
              aria-label={t('studio.templateName')}
              autoFocus
            />
          </label>
          <label>
            <span>{t('studio.body')}</span>
            <textarea
              ref={templateBodyInputRef}
              value={templateDraftBody}
              onChange={(event) => setTemplateDraftBody(event.target.value)}
              rows={5}
            />
          </label>
        </form>
      ) : (
        <div className="workspace-page-stage-main workspace-page-template-stage-list-area">
          <div className="workspace-page-template-stage-list">
            {filteredTemplates.length > 0 ? filteredTemplates.map((template) => (
              <div className="workspace-page-template-stage-item" key={template.id}>
                <button type="button" onClick={() => { onInsertTemplate(template.body); onModeChange('editor'); }}>
                  <strong>{template.name}</strong>
                  <span>{t('studio.characterCount', { count: template.body.length })}</span>
                </button>
                <div>
                  <button type="button" onClick={() => openTemplateEditor(template)}>{t('studio.edit')}</button>
                  <button type="button" onClick={() => onDeleteTemplate(template)}>{t('studio.delete')}</button>
                </div>
              </div>
            )) : (
              <div className="workspace-page-template-stage-empty">
                {templates.length > 0 ? t('studio.noTemplatesFound') : t('studio.noTemplates')}
              </div>
            )}
          </div>
        </div>
      )}
      <footer className="workspace-page-stage-actions workspace-page-template-stage-footer">
        <button type="button" className="workspace-page-stage-secondary" onClick={templateEditingId ? closeTemplateEditor : () => onModeChange('editor')}>← {t('studio.back')}</button>
        <div className="workspace-page-template-stage-footer-actions">
          {templateEditingId ? (
            <button type="submit" form="workspace-template-editor-form" className="workspace-page-stage-primary">
              {t('studio.save')}
            </button>
          ) : (
            <button type="button" className="workspace-page-stage-primary" onClick={() => openTemplateEditor()}>{t('studio.newTemplate')}</button>
          )}
        </div>
      </footer>
    </div>
  );
}