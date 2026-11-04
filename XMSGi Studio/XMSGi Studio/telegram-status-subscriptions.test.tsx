import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { StrictMode, type PropsWithChildren } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider, useLocale } from '@/lib/i18n';
import { useTelegramAuth } from './src/hooks/useTelegramAuth';

const nodeRequire = createRequire(import.meta.url);
const nodeModule = nodeRequire('node:module');
const originalLoad = nodeModule._load;
const preloadPath = nodeRequire.resolve('./preload.cjs');

function loadPreload() {
  delete nodeRequire.cache[preloadPath];
  const ipcRenderer = new EventEmitter();
  const exposed: Record<string, unknown> = {};
  const electron = {
    contextBridge: {
      exposeInMainWorld: (name: string, value: unknown) => { exposed[name] = value; },
    },
    ipcRenderer,
    webUtils: { getPathForFile: () => '' },
  };

  nodeModule._load = function load(request, parent, isMain) {
    if (request === 'electron') return electron;
    return originalLoad(request, parent, isMain);
  };
  try {
    nodeRequire('./preload.cjs');
  } finally {
    nodeModule._load = originalLoad;
  }

  return {
    ipcRenderer,
    telegram: exposed.telegram as Window['telegram'],
  };
}

afterEach(() => {
  nodeModule._load = originalLoad;
  delete nodeRequire.cache[preloadPath];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Telegram status subscriptions', () => {
  it('registers exactly one listener and forwards status events', () => {
    const { ipcRenderer, telegram } = loadPreload();
    const callback = vi.fn();
    const unsubscribe = telegram.onStatus(callback);

    expect(ipcRenderer.listenerCount('telegram-status')).toBe(1);
    ipcRenderer.emit('telegram-status', {}, { status: 'connected' });
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith({ status: 'connected' });
    unsubscribe();
  });

  it('deduplicates repeated registration of the same callback', () => {
    const { ipcRenderer, telegram } = loadPreload();
    const callback = vi.fn();
    const unsubscribeFirst = telegram.onStatus(callback);
    const unsubscribeSecond = telegram.onStatus(callback);

    expect(ipcRenderer.listenerCount('telegram-status')).toBe(1);
    ipcRenderer.emit('telegram-status', {}, 'reconnecting');
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith('reconnecting');

    unsubscribeFirst();
    expect(ipcRenderer.listenerCount('telegram-status')).toBe(1);
    unsubscribeSecond();
    expect(ipcRenderer.listenerCount('telegram-status')).toBe(0);
  });

  it('does not call an unsubscribed callback', () => {
    const { ipcRenderer, telegram } = loadPreload();
    const callback = vi.fn();
    const unsubscribe = telegram.onStatus(callback);

    unsubscribe();
    unsubscribe();
    ipcRenderer.emit('telegram-status', {}, { status: 'disconnected' });

    expect(callback).not.toHaveBeenCalled();
    expect(ipcRenderer.listenerCount('telegram-status')).toBe(0);
  });

  it('reconnects with only the new subscription active', () => {
    const { ipcRenderer, telegram } = loadPreload();
    const oldCallback = vi.fn();
    const newCallback = vi.fn();
    const unsubscribeOld = telegram.onStatus(oldCallback);

    ipcRenderer.emit('telegram-status', {}, { status: 'disconnected' });
    unsubscribeOld();
    const unsubscribeNew = telegram.onStatus(newCallback);
    ipcRenderer.emit('telegram-status', {}, { status: 'connected' });

    expect(oldCallback).toHaveBeenCalledTimes(1);
    expect(oldCallback).toHaveBeenCalledWith({ status: 'disconnected' });
    expect(newCallback).toHaveBeenCalledTimes(1);
    expect(newCallback).toHaveBeenCalledWith({ status: 'connected' });
    expect(ipcRenderer.listenerCount('telegram-status')).toBe(1);
    unsubscribeNew();
  });

  it('keeps hook status handling active through locale reinitialization and cleans up on unmount', async () => {
    const { ipcRenderer, telegram } = loadPreload();
    vi.stubGlobal('telegram', {
      ...telegram,
      getAuthState: vi.fn().mockResolvedValue({
        success: true,
        authState: { hasSession: false, signedOut: false, connected: false, userName: '' },
      }),
      getStatus: vi.fn().mockResolvedValue({ success: true, status: 'normal', accountId: 'account-1' }),
      getRateLimitState: vi.fn().mockResolvedValue({
        success: true,
        current: { accountId: 'account-1', paused: false, pausedUntil: null, remainingMs: 0, status: 'normal' },
      }),
    });

    let setTestLocale: ((locale: 'en' | 'ru') => void) | undefined;
    function LocaleHarness({ children }: PropsWithChildren) {
      return (
        <LocaleProvider>
          <LocaleController onReady={(setLocale) => { setTestLocale = setLocale; }}>
            {children}
          </LocaleController>
        </LocaleProvider>
      );
    }
    function LocaleController({ children, onReady }: PropsWithChildren<{ onReady: (setLocale: (locale: 'en' | 'ru') => void) => void }>) {
      const { setLocale } = useLocale();
      onReady(setLocale);
      return children;
    }

    const { result, unmount } = renderHook(() => useTelegramAuth({
      showNotification: vi.fn(),
      setIsSettingsOpen: vi.fn(),
      setChats: vi.fn(),
      setSelectedChat: vi.fn(),
    }), { wrapper: ({ children }) => <StrictMode><LocaleHarness>{children}</LocaleHarness></StrictMode> });

    await waitFor(() => expect(result.current.connectionResolved).toBe(true));
    expect(ipcRenderer.listenerCount('telegram-status')).toBe(1);

    act(() => setTestLocale?.('ru'));
    expect(ipcRenderer.listenerCount('telegram-status')).toBe(1);
    act(() => ipcRenderer.emit('telegram-status', {}, { status: 'connected', connected: true }));
    expect(result.current.connected).toBe(true);
    expect(result.current.telegramStatus.status).toBe('normal');

    act(() => ipcRenderer.emit('telegram-status', {}, { status: 'disconnected', connected: false }));
    expect(result.current.connected).toBe(false);
    unmount();
    expect(ipcRenderer.listenerCount('telegram-status')).toBe(0);
  });
});