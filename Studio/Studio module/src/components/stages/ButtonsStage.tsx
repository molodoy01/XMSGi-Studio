import { InlineKeyboardBuilder } from '@/components/InlineKeyboardBuilder';
import type { InlineButtonRow } from '@/lib/inlineKeyboard';

import type { StageMode } from './types';

interface Props {
  mode: StageMode;
  inlineButtons: InlineButtonRow[];
  setInlineButtons: (rows: InlineButtonRow[]) => void;
  onModeChange: (mode: StageMode) => void;
}

export function ButtonsStage({ mode, inlineButtons, setInlineButtons, onModeChange }: Props) {
  return (
    <div className={`workspace-page-rich-text-stage-view workspace-page-rich-text-buttons-stage ${mode === 'buttons' ? 'is-active' : ''}`} aria-hidden={mode !== 'buttons'}>
      <InlineKeyboardBuilder rows={inlineButtons} onChange={setInlineButtons} open={mode === 'buttons'} onClose={() => onModeChange('editor')} />
    </div>
  );
}