import { describe, expect, it, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createElement, type PropsWithChildren } from 'react';
import { getMissingTranslationKeys, LocaleProvider, useLocale } from './i18n';

function wrapper({ children }: PropsWithChildren) {
  return createElement(LocaleProvider, null, children);
}

describe('i18n', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('uses English by default and translates parameters', () => {
    const { result } = renderHook(() => useLocale(), { wrapper });
    expect(result.current.locale).toBe('en');
    expect(result.current.t('schedule.repeatRange', { count: 15 })).toBe('Choose between 1 and 15 runs.');
    expect(result.current.t('settings.aboutDescription')).toBe('XMSGi Studio — Create messages, save ideas, schedule posts, and keep everything under control in one convenient workspace.');
  });

  it('keeps English as the default regardless of browser language', () => {
    Object.defineProperty(navigator, 'language', { configurable: true, value: 'ru-RU' });
    const { result } = renderHook(() => useLocale(), { wrapper });
    expect(result.current.locale).toBe('en');
  });

  it('persists and applies an explicit Russian selection immediately', () => {
    const { result } = renderHook(() => useLocale(), { wrapper });
    act(() => result.current.setLocale('ru'));
    expect(result.current.locale).toBe('ru');
    expect(result.current.t('settings.title')).toBe('Настройки');
    expect(result.current.t('settings.aboutDescription')).toBe('XMSGi Studio — Создавайте сообщения, храните идеи, планируйте отправку и держите всё под контролем — в одном удобном рабочем пространстве.');
    expect(window.localStorage.getItem('awaitmsg_locale')).toBe('ru');
  });

  it('has no missing interface translations in either locale', () => {
    expect(getMissingTranslationKeys('en')).toEqual([]);
    expect(getMissingTranslationKeys('ru')).toEqual([]);
  });
});
