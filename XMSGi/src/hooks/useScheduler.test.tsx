import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '@/lib/i18n';
import type { ScheduledMessage } from '@/types';
import { useScheduler } from './useScheduler';

describe('useScheduler native history', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('restores workspace messages and preserves the selected local time', async () => {
    const selectedLocalTime = new Date(2035, 0, 15, 17, 42, 0, 0);
    const when = selectedLocalTime.toISOString();
    const upcoming: ScheduledMessage[] = [{
      id: 'workspace-scheduled-1',
      operationId: 'workspace-scheduled-1',
      chatId: 'chat-1',
      chatName: 'Test chat',
      text: 'Stage A timezone check',
      when,
      createdAt: new Date().toISOString(),
      status: 'scheduled',
    }];
    const saveScheduleHistory = vi.fn().mockResolvedValue({ success: true });
    const loadScheduleHistory = vi.fn().mockResolvedValue({
      success: true,
      history: { upcoming, sent: [] },
      needsMigration: false,
    });
    vi.stubGlobal('telegram', { loadScheduleHistory, saveScheduleHistory });

    const wrapper = ({ children }: PropsWithChildren) => <LocaleProvider>{children}</LocaleProvider>;
    const { result } = renderHook(() => useScheduler({
      historyScope: 'workspace',
      connected: false,
      selectedChat: null,
      chats: [],
      message: '',
      showNotification: vi.fn(),
      setMessage: vi.fn(),
      setAssistantPrompt: vi.fn(),
      setAssistantResponse: vi.fn(),
      setAssistantIntent: vi.fn(),
    }), { wrapper });

    await waitFor(() => expect(result.current.upcoming).toEqual(upcoming));

    const restoredTime = new Date(result.current.upcoming[0].when);
    expect([restoredTime.getFullYear(), restoredTime.getMonth(), restoredTime.getDate(), restoredTime.getHours(), restoredTime.getMinutes()])
      .toEqual([2035, 0, 15, 17, 42]);
    expect(loadScheduleHistory).toHaveBeenCalledWith('workspace');
    expect(saveScheduleHistory).toHaveBeenCalledWith({ scope: 'workspace', field: 'upcoming', messages: upcoming });
  });

  it('keeps a new schedule pending until the account rate-limit gate resumes', async () => {
    const chat = { id: 'chat-1', name: 'Test chat' };
    const future = new Date(Date.now() + 60 * 60 * 1000);
    const date = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-${String(future.getDate()).padStart(2, '0')}`;
    const time = `${String(future.getHours()).padStart(2, '0')}:${String(future.getMinutes()).padStart(2, '0')}`;
    let resumeRateLimit!: (value: { success: boolean }) => void;
    const rateLimitGate = new Promise<{ success: boolean }>((resolve) => { resumeRateLimit = resolve; });
    const waitForRateLimit = vi.fn(() => rateLimitGate);
    const schedule = vi.fn().mockResolvedValue({ success: true, confirmed: true, id: 'telegram-scheduled-1' });
    const showNotification = vi.fn();
    const loadScheduleHistory = vi.fn().mockResolvedValue({
      success: true,
      history: { upcoming: [], sent: [] },
      needsMigration: false,
    });
    vi.stubGlobal('telegram', {
      loadScheduleHistory,
      saveScheduleHistory: vi.fn().mockResolvedValue({ success: true }),
      waitForRateLimit,
      schedule,
    });

    const wrapper = ({ children }: PropsWithChildren) => <LocaleProvider>{children}</LocaleProvider>;
    const { result } = renderHook(() => useScheduler({
      historyScope: 'workspace',
      connected: false,
      selectedChat: chat,
      chats: [chat],
      message: 'Wait for the account gate',
      showNotification,
      setMessage: vi.fn(),
      setAssistantPrompt: vi.fn(),
      setAssistantResponse: vi.fn(),
      setAssistantIntent: vi.fn(),
    }), { wrapper });

    await waitFor(() => expect(loadScheduleHistory).toHaveBeenCalledWith('workspace'));
    await waitFor(() => expect(result.current.scheduling).toBe(false));
    await act(async () => {
      result.current.handleSchedule({
        chatId: chat.id,
        message: 'Wait for the account gate',
        date,
        time,
      }, { mode: 'none', occurrences: 1 });
      await Promise.resolve();
    });
    await waitFor(() => expect(waitForRateLimit).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.upcoming[0]).toMatchObject({
      chatId: chat.id,
      status: 'pending',
    }));

    expect(schedule).not.toHaveBeenCalled();

    await act(async () => {
      resumeRateLimit({ success: true });
    });
    await waitFor(() => expect(schedule).toHaveBeenCalledTimes(1));
    expect(schedule).toHaveBeenCalledWith(expect.objectContaining({
      chatId: chat.id,
      message: 'Wait for the account gate',
    }));
  });
});