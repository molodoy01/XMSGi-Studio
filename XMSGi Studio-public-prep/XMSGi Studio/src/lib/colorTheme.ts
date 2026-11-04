export type ColorTheme = 'light' | 'dark';

export const COLOR_THEME_STORAGE_KEY = 'xmsgi-color-theme-v1';
const THEME_TRANSITION_DURATION_MS = 320;
const THEME_TRANSITION_RESET_DELAY_MS = THEME_TRANSITION_DURATION_MS + 40;
let themeTransitionTimeout: number | undefined;

export function readColorTheme(storageKey = COLOR_THEME_STORAGE_KEY): ColorTheme {
  try {
    const savedTheme = window.localStorage.getItem(storageKey);
    return savedTheme === 'dark' || savedTheme === 'charcoal' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function applyColorTheme(theme: ColorTheme, options: { animate?: boolean; storageKey?: string } = {}) {
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    const baseTheme = theme === 'light' ? 'light' : 'dark';
    const themeChanged = root.dataset.theme !== baseTheme || root.dataset.themeVariant !== undefined;
    const prefersReducedMotion = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

    if (options.animate && themeChanged && !prefersReducedMotion) {
      if (themeTransitionTimeout !== undefined) window.clearTimeout(themeTransitionTimeout);
      root.classList.add('is-theme-transitioning');
      void root.offsetWidth;
      root.dataset.theme = baseTheme;
      delete root.dataset.themeVariant;
      root.style.colorScheme = baseTheme;
      themeTransitionTimeout = window.setTimeout(() => {
        root.classList.remove('is-theme-transitioning');
        themeTransitionTimeout = undefined;
      }, THEME_TRANSITION_RESET_DELAY_MS);
    } else {
      if (themeTransitionTimeout !== undefined) window.clearTimeout(themeTransitionTimeout);
      themeTransitionTimeout = undefined;
      root.classList.remove('is-theme-transitioning');
      root.dataset.theme = baseTheme;
      delete root.dataset.themeVariant;
      root.style.colorScheme = baseTheme;
    }
  }

  try {
    window.localStorage.setItem(options.storageKey ?? COLOR_THEME_STORAGE_KEY, theme);
  } catch {
    // Keep the current theme when browser storage is unavailable.
  }
}