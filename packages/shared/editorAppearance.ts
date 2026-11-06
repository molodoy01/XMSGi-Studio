export type EditorAppearanceMode = 'send' | 'schedule' | 'draft';
export type EditorAppearanceStyle = 'ambient' | 'outline' | 'monochrome';
export type EditorAppearancePalette = 'automatic' | 'custom';

export type EditorAppearancePreferences = {
  style: EditorAppearanceStyle;
  palette: EditorAppearancePalette;
  modeColors: Record<EditorAppearanceMode, string>;
};

export type EditorAppearanceCssTokens = {
  '--editor-outline': string;
  '--editor-outline-bright': string;
  '--editor-outline-secondary': string;
};

export const EDITOR_APPEARANCE_STORAGE_KEY = 'xmsgi-editor-appearance-v1';
export const EDITOR_APPEARANCE_UPDATED_EVENT = 'xmsgi-editor-appearance-updated';

export const DEFAULT_EDITOR_APPEARANCE: EditorAppearancePreferences = {
  style: 'outline',
  palette: 'automatic',
  modeColors: {
    send: '#239dfb',
    schedule: '#239dfb',
    draft: '#239dfb',
  },
};

const appearanceStyles: EditorAppearanceStyle[] = ['outline'];
const appearanceModes: EditorAppearanceMode[] = ['send', 'schedule', 'draft'];
const legacyAppearanceStyles: Record<string, EditorAppearanceStyle> = {
  ambient: 'outline',
  monochrome: 'outline',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function normalizeEditorAppearancePreferences(value: unknown): EditorAppearancePreferences {
  if (!isRecord(value)) {
    return {
      ...DEFAULT_EDITOR_APPEARANCE,
      modeColors: { ...DEFAULT_EDITOR_APPEARANCE.modeColors },
    };
  }

  const style = typeof value.style === 'string' && legacyAppearanceStyles[value.style as string]
    ? legacyAppearanceStyles[value.style as string]
    : appearanceStyles.includes(value.style as EditorAppearanceStyle)
      ? value.style as EditorAppearanceStyle
      : DEFAULT_EDITOR_APPEARANCE.style;
  return {
    style,
    palette: DEFAULT_EDITOR_APPEARANCE.palette,
    modeColors: Object.fromEntries(appearanceModes.map((mode) => (
      [mode, DEFAULT_EDITOR_APPEARANCE.modeColors[mode]]
    ))) as Record<EditorAppearanceMode, string>,
  };
}

export function readEditorAppearancePreferences(): EditorAppearancePreferences {
  if (typeof window === 'undefined') {
    return normalizeEditorAppearancePreferences(null);
  }

  try {
    const serialized = window.localStorage.getItem(EDITOR_APPEARANCE_STORAGE_KEY);
    return normalizeEditorAppearancePreferences(serialized ? JSON.parse(serialized) : null);
  } catch {
    return normalizeEditorAppearancePreferences(null);
  }
}

export function writeEditorAppearancePreferences(value: EditorAppearancePreferences) {
  if (typeof window === 'undefined') return false;

  try {
    const normalized = normalizeEditorAppearancePreferences(value);
    window.localStorage.setItem(EDITOR_APPEARANCE_STORAGE_KEY, JSON.stringify(normalized));
    window.dispatchEvent(new Event(EDITOR_APPEARANCE_UPDATED_EVENT));
    return true;
  } catch {
    return false;
  }
}

export function resolveEditorAppearanceColor(preferences: EditorAppearancePreferences, mode: EditorAppearanceMode) {
  return DEFAULT_EDITOR_APPEARANCE.modeColors[mode];
}

export function getEditorAppearanceCssTokens(
  preferences: EditorAppearancePreferences,
  mode: EditorAppearanceMode,
): EditorAppearanceCssTokens {
  const accent = resolveEditorAppearanceColor(preferences, mode).slice(1);
  const channels = [0, 2, 4].map((offset) => Number.parseInt(accent.slice(offset, offset + 2), 16));
  const toRgb = (values: number[]) => values.join(', ');
  const brighten = channels.map((channel) => Math.round(channel + (255 - channel) * 0.18));
  const soften = channels.map((channel) => Math.round(channel * 0.84 + 255 * 0.16));

  return {
    '--editor-outline': toRgb(channels),
    '--editor-outline-bright': toRgb(brighten),
    '--editor-outline-secondary': toRgb(soften),
  };
}
