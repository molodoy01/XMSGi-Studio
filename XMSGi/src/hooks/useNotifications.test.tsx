import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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
});