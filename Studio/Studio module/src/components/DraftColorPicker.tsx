import type { DraftColor } from '@/types';

const draftColorOptions: Array<{ value: DraftColor; label: string }> = [
  { value: 'gray', label: 'Gray' },
  { value: 'coral', label: 'Coral' },
  { value: 'amber', label: 'Amber' },
  { value: 'green', label: 'Green' },
  { value: 'teal', label: 'Teal' },
  { value: 'blue', label: 'Blue' },
];

interface Props {
  color: DraftColor;
  onChange: (color: DraftColor) => void;
  ariaLabel?: string;
}

export function DraftColorPicker({ color, onChange, ariaLabel = 'Draft color' }: Props) {
  const selectedColorLabel = draftColorOptions.find((option) => option.value === color)?.label ?? 'Gray';

  return (
    <div className="draft-color-control">
      <span className="draft-color-selected-label" aria-live="polite">{selectedColorLabel}</span>
      <div className="draft-color-picker" role="radiogroup" aria-label={ariaLabel}>
        {draftColorOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`draft-color-swatch${color === option.value ? ' is-selected' : ''}`}
            data-color={option.value}
            role="radio"
            aria-label={`${option.label} draft color`}
            aria-checked={color === option.value}
            title={`${option.label} draft color`}
            onClick={() => onChange(option.value)}
          />
        ))}
      </div>
    </div>
  );
}