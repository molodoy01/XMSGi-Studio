import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Chat } from '@/types';
import { useStudioScheduler } from './useStudioScheduler';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { publishToChannel } = vi.hoisted(() => ({
  publishToChannel: vi.fn(),
}));

vi.mock('@/services/publishingService', () => ({
  publishToChannel,
  scheduleToChannel: vi.fn(),
}));

vi.mock('@/lib/i18n', () => ({
  useLocale: () => ({
    locale: 'en',
    t: (key: string) => key,
  }),
}));

const chat: Chat = { id: 'chat-1', name: 'Test chat', type: 'group' };

function renderScheduler(showNotification = vi.fn()) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  let current!: ReturnType<typeof useStudioScheduler>;
  function Harness() {
    current = useStudioScheduler({
      accountId: 'account-1',
      chats: [chat],
      selectedChat: chat,
      showNotification,
    });
    return null;
  }
  act(() => root.render(createElement(Harness)));
  return {
    get result() { return current; },
    showNotification,
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('useStudioScheduler bridge errors', () => {
  beforeEach(() => {
    publishToChannel.mockReset();
  });

  it('preserves adapter FloodWait details in the Host/Studio notification', async () => {
    const errorDetails = {
      operation: 'publish' as const,
      category: 'flood' as const,
      retryable: true,
      message: 'Wait before retrying.',
      code: 'TELEGRAM_FLOOD_WAIT',
      waitSeconds: 12,
    };
    publishToChannel.mockResolvedValueOnce({
      publishResult: { ok: false, provider: 'telegram', error: errorDetails.message, errorDetails },
    });
    const { result, showNotification, unmount } = renderScheduler();

    await act(async () => {
      expect(await result.handleSendDraftNow(chat, 'Hello')).toBe(false);
    });

    expect(showNotification).toHaveBeenCalledWith(errorDetails.message, 'error', 'Studio', errorDetails);
    unmount();
  });

  it('reports an invalid schedule as a non-retryable validation error', async () => {
    const { result, showNotification, unmount } = renderScheduler();

    await act(async () => {
      await result.handleSchedule({
        chatId: chat.id,
        message: 'Hello',
        date: '2000-01-01',
        time: '00:00',
      });
    });

    expect(showNotification).toHaveBeenCalledWith('Дата и время должны быть в будущем.', 'error', 'Studio', {
      operation: 'validate',
      category: 'validation',
      retryable: false,
      message: 'Дата и время должны быть в будущем.',
      code: 'SCHEDULE_NOT_IN_FUTURE',
    });
    unmount();
  });
});