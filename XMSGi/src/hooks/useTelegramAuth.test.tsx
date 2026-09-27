import { renderHook, waitFor } from '@testing-library/react';
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
});
