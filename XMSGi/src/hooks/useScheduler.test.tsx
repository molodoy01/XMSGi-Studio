import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '@/lib/i18n';
import type { Chat, ScheduledMessage } from '@/types';
import { useScheduler } from './useScheduler';

function renderWorkspaceHistory(upcoming: ScheduledMessage[], sent: ScheduledMessage[], telegramOverrides: Record<string, unknown>, showNotification = vi.fn(), historyScope: 'personal' | 'workspace' = 'workspace', selectedChat: Chat | null = null) {
  const saveScheduleHistory = vi.fn().mockResolvedValue({ success: true });
  const loadScheduleHistory = vi.fn().mockResolvedValue({
    success: true,
    history: { upcoming, sent },
    needsMigration: false,
  });
  vi.stubGlobal('telegram', { loadScheduleHistory, saveScheduleHistory, ...telegramOverrides });

  const wrapper = ({ children }: PropsWithChildren) => <LocaleProvider>{children}</LocaleProvider>;
  const hook = renderHook(() => useScheduler({
    historyScope,
    connected: true,
    selectedChat,
    chats: selectedChat ? [selectedChat] : [],
    message: '',
    showNotification,
    setMessage: vi.fn(),
    setAssistantPrompt: vi.fn(),
    setAssistantResponse: vi.fn(),
    setAssistantIntent: vi.fn(),
  }), { wrapper });

  return {
    ...hook,
    saveScheduleHistory: (telegramOverrides.saveScheduleHistory as typeof saveScheduleHistory | undefined) ?? saveScheduleHistory,
    loadScheduleHistory,
    showNotification,
  };
}

