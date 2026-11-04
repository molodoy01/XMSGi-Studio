import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { applyColorTheme, COLOR_THEME_STORAGE_KEY, readColorTheme } from './colorTheme';

const themeBootstrap = readFileSync(path.resolve(process.cwd(), 'public', 'theme-init.js'), 'utf8');

describe('applyColorTheme', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.removeItem(COLOR_THEME_STORAGE_KEY);
    document.documentElement.dataset.theme = 'light';
    delete document.documentElement.dataset.themeVariant;
    document.documentElement.style.colorScheme = 'light';
    document.documentElement.classList.remove('is-theme-transitioning');
    applyColorTheme('light');
  });

  afterEach(() => {
    applyColorTheme('light');
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('keeps the synchronized color transition active until it finishes', () => {
    applyColorTheme('dark', { animate: true });

    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
    expect(document.documentElement).toHaveClass('is-theme-transitioning');
    expect(localStorage.getItem(COLOR_THEME_STORAGE_KEY)).toBe('dark');

    vi.advanceTimersByTime(319);
    expect(document.documentElement).toHaveClass('is-theme-transitioning');

    vi.advanceTimersByTime(41);
    expect(document.documentElement).not.toHaveClass('is-theme-transitioning');
  });

  it('restarts the transition timer when the theme changes again before completion', () => {
    applyColorTheme('dark', { animate: true });
    vi.advanceTimersByTime(240);

    applyColorTheme('light', { animate: true });
    vi.advanceTimersByTime(319);

    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.documentElement).toHaveClass('is-theme-transitioning');

    vi.advanceTimersByTime(41);
    expect(document.documentElement).not.toHaveClass('is-theme-transitioning');
  });

  it('uses the same color transition when the browser view transition API is available', () => {
    const viewTransitionDocument = document as Document & {
      startViewTransition?: (update: () => void) => unknown;
    };
    const startViewTransition = vi.fn((update: () => void) => {
      update();
      return {};
    });
    Object.defineProperty(viewTransitionDocument, 'startViewTransition', {
      configurable: true,
      value: startViewTransition,
    });

    try {
      applyColorTheme('dark', { animate: true });

      expect(startViewTransition).not.toHaveBeenCalled();
      expect(document.documentElement.dataset.theme).toBe('dark');
      expect(document.documentElement).toHaveClass('is-theme-transitioning');
    } finally {
      Reflect.deleteProperty(viewTransitionDocument, 'startViewTransition');
    }
  });

  it('applies the theme immediately when reduced motion is preferred', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: true,
      media: '(prefers-reduced-motion: reduce)',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    });

    applyColorTheme('dark', { animate: true });

    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement).not.toHaveClass('is-theme-transitioning');
  });

  it('treats a previously saved graphite theme as dark', () => {
    localStorage.setItem(COLOR_THEME_STORAGE_KEY, 'charcoal');
    expect(readColorTheme()).toBe('dark');

    applyColorTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.dataset.themeVariant).toBeUndefined();
  });

  it('restores the saved theme synchronously before the app renders', () => {
    localStorage.setItem(COLOR_THEME_STORAGE_KEY, 'dark');
    document.documentElement.dataset.theme = 'light';
    document.documentElement.style.colorScheme = 'light';

    new Function(themeBootstrap)();

    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
    expect(document.documentElement.style.backgroundColor).toBe('rgb(13, 17, 21)');
  });

  it('restores a previously saved graphite theme as dark before the app renders', () => {
    localStorage.setItem(COLOR_THEME_STORAGE_KEY, 'charcoal');
    document.documentElement.dataset.theme = 'light';
    document.documentElement.style.colorScheme = 'light';

    new Function(themeBootstrap)();

    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.dataset.themeVariant).toBeUndefined();
    expect(document.documentElement.style.colorScheme).toBe('dark');
    expect(document.documentElement.style.backgroundColor).toBe('rgb(13, 17, 21)');
  });
});
