import { applyColorTheme, readColorTheme, type ColorTheme } from '../../src/lib/colorTheme';

export const TESTBENCH_COLOR_THEME_STORAGE_KEY = 'xmsgi-testbench-color-theme-v1';

export function readTestbenchColorTheme(): ColorTheme {
  return readColorTheme(TESTBENCH_COLOR_THEME_STORAGE_KEY);
}

export function applyTestbenchColorTheme(theme: ColorTheme, options: { animate?: boolean } = {}) {
  applyColorTheme(theme, { ...options, storageKey: TESTBENCH_COLOR_THEME_STORAGE_KEY });
}
