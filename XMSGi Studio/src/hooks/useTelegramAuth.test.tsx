import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '@/lib/i18n';
import { useTelegramAuth } from './useTelegramAuth';

describe('useTelegramAuth', () => {
  it('handles a missing Telegram bridge gracefully', async () => {
    Reflect.deleteProperty(window, 'telegram');

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <LocaleProvider>{children}</LocaleProvider>
    );

    const { result } = renderHook(() =>
      useTelegramAuth({
        showNotification: vi.fn(),
        setIsSettingsOpen: vi.fn(),
        setChats: vi.fn(),
        setSelectedChat: vi.fn(),
      }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.connectionResolved).toBe(true);
    });

    expect(result.current.connected).toBe(false);
    expect(result.current.authError).toBe('');
  });

  it('does not show the returning-user state when there is no saved session', async () => {
    const previousTelegram = Object.getOwnPropertyDescriptor(window, 'telegram');
    Object.defineProperty(window, 'telegram', {
      configurable: true,
      value: {
        getAuthState: vi.fn().mockResolvedValue({
          success: true,
          authState: { hasSession: false, signedOut: true, connected: false, userName: '', state: 'ready' },
        }),
      },
    });

    try {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <LocaleProvider>{children}</LocaleProvider>
      );
      const { result } = renderHook(() => useTelegramAuth({
        showNotification: vi.fn(),
        setIsSettingsOpen: vi.fn(),
        setChats: vi.fn(),
        setSelectedChat: vi.fn(),
      }), { wrapper });

      await waitFor(() => expect(result.current.connectionResolved).toBe(true));
      expect(result.current.signedOut).toBe(false);
      expect(result.current.connected).toBe(false);
    } finally {
      if (previousTelegram) Object.defineProperty(window, 'telegram', previousTelegram);
      else Reflect.deleteProperty(window, 'telegram');
    }
  });

  it('shows a desktop-runtime message when the bridge has no login method', async () => {
    const previousTelegram = Object.getOwnPropertyDescriptor(window, 'telegram');
    const previousLocale = window.localStorage.getItem('awaitmsg_locale');
    window.localStorage.setItem('awaitmsg_locale', 'en');
    Object.defineProperty(window, 'telegram', {
      configurable: true,
      value: {
        getAuthState: vi.fn().mockResolvedValue({
          success: true,
          authState: { hasSession: false, signedOut: false, connected: false, userName: '', state: 'ready' },
        }),
      },
    });

    try {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <LocaleProvider>{children}</LocaleProvider>
      );
      const { result } = renderHook(() => useTelegramAuth({
        showNotification: vi.fn(),
        setIsSettingsOpen: vi.fn(),
        setChats: vi.fn(),
        setSelectedChat: vi.fn(),
      }), { wrapper });

      await waitFor(() => expect(result.current.connectionResolved).toBe(true));
      await act(async () => result.current.handleTelegramAuth());

      expect(result.current.authError).toBe('Telegram sign-in is available only in the XMSGi desktop app.');
    } finally {
      if (previousTelegram) Object.defineProperty(window, 'telegram', previousTelegram);
      else Reflect.deleteProperty(window, 'telegram');
      if (previousLocale === null) window.localStorage.removeItem('awaitmsg_locale');
      else window.localStorage.setItem('awaitmsg_locale', previousLocale);
    }
  });

  it('turns Telegram invalid-phone errors into a clear localized message', async () => {
    const previousTelegram = Object.getOwnPropertyDescriptor(window, 'telegram');
    const previousLocale = window.localStorage.getItem('awaitmsg_locale');
    window.localStorage.setItem('awaitmsg_locale', 'ru');
    Object.defineProperty(window, 'telegram', {
      configurable: true,
      value: {
        getAuthState: vi.fn().mockResolvedValue({
          success: true,
          authState: { hasSession: false, signedOut: false, connected: false, userName: '', state: 'ready' },
        }),
        login: vi.fn().mockResolvedValue({
          success: false,
          error: 'The phone number is invalid. (caused by auth.SendCode)',
        }),
      },
    });

    try {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <LocaleProvider>{children}</LocaleProvider>
      );
      const { result } = renderHook(() => useTelegramAuth({
        showNotification: vi.fn(),
        setIsSettingsOpen: vi.fn(),
        setChats: vi.fn(),
        setSelectedChat: vi.fn(),
      }), { wrapper });

      await waitFor(() => expect(result.current.connectionResolved).toBe(true));
      await act(async () => result.current.handleTelegramAuth());

      expect(result.current.authError).toBe('Проверьте номер телефона и код страны.');
      expect(result.current.authError).not.toContain('auth.SendCode');
    } finally {
      if (previousTelegram) Object.defineProperty(window, 'telegram', previousTelegram);
      else Reflect.deleteProperty(window, 'telegram');
      if (previousLocale === null) window.localStorage.removeItem('awaitmsg_locale');
      else window.localStorage.setItem('awaitmsg_locale', previousLocale);
    }
  });

  it('restores the saved account and reports a failed one-click reconnect', async () => {
    const previousTelegram = Object.getOwnPropertyDescriptor(window, 'telegram');
    const previousLocale = window.localStorage.getItem('awaitmsg_locale');
    const showNotification = vi.fn();
    const welcomeBack = vi.fn().mockResolvedValue({ success: false, error: 'Session could not be restored.' });
    window.localStorage.setItem('awaitmsg_locale', 'en');
    Object.defineProperty(window, 'telegram', {
      configurable: true,
      value: {
        getAuthState: vi.fn().mockResolvedValue({
          success: true,
          authState: { hasSession: true, signedOut: true, connected: false, userName: 'Alex', username: 'alex', state: 'ready' },
        }),
        welcomeBack,
      },
    });

    try {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <LocaleProvider>{children}</LocaleProvider>
      );
      const { result } = renderHook(() => useTelegramAuth({
        showNotification,
        setIsSettingsOpen: vi.fn(),
        setChats: vi.fn(),
        setSelectedChat: vi.fn(),
      }), { wrapper });

      await waitFor(() => expect(result.current.signedOut).toBe(true));
      await act(async () => result.current.handleWelcomeBack());

      expect(welcomeBack).toHaveBeenCalledOnce();
      expect(showNotification).toHaveBeenCalledWith('Session could not be restored.', 'error', 'Error');
    } finally {
      if (previousTelegram) Object.defineProperty(window, 'telegram', previousTelegram);
      else Reflect.deleteProperty(window, 'telegram');
      if (previousLocale === null) window.localStorage.removeItem('awaitmsg_locale');
      else window.localStorage.setItem('awaitmsg_locale', previousLocale);
    }
  });

  it('returns to the connected state after a successful one-click reconnect', async () => {
    const previousTelegram = Object.getOwnPropertyDescriptor(window, 'telegram');
    const welcomeBack = vi.fn().mockResolvedValue({
      success: true,
      authState: { hasSession: true, signedOut: false, connected: true, userName: 'Alex', username: 'alex', state: 'ready' },
    });
    Object.defineProperty(window, 'telegram', {
      configurable: true,
      value: {
        getAuthState: vi.fn().mockResolvedValue({
          success: true,
          authState: { hasSession: true, signedOut: true, connected: false, userName: 'Alex', username: 'alex', state: 'ready' },
        }),
        welcomeBack,
      },
    });

    try {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <LocaleProvider>{children}</LocaleProvider>
      );
      const { result } = renderHook(() => useTelegramAuth({
        showNotification: vi.fn(),
        setIsSettingsOpen: vi.fn(),
        setChats: vi.fn(),
        setSelectedChat: vi.fn(),
      }), { wrapper });

      await waitFor(() => expect(result.current.signedOut).toBe(true));
      await act(async () => result.current.handleWelcomeBack());

      expect(welcomeBack).toHaveBeenCalledOnce();
      await waitFor(() => expect(result.current.connected).toBe(true));
      expect(result.current.signedOut).toBe(false);
    } finally {
      if (previousTelegram) Object.defineProperty(window, 'telegram', previousTelegram);
      else Reflect.deleteProperty(window, 'telegram');
    }
  });
});
