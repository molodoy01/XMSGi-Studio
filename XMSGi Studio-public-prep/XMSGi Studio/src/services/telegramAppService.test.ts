import { afterEach, describe, expect, it, vi } from 'vitest';
import { subscribeToConfirmedSendHistoryWarning } from './telegramAppService';

describe('confirmed Telegram send history warning', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('forwards the safe bridge event to the renderer warning notification', () => {
    let onWarning: (() => void) | undefined;
    const unsubscribe = vi.fn();
    vi.stubGlobal('window', {
      telegram: {
        onSendHistoryWarning(callback: () => void) {
          onWarning = callback;
          return unsubscribe;
        },
      },
    });
    const showNotification = vi.fn();
    const translate = (key: string) => key;

    const removeListener = subscribeToConfirmedSendHistoryWarning(showNotification, translate);
    onWarning?.();

    expect(showNotification).toHaveBeenCalledWith(
      'schedule.confirmedSendHistoryWriteFailed',
      'warning',
      'schedule.errorTitle',
    );
    removeListener();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