describe('useScheduler native history', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
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

  it('restores Personal records from the separate personal history scope', async () => {
    const personalRecord: ScheduledMessage = {
      id: 'personal-restart-1',
      chatId: 'chat-1',
      chatName: 'Personal chat',
      text: 'Restore Personal history',
      when: '2035-01-15T17:42:00.000Z',
      createdAt: '2035-01-15T16:42:00.000Z',
      status: 'scheduled',
    };
    const { result, loadScheduleHistory } = renderWorkspaceHistory([personalRecord], [], {}, vi.fn(), 'personal');

    await waitFor(() => expect(result.current.upcoming).toEqual([personalRecord]));
    expect(loadScheduleHistory).toHaveBeenCalledWith('personal');
  });

  it('normalizes legacy confirmed records to Scheduled during restore', async () => {
    const legacyRecord: ScheduledMessage = {
      id: 'legacy-confirmed-1',
      chatId: 'chat-1',
      chatName: 'Test chat',
      text: 'Legacy schedule status',
      when: '2035-01-15T17:42:00.000Z',
      createdAt: '2035-01-15T16:42:00.000Z',
      status: 'confirmed',
    };
    const { result } = renderWorkspaceHistory([legacyRecord], [], {});

    await waitFor(() => expect(result.current.upcoming[0]).toMatchObject({
      id: legacyRecord.id,
      status: 'scheduled',
    }));
  });

  it('restores Failed without retrying it or moving it to Sent', async () => {
    const failedMessage: ScheduledMessage = {
      id: 'failed-after-restart',
      chatId: 'chat-1',
      chatName: 'Test chat',
      text: 'Retry after restart',
      when: '2035-01-15T17:42:00.000Z',
      createdAt: '2035-01-15T16:42:00.000Z',
      status: 'failed',
      lastError: 'Telegram rejected the previous attempt.',
      retryAction: 'send',
      sendAttemptId: '1736962920000:stable-attempt',
    };
    const schedule = vi.fn();
    const { result } = renderWorkspaceHistory([failedMessage], [], { schedule });

    await waitFor(() => expect(result.current.upcoming).toEqual([failedMessage]));

    expect(result.current.sent).toHaveLength(0);
    expect(schedule).not.toHaveBeenCalled();
  });

  it('does not mark a scheduled record sent when its time passes', async () => {
    const message: ScheduledMessage = {
      id: 'past-scheduled-1',
      chatId: 'chat-1',
      chatName: 'Test chat',
      text: 'Wait for Telegram confirmation',
      when: new Date(Date.now() - 60_000).toISOString(),
      createdAt: new Date(Date.now() - 120_000).toISOString(),
      status: 'scheduled',
      telegramMessageId: 'telegram-scheduled-1',
    };
    const { result } = renderWorkspaceHistory([message], [], {});

    await waitFor(() => expect(result.current.upcoming).toEqual([message]));

    expect(result.current.sent).toHaveLength(0);
  });

  it('keeps a new schedule Sending until the account rate-limit gate resumes', async () => {
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
      status: 'sending',
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
    await waitFor(() => expect(result.current.upcoming[0]).toMatchObject({ status: 'scheduled' }));
  });

  it('marks schedule failure Failed and retries through the same confirmed schedule flow', async () => {
    const chat = { id: 'chat-1', name: 'Test chat' };
    const future = new Date(Date.now() + 60 * 60 * 1000);
    const date = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-${String(future.getDate()).padStart(2, '0')}`;
    const time = `${String(future.getHours()).padStart(2, '0')}:${String(future.getMinutes()).padStart(2, '0')}`;
    const events: string[] = [];
    const saveScheduleHistory = vi.fn(async ({ field }: { field: string }) => {
      if (field === 'upcoming') events.push('persist');
      return { success: true };
    });
    const schedule = vi.fn()
      .mockImplementationOnce(async () => {
        events.push('schedule');
        return { success: false, error: 'Telegram schedule failed.' };
      })
      .mockImplementationOnce(async () => {
        events.push('schedule-retry');
        return { success: true, confirmed: true, telegramMessageId: 'telegram-retry-1' };
      });
    const { result } = renderWorkspaceHistory([], [], { schedule, saveScheduleHistory }, vi.fn(), 'workspace', chat);

    await waitFor(() => expect(result.current.scheduling).toBe(false));
    await act(async () => {
      result.current.handleSchedule({ chatId: chat.id, message: 'Retry schedule', date, time });
    });
    await waitFor(() => expect(result.current.upcoming[0]).toMatchObject({
      status: 'failed',
      lastError: 'Telegram schedule failed.',
      retryAction: 'schedule',
    }));
    expect(events.indexOf('persist')).toBeLessThan(events.indexOf('schedule'));

    await act(async () => {
      await result.current.handleRetry(result.current.upcoming[0]);
    });

    expect(result.current.upcoming[0]).toMatchObject({
      status: 'scheduled',
      telegramMessageId: 'telegram-retry-1',
    });
    expect(schedule).toHaveBeenCalledTimes(2);
    expect(events.indexOf('persist')).toBeLessThan(events.indexOf('schedule-retry'));
  });

  it.each([
    { length: 4097, attachments: [], limit: 4096 },
    { length: 1025, attachments: ['attachment.txt'], limit: 1024 },
  ])('rejects $length characters at scheduling time without truncating the draft', async ({ length, attachments, limit }) => {
    const chat = { id: 'chat-1', name: 'Test chat' };
    const schedule = vi.fn();
    const showNotification = vi.fn();
    const { result, loadScheduleHistory } = renderWorkspaceHistory(
      [],
      [],
      { schedule },
      showNotification,
      'workspace',
      chat,
    );
    const message = 'a'.repeat(length);

    await waitFor(() => expect(loadScheduleHistory).toHaveBeenCalled());
    act(() => {
      result.current.handleSchedule({
        chatId: chat.id,
        message,
        date: '2035-01-15',
        time: '18:00',
        attachments,
      });
    });

    expect(schedule).not.toHaveBeenCalled();
    expect(result.current.upcoming).toHaveLength(0);
    expect(showNotification).toHaveBeenCalledWith(
      expect.stringContaining(String(limit)),
      'warning',
      expect.any(String),
    );
  });

  it.each(['personal', 'workspace'] as const)('clears Sent through the existing %s scheduler scope', async (historyScope) => {
    const sentMessage: ScheduledMessage = {
      id: `sent-${historyScope}`,
      chatId: 'chat-1',
      chatName: 'Test chat',
      text: 'Clear this sent record',
      when: '2035-01-15T18:00:00.000Z',
      createdAt: '2035-01-15T17:00:00.000Z',
      sentAt: '2035-01-15T18:01:00.000Z',
      status: 'sent',
    };
    const { result, loadScheduleHistory, saveScheduleHistory } = renderWorkspaceHistory(
      [],
      [sentMessage],
      {},
      vi.fn(),
      historyScope,
    );

    await waitFor(() => expect(loadScheduleHistory).toHaveBeenCalledWith(historyScope));
    act(() => result.current.handleClearSent());

    await waitFor(() => expect(result.current.sent).toEqual([]));
    await waitFor(() => expect(saveScheduleHistory).toHaveBeenCalledWith({
      scope: historyScope,
      field: 'sent',
      messages: [],
    }));
  });

  it.each(['personal', 'workspace'] as const)('clears All through the existing %s scheduler scope after Telegram confirms cancellation', async (historyScope) => {
    const chat = { id: 'chat-1', name: 'Test chat' };
    const message: ScheduledMessage = {
      id: `scheduled-${historyScope}`,
      chatId: chat.id,
      chatName: chat.name,
      text: 'Cancel before clearing',
      when: '2035-01-15T18:00:00.000Z',
      createdAt: '2035-01-15T17:00:00.000Z',
      status: 'scheduled',
      telegramMessageId: `telegram-${historyScope}`,
    };
    const cancel = vi.fn().mockResolvedValue({ success: true });
    const { result, loadScheduleHistory, saveScheduleHistory } = renderWorkspaceHistory(
      [message],
      [],
      { cancel },
      vi.fn(),
      historyScope,
      chat,
    );
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    await waitFor(() => expect(loadScheduleHistory).toHaveBeenCalledWith(historyScope));
    act(() => result.current.handleClearAll());

    await waitFor(() => expect(result.current.upcoming).toEqual([]));
    expect(cancel).toHaveBeenCalledWith({ chatId: message.chatId, telegramMessageId: message.telegramMessageId });
    await waitFor(() => expect(saveScheduleHistory).toHaveBeenCalledWith({
      scope: historyScope,
      field: 'upcoming',
      messages: [],
    }));
  });

  it.each(['personal', 'workspace'] as const)('retains failed Telegram cancellations in the %s queue during Clear All', async (historyScope) => {
    const chat = { id: 'chat-1', name: 'Test chat' };
    const succeeded: ScheduledMessage = {
      id: `cancelled-${historyScope}`,
      chatId: chat.id,
      chatName: chat.name,
      text: 'Cancellation succeeds',
      when: '2035-01-15T18:00:00.000Z',
      createdAt: '2035-01-15T17:00:00.000Z',
      status: 'scheduled',
      telegramMessageId: `telegram-ok-${historyScope}`,
    };
    const failed: ScheduledMessage = {
      ...succeeded,
      id: `retained-${historyScope}`,
      text: 'Cancellation fails',
      telegramMessageId: `telegram-fail-${historyScope}`,
    };
    const cancel = vi.fn(({ telegramMessageId }: { telegramMessageId?: string | number }) => Promise.resolve({
      success: telegramMessageId === succeeded.telegramMessageId,
      ...(telegramMessageId === failed.telegramMessageId ? { error: 'Telegram cancellation failed.' } : {}),
    }));
    const showNotification = vi.fn();
    const { result, loadScheduleHistory, saveScheduleHistory } = renderWorkspaceHistory(
      [succeeded, failed],
      [],
      { cancel },
      showNotification,
      historyScope,
      chat,
    );
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    await waitFor(() => expect(loadScheduleHistory).toHaveBeenCalledWith(historyScope));
    act(() => result.current.handleClearAll());

    await waitFor(() => expect(result.current.upcoming).toEqual([failed]));
    expect(showNotification).toHaveBeenCalledWith(expect.any(String), 'warning', expect.any(String));
    await waitFor(() => expect(saveScheduleHistory).toHaveBeenCalledWith({
      scope: historyScope,
      field: 'upcoming',
      messages: [failed],
    }));
  });

  it('marks send-now as sent only after Telegram confirms success', async () => {
    const message: ScheduledMessage = {
      id: 'send-now-1',
      chatId: 'chat-1',
      chatName: 'Test chat',
      text: 'Send through Telegram',
      when: '2035-01-15T18:00:00.000Z',
      createdAt: '2035-01-15T17:00:00.000Z',
      status: 'scheduled',
      telegramMessageId: 'telegram-1',
      silent: true,
      effect: '12345',
    };
    const events: string[] = [];
    const cancel = vi.fn(async () => {
      events.push('cancel');
      return { success: true };
    });
    const send = vi.fn(async () => {
      events.push('send');
      return { success: true, messageId: 'sent-1' };
    });
    const saveScheduleHistory = vi.fn(async ({ field, messages }: { field: string; messages: ScheduledMessage[] }) => {
      if (field === 'upcoming' && messages.some((item) => item.id === message.id && item.telegramMessageId === undefined)) {
        events.push('persist-cleared-id');
      }
      return { success: true };
    });
    const { result } = renderWorkspaceHistory([message], [], { cancel, send, saveScheduleHistory });

    await waitFor(() => expect(result.current.upcoming).toEqual([message]));
    await act(async () => {
      await result.current.handleSendNow(message);
    });

    await waitFor(() => expect(result.current.sent).toHaveLength(1));
    expect(result.current.sent[0]).toMatchObject({ status: 'sent', sentAt: expect.any(String) });
    expect(result.current.upcoming).toHaveLength(0);
    expect(cancel).toHaveBeenCalledWith({
      chatId: message.chatId,
      telegramMessageId: message.telegramMessageId,
      message: message.text,
      targetTimestamp: Math.floor(new Date(message.when).getTime() / 1000),
    });
    expect(send).toHaveBeenCalledWith(
      message.chatId,
      message.text,
      [],
      [],
      undefined,
      true,
      '12345',
      'account-1',
      expect.stringMatching(/^\d+:[a-z0-9]+$/i),
    );
    expect(events.indexOf('cancel')).toBeLessThan(events.indexOf('persist-cleared-id'));
    expect(events.indexOf('persist-cleared-id')).toBeLessThan(events.indexOf('send'));
  });

  it('records Telegram reconciliation as Sent without sending a duplicate', async () => {
    const message: ScheduledMessage = {
      id: 'already-delivered-1',
      chatId: 'chat-1',
      chatName: 'Test chat',
      text: 'Telegram already delivered this',
      when: '2035-01-15T18:00:00.000Z',
      createdAt: '2035-01-15T17:00:00.000Z',
      status: 'scheduled',
      telegramMessageId: 'stale-schedule-id',
    };
    const cancel = vi.fn().mockResolvedValue({
      success: true,
      alreadySent: true,
      telegramMessageId: 'sent-telegram-id',
      sentAt: '2035-01-15T18:00:30.000Z',
    });
    const send = vi.fn();
    const { result } = renderWorkspaceHistory([message], [], { cancel, send });

    await waitFor(() => expect(result.current.upcoming).toEqual([message]));
    await act(async () => {
      await result.current.handleSendNow(message);
    });

    expect(result.current.upcoming).toHaveLength(0);
    expect(result.current.sent[0]).toMatchObject({
      id: message.id,
      status: 'sent',
      sentAt: '2035-01-15T18:00:30.000Z',
      telegramMessageId: 'sent-telegram-id',
    });
    expect(send).not.toHaveBeenCalled();
  });

  it('marks a rejected send-now as retryable Failed without marking it Sent', async () => {
    const message: ScheduledMessage = {
      id: 'send-now-failed',
      chatId: 'chat-1',
      chatName: 'Test chat',
      text: 'Telegram rejects this',
      when: '2035-01-15T18:00:00.000Z',
      createdAt: '2035-01-15T17:00:00.000Z',
      status: 'scheduled',
      telegramMessageId: 'telegram-schedule-to-cancel',
    };
    const showNotification = vi.fn();
    const cancel = vi.fn().mockResolvedValue({ success: true });
    const send = vi.fn()
      .mockResolvedValueOnce({ success: false, error: 'Telegram rejected the message.' })
      .mockResolvedValueOnce({ success: true, messageId: 'retry-sent' });
    const { result } = renderWorkspaceHistory([message], [], { cancel, send }, showNotification);

    await waitFor(() => expect(result.current.upcoming).toEqual([message]));
    await act(async () => {
      await result.current.handleSendNow(message);
    });

    await waitFor(() => expect(showNotification).toHaveBeenCalledWith(
      'Telegram rejected the message.',
      'error',
      expect.any(String),
    ));
    expect(result.current.upcoming[0]).toMatchObject({
      id: message.id,
      status: 'failed',
      lastError: 'Telegram rejected the message.',
      retryAction: 'send',
      telegramMessageId: undefined,
    });
    expect(result.current.sent).toHaveLength(0);

    const failedMessage = result.current.upcoming[0];
    await act(async () => {
      await result.current.handleRetry(failedMessage);
    });

    expect(result.current.sent).toHaveLength(1);
    expect(result.current.sent[0]).toMatchObject({ status: 'sent', id: message.id });
    expect(result.current.upcoming).toHaveLength(0);
    expect(cancel).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][8]).toBe(send.mock.calls[1][8]);
  });

  it('ignores a second concurrent Send Now call for the same record', async () => {
    const message: ScheduledMessage = {
      id: 'send-now-duplicate',
      chatId: 'chat-1',
      chatName: 'Test chat',
      text: 'Send once',
      when: '2035-01-15T18:00:00.000Z',
      createdAt: '2035-01-15T17:00:00.000Z',
      status: 'scheduled',
      telegramMessageId: 'telegram-scheduled-duplicate',
    };
    let resolveSend!: (result: { success: boolean }) => void;
    const send = vi.fn(() => new Promise<{ success: boolean }>((resolve) => { resolveSend = resolve; }));
    const cancel = vi.fn().mockResolvedValue({ success: true });
    const { result } = renderWorkspaceHistory([message], [], { cancel, send });

    await waitFor(() => expect(result.current.upcoming).toEqual([message]));
    let firstAttempt!: Promise<void>;
    await act(async () => {
      firstAttempt = result.current.handleSendNow(message);
      await Promise.resolve();
      await result.current.handleSendNow(message);
    });

    expect(cancel).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledOnce();
    await act(async () => {
      resolveSend({ success: true });
      await firstAttempt;
    });
    expect(result.current.sent).toHaveLength(1);
  });

  it('keeps the scheduled record and reports cancellation errors', async () => {
    const message: ScheduledMessage = {
      id: 'cancel-failed',
      chatId: 'chat-1',
      chatName: 'Test chat',
      text: 'Keep this scheduled',
      when: '2035-01-15T18:00:00.000Z',
      createdAt: '2035-01-15T17:00:00.000Z',
      status: 'scheduled',
      telegramMessageId: 'telegram-cancel-failed',
    };
    const showNotification = vi.fn();
    const cancel = vi.fn().mockResolvedValue({ success: false, error: 'Telegram cancellation failed.' });
    const { result } = renderWorkspaceHistory([message], [], { cancel }, showNotification);

    await waitFor(() => expect(result.current.upcoming).toEqual([message]));
    act(() => result.current.handleCancelMessage(message));

    await waitFor(() => expect(showNotification).toHaveBeenCalledWith(
      'Telegram cancellation failed.',
      'error',
      expect.any(String),
    ));
    expect(result.current.upcoming[0]).toMatchObject({
      id: message.id,
      status: 'failed',
      telegramMessageId: message.telegramMessageId,
      lastError: 'Telegram cancellation failed.',
      retryAction: 'cancel',
    });
    expect(result.current.sent).toHaveLength(0);
  });

  it('allows retrying cancellation after Telegram rejects the first attempt', async () => {
    const message: ScheduledMessage = {
      id: 'cancel-retry',
      chatId: 'chat-1',
      chatName: 'Test chat',
      text: 'Cancel twice only after failure',
      when: '2035-01-15T18:00:00.000Z',
      createdAt: '2035-01-15T17:00:00.000Z',
      status: 'scheduled',
      telegramMessageId: 'telegram-cancel-retry',
    };
    const cancel = vi.fn()
      .mockResolvedValueOnce({ success: false, error: 'Network unavailable.' })
      .mockResolvedValueOnce({ success: true });
    const { result, showNotification } = renderWorkspaceHistory([message], [], { cancel });

    await waitFor(() => expect(result.current.upcoming).toEqual([message]));
    act(() => result.current.handleCancelMessage(message));
    await waitFor(() => expect(showNotification).toHaveBeenCalledWith('Network unavailable.', 'error', expect.any(String)));
    expect(result.current.upcoming[0]).toMatchObject({
      id: message.id,
      status: 'failed',
      telegramMessageId: message.telegramMessageId,
      lastError: 'Network unavailable.',
      retryAction: 'cancel',
    });

    act(() => result.current.handleCancelMessage(message));
    await waitFor(() => expect(result.current.upcoming).toHaveLength(0));
    expect(cancel).toHaveBeenCalledTimes(2);
  });

  it('removes a scheduled record only after Telegram confirms cancellation', async () => {
    const message: ScheduledMessage = {
      id: 'cancel-success',
      chatId: 'chat-1',
      chatName: 'Test chat',
      text: 'Cancel through Telegram',
      when: '2035-01-15T18:00:00.000Z',
      createdAt: '2035-01-15T17:00:00.000Z',
      status: 'scheduled',
      telegramMessageId: 'telegram-cancel-success',
    };
    const cancel = vi.fn().mockResolvedValue({ success: true });
    const { result, saveScheduleHistory } = renderWorkspaceHistory([message], [], { cancel });

    await waitFor(() => expect(result.current.upcoming).toEqual([message]));
    act(() => result.current.handleCancelMessage(message));

    await waitFor(() => expect(result.current.upcoming).toHaveLength(0));
    expect(cancel).toHaveBeenCalledWith({
      chatId: message.chatId,
      telegramMessageId: message.telegramMessageId,
      message: message.text,
      targetTimestamp: Math.floor(new Date(message.when).getTime() / 1000),
    });
    await waitFor(() => expect(saveScheduleHistory).toHaveBeenCalledWith({ scope: 'workspace', field: 'upcoming', messages: [] }));
  });

  it('deletes a sent record through the existing local history handler', async () => {
    const message: ScheduledMessage = {
      id: 'delete-sent',
      chatId: 'chat-1',
      chatName: 'Test chat',
      text: 'Already sent',
      when: '2035-01-15T18:00:00.000Z',
      createdAt: '2035-01-15T17:00:00.000Z',
      sentAt: '2035-01-15T18:01:00.000Z',
      status: 'sent',
    };
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { result, saveScheduleHistory } = renderWorkspaceHistory([], [message], {});

    await waitFor(() => expect(result.current.sent).toEqual([message]));
    act(() => result.current.handleDeleteMessage(message));

    await waitFor(() => expect(result.current.sent).toHaveLength(0));
    expect(saveScheduleHistory).toHaveBeenCalledWith({ scope: 'workspace', field: 'sent', messages: [] });
  });
});