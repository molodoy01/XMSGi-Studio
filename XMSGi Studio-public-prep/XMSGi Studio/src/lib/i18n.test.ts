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
    expect(result.current.t('schedule.massWarningTitle')).toBe('Mass scheduling warning');
    expect(result.current.t('schedule.massWarningMessage', { count: 10 })).toBe('10 messages · FloodWait risk');
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
    expect(result.current.t('schedule.massWarningTitle')).toBe('Массовое планирование');
    expect(result.current.t('schedule.massWarningMessage', { count: 10 })).toBe('10 сообщений · риск FloodWait');
    expect(result.current.t('settings.aboutDescription')).toBe('XMSGi Studio — Создавайте сообщения, храните идеи, планируйте отправку и держите всё под контролем — в одном удобном рабочем пространстве.');
    expect(window.localStorage.getItem('awaitmsg_locale')).toBe('ru');
  });

  it('uses concise, actionable Telegram auth errors in both languages', () => {
    const { result } = renderHook(() => useLocale(), { wrapper });
    const messages = [
      ['auth.noInternet', 'No internet connection. Reconnect and try again.', 'Нет подключения к интернету. Подключитесь к сети и попробуйте снова.'],
      ['auth.authorizationFailed', 'Telegram could not verify your sign-in. Try again.', 'Telegram не подтвердил вход. Попробуйте снова.'],
      ['auth.loginCodePlaceholder', 'Sent via Telegram', 'Из Telegram'],
      ['auth.twoFactorPassword', 'Two-step verification password', 'Пароль двухэтапной проверки'],
      ['auth.twoFactorPasswordPlaceholder', 'Your password', 'Ваш пароль'],
      ['auth.startOver', 'Use a different phone number', 'Начать заново с другим номером'],
      ['auth.loginHeroTaglineSub', 'Your content. Your studio.', 'Твой контент. Твоя студия.'],
      ['auth.returnToApp', 'Continue as {name}', 'Вернуться в приложение: {name}'],
      ['auth.invalidPhone', 'Enter a valid phone number, including the country code.', 'Введите номер телефона с кодом страны.'],
      ['auth.invalidCode', 'The Telegram code is incorrect. Check your latest message and try again.', 'Неверный код Telegram. Проверьте последнее сообщение и попробуйте снова.'],
      ['auth.expiredCode', 'The code expired. Request a new one.', 'Срок действия кода истёк. Запросите новый.'],
      ['auth.invalidPassword', 'The two-step verification password is incorrect. Try again.', 'Неверный пароль двухэтапной проверки. Попробуйте снова.'],
      ['auth.tooManyAttempts', 'Too many sign-in attempts. Wait a few minutes, then try again.', 'Слишком много попыток входа. Подождите несколько минут и попробуйте снова.'],
      ['auth.networkSignInError', 'Can’t reach Telegram. Check your internet connection and try again.', 'Нет связи с Telegram. Проверьте интернет и попробуйте снова.'],
      ['auth.genericSignInError', 'Telegram couldn’t complete sign-in. Try again or contact support.', 'Telegram не завершил вход. Попробуйте снова или обратитесь в поддержку.'],
      ['auth.desktopBridgeRequired', 'Sign in to Telegram in the XMSGi desktop app.', 'Войти в Telegram можно только в приложении XMSGi для компьютера.'],
      ['auth.enterTwoFactor', 'Code accepted. Your Telegram account has two-step verification enabled. Enter your password to continue.', 'Код подтверждён. В аккаунте включена двухэтапная проверка Telegram — введите пароль, чтобы продолжить.'],
      ['auth.disconnectFailed', 'Couldn’t sign out of Telegram. Try again.', 'Не удалось выйти из Telegram. Попробуйте снова.'],
      ['auth.restoreFailed', 'Couldn’t restore your saved Telegram session. Sign in again.', 'Не удалось восстановить сессию Telegram. Войдите снова.'],
      ['auth.removeFailed', 'Couldn’t remove your Telegram account. Try again.', 'Не удалось удалить аккаунт Telegram. Попробуйте снова.'],
      ['auth.readStateFailed', 'Couldn’t check your Telegram sign-in. Restart XMSGi.', 'Не удалось проверить вход в Telegram. Перезапустите XMSGi.'],
      ['auth.connectFailed', 'Couldn’t reconnect your saved Telegram session. Sign in again.', 'Не удалось подключить сохранённую сессию Telegram. Войдите снова.'],
      ['auth.readConnectionFailed', 'Couldn’t load Telegram settings. Restart XMSGi.', 'Не удалось загрузить настройки Telegram. Перезапустите XMSGi.'],
      ['auth.sessionExpired', 'Your Telegram session expired. Sign in again.', 'Сессия Telegram истекла. Войдите снова.'],
    ] as const;

    for (const [key, english] of messages) {
      expect(result.current.t(key)).toBe(english);
    }

    act(() => result.current.setLocale('ru'));
    for (const [key, , russian] of messages) {
      expect(result.current.t(key)).toBe(russian);
    }
  });

  it('has no missing interface translations in either locale', () => {
    expect(getMissingTranslationKeys('en')).toEqual([]);
    expect(getMissingTranslationKeys('ru')).toEqual([]);
  });
});
