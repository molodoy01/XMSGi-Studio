import { useLocale } from '@/lib/i18n';
import type { StageMode } from '@/components/stages/types';

interface Props {
  stageMode: StageMode;
  remainingCharacters: number;
  counterClassName: string;
  linkPopoverOpen: boolean;
  onToggleLink: () => void;
}

export function EditorToolbar({ stageMode, remainingCharacters, counterClassName, linkPopoverOpen, onToggleLink }: Props) {
  const { t } = useLocale();

  return (
    <div
      className="workspace-page-rich-text-toolbar"
      aria-label={t('studio.linkTools')}
      aria-hidden={stageMode !== 'editor'}
    >
      <span className={counterClassName} aria-live="polite">
        {remainingCharacters}
      </span>
      <div className="workspace-page-rich-text-toolbar-actions">
        <span className="workspace-page-rich-text-photo-slot" aria-hidden="true" />
        <button
          type="button"
          className={`workspace-page-rich-text-link-trigger ${linkPopoverOpen ? 'is-open' : ''}`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={onToggleLink}
          aria-label={t('studio.insertLink')}
          aria-expanded={linkPopoverOpen}
          title={t('studio.insertLink')}
        >
          <span className="workspace-page-rich-text-link-trigger__icon" aria-hidden="true">↗</span>
        </button>
      </div>
    </div>
  );
}