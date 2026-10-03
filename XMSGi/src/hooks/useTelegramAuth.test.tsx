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
});
