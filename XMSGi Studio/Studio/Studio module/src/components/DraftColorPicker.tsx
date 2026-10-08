import type { DraftColor } from '@/types';
import { useLocale } from '@/lib/i18n';

const draftColorOptions: Array<{ value: DraftColor; labelKey: 'studio.colorGray' | 'studio.colorCoral' | 'studio.colorAmber' | 'studio.colorGreen' | 'studio.colorTeal' | 'studio.colorBlue' }> = [
  { value: 'gray', labelKey: 'studio.colorGray' },
  { value: 'coral', labelKey: 'studio.colorCoral' },
  { value: 'amber', labelKey: 'studio.colorAmber' },
  { value: 'green', labelKey: 'studio.colorGreen' },
  { value: 'teal', labelKey: 'studio.colorTeal' },
  { value: 'blue', labelKey: 'studio.colorBlue' },
];

interface Props {
  color: DraftColor;
  onChange: (color: DraftColor) => void;
  ariaLabel?: string;
}

export function DraftColorPicker({ color, onChange, ariaLabel }: Props) {
  const { t } = useLocale();
  const selectedColorLabel = t(draftColorOptions.find((option) => option.value === color)?.labelKey ?? 'studio.colorGray');

  return (
    <div className="draft-color-control">
      <span className="draft-color-selected-label" aria-live="polite">{selectedColorLabel}</span>
      <div className="draft-color-picker" role="radiogroup" aria-label={ariaLabel ?? t('studio.draftColor')}>
        {draftColorOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`draft-color-swatch${color === option.value ? ' is-selected' : ''}`}
            data-color={option.value}
            role="radio"
            aria-label={t('studio.colorOption', { color: t(option.labelKey) })}
            aria-checked={color === option.value}
            title={t('studio.colorOption', { color: t(option.labelKey) })}
            onClick={() => onChange(option.value)}
          />
        ))}
      </div>
    </div>
  );
}