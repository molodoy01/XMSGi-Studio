import type { DraftColor } from '@studio/types';

export const DRAFT_COLOR_OPTIONS: Array<{
  value: DraftColor;
  labelKey: 'studio.colorGray' | 'studio.colorCoral' | 'studio.colorAmber' | 'studio.colorGreen' | 'studio.colorTeal' | 'studio.colorBlue';
}> = [
  { value: 'gray', labelKey: 'studio.colorGray' },
  { value: 'coral', labelKey: 'studio.colorCoral' },
  { value: 'amber', labelKey: 'studio.colorAmber' },
  { value: 'green', labelKey: 'studio.colorGreen' },
  { value: 'teal', labelKey: 'studio.colorTeal' },
  { value: 'blue', labelKey: 'studio.colorBlue' },
];
