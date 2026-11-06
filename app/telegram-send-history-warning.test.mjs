import { describe, expect, it, vi } from 'vitest';
import {
  createTelegramSendHistoryWarningNotifier,
  createRendererSendHistoryWarningSubscription,
  persistConfirmedSendResult,
} from './telegram-send-history-warning.cjs';

describe('confirmed send history persistence warnings', () => {
  it('warns once for a repeated late confirmation after history writes fail', () => {
    const webContents = { send: vi.fn(), isDestroyed: () => false };
    const notifier = createTelegramSendHistoryWarningNotifier(() => ({
      webContents,
      isDestroyed: () => false,
    }));
    const persist = vi.fn().mockReturnValue({
      historyPersisted: false,
      historyError: 'Disk full',
    });

    persistConfirmedSendResult('attempt-1', { telegramMessageId: 42 }, { persist, notifier });
    persistConfirmedSendResult('attempt-1', { telegramMessageId: 42 }, { persist, notifier });

    expect(persist).toHaveBeenCalledTimes(2);
    expect(webContents.send).toHaveBeenCalledOnce();
    expect(webContents.send).toHaveBeenCalledWith('telegram-send-history-warning');
  });

  it('queues a warning while the window is absent and flushes it when ready', () => {
    let currentWindow = null;
    const notifier = createTelegramSendHistoryWarningNotifier(() => currentWindow);
    notifier.report('attempt-1');

    const send = vi.fn();
    currentWindow = { webContents: { send, isDestroyed: () => false }, isDestroyed: () => false };
    notifier.flush();

    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith('telegram-send-history-warning');
  });

  it('delivers a warning received before the renderer subscribes and removes listeners', () => {
    let listener;
    const ipcRenderer = {
      on: vi.fn((channel, callback) => {
        expect(channel).toBe('telegram-send-history-warning');
        listener = callback;
      }),
    };
    const subscribe = createRendererSendHistoryWarningSubscription(ipcRenderer);
    listener();
    const callback = vi.fn();

    const unsubscribe = subscribe(callback);
    expect(callback).toHaveBeenCalledOnce();
    unsubscribe();
    listener();
    expect(callback).toHaveBeenCalledOnce();
  });

  it('clears a warning after a later persistence succeeds', () => {
    const send = vi.fn();
    const notifier = createTelegramSendHistoryWarningNotifier(() => ({
      webContents: { send, isDestroyed: () => false },
      isDestroyed: () => false,
    }));
    const persist = vi.fn()
      .mockReturnValueOnce({ historyPersisted: false, historyError: 'Disk full' })
      .mockReturnValueOnce({ historyPersisted: true })
      .mockReturnValueOnce({ historyPersisted: false, historyError: 'Disk full' });

    persistConfirmedSendResult('attempt-1', { telegramMessageId: 42 }, { persist, notifier });
    persistConfirmedSendResult('attempt-1', { telegramMessageId: 42 }, { persist, notifier });
    persistConfirmedSendResult('attempt-1', { telegramMessageId: 42 }, { persist, notifier });

    expect(send).toHaveBeenCalledTimes(2);
  });
});
