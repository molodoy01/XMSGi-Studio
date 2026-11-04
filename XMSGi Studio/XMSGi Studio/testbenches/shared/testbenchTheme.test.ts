import { beforeEach, describe, expect, it } from 'vitest';
import { applyColorTheme, COLOR_THEME_STORAGE_KEY } from '../../src/lib/colorTheme';
import {
  applyTestbenchColorTheme,
  readTestbenchColorTheme,
  TESTBENCH_COLOR_THEME_STORAGE_KEY,
} from './testbenchTheme';

describe('testbench theme', () => {
  beforeEach(() => {
    window.localStorage.clear();
    applyColorTheme('light');
  });

  it('reads the testbench theme separately from the application theme', () => {
    window.localStorage.setItem(COLOR_THEME_STORAGE_KEY, 'dark');
    window.localStorage.setItem(TESTBENCH_COLOR_THEME_STORAGE_KEY, 'light');

    expect(readTestbenchColorTheme()).toBe('light');
  });

  it('applies and saves the testbench theme without changing the application preference', () => {
    window.localStorage.setItem(COLOR_THEME_STORAGE_KEY, 'light');

    applyTestbenchColorTheme('dark');

    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(window.localStorage.getItem(TESTBENCH_COLOR_THEME_STORAGE_KEY)).toBe('dark');
    expect(window.localStorage.getItem(COLOR_THEME_STORAGE_KEY)).toBe('light');
  });
});
