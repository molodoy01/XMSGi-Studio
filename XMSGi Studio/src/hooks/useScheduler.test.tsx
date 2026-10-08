import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '@/lib/i18n';
import type { Chat, ScheduledMessage } from '@/types';
import { useScheduler } from './useScheduler';

function createScheduleIdentityResult(operations: Array<Record<string, unknown>>) {
  return {
    success: true,
    identities: operations.map((operation) => JSON.stringify({
      target: String(operation.chatId),
      message: operation.message,
      targetTimestamp: operation.targetTimestamp,
      attachmentHashes: operation.attachments ?? [],
      entities: operation.entities ?? [],
      replyMarkup: operation.replyMarkup ?? null,
      silent: operation.silent === true,
      effect: operation.effect === undefined || operation.effect === null ? null : String(operation.effect),
    }) ?? ''),
  };
}

function localDateTimeAt(timestamp: number) {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  };
}

function getFutureReplacementTimes() {
  const original = new Date(Date.now() + 30 * 60 * 1000);
  original.setSeconds(0, 0);
  const replacement = new Date(Date.now() + 60 * 60 * 1000);
  replacement.setSeconds(0, 0);
  return {
    originalWhen: original.toISOString(),
    replacementDateTime: localDateTimeAt(replacement.getTime()),
  };
}

