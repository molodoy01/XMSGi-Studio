import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LocaleProvider, useLocale, type Locale } from '@/lib/i18n';
import { useTelegramAuth } from './useTelegramAuth';

let setTestLocale: ((locale: Locale) => void) | undefined;

function LocaleSetterCapture() {
  setTestLocale = useLocale().setLocale;
  return null;
}

describe('useTelegramAuth', () => {
  it('handles a missing Telegram bridge gracefully', async () => {
    Reflect.deleteProperty(window, 'telegram');

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <LocaleProvider>{children}</LocaleProvider>
    );

    const { result } = renderHook(() =>
      useTelegramAuth({
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

  it('preserves a saved session through a failed connection and offline status', async () => {
    const previousTelegram = Object.getOwnPropertyDescriptor(window, 'telegram');
    let emitStatus: (status: unknown) => void = () => undefined;
    Object.defineProperty(window, 'telegram', {
      configurable: true,
      value: {
        getAuthState: vi.fn().mockResolvedValue({
          success: true,
          authState: { hasSession: true, signedOut: false, connected: false, userName: 'Alex', state: 'ready' },
        }),
        connect: vi.fn().mockResolvedValue({ success: false, error: 'ERR_INTERNET_DISCONNECTED' }),
        getStatus: vi.fn().mockResolvedValue({ success: true }),
        getRateLimitState: vi.fn().mockResolvedValue({ success: true }),
        onStatus: vi.fn((callback: (status: unknown) => void) => {
          emitStatus = callback;
          return vi.fn();
        }),
      },
    });

    try {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <LocaleProvider>{children}</LocaleProvider>
      );
      const { result } = renderHook(() => useTelegramAuth({
        setIsSettingsOpen: vi.fn(),
        setChats: vi.fn(),
        setSelectedChat: vi.fn(),
      }), { wrapper });

      await waitFor(() => expect(result.current.connectionResolved).toBe(true));
      expect(result.current.sessionAvailable).toBe(true);
      expect(result.current.connected).toBe(false);
      expect(result.current.signedOut).toBe(false);
      expect(result.current.authError).toBe('');

      act(() => emitStatus({ status: 'offline', connected: false }));
      expect(result.current.sessionAvailable).toBe(true);
      expect(result.current.signedOut).toBe(false);

      act(() => emitStatus({ status: 'connected', connected: true }));
      expect(result.current.sessionAvailable).toBe(true);
      expect(result.current.connected).toBe(true);

      act(() => emitStatus({ status: 'auth required', connected: false }));
      expect(result.current.sessionAvailable).toBe(false);
      expect(result.current.connected).toBe(false);
    } finally {
      if (previousTelegram) Object.defineProperty(window, 'telegram', previousTelegram);
      else Reflect.deleteProperty(window, 'telegram');
    }
  });

  it('ignores a stale connected status after Remember me has signed out', async () => {
    const previousTelegram = Object.getOwnPropertyDescriptor(window, 'telegram');
    let emitStatus: (status: unknown) => void = () => undefined;
    Object.defineProperty(window, 'telegram', {
      configurable: true,
      value: {
        getAuthState: vi.fn().mockResolvedValue({
          success: true,
          authState: { hasSession: true, signedOut: true, connected: false, userName: 'Alex', state: 'SIGNED_OUT' },
        }),
        getStatus: vi.fn().mockResolvedValue({ success: true }),
        getRateLimitState: vi.fn().mockResolvedValue({ success: true }),
        onStatus: vi.fn((callback: (status: unknown) => void) => {
          emitStatus = callback;
          return vi.fn();
        }),
      },
    });

    try {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <LocaleProvider>{children}</LocaleProvider>
      );
      const { result } = renderHook(() => useTelegramAuth({
        setIsSettingsOpen: vi.fn(),
        setChats: vi.fn(),
        setSelectedChat: vi.fn(),
      }), { wrapper });

      await waitFor(() => {
        expect(result.current.connectionResolved).toBe(true);
        expect(result.current.signedOut).toBe(true);
      });
      act(() => emitStatus('connected'));

      expect(result.current.connected).toBe(false);
      expect(result.current.signedOut).toBe(true);
    } finally {
      if (previousTelegram) Object.defineProperty(window, 'telegram', previousTelegram);
      else Reflect.deleteProperty(window, 'telegram');
    }
  });

  it('shows a user-friendly message when the auth-state IPC request is rejected', async () => {
    const previousTelegram = Object.getOwnPropertyDescriptor(window, 'telegram');
    const previousLocale = window.localStorage.getItem('awaitmsg_locale');
    window.localStorage.setItem('awaitmsg_locale', 'en');
    Object.defineProperty(window, 'telegram', {
      configurable: true,
      value: {
        getAuthState: vi.fn().mockRejectedValue(
          new Error("Error invoking remote method 'telegram-auth-state': Error: Untrusted renderer."),
        ),
      },
    });

    try {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <LocaleProvider>{children}</LocaleProvider>
      );
      const { result } = renderHook(() => useTelegramAuth({
        setIsSettingsOpen: vi.fn(),
        setChats: vi.fn(),
        setSelectedChat: vi.fn(),
      }), { wrapper });

      await waitFor(() => expect(result.current.connectionResolved).toBe(true));

      expect(result.current.authError).toBe('Couldn’t check your Telegram sign-in. Restart XMSGi.');
      expect(result.current.authError).not.toContain('Untrusted renderer');
      expect(result.current.authError).not.toContain('telegram-auth-state');
    } finally {
      if (previousTelegram) Object.defineProperty(window, 'telegram', previousTelegram);
      else Reflect.deleteProperty(window, 'telegram');
      if (previousLocale === null) window.localStorage.removeItem('awaitmsg_locale');
      else window.localStorage.setItem('awaitmsg_locale', previousLocale);
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
        setIsSettingsOpen: vi.fn(),
        setChats: vi.fn(),
        setSelectedChat: vi.fn(),
      }), { wrapper });

      await waitFor(() => expect(result.current.connectionResolved).toBe(true));
      await act(async () => result.current.handleTelegramAuth());

      expect(result.current.authError).toBe('Sign in to Telegram in the XMSGi desktop app.');
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
        <LocaleProvider><LocaleSetterCapture />{children}</LocaleProvider>
      );
      const { result } = renderHook(() => useTelegramAuth({
        setIsSettingsOpen: vi.fn(),
        setChats: vi.fn(),
        setSelectedChat: vi.fn(),
      }), { wrapper });

      await waitFor(() => expect(result.current.connectionResolved).toBe(true));
      await act(async () => result.current.handleTelegramAuth());

      expect(result.current.authError).toBe('Введите номер телефона с кодом страны.');
      expect(result.current.authError).not.toContain('auth.SendCode');
      await act(async () => setTestLocale?.('en'));
      expect(result.current.authError).toBe('Enter a valid phone number, including the country code.');
      await act(async () => setTestLocale?.('ru'));
      expect(result.current.authError).toBe('Введите номер телефона с кодом страны.');
    } finally {
      if (previousTelegram) Object.defineProperty(window, 'telegram', previousTelegram);
      else Reflect.deleteProperty(window, 'telegram');
      if (previousLocale === null) window.localStorage.removeItem('awaitmsg_locale');
      else window.localStorage.setItem('awaitmsg_locale', previousLocale);
    }
  });

  it('turns bridge network failures into the localized connection message', async () => {
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
        login: vi.fn().mockResolvedValue({
          success: false,
          error: 'TypeError: Failed to fetch (net::ERR_INTERNET_DISCONNECTED)',
        }),
      },
    });

    try {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <LocaleProvider>{children}</LocaleProvider>
      );
      const { result } = renderHook(() => useTelegramAuth({
        setIsSettingsOpen: vi.fn(),
        setChats: vi.fn(),
        setSelectedChat: vi.fn(),
      }), { wrapper });

      await waitFor(() => expect(result.current.connectionResolved).toBe(true));
      await act(async () => result.current.handleTelegramAuth());

      expect(result.current.authError).toBe('Can’t reach Telegram. Check your internet connection and try again.');
      expect(result.current.authError).not.toContain('ERR_INTERNET_DISCONNECTED');
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
        setIsSettingsOpen: vi.fn(),
        setChats: vi.fn(),
        setSelectedChat: vi.fn(),
      }), { wrapper });

      await waitFor(() => expect(result.current.signedOut).toBe(true));
      await act(async () => result.current.handleWelcomeBack());

      expect(welcomeBack).toHaveBeenCalledOnce();
      expect(result.current.authError).toBe('Session could not be restored.');
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
        setIsSettingsOpen: vi.fn(),
        setChats: vi.fn(),
        setSelectedChat: vi.fn(),
      }), { wrapper });

      await waitFor(() => expect(result.current.signedOut).toBe(true));
      const onRestored = vi.fn(() => {
        expect(result.current.connected).toBe(false);
        expect(result.current.signedOut).toBe(true);
      });
      await act(async () => result.current.handleWelcomeBack(onRestored));

      expect(welcomeBack).toHaveBeenCalledOnce();
      expect(onRestored).toHaveBeenCalledOnce();
      await waitFor(() => expect(result.current.connected).toBe(true));
      expect(result.current.signedOut).toBe(false);
    } finally {
      if (previousTelegram) Object.defineProperty(window, 'telegram', previousTelegram);
      else Reflect.deleteProperty(window, 'telegram');
    }
  });

  it('reports successful Remember me sign-out so the app can show the return screen', async () => {
    const previousTelegram = Object.getOwnPropertyDescriptor(window, 'telegram');
    const signOutKeepSession = vi.fn().mockResolvedValue({
      success: true,
      authState: { hasSession: true, signedOut: true, connected: false, userName: 'Alex', username: 'alex', state: 'SIGNED_OUT' },
    });
    Object.defineProperty(window, 'telegram', {
      configurable: true,
      value: {
        getAuthState: vi.fn().mockResolvedValue({
          success: true,
          authState: { hasSession: false, signedOut: false, connected: false, userName: '', state: 'NO_SESSION' },
        }),
        getStatus: vi.fn().mockResolvedValue({ success: true }),
        getRateLimitState: vi.fn().mockResolvedValue({ success: true }),
        signOutKeepSession,
      },
    });

    try {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <LocaleProvider>{children}</LocaleProvider>
      );
      const { result } = renderHook(() => useTelegramAuth({
        setIsSettingsOpen: vi.fn(),
        setChats: vi.fn(),
        setSelectedChat: vi.fn(),
      }), { wrapper });

      await waitFor(() => expect(result.current.connectionResolved).toBe(true));
      let signedOut = false;
      await act(async () => {
        signedOut = await result.current.handleDisconnect();
      });

      expect(signOutKeepSession).toHaveBeenCalledOnce();
      expect(signedOut).toBe(true);
      expect(result.current.signedOut).toBe(true);
      expect(result.current.connected).toBe(false);
    } finally {
      if (previousTelegram) Object.defineProperty(window, 'telegram', previousTelegram);
      else Reflect.deleteProperty(window, 'telegram');
    }
  });

  it('does not report Remember me sign-out when the request fails', async () => {
    const previousTelegram = Object.getOwnPropertyDescriptor(window, 'telegram');
    Object.defineProperty(window, 'telegram', {
      configurable: true,
      value: {
        getAuthState: vi.fn().mockResolvedValue({
          success: true,
          authState: { hasSession: false, signedOut: false, connected: false, userName: '', state: 'NO_SESSION' },
        }),
        getStatus: vi.fn().mockResolvedValue({ success: true }),
        getRateLimitState: vi.fn().mockResolvedValue({ success: true }),
        signOutKeepSession: vi.fn().mockResolvedValue({ success: false, error: 'Sign out failed.' }),
      },
    });

    try {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <LocaleProvider>{children}</LocaleProvider>
      );
      const { result } = renderHook(() => useTelegramAuth({
        setIsSettingsOpen: vi.fn(),
        setChats: vi.fn(),
        setSelectedChat: vi.fn(),
      }), { wrapper });

      await waitFor(() => expect(result.current.connectionResolved).toBe(true));
      let signedOut = true;
      await act(async () => {
        signedOut = await result.current.handleDisconnect();
      });

      expect(signedOut).toBe(false);
      expect(result.current.signedOut).toBe(false);
      expect(result.current.authError).toBe('Sign out failed.');
    } finally {
      if (previousTelegram) Object.defineProperty(window, 'telegram', previousTelegram);
      else Reflect.deleteProperty(window, 'telegram');
    }
  });

  it('preserves status snapshot identity when polling returns unchanged values', async () => {
    const previousTelegram = Object.getOwnPropertyDescriptor(window, 'telegram');
    const getStatus = vi.fn().mockResolvedValue({ success: true, accountId: 'account-1', status: 'normal' });
    const getRateLimitState = vi.fn().mockResolvedValue({
      success: true,
      current: { accountId: 'account-1', status: 'normal', category: null, paused: false, pausedUntil: null, remainingMs: 0 },
    });
    vi.useFakeTimers();
    Object.defineProperty(window, 'telegram', {
      configurable: true,
      value: {
        getAuthState: vi.fn().mockResolvedValue({
          success: true,
          authState: { hasSession: false, signedOut: false, connected: false, userName: '', state: 'NO_SESSION' },
        }),
        getStatus,
        getRateLimitState,
      },
    });

    try {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <LocaleProvider>{children}</LocaleProvider>
      );
      const { result, unmount } = renderHook(() => useTelegramAuth({
        setIsSettingsOpen: vi.fn(),
        setChats: vi.fn(),
        setSelectedChat: vi.fn(),
      }), { wrapper });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(result.current.connectionResolved).toBe(true);
      expect(result.current.telegramStatus).toMatchObject({ accountId: 'account-1', status: 'normal' });
      const statusSnapshot = result.current.telegramStatus;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });

      expect(getStatus).toHaveBeenCalledTimes(2);
      expect(getRateLimitState).toHaveBeenCalledTimes(2);
      expect(result.current.telegramStatus).toBe(statusSnapshot);
      unmount();
    } finally {
      vi.useRealTimers();
      if (previousTelegram) Object.defineProperty(window, 'telegram', previousTelegram);
      else Reflect.deleteProperty(window, 'telegram');
    }
  });
});
