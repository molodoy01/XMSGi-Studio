import { useState } from 'react';
import type { DraftColor } from '@studio/types';
import { useLocale } from '@studio/lib/i18n';
import { DRAFT_COLOR_OPTIONS } from './DraftColorOptions';

interface Props {
  color: DraftColor;
  onChange: (color: DraftColor) => void;
  ariaLabel?: string;
}

export function DraftColorPicker({ color, onChange, ariaLabel }: Props) {
  const { t } = useLocale();
  const [hoveredColor, setHoveredColor] = useState<DraftColor | null>(null);
  const [focusedColor, setFocusedColor] = useState<DraftColor | null>(null);
  const displayedColor = hoveredColor ?? focusedColor ?? color;
  const displayedColorLabel = t(DRAFT_COLOR_OPTIONS.find((option) => option.value === displayedColor)?.labelKey ?? 'studio.colorGray');

  return (
    <div className="draft-color-control">
      <span className="draft-color-selected-label" data-color={displayedColor} aria-live="polite">{displayedColorLabel}</span>
      <div className="draft-color-picker" role="radiogroup" aria-label={ariaLabel ?? t('studio.draftColor')}>
        {DRAFT_COLOR_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`draft-color-swatch${color === option.value ? ' is-selected' : ''}`}
            data-color={option.value}
            role="radio"
            aria-label={t('studio.colorOption', { color: t(option.labelKey) })}
            aria-checked={color === option.value}
            title={t('studio.colorOption', { color: t(option.labelKey) })}
            onMouseEnter={() => setHoveredColor(option.value)}
            onMouseLeave={() => setHoveredColor(null)}
            onFocus={() => setFocusedColor(option.value)}
            onBlur={() => setFocusedColor(null)}
            onClick={() => onChange(option.value)}
          />
        ))}
      </div>
    </div>
  );
}