function renderWorkspaceHistory(upcoming: ScheduledMessage[], sent: ScheduledMessage[], telegramOverrides: Record<string, unknown>, showNotification = vi.fn(), historyScope: 'personal' | 'workspace' = 'workspace', selectedChat: Chat | null = null) {
  const saveScheduleHistory = vi.fn().mockResolvedValue({ success: true });
  const loadScheduleHistory = vi.fn().mockResolvedValue({
    success: true,
    history: { upcoming, sent },
    needsMigration: false,
  });
  vi.stubGlobal('telegram', {
    loadScheduleHistory,
    saveScheduleHistory,
    getScheduleIdentities: vi.fn(async (operations: Array<Record<string, unknown>>) => createScheduleIdentityResult(operations)),
    ...telegramOverrides,
  });

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
      getScheduleIdentities: vi.fn(async (operations: Array<Record<string, unknown>>) => createScheduleIdentityResult(operations)),
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
    { label: 'within the limit', offset: 366 * 24 * 60 * 60 * 1000, accepted: true },
    { label: 'exactly at the limit', offset: 367 * 24 * 60 * 60 * 1000, accepted: true },
    { label: 'beyond the limit', offset: 367 * 24 * 60 * 60 * 1000 + 60 * 1000, accepted: false },
  ])('enforces Telegram’s 367-day limit for a date $label', async ({ offset, accepted }) => {
    const now = new Date(2035, 0, 1, 12, 0, 0, 0).getTime();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const chat = { id: 'chat-1', name: 'Test chat' };
    const schedule = vi.fn().mockResolvedValue({
      success: true,
      confirmed: true,
      telegramMessageId: 'telegram-scheduled-1',
    });
    const showNotification = vi.fn();
    const { result, loadScheduleHistory, saveScheduleHistory } = renderWorkspaceHistory(
      [],
      [],
      { schedule },
      showNotification,
      'workspace',
      chat,
    );
    const selectedDateTime = localDateTimeAt(now + offset);

    await waitFor(() => expect(loadScheduleHistory).toHaveBeenCalledWith('workspace'));
    const historyWritesAfterRestore = saveScheduleHistory.mock.calls.length;
    await act(async () => {
      await result.current.handleSchedule({
        chatId: chat.id,
        message: 'Schedule limit check',
        ...selectedDateTime,
      });
    });

    if (accepted) {
      await waitFor(() => expect(schedule).toHaveBeenCalledOnce());
      expect(result.current.upcoming).toHaveLength(1);
      expect(schedule).toHaveBeenCalledWith(expect.objectContaining({
        targetTimestamp: Math.floor((now + offset) / 1000),
      }));
    } else {
      expect(schedule).not.toHaveBeenCalled();
      expect(result.current.upcoming).toHaveLength(0);
      expect(saveScheduleHistory).toHaveBeenCalledTimes(historyWritesAfterRestore);
      expect(showNotification).toHaveBeenCalledWith(
        expect.stringContaining('367'),
        'warning',
        expect.any(String),
        expect.objectContaining({ operation: 'validate', category: 'validation', retryable: false, code: 'SCHEDULE_TOO_FAR' }),
      );
    }
  });

  it('keeps partial fallback IDs in history and sends all of them on manual cancel retry', async () => {
    const chat = { id: 'chat-1', name: 'Test chat' };
    const future = new Date(Date.now() + 60 * 60 * 1000);
    const date = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-${String(future.getDate()).padStart(2, '0')}`;
    const time = `${String(future.getHours()).padStart(2, '0')}:${String(future.getMinutes()).padStart(2, '0')}`;
    const telegramMessageIds = ['telegram-partial-1', 'telegram-partial-2'];
    const schedule = vi.fn().mockResolvedValue({
      success: false,
      error: 'Some attachments could not be scheduled.',
      telegramMessageId: telegramMessageIds[0],
      telegramMessageIds,
    });
    const cancel = vi.fn().mockResolvedValue({ success: true, alreadySent: false });
    const saveScheduleHistory = vi.fn().mockResolvedValue({ success: true });
    const { result } = renderWorkspaceHistory(
      [],
      [],
      { schedule, cancel, saveScheduleHistory },
      vi.fn(),
      'workspace',
      chat,
    );

    await waitFor(() => expect(result.current.scheduling).toBe(false));
    await act(async () => {
      result.current.handleSchedule({
        chatId: chat.id,
        message: '',
        date,
        time,
        attachments: ['C:/demo/one.png', 'C:/demo/two.png'],
      });
    });

    await waitFor(() => expect(result.current.upcoming[0]).toMatchObject({
      status: 'failed',
      telegramMessageId: telegramMessageIds[0],
      telegramMessageIds,
      retryAction: 'cancel',
    }));
    expect(saveScheduleHistory).toHaveBeenCalledWith(expect.objectContaining({
      field: 'upcoming',
      messages: expect.arrayContaining([expect.objectContaining({ telegramMessageIds })]),
    }));

    await act(async () => {
      await result.current.handleRetry(result.current.upcoming[0]);
    });

    expect(cancel).toHaveBeenCalledWith(expect.objectContaining({
      chatId: chat.id,
      telegramMessageId: telegramMessageIds[0],
      telegramMessageIds,
    }));
    expect(result.current.upcoming).toHaveLength(0);
    expect(schedule).toHaveBeenCalledOnce();
  });

  it('retains partial IDs when Retry leaves cleanup work for Cancel', async () => {
    const chat = { id: 'chat-1', name: 'Test chat' };
    const scheduled: ScheduledMessage = {
      id: 'failed-schedule-retry',
      chatId: chat.id,
      chatName: chat.name,
      text: '',
      when: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      createdAt: new Date().toISOString(),
      status: 'failed',
      retryAction: 'schedule',
      attachments: ['one.png', 'two.png', 'three.png'],
    };
    const telegramMessageIds = ['telegram-left-1', 'telegram-left-2'];
    const schedule = vi.fn().mockResolvedValue({
      success: false,
      error: 'Cleanup did not remove all scheduled files.',
      telegramMessageId: telegramMessageIds[0],
      telegramMessageIds,
    });
    const cancel = vi.fn().mockResolvedValue({ success: true, alreadySent: false });
    const { result } = renderWorkspaceHistory([scheduled], [], { schedule, cancel }, vi.fn(), 'workspace', chat);

    await waitFor(() => expect(result.current.upcoming).toEqual([scheduled]));
    await act(async () => {
      await result.current.handleRetry(scheduled);
    });

    expect(result.current.upcoming[0]).toMatchObject({
      status: 'failed',
      retryAction: 'cancel',
      telegramMessageId: telegramMessageIds[0],
      telegramMessageIds,
    });

    await act(async () => {
      await result.current.handleRetry(result.current.upcoming[0]);
    });

    expect(cancel).toHaveBeenCalledWith(expect.objectContaining({
      telegramMessageId: telegramMessageIds[0],
      telegramMessageIds,
    }));
    expect(result.current.upcoming).toHaveLength(0);
  });

  it.each([
    ['entities', { entities: [{ type: 'bold', offset: 0, length: 4 }] }],
    ['silent', { silent: true }],
    ['reply markup', { replyMarkup: { inline_keyboard: [[{ text: 'Open', url: 'https://example.com' }]] } }],
    ['effect', { effect: '123' }],
  ] as Array<[string, Partial<ScheduledMessage>]>)('does not dedupe schedules when %s differs', async (_difference, existingOptions) => {
    const chat = { id: 'chat-1', name: 'Test chat' };
    const future = new Date(Date.now() + 60 * 60 * 1000);
    const date = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-${String(future.getDate()).padStart(2, '0')}`;
    const time = `${String(future.getHours()).padStart(2, '0')}:${String(future.getMinutes()).padStart(2, '0')}`;
    const when = new Date(`${date}T${time}`).toISOString();
    const existing: ScheduledMessage = {
      id: 'existing-operation',
      chatId: chat.id,
      chatName: chat.name,
      text: 'Same operation text',
      when,
      createdAt: new Date().toISOString(),
      status: 'scheduled',
      ...existingOptions,
    };
    const schedule = vi.fn().mockResolvedValue({
      success: true,
      confirmed: true,
      telegramMessageId: 'telegram-distinct-operation',
    });
    const { result } = renderWorkspaceHistory([existing], [], { schedule }, vi.fn(), 'workspace', chat);

    await waitFor(() => expect(result.current.scheduling).toBe(false));
    await act(async () => {
      await result.current.handleSchedule({
        chatId: chat.id,
        message: existing.text,
        date,
        time,
      });
    });

    await waitFor(() => expect(result.current.upcoming).toHaveLength(2));
    expect(schedule).toHaveBeenCalledOnce();
  });

  it('dedupes equal attachment content supplied through different paths', async () => {
    const chat = { id: 'chat-1', name: 'Test chat' };
    const future = new Date(Date.now() + 60 * 60 * 1000);
    const date = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-${String(future.getDate()).padStart(2, '0')}`;
    const time = `${String(future.getHours()).padStart(2, '0')}:${String(future.getMinutes()).padStart(2, '0')}`;
    const when = new Date(`${date}T${time}`).toISOString();
    const existing: ScheduledMessage = {
      id: 'existing-media-operation',
      chatId: chat.id,
      chatName: chat.name,
      text: 'Same media operation',
      when,
      createdAt: new Date().toISOString(),
      status: 'scheduled',
      attachments: ['C:/first/same.bin'],
    };
    const getScheduleIdentities = vi.fn(async (operations: Array<Record<string, unknown>>) => ({
      success: true,
      identities: operations.map(() => 'stable:same-media-operation'),
    }));
    const schedule = vi.fn();
    const showNotification = vi.fn();
    const { result } = renderWorkspaceHistory(
      [existing],
      [],
      { getScheduleIdentities, schedule },
      showNotification,
      'workspace',
      chat,
    );

    await waitFor(() => expect(result.current.scheduling).toBe(false));
    await act(async () => {
      await result.current.handleSchedule({
        chatId: chat.id,
        message: existing.text,
        date,
        time,
        attachments: ['D:/second/same.bin'],
      });
    });

    expect(getScheduleIdentities).toHaveBeenCalledOnce();
    expect(schedule).not.toHaveBeenCalled();
    expect(result.current.upcoming).toHaveLength(1);
    expect(result.current.upcoming[0].operationIdentity).toBe('stable:same-media-operation');
    expect(showNotification).toHaveBeenCalledWith(expect.any(String), 'warning', expect.any(String));
  });

  it('does not schedule when a comparable legacy attachment identity cannot be verified', async () => {
    const chat = { id: 'chat-1', name: 'Test chat' };
    const future = new Date(Date.now() + 60 * 60 * 1000);
    const date = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-${String(future.getDate()).padStart(2, '0')}`;
    const time = `${String(future.getHours()).padStart(2, '0')}:${String(future.getMinutes()).padStart(2, '0')}`;
    const when = new Date(`${date}T${time}`).toISOString();
    const existing: ScheduledMessage = {
      id: 'legacy-unreadable-media',
      chatId: chat.id,
      chatName: chat.name,
      text: 'Same media operation',
      when,
      createdAt: new Date().toISOString(),
      status: 'scheduled',
      attachments: ['C:/missing/legacy.bin'],
    };
    const getScheduleIdentities = vi.fn().mockResolvedValue({
      success: true,
      identities: ['stable:new-operation', null],
    });
    const schedule = vi.fn();
    const showNotification = vi.fn();
    const { result } = renderWorkspaceHistory(
      [existing],
      [],
      { getScheduleIdentities, schedule },
      showNotification,
      'workspace',
      chat,
    );

    await waitFor(() => expect(result.current.scheduling).toBe(false));
    await act(async () => {
      await result.current.handleSchedule({
        chatId: chat.id,
        message: existing.text,
        date,
        time,
        attachments: ['C:/missing/legacy.bin'],
      });
    });

    expect(schedule).not.toHaveBeenCalled();
    expect(result.current.upcoming).toEqual([existing]);
    expect(showNotification).toHaveBeenCalledWith(
      expect.any(String),
      'warning',
      expect.any(String),
      expect.objectContaining({ operation: 'validate', category: 'validation', retryable: false, code: 'LEGACY_MEDIA_IDENTITY_UNAVAILABLE' }),
    );
  });

  it('keeps a stored identity immutable when its attachment path later changes', async () => {
    const chat = { id: 'chat-1', name: 'Test chat' };
    const future = new Date(Date.now() + 60 * 60 * 1000);
    const date = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-${String(future.getDate()).padStart(2, '0')}`;
    const time = `${String(future.getHours()).padStart(2, '0')}:${String(future.getMinutes()).padStart(2, '0')}`;
    const when = new Date(`${date}T${time}`).toISOString();
    const existing: ScheduledMessage = {
      id: 'original-file-operation',
      chatId: chat.id,
      chatName: chat.name,
      text: 'Same media operation',
      when,
      createdAt: new Date().toISOString(),
      status: 'scheduled',
      attachments: ['C:/same/mutable.bin'],
      operationIdentity: 'stable:original-content',
    };
    const getScheduleIdentities = vi.fn()
      .mockResolvedValueOnce({ success: true, identities: ['stable:preflight-content'] })
      .mockResolvedValueOnce({ success: true, identities: ['stable:actual-content'] });
    const schedule = vi.fn().mockResolvedValue({
      success: true,
      confirmed: true,
      telegramMessageId: 'telegram-new-content',
      operationIdentity: 'stable:actual-content',
    });
    const { result } = renderWorkspaceHistory(
      [existing],
      [],
      { getScheduleIdentities, schedule },
      vi.fn(),
      'workspace',
      chat,
    );

    await waitFor(() => expect(result.current.scheduling).toBe(false));
    await act(async () => {
      await result.current.handleSchedule({
        chatId: chat.id,
        message: existing.text,
        date,
        time,
        attachments: ['C:/same/mutable.bin'],
      });
    });

    await waitFor(() => expect(result.current.upcoming).toHaveLength(2));
    const newlyScheduled = result.current.upcoming.find((item) => item.id !== existing.id)!;
    expect(newlyScheduled.operationIdentity).toBe('stable:actual-content');
    expect(schedule).toHaveBeenCalledOnce();

    await act(async () => {
      await result.current.handleSchedule({
        chatId: chat.id,
        message: existing.text,
        date,
        time,
        attachments: ['C:/same/mutable.bin'],
      });
    });

    expect(schedule).toHaveBeenCalledOnce();
    expect(result.current.upcoming).toHaveLength(2);
  });

  it('updates a retried schedule identity to the key used for changed attachment bytes', async () => {
    const chat = { id: 'chat-1', name: 'Test chat' };
    const failed: ScheduledMessage = {
      id: 'failed-media-operation',
      operationId: 'failed-media-operation',
      chatId: chat.id,
      chatName: chat.name,
      text: 'Retry changed media',
      when: '2035-01-15T19:00:00.000Z',
      createdAt: '2035-01-14T18:30:00.000Z',
      status: 'failed',
      retryAction: 'schedule',
      attachments: ['C:/same/mutable.bin'],
      operationIdentity: 'stable:original-content',
    };
    const schedule = vi.fn().mockResolvedValue({
      success: true,
      confirmed: true,
      telegramMessageId: 'telegram-updated-content',
      operationIdentity: 'stable:changed-content',
    });
    const { result } = renderWorkspaceHistory([failed], [], { schedule }, vi.fn(), 'workspace', chat);

    await waitFor(() => expect(result.current.upcoming).toEqual([failed]));
    await act(async () => {
      await result.current.handleRetry(failed);
    });

    expect(result.current.upcoming[0]).toMatchObject({
      status: 'scheduled',
      telegramMessageId: 'telegram-updated-content',
      operationIdentity: 'stable:changed-content',
    });
  });

  it('cancels one distinct operation without leaving the other row stale', async () => {
    const chat = { id: 'chat-1', name: 'Test chat' };
    const future = new Date(Date.now() + 60 * 60 * 1000);
    const date = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-${String(future.getDate()).padStart(2, '0')}`;
    const time = `${String(future.getHours()).padStart(2, '0')}:${String(future.getMinutes()).padStart(2, '0')}`;
    const schedule = vi.fn(async (operation: { entities?: unknown[]; effect?: string }) => ({
      success: true,
      confirmed: true,
      telegramMessageId: operation.effect ? 'telegram-effect-operation' : 'telegram-entity-operation',
    }));
    const cancel = vi.fn().mockResolvedValue({ success: true });
    const { result } = renderWorkspaceHistory([], [], { schedule, cancel }, vi.fn(), 'workspace', chat);

    await waitFor(() => expect(result.current.scheduling).toBe(false));
    await act(async () => {
      await result.current.handleSchedule({
        chatId: chat.id,
        message: 'Same operation text',
        date,
        time,
        entities: [{ type: 'bold', offset: 0, length: 4 }],
      });
    });
    await waitFor(() => expect(result.current.upcoming[0]?.status).toBe('scheduled'));

    await act(async () => {
      await result.current.handleSchedule({
        chatId: chat.id,
        message: 'Same operation text',
        date,
        time,
        effect: '123',
      });
    });
    await waitFor(() => expect(result.current.upcoming).toHaveLength(2));

    const firstOperation = result.current.upcoming.find((item) => item.telegramMessageId === 'telegram-entity-operation')!;
    await act(async () => {
      await result.current.handleCancelMessage(firstOperation);
    });

    expect(cancel).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledWith(expect.objectContaining({ telegramMessageId: 'telegram-entity-operation' }));
    expect(result.current.upcoming).toHaveLength(1);
    expect(result.current.upcoming[0]).toMatchObject({
      status: 'scheduled',
      telegramMessageId: 'telegram-effect-operation',
    });
  });

  it('allows attachment-only messages to be sent immediately', async () => {
    const chat = { id: 'chat-1', name: 'Test chat' };
    const send = vi.fn().mockResolvedValue({ success: true, id: 'telegram-send-1' });
    const { result } = renderWorkspaceHistory([], [], { send }, vi.fn(), 'workspace', chat);

    await waitFor(() => expect(result.current.upcoming).toEqual([]));
    await act(async () => {
      const sent = await result.current.handleSendDraftNow(chat, '', ['C:/demo/demo.pdf']);
      expect(sent).toBe(true);
    });


    expect(send).toHaveBeenCalledWith(
      chat.id,
      '',
      ['C:/demo/demo.pdf'],
      [],
      undefined,
      false,
      undefined,
      'account-1',
    );
  });

  it('cancels the original schedule only after the replacement is confirmed', async () => {
    const chat = { id: 'chat-1', name: 'Test chat' };
    const { originalWhen, replacementDateTime } = getFutureReplacementTimes();
    const original: ScheduledMessage = {
      id: 'original-schedule',
      chatId: chat.id,
      chatName: chat.name,
      text: 'Original text',
      when: originalWhen,
      createdAt: new Date(Date.now() - 60_000).toISOString(),
      status: 'scheduled',
      telegramMessageId: 'telegram-original',
    };
    const events: string[] = [];
    const schedule = vi.fn(async () => {
      events.push('schedule');
      return { success: true, confirmed: true, telegramMessageId: 'telegram-replacement' };
    });
    const cancel = vi.fn(async () => {
      events.push('cancel');
      return { success: true };
    });
    const { result, loadScheduleHistory } = renderWorkspaceHistory(
      [original],
      [],
      { schedule, cancel },
      vi.fn(),
      'workspace',
      chat,
    );

    await waitFor(() => expect(loadScheduleHistory).toHaveBeenCalledWith('workspace'));
    await waitFor(() => expect(result.current.upcoming).toEqual([original]));
    await act(async () => {
      await result.current.handleSchedule({
        chatId: chat.id,
        message: 'Replacement text',
        ...replacementDateTime,
        replaceMessage: original,
      });
    });

    await waitFor(() => expect(result.current.upcoming).toHaveLength(1));
    expect(events).toEqual(['schedule', 'cancel']);
    expect(result.current.upcoming[0]).toMatchObject({
      text: 'Replacement text',
      telegramMessageId: 'telegram-replacement',
      status: 'scheduled',
    });
  });

  it('keeps the original schedule when Telegram does not confirm the replacement', async () => {
    const chat = { id: 'chat-1', name: 'Test chat' };
    const { originalWhen, replacementDateTime } = getFutureReplacementTimes();
    const original: ScheduledMessage = {
      id: 'original-schedule-unconfirmed',
      chatId: chat.id,
      chatName: chat.name,
      text: 'Original text',
      when: originalWhen,
      createdAt: new Date(Date.now() - 60_000).toISOString(),
      status: 'scheduled',
      telegramMessageId: 'telegram-original-unconfirmed',
    };
    const schedule = vi.fn().mockResolvedValue({ success: false, error: 'Schedule request failed.' });
    const cancel = vi.fn().mockResolvedValue({ success: true });
    const { result, loadScheduleHistory } = renderWorkspaceHistory(
      [original],
      [],
      { schedule, cancel },
      vi.fn(),
      'workspace',
      chat,
    );

    await waitFor(() => expect(loadScheduleHistory).toHaveBeenCalledWith('workspace'));
    await waitFor(() => expect(result.current.upcoming).toEqual([original]));
    await act(async () => {
      await result.current.handleSchedule({
        chatId: chat.id,
        message: 'Replacement text',
        ...replacementDateTime,
        replaceMessage: original,
      });
    });

    await waitFor(() => expect(result.current.upcoming).toHaveLength(2));
    expect(cancel).not.toHaveBeenCalled();
    expect(result.current.upcoming).toContainEqual(expect.objectContaining({
      id: original.id,
      status: 'scheduled',
      telegramMessageId: original.telegramMessageId,
    }));
  });

  it('keeps both schedules and marks the original retryable when replacement cancellation fails', async () => {
    const chat = { id: 'chat-1', name: 'Test chat' };
    const { originalWhen, replacementDateTime } = getFutureReplacementTimes();
    const original: ScheduledMessage = {
      id: 'original-schedule-failed-cancel',
      chatId: chat.id,
      chatName: chat.name,
      text: 'Original text',
      when: originalWhen,
      createdAt: new Date(Date.now() - 60_000).toISOString(),
      status: 'scheduled',
      telegramMessageId: 'telegram-original-failed-cancel',
    };
    const schedule = vi.fn().mockResolvedValue({
      success: true,
      confirmed: true,
      telegramMessageId: 'telegram-replacement-failed-cancel',
    });
    const cancel = vi.fn().mockResolvedValue({ success: false, error: 'Telegram cancellation failed.' });
    const showNotification = vi.fn();
    const { result, loadScheduleHistory } = renderWorkspaceHistory(
      [original],
      [],
      { schedule, cancel },
      showNotification,
      'workspace',
      chat,
    );

    await waitFor(() => expect(loadScheduleHistory).toHaveBeenCalledWith('workspace'));
    await act(async () => {
      result.current.handleSchedule({
        chatId: chat.id,
        message: 'Replacement text',
        ...replacementDateTime,
        replaceMessage: original,
      });
    });

    await waitFor(() => expect(result.current.upcoming).toHaveLength(2));
    expect(result.current.upcoming).toContainEqual(expect.objectContaining({
      id: original.id,
      status: 'failed',
      retryAction: 'cancel',
    }));
    expect(result.current.upcoming).toContainEqual(expect.objectContaining({
      text: 'Replacement text',
      status: 'scheduled',
      telegramMessageId: 'telegram-replacement-failed-cancel',
    }));
    expect(showNotification).toHaveBeenCalledWith(expect.any(String), 'warning', expect.any(String));
  });

  it('cancels the replacement when Telegram reports the original was already sent', async () => {
    const chat = { id: 'chat-1', name: 'Test chat' };
    const { originalWhen, replacementDateTime } = getFutureReplacementTimes();
    const original: ScheduledMessage = {
      id: 'original-already-sent',
      chatId: chat.id,
      chatName: chat.name,
      text: 'Original text',
      when: originalWhen,
      createdAt: new Date(Date.now() - 60_000).toISOString(),
      status: 'scheduled',
      telegramMessageId: 'telegram-original-already-sent',
    };
    const schedule = vi.fn().mockResolvedValue({
      success: true,
      confirmed: true,
      telegramMessageId: 'telegram-replacement-race',
    });
    const cancel = vi.fn()
      .mockResolvedValueOnce({
        success: true,
        alreadySent: true,
        telegramMessageId: 'telegram-original-delivered',
        sentAt: new Date(Date.parse(originalWhen) + 30_000).toISOString(),
      })
      .mockResolvedValueOnce({ success: true });
    const { result, loadScheduleHistory } = renderWorkspaceHistory(
      [original],
      [],
      { schedule, cancel },
      vi.fn(),
      'workspace',
      chat,
    );

    await waitFor(() => expect(loadScheduleHistory).toHaveBeenCalledWith('workspace'));
    await act(async () => {
      result.current.handleSchedule({
        chatId: chat.id,
        message: 'Replacement text',
        ...replacementDateTime,
        replaceMessage: original,
      });
    });

    await waitFor(() => expect(cancel).toHaveBeenCalledTimes(2));
    expect(cancel).toHaveBeenNthCalledWith(2, expect.objectContaining({
      chatId: chat.id,
      telegramMessageId: 'telegram-replacement-race',
    }));
    expect(result.current.upcoming).toEqual([]);
    expect(result.current.sent[0]).toMatchObject({
      id: original.id,
      status: 'sent',
      telegramMessageId: 'telegram-original-delivered',
    });
  });

  it('cancels the linked original when a failed replacement is retried successfully', async () => {
    const chat = { id: 'chat-1', name: 'Test chat' };
    const original: ScheduledMessage = {
      id: 'retry-original-schedule',
      chatId: chat.id,
      chatName: chat.name,
      text: 'Original text',
      when: '2035-01-15T18:00:00.000Z',
      createdAt: '2035-01-14T18:00:00.000Z',
      status: 'scheduled',
      telegramMessageId: 'telegram-retry-original',
    };
    const replacement: ScheduledMessage = {
      id: 'retry-replacement-schedule',
      operationId: 'retry-replacement-operation',
      replacementOfId: original.id,
      chatId: chat.id,
      chatName: chat.name,
      text: 'Replacement text',
      when: '2035-01-15T19:00:00.000Z',
      createdAt: '2035-01-14T18:30:00.000Z',
      status: 'failed',
      retryAction: 'schedule',
    };
    const events: string[] = [];
    const schedule = vi.fn(async () => {
      events.push('schedule');
      return { success: true, confirmed: true, telegramMessageId: 'telegram-retried-replacement' };
    });
    const cancel = vi.fn(async () => {
      events.push('cancel');
      return { success: true };
    });
    const { result, loadScheduleHistory } = renderWorkspaceHistory(
      [original, replacement],
      [],
      { schedule, cancel },
      vi.fn(),
      'workspace',
      chat,
    );

    await waitFor(() => expect(loadScheduleHistory).toHaveBeenCalledWith('workspace'));
    await act(async () => {
      await result.current.handleRetry(replacement);
    });

    expect(events).toEqual(['schedule', 'cancel']);
    expect(result.current.upcoming).toHaveLength(1);
    expect(result.current.upcoming[0]).toMatchObject({
      id: replacement.id,
      status: 'scheduled',
      telegramMessageId: 'telegram-retried-replacement',
    });
  });

  it('allows attachment-only messages to be scheduled without text', async () => {
    const chat = { id: 'chat-1', name: 'Test chat' };
    const future = new Date(Date.now() + 60 * 60 * 1000);
    const date = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-${String(future.getDate()).padStart(2, '0')}`;
    const time = `${String(future.getHours()).padStart(2, '0')}:${String(future.getMinutes()).padStart(2, '0')}`;
    const schedule = vi.fn().mockResolvedValue({ success: true, confirmed: true, telegramMessageId: 'telegram-scheduled-1' });
    const { result } = renderWorkspaceHistory([], [], { schedule }, vi.fn(), 'workspace', chat);

    await waitFor(() => expect(result.current.scheduling).toBe(false));
    await act(async () => {
      result.current.handleSchedule({
        chatId: chat.id,
        message: '',
        date,
        time,
        attachments: ['C:/demo/demo.pdf'],
      });
    });

    await waitFor(() => expect(schedule).toHaveBeenCalledTimes(1));
    expect(schedule).toHaveBeenCalledWith(expect.objectContaining({
      chatId: chat.id,
      message: '',
      attachments: ['C:/demo/demo.pdf'],
    }));
  });

  it('distinguishes attachment-only schedules by their attachments', async () => {
    const chat = { id: 'chat-1', name: 'Test chat' };
    const future = new Date(Date.now() + 60 * 60 * 1000);
    const date = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-${String(future.getDate()).padStart(2, '0')}`;
    const time = `${String(future.getHours()).padStart(2, '0')}:${String(future.getMinutes()).padStart(2, '0')}`;
    const when = new Date(`${date}T${time}`).toISOString();
    const existingMessage: ScheduledMessage = {
      id: 'scheduled-photo-one',
      chatId: chat.id,
      chatName: chat.name,
      text: '',
      when,
      createdAt: new Date().toISOString(),
      status: 'scheduled',
      attachments: ['C:/demo/photo-one.png'],
    };
    const schedule = vi.fn().mockResolvedValue({
      success: true,
      confirmed: true,
      telegramMessageId: 'telegram-photo-two',
    });
    const { result, loadScheduleHistory } = renderWorkspaceHistory(
      [existingMessage],
      [],
      { schedule },
      vi.fn(),
      'workspace',
      chat,
    );

    await waitFor(() => expect(loadScheduleHistory).toHaveBeenCalledWith('workspace'));
    await act(async () => {
      result.current.handleSchedule({
        chatId: chat.id,
        message: '',
        date,
        time,
        attachments: ['C:/demo/photo-two.png'],
      });
    });

    await waitFor(() => expect(schedule).toHaveBeenCalledOnce());
    await waitFor(() => expect(result.current.upcoming).toContainEqual(expect.objectContaining({
      attachments: ['C:/demo/photo-two.png'],
      status: 'scheduled',
    })));

    await act(async () => {
      result.current.handleSchedule({
        chatId: chat.id,
        message: '',
        date,
        time,
        attachments: ['C:/demo/photo-two.png'],
      });
    });

    expect(schedule).toHaveBeenCalledOnce();
    expect(result.current.upcoming).toHaveLength(2);
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
      expect.objectContaining({ operation: 'validate', category: 'validation', retryable: false, code: 'MESSAGE_TOO_LONG' }),
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
      .mockResolvedValueOnce({ success: false, error: 'Telegram rejected the message.', code: 'HTTP_503', category: 'network', retryable: true })
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
      expect.objectContaining({ operation: 'publish', category: 'network', code: 'HTTP_503', retryable: true }),
    ));
    expect(result.current.upcoming[0]).toMatchObject({
      id: message.id,
      status: 'failed',
      lastError: 'Telegram rejected the message.',
      lastErrorDetails: expect.objectContaining({ operation: 'publish', category: 'network', code: 'HTTP_503', retryable: true }),
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
    const cancel = vi.fn().mockResolvedValue({
      success: false,
      error: 'Telegram cancellation failed.',
      code: 'TELEGRAM_REQUEST_CANCELLED',
      category: 'cancelled',
      retryable: false,
      cancelled: true,
    });
    const { result } = renderWorkspaceHistory([message], [], { cancel }, showNotification);

    await waitFor(() => expect(result.current.upcoming).toEqual([message]));
    await act(async () => { await result.current.handleCancelMessage(message); });

    await waitFor(() => expect(showNotification).toHaveBeenCalledWith(
      'Telegram cancellation failed.',
      'error',
      expect.any(String),
      expect.objectContaining({ operation: 'cancel', category: 'cancelled', code: 'TELEGRAM_REQUEST_CANCELLED', retryable: false }),
    ));
    expect(result.current.upcoming[0]).toMatchObject({
      id: message.id,
      status: 'failed',
      telegramMessageId: message.telegramMessageId,
      lastError: 'Telegram cancellation failed.',
      lastErrorDetails: expect.objectContaining({ operation: 'cancel', category: 'cancelled' }),
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
    await act(async () => { await result.current.handleCancelMessage(message); });
    await waitFor(() => expect(showNotification).toHaveBeenCalledWith(
      'Network unavailable.',
      'error',
      expect.any(String),
      expect.objectContaining({ operation: 'cancel', category: 'unknown', retryable: false }),
    ));
    expect(result.current.upcoming[0]).toMatchObject({
      id: message.id,
      status: 'failed',
      telegramMessageId: message.telegramMessageId,
      lastError: 'Network unavailable.',
      retryAction: 'cancel',
    });

    await act(async () => { await result.current.handleCancelMessage(message); });
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
    await act(async () => { await result.current.handleCancelMessage(message); });

    await waitFor(() => expect(result.current.upcoming).toHaveLength(0));
    expect(cancel).toHaveBeenCalledWith({
      chatId: message.chatId,
      telegramMessageId: message.telegramMessageId,
      message: message.text,
      targetTimestamp: Math.floor(new Date(message.when).getTime() / 1000),
    });
    await waitFor(() => expect(saveScheduleHistory).toHaveBeenCalledWith({ scope: 'workspace', field: 'upcoming', messages: [] }));
  });

  it('cancels an attachment-only scheduled record with its Telegram ID', async () => {
    const message: ScheduledMessage = {
      id: 'cancel-photo-only',
      chatId: 'chat-1',
      chatName: 'Test chat',
      text: '',
      when: '2035-01-15T18:00:00.000Z',
      createdAt: '2035-01-15T17:00:00.000Z',
      status: 'scheduled',
      attachments: ['C:/demo/photo.png'],
      telegramMessageId: 'telegram-photo-only',
    };
    const cancel = vi.fn().mockResolvedValue({ success: true });
    const { result } = renderWorkspaceHistory([message], [], { cancel });

    await waitFor(() => expect(result.current.upcoming).toEqual([message]));
    await act(async () => { await result.current.handleCancelMessage(message); });

    expect(cancel).toHaveBeenCalledWith({
      chatId: message.chatId,
      telegramMessageId: message.telegramMessageId,
      message: '',
      targetTimestamp: Math.floor(new Date(message.when).getTime() / 1000),
    });
    await waitFor(() => expect(result.current.upcoming).toHaveLength(0));
  });

  it('does not call cancel for an attachment-only record without a Telegram ID', async () => {
    const message: ScheduledMessage = {
      id: 'cancel-photo-without-id',
      chatId: 'chat-1',
      chatName: 'Test chat',
      text: '',
      when: '2035-01-15T18:00:00.000Z',
      createdAt: '2035-01-15T17:00:00.000Z',
      status: 'scheduled',
      attachments: ['C:/demo/photo.png'],
    };
    const cancel = vi.fn().mockResolvedValue({ success: true });
    const { result, showNotification } = renderWorkspaceHistory([message], [], { cancel });

    await waitFor(() => expect(result.current.upcoming).toEqual([message]));
    await act(async () => { await result.current.handleCancelMessage(message); });

    expect(cancel).not.toHaveBeenCalled();
    expect(result.current.upcoming).toEqual([message]);
    expect(showNotification).toHaveBeenCalledWith(expect.any(String), 'error', expect.any(String));
  });

  it('cancels multiple scheduled records sequentially and uses the updated queue state', async () => {
    const firstMessage: ScheduledMessage = {
      id: 'cancel-batch-first',
      chatId: 'chat-1',
      chatName: 'Test chat',
      text: 'First scheduled message',
      when: '2035-01-15T18:00:00.000Z',
      createdAt: '2035-01-15T17:00:00.000Z',
      status: 'scheduled',
      telegramMessageId: 'telegram-cancel-first',
    };
    const secondMessage: ScheduledMessage = {
      ...firstMessage,
      id: 'cancel-batch-second',
      text: 'Second scheduled message',
      telegramMessageId: 'telegram-cancel-second',
    };
    const cancel = vi.fn().mockResolvedValue({ success: true });
    const { result } = renderWorkspaceHistory([firstMessage, secondMessage], [], { cancel });

    await waitFor(() => expect(result.current.upcoming).toHaveLength(2));
    let cancelled = false;
    await act(async () => {
      cancelled = await result.current.handleCancelMessages([firstMessage, secondMessage]);
    });

    expect(cancelled).toBe(true);
    expect(cancel).toHaveBeenCalledTimes(2);
    expect(cancel.mock.invocationCallOrder[0]).toBeLessThan(cancel.mock.invocationCallOrder[1]);
    expect(result.current.upcoming).toHaveLength(0);
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

  it('deletes a failed record without a second confirmation after the history dialog', async () => {
    const message: ScheduledMessage = {
      id: 'delete-failed-history',
      chatId: 'chat-1',
      chatName: 'Test chat',
      text: 'Failed schedule',
      when: '2035-01-15T18:00:00.000Z',
      createdAt: '2035-01-15T17:00:00.000Z',
      status: 'failed',
      lastError: 'Telegram did not confirm that the reminder was saved.',
      retryAction: 'schedule',
    };
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { result, saveScheduleHistory } = renderWorkspaceHistory([message], [], {});

    await waitFor(() => expect(result.current.upcoming).toEqual([message]));
    act(() => result.current.handleDeleteMessage(message, true));

    await waitFor(() => expect(result.current.upcoming).toHaveLength(0));
    expect(confirm).not.toHaveBeenCalled();
    expect(saveScheduleHistory).toHaveBeenCalledWith({ scope: 'workspace', field: 'upcoming', messages: [] });
  });
});