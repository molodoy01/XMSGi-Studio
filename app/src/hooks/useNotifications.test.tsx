import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useNotifications } from './useNotifications';

describe('useNotifications', () => {
  it('assigns a new revision when the same message is shown again', () => {
    const { result, unmount } = renderHook(() => useNotifications());

    act(() => {
      result.current.showNotification('Message cannot be empty.', 'warning', 'Empty message');
    });
    const firstRevision = result.current.notification.revision;

    act(() => {
      result.current.showNotification('Message cannot be empty.', 'warning', 'Empty message');
    });

    expect(result.current.notification.revision).toBeGreaterThan(firstRevision ?? 0);
    unmount();
  });

  it('auto-dismisses a warning after five seconds and can close it sooner', () => {
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() => useNotifications());

    act(() => {
      result.current.showNotification('10 messages · FloodWait risk', 'warning', 'Mass scheduling', undefined, 5000);
    });
    act(() => vi.advanceTimersByTime(4999));

    expect(result.current.notification.visible).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.notification.visible).toBe(false);

    act(() => result.current.showNotification('Risk', 'warning', 'Mass scheduling', undefined, 5000));
    act(() => result.current.closeNotification());
    expect(result.current.notification.visible).toBe(false);
    unmount();
    vi.useRealTimers();
  });
});