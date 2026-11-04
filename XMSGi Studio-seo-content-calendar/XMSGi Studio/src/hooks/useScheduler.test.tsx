import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '@/lib/i18n';
import type { Chat, RichTextEntity, ScheduledMessage } from '@/types';
import { useScheduler } from './useScheduler';
import { getCurrentTimeStr, getTodayStr } from '@/lib/utils';

function createScheduleIdentityResult(operations: Array<Record<string, unknown>>) {
  return {
    success: true,
    identities: operations.map((operation) => JSON.stringify({
      target: String(operation.chatId),
      message: operation.message,
      targetTimestamp: operation.targetTimestamp,
      attachmentHashes: operation.attachments ?? [],
      entities: operation.entities ?? [],
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

function renderWorkspaceHistory(upcoming: ScheduledMessage[], sent: ScheduledMessage[], telegramOverrides: Record<string, unknown>, showNotification = vi.fn(), historyScope: 'personal' | 'workspace' = 'workspace', selectedChat: Chat | null = null, setMessage = vi.fn(), attachments: string[] = [], entities: RichTextEntity[] = [], message = '') {
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
    message,
    composerAttachments: attachments,
    composerEntities: entities,
    showNotification,
    setMessage,
  }), { wrapper });

  return {
    ...hook,
    saveScheduleHistory: (telegramOverrides.saveScheduleHistory as typeof saveScheduleHistory | undefined) ?? saveScheduleHistory,
    loadScheduleHistory,
    showNotification,
    setMessage,
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
    }), { wrapper });

    await waitFor(() => expect(result.current.upcoming).toEqual(upcoming));

    const restoredTime = new Date(result.current.upcoming[0].when);
    expect([restoredTime.getFullYear(), restoredTime.getMonth(), restoredTime.getDate(), restoredTime.getHours(), restoredTime.getMinutes()])
      .toEqual([2035, 0, 15, 17, 42]);
    expect(loadScheduleHistory).toHaveBeenCalledWith('workspace');
    expect(saveScheduleHistory).not.toHaveBeenCalled();
  });

  it('exposes a failed history restore separately from a successfully empty history', async () => {
    const restoreError = new Error('History service unavailable');
    const showNotification = vi.fn();
    const { result } = renderWorkspaceHistory([], [], {
      loadScheduleHistory: vi.fn().mockRejectedValue(restoreError),
    }, showNotification);

    await waitFor(() => expect(result.current.historyReady).toBe(true));

    expect(result.current.historyLoadError).toBe(restoreError.message);
    expect(result.current.sent).toEqual([]);
    expect(showNotification).toHaveBeenCalledWith(
      restoreError.message,
      'error',
      expect.any(String),
    );
  });

  it('uses workspace-scoped local history when native history is unavailable', async () => {
    const storageKeys = [
      'awaitmsg_upcoming',
      'awaitmsg_workspace_upcoming',
      'awaitmsg_sent',
      'awaitmsg_workspace_sent',
    ];
    const previousValues = new Map(storageKeys.map((key) => [key, window.localStorage.getItem(key)]));
    const personalMessage: ScheduledMessage = {
      id: 'personal-only',
      chatId: 'personal-chat',
      chatName: 'Personal',
      text: 'Personal',
      when: '2035-01-15T17:42:00.000Z',
      createdAt: '2035-01-15T16:42:00.000Z',
      status: 'scheduled',
    };
    const workspaceMessage: ScheduledMessage = {
      id: 'workspace-only',
      chatId: 'workspace-chat',
      chatName: 'Workspace',
      text: 'Workspace',
      when: '2035-01-15T17:42:00.000Z',
      createdAt: '2035-01-15T16:42:00.000Z',
      status: 'scheduled',
    };
    window.localStorage.setItem('awaitmsg_upcoming', JSON.stringify([personalMessage]));
    window.localStorage.setItem('awaitmsg_workspace_upcoming', JSON.stringify([workspaceMessage]));
    window.localStorage.setItem('awaitmsg_sent', JSON.stringify([]));
    window.localStorage.setItem('awaitmsg_workspace_sent', JSON.stringify([]));
    vi.stubGlobal('telegram', {});

    const wrapper = ({ children }: PropsWithChildren) => <LocaleProvider>{children}</LocaleProvider>;
    const { result, unmount } = renderHook(() => useScheduler({
      historyScope: 'workspace',
      connected: false,
      selectedChat: null,
      chats: [],
      message: '',
      showNotification: vi.fn(),
      setMessage: vi.fn(),
    }), { wrapper });

    try {
      await waitFor(() => expect(result.current.scheduling).toBe(false));
      expect(result.current.upcoming).toEqual([workspaceMessage]);
      expect(result.current.sent).toEqual([]);
    } finally {
      unmount();
      for (const [key, value] of previousValues) {
        if (value === null) window.localStorage.removeItem(key);
        else window.localStorage.setItem(key, value);
      }
    }
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

  it('reconciles an overdue Pending operation as Scheduled without scheduling it again', async () => {
    const pending: ScheduledMessage = {
      id: 'overdue-pending-scheduled',
      operationId: 'pending-operation-1',
      chatId: 'chat-1',
      chatName: 'Test chat',
      text: 'Still scheduled in Telegram',
      when: new Date(Date.now() - 10 * 60_000).toISOString(),
      createdAt: new Date(Date.now() - 60 * 60_000).toISOString(),
      status: 'pending',
    };
    const reconcilePendingSchedule = vi.fn().mockResolvedValue({
      success: true,
      state: 'scheduled',
      telegramMessageId: '42001',
      telegramMessageIds: ['42001'],
    });
    const schedule = vi.fn();
    const { result, saveScheduleHistory } = renderWorkspaceHistory(
      [pending],
      [],
      { reconcilePendingSchedule, schedule },
    );

    await waitFor(() => expect(result.current.upcoming).toMatchObject([{
      id: pending.id,
      status: 'scheduled',
      telegramMessageId: '42001',
    }]));
    expect(reconcilePendingSchedule).toHaveBeenCalledWith(expect.objectContaining({
      chatId: pending.chatId,
      message: pending.text,
      telegramMessageIds: [],
    }));
    expect(schedule).not.toHaveBeenCalled();
    expect(saveScheduleHistory).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'workspace',
      field: 'snapshot',
      messages: expect.objectContaining({
        upcoming: [expect.objectContaining({ id: pending.id, status: 'scheduled' })],
      }),
    }));
  });

  it('keeps an unlinked sent response Pending instead of trusting its message ID or sentAt', async () => {
    const pending: ScheduledMessage = {
      id: 'overdue-pending-sent',
      chatId: 'chat-1',
      chatName: 'Test chat',
      text: 'Already sent by Telegram',
      when: new Date(Date.now() - 10 * 60_000).toISOString(),
      createdAt: new Date(Date.now() - 60 * 60_000).toISOString(),
      status: 'pending',
    };
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const reconcilePendingSchedule = vi.fn().mockResolvedValue({
      success: true,
      state: 'sent',
      telegramMessageId: 'telegram-sent-1',
      sentAt: '2035-01-15T18:01:30.000Z',
    });
    const schedule = vi.fn();
    const send = vi.fn();
    const { result } = renderWorkspaceHistory(
      [pending],
      [],
      { reconcilePendingSchedule, schedule, send },
    );

    await waitFor(() => expect(reconcilePendingSchedule).toHaveBeenCalledOnce());
    expect(result.current.upcoming).toMatchObject([{ id: pending.id, status: 'pending' }]);
    expect(result.current.sent).toEqual([]);
    expect(schedule).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      'Telegram returned an unsupported or unlinked reconciliation state.',
      'sent',
    );
  });

  it('keeps an overdue operation Pending when Telegram lists provide no proof it was rejected', async () => {
    const pending: ScheduledMessage = {
      id: 'overdue-pending-unknown',
      chatId: 'chat-1',
      chatName: 'Test chat',
      text: 'State not present in available lists',
      when: new Date(Date.now() - 10 * 60_000).toISOString(),
      createdAt: new Date(Date.now() - 60 * 60_000).toISOString(),
      status: 'pending',
    };
    const reconcilePendingSchedule = vi.fn().mockResolvedValue({ state: 'unknown' });
    const schedule = vi.fn();
    const send = vi.fn();
    const { result } = renderWorkspaceHistory(
      [pending],
      [],
      { reconcilePendingSchedule, schedule, send },
    );

    await waitFor(() => expect(reconcilePendingSchedule).toHaveBeenCalledOnce());

    expect(result.current.upcoming).toMatchObject([{ id: pending.id, status: 'pending' }]);
    expect(result.current.sent).toEqual([]);
    expect(schedule).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('retains Pending after a network failure during Telegram reconciliation', async () => {
    const pending: ScheduledMessage = {
      id: 'overdue-pending-network-error',
      chatId: 'chat-1',
      chatName: 'Test chat',
      text: 'Telegram unavailable',
      when: new Date(Date.now() - 10 * 60_000).toISOString(),
      createdAt: new Date(Date.now() - 60 * 60_000).toISOString(),
      status: 'pending',
    };
    const reconcilePendingSchedule = vi.fn().mockRejectedValue(new Error('Telegram timeout'));
    const schedule = vi.fn();
    const send = vi.fn();
    const { result } = renderWorkspaceHistory(
      [pending],
      [],
      { reconcilePendingSchedule, schedule, send },
    );

    await waitFor(() => expect(reconcilePendingSchedule).toHaveBeenCalledOnce());

    expect(result.current.upcoming).toMatchObject([{ id: pending.id, status: 'pending' }]);
    expect(schedule).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('keeps an ambiguous Telegram response Pending and does not repeat the operation', async () => {
    const pending: ScheduledMessage = {
      id: 'overdue-pending-ambiguous',
      chatId: 'chat-1',
      chatName: 'Test chat',
      text: 'Ambiguous Telegram result',
      when: new Date(Date.now() - 10 * 60_000).toISOString(),
      createdAt: new Date(Date.now() - 60 * 60_000).toISOString(),
      status: 'pending',
    };
    const reconcilePendingSchedule = vi.fn().mockResolvedValue({ success: true });
    const schedule = vi.fn();
    const send = vi.fn();
    const { result } = renderWorkspaceHistory(
      [pending],
      [],
      { reconcilePendingSchedule, schedule, send },
    );

    await waitFor(() => expect(reconcilePendingSchedule).toHaveBeenCalledOnce());

    expect(result.current.upcoming).toMatchObject([{ id: pending.id, status: 'pending' }]);
    expect(schedule).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('keeps Pending when the bridge returns an unknown reconciliation status', async () => {
    const pending: ScheduledMessage = {
      id: 'overdue-pending-invalid-state',
      chatId: 'chat-1',
      chatName: 'Test chat',
      text: 'Unexpected bridge status',
      when: new Date(Date.now() - 10 * 60_000).toISOString(),
      createdAt: new Date(Date.now() - 60 * 60_000).toISOString(),
      status: 'pending',
    };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const reconcilePendingSchedule = vi.fn().mockResolvedValue({
      success: true,
      state: 'complete',
      telegramMessageId: 'telegram-id',
    });
    const schedule = vi.fn();
    const send = vi.fn();
    const { result } = renderWorkspaceHistory(
      [pending],
      [],
      { reconcilePendingSchedule, schedule, send },
    );

    await waitFor(() => expect(reconcilePendingSchedule).toHaveBeenCalledOnce());

    expect(result.current.upcoming).toMatchObject([{ id: pending.id, status: 'pending' }]);
    expect(result.current.sent).toEqual([]);
    expect(schedule).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('rechecks Pending after a confirmed schedule cannot be saved', async () => {
    const pending: ScheduledMessage = {
      id: 'overdue-pending-save-failure',
      chatId: 'chat-1',
      chatName: 'Test chat',
      text: 'Keep pending on disk when write fails',
      when: new Date(Date.now() - 10 * 60_000).toISOString(),
      createdAt: new Date(Date.now() - 60 * 60_000).toISOString(),
      status: 'pending',
    };
    const showNotification = vi.fn();
    const reconcilePendingSchedule = vi.fn().mockResolvedValue({
      success: true,
      state: 'scheduled',
      telegramMessageId: '42002',
    });
    const failingSave = vi.fn().mockResolvedValue({ success: false, error: 'Disk full' });
    const firstRun = renderWorkspaceHistory(
      [pending],
      [],
      { reconcilePendingSchedule, saveScheduleHistory: failingSave },
      showNotification,
    );

    await waitFor(() => expect(firstRun.result.current.upcoming).toMatchObject([{
      id: pending.id,
      status: 'scheduled',
    }]));
    expect(failingSave).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'workspace',
      field: 'snapshot',
      messages: expect.objectContaining({
        upcoming: [expect.objectContaining({ id: pending.id, status: 'scheduled' })],
      }),
    }));
    expect(showNotification).toHaveBeenCalledWith(
      expect.any(String),
      'warning',
      expect.any(String),
    );
    firstRun.unmount();

    const schedule = vi.fn();
    const send = vi.fn();
    const retryReconciliation = vi.fn().mockResolvedValue({ state: 'unknown' });
    const secondRun = renderWorkspaceHistory(
      [pending],
      [],
      { reconcilePendingSchedule: retryReconciliation, schedule, send },
    );
    await waitFor(() => expect(retryReconciliation).toHaveBeenCalledOnce());

    expect(secondRun.result.current.upcoming).toMatchObject([{ id: pending.id, status: 'pending' }]);
    expect(schedule).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it.each(['personal', 'workspace'] as const)(
    'preserves %s scope while reconciling an overdue operation',
    async (scope) => {
      const pending: ScheduledMessage = {
        id: `${scope}-overdue-pending`,
        chatId: 'chat-1',
        chatName: 'Test chat',
        text: 'Scope remains isolated',
        when: new Date(Date.now() - 10 * 60_000).toISOString(),
        createdAt: new Date(Date.now() - 60 * 60_000).toISOString(),
        status: 'pending',
      };
      const reconcilePendingSchedule = vi.fn().mockResolvedValue({
        success: true,
        state: 'scheduled',
        telegramMessageId: '42003',
      });
      const { saveScheduleHistory } = renderWorkspaceHistory(
        [pending],
        [],
        { reconcilePendingSchedule },
        vi.fn(),
        scope,
      );

      await waitFor(() => expect(reconcilePendingSchedule).toHaveBeenCalledOnce());

      expect(saveScheduleHistory).toHaveBeenCalledWith(expect.objectContaining({
        scope,
        field: 'snapshot',
      }));
    },
  );

  it('rechecks the same Pending operation after restart without duplicating it', async () => {
    const pending: ScheduledMessage = {
      id: 'restart-pending-idempotency',
      chatId: 'chat-1',
      chatName: 'Test chat',
      text: 'One operation across restarts',
      when: new Date(Date.now() - 10 * 60_000).toISOString(),
      createdAt: new Date(Date.now() - 60 * 60_000).toISOString(),
      status: 'pending',
    };
    const schedule = vi.fn();
    const send = vi.fn();
    const firstReconciliation = vi.fn().mockResolvedValue({ state: 'unknown' });
    const firstRun = renderWorkspaceHistory(
      [pending],
      [],
      { reconcilePendingSchedule: firstReconciliation, schedule, send },
    );
    await waitFor(() => expect(firstReconciliation).toHaveBeenCalledOnce());
    firstRun.unmount();

    const secondReconciliation = vi.fn().mockResolvedValue({
      success: true,
      state: 'sent',
      telegramMessageId: '42004',
      sentAt: '2035-01-15T18:01:30.000Z',
    });
    const secondRun = renderWorkspaceHistory(
      [pending],
      [],
      { reconcilePendingSchedule: secondReconciliation, schedule, send },
    );
    await waitFor(() => expect(secondReconciliation).toHaveBeenCalledOnce());

    expect(schedule).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(secondRun.result.current.upcoming).toMatchObject([{ id: pending.id, status: 'pending' }]);
    expect(secondRun.result.current.sent).toEqual([]);
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

  it('sends Planner photo attachments through Telegram scheduling and reports confirmation', async () => {
    const chat = { id: 'planner-photo-chat', name: 'Photo channel' };
    const future = new Date(Date.now() + 60 * 60 * 1000);
    const date = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-${String(future.getDate()).padStart(2, '0')}`;
    const time = `${String(future.getHours()).padStart(2, '0')}:${String(future.getMinutes()).padStart(2, '0')}`;
    const schedule = vi.fn().mockResolvedValue({ success: true, confirmed: true, id: 'telegram-photo-schedule' });
    const { result, loadScheduleHistory } = renderWorkspaceHistory([], [], { schedule }, vi.fn(), 'personal', chat);
    await waitFor(() => expect(loadScheduleHistory).toHaveBeenCalledWith('personal'));
    await waitFor(() => expect(result.current.upcoming).toEqual([]));
    let scheduled = false;
    let scheduleRequest!: Promise<boolean | void | 'sent-history-failed'>;
    act(() => {
      scheduleRequest = result.current.handleSchedule({
        chatId: chat.id,
        message: 'Caption with photo',
        attachments: ['C:/planner/photo.png'],
        date,
        time,
        clearMessageOnSuccess: false,
        waitForConfirmation: true,
      });
    });
    await waitFor(() => expect(schedule).toHaveBeenCalledOnce());
    await act(async () => { scheduled = await scheduleRequest === true; });

    expect(scheduled).toBe(true);
    expect(schedule).toHaveBeenCalledWith(expect.objectContaining({
      chatId: chat.id,
      message: 'Caption with photo',
      attachments: ['C:/planner/photo.png'],
    }));
    expect(result.current.upcoming[0]).toMatchObject({
      text: 'Caption with photo',
      attachments: ['C:/planner/photo.png'],
      status: 'scheduled',
    });
  });

  it('resets the schedule date and time after a fully confirmed schedule', async () => {
    const chat = { id: 'chat-reset-date', name: 'Date reset chat' };
    const future = new Date(Date.now() + 60 * 60 * 1000);
    const date = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-${String(future.getDate()).padStart(2, '0')}`;
    const time = `${String(future.getHours()).padStart(2, '0')}:${String(future.getMinutes()).padStart(2, '0')}`;
    const schedule = vi.fn().mockResolvedValue({ success: true, confirmed: true, id: 'scheduled-reset-date' });
    const { result } = renderWorkspaceHistory([], [], { schedule }, vi.fn(), 'workspace', chat);

    await waitFor(() => expect(result.current.scheduling).toBe(false));
    act(() => {
      result.current.dateEditedRef.current = true;
      result.current.timeEditedRef.current = true;
      result.current.setDate('2035-01-15');
      result.current.setTime('18:30');
    });

    let scheduleRequest!: Promise<boolean | void | 'sent-history-failed'>;
    act(() => {
      scheduleRequest = result.current.handleSchedule({
        chatId: chat.id,
        message: 'Schedule the next post',
        date,
        time,
        waitForConfirmation: true,
      });
    });
    await act(async () => {
      expect(await scheduleRequest).toBe(true);
    });

    expect(result.current.date).toBe(getTodayStr());
    expect(result.current.time).toBe(getCurrentTimeStr());
    expect(result.current.dateEditedRef.current).toBe(false);
    expect(result.current.timeEditedRef.current).toBe(false);
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

  it('keeps the draft and does not report success when a repeated schedule partially fails', async () => {
    const chat = { id: 'chat-partial-repeat', name: 'Partial repeat chat' };
    const { date, time } = getFutureReplacementTimes().replacementDateTime;
    const schedule = vi.fn()
      .mockResolvedValueOnce({ success: true, confirmed: true, telegramMessageId: 'scheduled-first' })
      .mockResolvedValueOnce({ success: false, error: 'Second schedule failed.' });
    const setMessage = vi.fn();
    const { result } = renderWorkspaceHistory(
      [],
      [],
      { schedule },
      vi.fn(),
      'workspace',
      chat,
      setMessage,
    );

    await waitFor(() => expect(result.current.scheduling).toBe(false));
    let scheduleRequest!: Promise<boolean | void | 'sent-history-failed'>;
    act(() => {
      scheduleRequest = result.current.handleSchedule(
        { chatId: chat.id, message: 'Preserve this draft', date, time, waitForConfirmation: true },
        { mode: 'daily', occurrences: 2 },
      );
    });
    let scheduled = true;
    await act(async () => {
      scheduled = await scheduleRequest === true;
    });

    expect(scheduled).toBe(false);
    expect(schedule).toHaveBeenCalledTimes(2);
    expect(result.current.upcoming).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'scheduled', telegramMessageId: 'scheduled-first' }),
      expect.objectContaining({ status: 'failed', lastError: 'Second schedule failed.' }),
    ]));
    expect(setMessage).not.toHaveBeenCalled();
    expect(result.current.successPulse).toBe(false);
    expect(result.current.lastAction).toBeNull();
  });

  it('keeps a Telegram-confirmed retry scheduled when its final history write fails', async () => {
    const previousLocale = window.localStorage.getItem('awaitmsg_locale');
    window.localStorage.setItem('awaitmsg_locale', 'en');
    try {
      const chat = { id: 'retry-history-write-chat', name: 'Retry history chat' };
      const failedRecord: ScheduledMessage = {
        id: 'retry-history-write-record',
        chatId: chat.id,
        chatName: chat.name,
        text: 'Confirmed by Telegram on retry',
        when: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        createdAt: new Date().toISOString(),
        status: 'failed',
        retryAction: 'schedule',
      };
      const schedule = vi.fn().mockResolvedValue({
        success: true,
        confirmed: true,
        telegramMessageId: 'telegram-confirmed-on-retry',
      });
      const saveScheduleHistory = vi.fn(async ({ messages }: { messages: ScheduledMessage[] }) => ({
        success: !messages.some((message) => message.status === 'scheduled'),
        error: 'Disk full',
      }));
      const showNotification = vi.fn();
      const { result, loadScheduleHistory } = renderWorkspaceHistory(
        [failedRecord],
        [],
        { schedule, saveScheduleHistory },
        showNotification,
        'workspace',
        chat,
      );

      await waitFor(() => expect(loadScheduleHistory).toHaveBeenCalledWith('workspace'));
      await waitFor(() => expect(result.current.scheduling).toBe(false));
      await act(async () => result.current.handleRetry(result.current.upcoming[0]));

      expect(schedule).toHaveBeenCalledOnce();
      expect(result.current.upcoming[0]).toMatchObject({
        status: 'scheduled',
        telegramMessageId: 'telegram-confirmed-on-retry',
      });
      expect(showNotification).toHaveBeenCalledWith(
        'Telegram confirmed the schedule, but its history could not be saved. Check the queue before retrying.',
        'warning',
        'Error',
      );
      expect(showNotification).not.toHaveBeenCalledWith('Message scheduled in Telegram.', 'success', 'Scheduled');
    } finally {
      if (previousLocale === null) window.localStorage.removeItem('awaitmsg_locale');
      else window.localStorage.setItem('awaitmsg_locale', previousLocale);
    }
  });

  it('keeps a Telegram-confirmed schedule visible and warns when its final history commit fails', async () => {
    const previousLocale = window.localStorage.getItem('awaitmsg_locale');
    window.localStorage.setItem('awaitmsg_locale', 'en');
    try {
      const chat = { id: 'chat-history-write-failure', name: 'History write failure chat' };
      const saveScheduleHistory = vi.fn(async ({ messages }: { messages: ScheduledMessage[] }) => ({
        success: !messages.some((message) => message.status === 'scheduled'),
        error: 'Disk full',
      }));
      const schedule = vi.fn().mockResolvedValue({
        success: true,
        confirmed: true,
        telegramMessageId: 'telegram-confirmed-history-failure',
      });
      const showNotification = vi.fn();
      const { result, loadScheduleHistory } = renderWorkspaceHistory(
        [],
        [],
        { schedule, saveScheduleHistory },
        showNotification,
        'workspace',
        chat,
      );
      const future = new Date(Date.now() + 60 * 60 * 1000);
      const date = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-${String(future.getDate()).padStart(2, '0')}`;
      const time = `${String(future.getHours()).padStart(2, '0')}:${String(future.getMinutes()).padStart(2, '0')}`;

      await waitFor(() => expect(loadScheduleHistory).toHaveBeenCalledWith('workspace'));
      await waitFor(() => expect(result.current.scheduling).toBe(false));
      await act(async () => {
        await result.current.handleSchedule({ chatId: chat.id, message: 'Persist the confirmation', date, time });
      });

      await waitFor(() => expect(result.current.scheduling).toBe(false));
      expect(schedule).toHaveBeenCalledOnce();
      expect(result.current.upcoming).toContainEqual(expect.objectContaining({
        status: 'scheduled',
        telegramMessageId: 'telegram-confirmed-history-failure',
      }));
      expect(showNotification).toHaveBeenCalledWith(
        'Telegram confirmed the schedule, but its history could not be saved. Check the queue before retrying.',
        'warning',
        'Error',
      );
    } finally {
      if (previousLocale === null) window.localStorage.removeItem('awaitmsg_locale');
      else window.localStorage.setItem('awaitmsg_locale', previousLocale);
    }
  });

  it('does not cancel the original schedule when the confirmed replacement cannot be persisted', async () => {
    const previousLocale = window.localStorage.getItem('awaitmsg_locale');
    window.localStorage.setItem('awaitmsg_locale', 'en');
    try {
      const chat = { id: 'chat-replacement-history-failure', name: 'Replacement history failure chat' };
      const future = new Date(Date.now() + 60 * 60 * 1000);
      const date = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-${String(future.getDate()).padStart(2, '0')}`;
      const time = `${String(future.getHours()).padStart(2, '0')}:${String(future.getMinutes()).padStart(2, '0')}`;
      const original: ScheduledMessage = {
        id: 'replacement-original',
        telegramMessageId: 'telegram-original-replacement',
        chatId: chat.id,
        chatName: chat.name,
        text: 'Original schedule',
        when: new Date(future.getTime() + 30 * 60 * 1000).toISOString(),
        createdAt: new Date().toISOString(),
        status: 'scheduled',
      };
      const saveScheduleHistory = vi.fn(async ({ messages }: { messages: ScheduledMessage[] }) => ({
        success: !messages.some((item) => item.text === 'Replacement text'
          && item.telegramMessageId === 'telegram-confirmed-replacement'
          && item.status === 'scheduled'),
        error: 'Disk full',
      }));
      const schedule = vi.fn().mockResolvedValue({
        success: true,
        confirmed: true,
        telegramMessageId: 'telegram-confirmed-replacement',
      });
      const cancel = vi.fn().mockResolvedValue({ success: true });
      const showNotification = vi.fn();
      const { result, loadScheduleHistory } = renderWorkspaceHistory(
        [original],
        [],
        { schedule, cancel, saveScheduleHistory },
        showNotification,
        'workspace',
        chat,
      );

      await waitFor(() => expect(loadScheduleHistory).toHaveBeenCalledWith('workspace'));
      await waitFor(() => expect(result.current.scheduling).toBe(false));
      await act(async () => {
        await result.current.handleSchedule({
          chatId: chat.id,
          message: 'Replacement text',
          date,
          time,
          replaceMessage: original,
        });
      });

      await waitFor(() => expect(result.current.scheduling).toBe(false));
      expect(schedule).toHaveBeenCalledOnce();
      expect(cancel).not.toHaveBeenCalled();
      expect(result.current.upcoming).toContainEqual(expect.objectContaining({
        id: original.id,
        status: 'scheduled',
      }));
      expect(result.current.upcoming).toContainEqual(expect.objectContaining({
        status: 'scheduled',
        replacementOfId: original.id,
        telegramMessageId: 'telegram-confirmed-replacement',
      }));
      expect(showNotification).toHaveBeenCalledWith(
        'Telegram confirmed the schedule, but its history could not be saved. Check the queue before retrying.',
        'warning',
        'Error',
      );
    } finally {
      if (previousLocale === null) window.localStorage.removeItem('awaitmsg_locale');
      else window.localStorage.setItem('awaitmsg_locale', previousLocale);
    }
  });

  it('schedules each attachment group as a separate Telegram message', async () => {
    const chat = { id: 'chat-album-groups', name: 'Album group chat' };
    const future = new Date(Date.now() + 60 * 60 * 1000);
    const date = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-${String(future.getDate()).padStart(2, '0')}`;
    const time = `${String(future.getHours()).padStart(2, '0')}:${String(future.getMinutes()).padStart(2, '0')}`;
    const schedule = vi.fn()
      .mockResolvedValueOnce({ success: true, confirmed: true, telegramMessageId: 'telegram-album-1' })
      .mockResolvedValueOnce({ success: true, confirmed: true, telegramMessageId: 'telegram-album-2' });
    const entities: RichTextEntity[] = [{ type: 'bold', offset: 0, length: 7 }];
    const { result } = renderWorkspaceHistory([], [], { schedule }, vi.fn(), 'workspace', chat);

    await waitFor(() => expect(result.current.scheduling).toBe(false));
    await act(async () => {
      result.current.handleSchedule({
        chatId: chat.id,
        message: 'Caption',
        date,
        time,
        attachments: ['one.png', 'two.png', 'three.png'],
        attachmentGroups: [['one.png', 'two.png'], ['three.png']],
        entities,
      });
    });

    await waitFor(() => expect(schedule).toHaveBeenCalledTimes(2), { timeout: 5000 });
    expect(schedule.mock.calls.map(([request]) => request)).toEqual([
      expect.objectContaining({ message: 'Caption', attachments: ['one.png', 'two.png'], entities }),
      expect.objectContaining({ message: '', attachments: ['three.png'], entities: [] }),
    ]);
    await waitFor(() => expect(result.current.upcoming.filter((item) => item.status === 'scheduled')).toHaveLength(2));
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
    const { result, saveScheduleHistory } = renderWorkspaceHistory(
      [],
      [],
      { schedule },
      showNotification,
      'workspace',
      chat,
    );
    const selectedDateTime = localDateTimeAt(now + offset);

    await waitFor(() => expect(result.current.scheduling).toBe(false));
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
    const send = vi.fn().mockResolvedValue({ success: true, telegramMessageId: 501 });
    const { result } = renderWorkspaceHistory([], [], { send }, vi.fn(), 'workspace', chat);

    await waitFor(() => expect(result.current.scheduling).toBe(false));
    await act(async () => {
      result.current.dateEditedRef.current = true;
      result.current.timeEditedRef.current = true;
      result.current.setDate('2035-01-15');
      result.current.setTime('18:30');
      const sent = await result.current.handleSendDraftNow(chat, '', ['C:/demo/demo.pdf']);
      expect(sent).toBe(true);
    });

    expect(result.current.date).toBe(getTodayStr());
    expect(result.current.time).toMatch(/^\d{2}:\d{2}$/);
    expect(result.current.dateEditedRef.current).toBe(false);
    expect(result.current.timeEditedRef.current).toBe(false);
    expect(send).toHaveBeenCalledWith(
      chat.id,
      '',
      ['C:/demo/demo.pdf'],
      [],
      false,
      undefined,
      'account-1',
      expect.stringMatching(/^\d+:[a-z0-9]+$/i),
    );
  });

  it('suppresses completion success feedback when the caller manages the outcome notification', async () => {
    const chat = { id: 'chat-managed-outcome', name: 'Managed outcome chat' };
    const send = vi.fn().mockResolvedValue({ success: true, telegramMessageId: 503 });
    const showNotification = vi.fn();
    const { result } = renderWorkspaceHistory([], [], { send }, showNotification, 'workspace', chat);

    await waitFor(() => expect(result.current.scheduling).toBe(false));
    await act(async () => {
      await expect(result.current.handleSendDraftNow(
        chat,
        'Overlay draft',
        [],
        [],
        false,
        undefined,
        { suppressNotifications: true },
      )).resolves.toBe(true);
    });

    expect(send).toHaveBeenCalledOnce();
    expect(showNotification).not.toHaveBeenCalled();
  });

  it('suppresses send failure toast when the caller displays it in its own status area', async () => {
    const chat = { id: 'chat-managed-send-error', name: 'Managed send error chat' };
    const send = vi.fn().mockResolvedValue({ success: false, error: 'Telegram rejected the message.' });
    const showNotification = vi.fn();
    const { result } = renderWorkspaceHistory([], [], { send }, showNotification, 'workspace', chat);

    await waitFor(() => expect(result.current.scheduling).toBe(false));
    await act(async () => {
      await expect(result.current.handleSendDraftNow(
        chat,
        'Rejected draft',
        [],
        [],
        false,
        undefined,
        { suppressNotifications: true },
      )).resolves.toBe(false);
    });

    expect(send).toHaveBeenCalledOnce();
    expect(showNotification).not.toHaveBeenCalled();
  });

  it('clears the sending state for text sends with an empty attachment-groups array', async () => {
    const chat = { id: 'chat-empty-attachment-groups', name: 'Text chat' };
    const send = vi.fn().mockResolvedValue({ success: true, telegramMessageId: 502 });
    const { result } = renderWorkspaceHistory([], [], { send }, vi.fn(), 'workspace', chat);

    await waitFor(() => expect(result.current.scheduling).toBe(false));
    await act(async () => {
      await expect(result.current.handleSendDraftNow(
        chat,
        'Send text',
        [],
        [],
        false,
        undefined,
        {},
        [],
      )).resolves.toBe(true);
    });

    expect(send).toHaveBeenCalledOnce();
    expect(result.current.publishingDraft).toBe(false);
  });

  it('does not report success or clear a confirmed send when its history write fails', async () => {
    const previousLocale = window.localStorage.getItem('awaitmsg_locale');
    window.localStorage.setItem('awaitmsg_locale', 'en');
    try {
      const chat = { id: 'chat-send-history-failure', name: 'Send history failure chat' };
      const send = vi.fn().mockResolvedValue({ success: true, telegramMessageId: 1 });
      let resolveSnapshot!: (result: { success: boolean; error?: string }) => void;
      const saveScheduleHistory = vi.fn(({ field }: { field: string }) => field === 'snapshot'
        ? new Promise<{ success: boolean; error?: string }>((resolve) => { resolveSnapshot = resolve; })
        : Promise.resolve({ success: true }));
      const showNotification = vi.fn();
      const setMessage = vi.fn();
      const { result, loadScheduleHistory } = renderWorkspaceHistory(
        [],
        [],
        { send, saveScheduleHistory },
        showNotification,
        'workspace',
        chat,
        setMessage,
      );

      await waitFor(() => expect(loadScheduleHistory).toHaveBeenCalledWith('workspace'));
      await waitFor(() => expect(result.current.scheduling).toBe(false));
      let sendPromise!: Promise<boolean | 'sent-history-failed'>;
      await act(async () => {
        sendPromise = result.current.handleSendDraftNow(chat, 'Send exactly once');
        await waitFor(() => expect(saveScheduleHistory).toHaveBeenCalledWith(expect.objectContaining({ field: 'snapshot' })));
      });

      expect(send).toHaveBeenCalledOnce();
      await act(async () => {
        resolveSnapshot({ success: false, error: 'Disk full' });
        await expect(sendPromise).resolves.toBe('sent-history-failed');
      });
      expect(result.current.sent).toHaveLength(1);
      expect(result.current.publishingDraft).toBe(false);
      expect(setMessage).not.toHaveBeenCalledWith('');
      expect(showNotification).not.toHaveBeenCalledWith('Message sent to Telegram.', 'success', 'Sent');
      expect(showNotification).toHaveBeenCalledWith(
        'Message history could not be saved. It may return after the app restarts.',
        'warning',
        'Error',
      );
    } finally {
      if (previousLocale === null) window.localStorage.removeItem('awaitmsg_locale');
      else window.localStorage.setItem('awaitmsg_locale', previousLocale);
    }
  });

  it('does not clear a confirmed grouped send when a group history commit fails', async () => {
    const previousLocale = window.localStorage.getItem('awaitmsg_locale');
    window.localStorage.setItem('awaitmsg_locale', 'en');
    try {
      const chat = { id: 'chat-group-history-failure', name: 'Grouped history failure chat' };
      const send = vi.fn()
        .mockResolvedValueOnce({ success: true, telegramMessageId: 11 })
        .mockResolvedValueOnce({ success: true, telegramMessageId: 12 });
      const saveScheduleHistory = vi.fn(async ({ field }: { field: string }) => ({
        success: field !== 'snapshot',
        error: 'Disk full',
      }));
      const showNotification = vi.fn();
      const setMessage = vi.fn();
      const onAttachmentGroupResult = vi.fn();
      const { result, loadScheduleHistory } = renderWorkspaceHistory(
        [],
        [],
        { send, saveScheduleHistory },
        showNotification,
        'workspace',
        chat,
        setMessage,
      );

      await waitFor(() => expect(loadScheduleHistory).toHaveBeenCalledWith('workspace'));
      await act(async () => {
        await expect(result.current.handleSendDraftNow(
          chat,
          'Grouped send',
          ['first-media', 'second-media'],
          [],
          false,
          undefined,
          {},
          [['first-media'], ['second-media']],
          onAttachmentGroupResult,
        )).resolves.toBe('sent-history-failed');
      });

      expect(send).toHaveBeenCalledTimes(2);
      expect(onAttachmentGroupResult.mock.calls).toEqual([[0, true], [1, true]]);
      expect(setMessage).not.toHaveBeenCalledWith('');
      expect(showNotification).toHaveBeenCalledWith(
        'Message history could not be saved. It may return after the app restarts.',
        'warning',
        'Error',
      );
      expect(showNotification).not.toHaveBeenCalledWith('Message sent to Telegram.', 'success', 'Sent');
    } finally {
      if (previousLocale === null) window.localStorage.removeItem('awaitmsg_locale');
      else window.localStorage.setItem('awaitmsg_locale', previousLocale);
    }
  });

  it('keeps a single sending status while a multi-album draft is sent in groups', async () => {
    const chat = { id: 'chat-send-album-groups', name: 'Album send chat' };
    let resolveFirst!: (value: { success: boolean; telegramMessageIds: number[]; telegramMessageId: number }) => void;
    let resolveSecond!: (value: { success: boolean; telegramMessageId: number }) => void;
    const send = vi.fn()
      .mockImplementationOnce(() => new Promise<{ success: boolean; telegramMessageIds: number[]; telegramMessageId: number }>((resolve) => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => new Promise<{ success: boolean; telegramMessageId: number }>((resolve) => { resolveSecond = resolve; }));
    const showNotification = vi.fn();
    const onAttachmentGroupResult = vi.fn();
    const { result } = renderWorkspaceHistory([], [], { send }, showNotification, 'workspace', chat);

    await waitFor(() => expect(result.current.scheduling).toBe(false));
    let batchPromise!: Promise<boolean | 'sent-history-failed'>;
    await act(async () => {
      batchPromise = result.current.handleSendDraftNow(
        chat,
        'Caption',
        ['one.png', 'two.png', 'three.png'],
        [],
        [['one.png', 'two.png'], ['three.png']],
        undefined,
        {},
        [['one.png', 'two.png'], ['three.png']],
        onAttachmentGroupResult,
      );
      await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    });

    expect(result.current.publishingDraft).toBe(true);
    await act(async () => {
      resolveFirst({ success: true, telegramMessageId: 1, telegramMessageIds: [1, 2] });
      await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    });
    expect(result.current.publishingDraft).toBe(true);
    expect(result.current.successPulse).toBe(false);
    expect(showNotification).not.toHaveBeenCalled();

    await act(async () => {
      resolveSecond({ success: true, telegramMessageId: 3 });
      await expect(batchPromise).resolves.toBe(true);
    });
    expect(result.current.publishingDraft).toBe(false);
    expect(result.current.successPulse).toBe(true);
    expect(showNotification).toHaveBeenCalledTimes(1);
    expect(onAttachmentGroupResult.mock.calls).toEqual([[0, true], [1, true]]);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('stops a grouped send at the first failure and reports later groups as unattempted', async () => {
    const chat = { id: 'chat-send-album-partial', name: 'Partial album chat' };
    const send = vi.fn()
      .mockResolvedValueOnce({ success: true, telegramMessageId: 1, telegramMessageIds: [1, 2] })
      .mockResolvedValueOnce({ success: false, error: 'Album upload failed.' });
    const showNotification = vi.fn();
    const onAttachmentGroupResult = vi.fn();
    const { result } = renderWorkspaceHistory([], [], { send }, showNotification, 'workspace', chat);
    const groups = [['one.png', 'two.png'], ['three.png'], ['four.png']];

    await waitFor(() => expect(result.current.scheduling).toBe(false));
    let sent: boolean | 'sent-history-failed' = true;
    await act(async () => {
      sent = await result.current.handleSendDraftNow(
        chat,
        'Caption',
        groups.flat(),
        [],
        groups,
        undefined,
        {},
        groups,
        onAttachmentGroupResult,
      );
    });

    expect(sent).toBe(false);
    expect(send).toHaveBeenCalledTimes(2);
    expect(onAttachmentGroupResult.mock.calls).toEqual([[0, true], [1, false], [2, false]]);
    expect(result.current.sent).toHaveLength(1);
    expect(result.current.sent[0].attachments).toEqual(groups[0]);
    expect(result.current.publishingDraft).toBe(false);
    expect(showNotification).toHaveBeenCalledTimes(1);
    expect(showNotification.mock.calls[0][1]).toBe('warning');
    expect(result.current.successPulse).toBe(false);
  });

  it('sends each attachment group separately and keeps the caption on the first group', async () => {
    const chat = { id: 'chat-send-album-groups', name: 'Album send chat' };
    const send = vi.fn()
      .mockResolvedValueOnce({ success: true, telegramMessageId: 1, telegramMessageIds: [1, 2] })
      .mockResolvedValueOnce({ success: true, telegramMessageId: 3 });
    const entities: RichTextEntity[] = [{ type: 'bold', offset: 0, length: 7 }];
    const setMessage = vi.fn();
    const { result } = renderWorkspaceHistory([], [], { send }, vi.fn(), 'workspace', chat, setMessage);

    await waitFor(() => expect(result.current.scheduling).toBe(false));
    await act(async () => {
      const sent = await result.current.handleSendDraftNow(
        chat,
        'Caption',
        ['one.png', 'two.png', 'three.png'],
        entities,
        [['one.png', 'two.png'], ['three.png']],
      );
      expect(sent).toBe(true);
    });

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls.map((call) => call.slice(0, 6))).toEqual([
      [chat.id, 'Caption', ['one.png', 'two.png'], entities, false, undefined],
      [chat.id, '', ['three.png'], [], false, undefined],
    ]);
    expect(setMessage).toHaveBeenCalledOnce();
    expect(setMessage).toHaveBeenCalledWith('');
  });

  it('keeps composer attachments and entities when scheduling for the current minute', async () => {
    const chat = { id: 'chat-current-minute', name: 'Current minute chat' };
    const attachments = ['C:/demo/photo.jpg'];
    const entities: RichTextEntity[] = [{ type: 'bold', offset: 0, length: 5 }];
    const send = vi.fn().mockResolvedValue({ success: true, telegramMessageId: 502 });
    const schedule = vi.fn();
    const { result, loadScheduleHistory } = renderWorkspaceHistory(
      [],
      [],
      { send, schedule },
      vi.fn(),
      'personal',
      chat,
      vi.fn(),
      attachments,
      entities,
      'Photo',
    );

    await waitFor(() => expect(loadScheduleHistory).toHaveBeenCalledWith('personal'));
    act(() => {
      result.current.setDate(getTodayStr());
      result.current.setTime(getCurrentTimeStr());
    });
    await act(async () => {
      await result.current.handleSchedule();
    });

    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0].slice(0, 4)).toEqual([chat.id, 'Photo', attachments, entities]);
  });

  it('lets Quick Planner clear the message only after confirming the draft is unchanged', async () => {
    const chat = { id: 'chat-1', name: 'Test chat' };
    const setMessage = vi.fn();
    const { result } = renderWorkspaceHistory([], [], {
      send: vi.fn().mockResolvedValue({ success: true, telegramMessageId: 503 }),
    }, vi.fn(), 'personal', chat, setMessage);

    await waitFor(() => expect(result.current.upcoming).toEqual([]));
    await act(async () => {
      const sent = await result.current.handleSendDraftNow(
        chat,
        'First draft',
        [],
        [],
        false,
        undefined,
        { clearMessageOnSuccess: false },
      );
      expect(sent).toBe(true);
    });

    expect(setMessage).not.toHaveBeenCalled();
  });

  it('keeps an uncertain draft send unknown and does not repeat the request', async () => {
    const chat = { id: 'draft-retry', name: 'Draft retry chat' };
    const send = vi.fn().mockResolvedValue({
      success: false,
      error: 'Network response was lost.',
      code: 'ETIMEDOUT',
      category: 'network',
      retryable: true,
    });
    const { result } = renderWorkspaceHistory([], [], { send }, vi.fn(), 'workspace', chat);

    await waitFor(() => expect(result.current.scheduling).toBe(false));
    await act(async () => {
      await expect(result.current.handleSendDraftNow(chat, 'Retry same payload')).resolves.toBe(false);
    });
    expect(result.current.upcoming[0]).toMatchObject({ status: 'unknown', retryAction: undefined });

    await act(async () => {
      await expect(result.current.handleSendDraftNow(chat, 'Retry same payload')).resolves.toBe(false);
    });

    expect(send).toHaveBeenCalledOnce();
    expect(result.current.sent).toHaveLength(0);
  });

  it('restores an uncertain draft-send attempt without automatically repeating it', async () => {
    const chat = { id: 'draft-restart-retry', name: 'Draft restart chat' };
    const send = vi.fn().mockResolvedValue({
      success: false,
      error: 'Network response was lost.',
      code: 'ETIMEDOUT',
      category: 'network',
      retryable: true,
    });
    const firstRun = renderWorkspaceHistory([], [], { send }, vi.fn(), 'workspace', chat);

    await waitFor(() => expect(firstRun.result.current.scheduling).toBe(false));
    await act(async () => {
      await expect(firstRun.result.current.handleSendDraftNow(chat, 'Persist this attempt')).resolves.toBe(false);
    });
    const interruptedAttempt = firstRun.result.current.upcoming[0];
    const originalAttemptId = interruptedAttempt.sendAttemptId;
    expect(interruptedAttempt).toMatchObject({ status: 'unknown', retryAction: undefined });
    expect(originalAttemptId).toEqual(expect.stringMatching(/^\d+:[a-z0-9]+$/i));
    firstRun.unmount();

    const restarted = renderWorkspaceHistory([interruptedAttempt], [], { send }, vi.fn(), 'workspace', chat);
    await waitFor(() => expect(restarted.result.current.scheduling).toBe(false));
    await act(async () => {
      await expect(restarted.result.current.handleSendDraftNow(chat, 'Persist this attempt')).resolves.toBe(false);
    });

    expect(send).toHaveBeenCalledOnce();
    expect(restarted.result.current.upcoming[0]).toMatchObject({
      status: 'unknown',
      sendAttemptId: originalAttemptId,
    });
    expect(restarted.result.current.sent).toHaveLength(0);
    restarted.unmount();
  });

  it('restores an unknown send as Sent only when Telegram returns its correlated message ID', async () => {
    const unknown: ScheduledMessage = {
      id: 'unknown-send',
      chatId: 'chat-unknown',
      chatName: 'Unknown chat',
      text: 'Correlated send',
      when: '2035-01-15T18:00:00.000Z',
      createdAt: '2035-01-15T17:00:00.000Z',
      status: 'unknown',
      sendAttemptId: '1736962920000:stable-attempt',
    };
    const send = vi.fn();
    const reconcileSendAttempt = vi.fn().mockResolvedValue({
      success: true,
      state: 'sent',
      telegramMessageId: 42,
      telegramMessageIds: [42],
      sentAt: '2035-01-15T18:00:10.000Z',
    });
    const { result, saveScheduleHistory } = renderWorkspaceHistory(
      [unknown],
      [],
      { send, reconcileSendAttempt },
      vi.fn(),
    );

    await waitFor(() => expect(reconcileSendAttempt).toHaveBeenCalledOnce());
    await waitFor(() => expect(result.current.sent).toHaveLength(1));
    expect(result.current.upcoming).toHaveLength(0);
    expect(reconcileSendAttempt).toHaveBeenCalledWith({
      idempotencyKey: unknown.sendAttemptId,
      attachmentCount: 0,
    });
    expect(result.current.sent[0]).toMatchObject({
      id: unknown.id,
      status: 'sent',
      telegramMessageId: 42,
      sentAt: '2035-01-15T18:00:10.000Z',
    });
    expect(send).not.toHaveBeenCalled();
    expect(saveScheduleHistory).toHaveBeenCalledWith(expect.objectContaining({
      field: 'snapshot',
      messages: expect.objectContaining({
        sent: [expect.objectContaining({ id: unknown.id, telegramMessageId: 42 })],
      }),
    }));
  });

  it('keeps a nominally successful send unknown when the bridge omits its Telegram message ID', async () => {
    const chat = { id: 'missing-send-id', name: 'Missing send ID' };
    const send = vi.fn().mockResolvedValue({ success: true });
    const { result } = renderWorkspaceHistory([], [], { send }, vi.fn(), 'workspace', chat);

    await waitFor(() => expect(result.current.scheduling).toBe(false));
    await act(async () => {
      await expect(result.current.handleSendDraftNow(chat, 'Do not assume sent')).resolves.toBe(false);
    });

    expect(send).toHaveBeenCalledOnce();
    expect(result.current.sent).toHaveLength(0);
    expect(result.current.upcoming[0]).toMatchObject({
      status: 'unknown',
      retryAction: undefined,
    });
  });

  it('does not contact Telegram when the draft Sending record cannot be persisted', async () => {
    const chat = { id: 'draft-persist-before-send', name: 'Draft persist chat' };
    const send = vi.fn();
    const saveScheduleHistory = vi.fn(async ({ field, messages }: {
      field: string;
      messages: ScheduledMessage[] | { upcoming: ScheduledMessage[]; sent: ScheduledMessage[] };
    }) => {
      const containsSending = field === 'upcoming'
        && Array.isArray(messages)
        && messages.some((item) => item.status === 'sending');
      return { success: !containsSending, error: containsSending ? 'Disk full' : undefined };
    });
    const { result } = renderWorkspaceHistory([], [], { send, saveScheduleHistory }, vi.fn(), 'workspace', chat);

    await waitFor(() => expect(result.current.scheduling).toBe(false));
    await act(async () => {
      await expect(result.current.handleSendDraftNow(chat, 'Persist before send')).resolves.toBe(false);
    });

    expect(send).not.toHaveBeenCalled();
    expect(result.current.upcoming[0]).toMatchObject({ status: 'failed', retryAction: 'send' });
  });

  it('keeps recovery Pending when the bridge returns an unknown send status', async () => {
    const unknown: ScheduledMessage = {
      id: 'unsupported-send-state',
      chatId: 'chat-unknown-state',
      chatName: 'Unknown state chat',
      text: 'Do not infer delivery',
      when: '2035-01-15T18:00:00.000Z',
      createdAt: '2035-01-15T17:00:00.000Z',
      status: 'unknown',
      sendAttemptId: '1736962920000:unsupported-state-attempt',
    };
    const reconcileSendAttempt = vi.fn().mockResolvedValue({
      success: true,
      state: 'delivered',
      telegramMessageId: 42,
    });
    const send = vi.fn();
    const { result } = renderWorkspaceHistory(
      [unknown],
      [],
      { send, reconcileSendAttempt },
    );

    await waitFor(() => expect(reconcileSendAttempt).toHaveBeenCalledOnce());
    await waitFor(() => expect(result.current.upcoming[0]?.status).toBe('unknown'));

    expect(result.current.sent).toHaveLength(0);
    expect(send).not.toHaveBeenCalled();
  });

  it('ignores a duplicate immediate draft-send while the first request is in flight', async () => {
    const chat = { id: 'draft-send-once', name: 'Draft send chat' };
    let resolveSend!: (result: { success: boolean; telegramMessageId?: string }) => void;
    const send = vi.fn(() => new Promise<{ success: boolean; telegramMessageId?: string }>((resolve) => { resolveSend = resolve; }));
    const { result } = renderWorkspaceHistory([], [], { send }, vi.fn(), 'workspace', chat);

    await waitFor(() => expect(result.current.scheduling).toBe(false));
    let firstAttempt!: Promise<boolean | 'sent-history-failed'>;
    let duplicateResult: boolean | 'sent-history-failed' = true;
    await act(async () => {
      firstAttempt = result.current.handleSendDraftNow(chat, 'Send once');
      await Promise.resolve();
      duplicateResult = await result.current.handleSendDraftNow(chat, 'Send once');
    });

    expect(duplicateResult).toBe(false);
    expect(send).toHaveBeenCalledOnce();
    const idempotencyKey = (send.mock.calls[0] as unknown[])[7];
    expect(idempotencyKey).toEqual(expect.stringMatching(/^\d+:[a-z0-9]+$/i));

    await act(async () => {
      resolveSend({ success: true, telegramMessageId: '506' });
      await expect(firstAttempt).resolves.toBe(true);
    });

    expect(send).toHaveBeenCalledOnce();
    expect(result.current.sent).toHaveLength(1);
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
    await waitFor(() => expect(result.current.upcoming).toEqual([original]));
    await act(async () => {
      await result.current.handleSchedule({
        chatId: chat.id,
        message: 'Replacement text',
        ...replacementDateTime,
        replaceMessage: original,
      });
    });

    await waitFor(() => {
      expect(result.current.upcoming).toHaveLength(2);
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
    });
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
    await waitFor(() => expect(result.current.scheduling).toBe(false));
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
    await act(async () => { await result.current.handleClearSent(); });

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
      return { success: true, telegramMessageId: '507' };
    });
    const saveScheduleHistory = vi.fn(async ({ field, messages }: { field: string; messages: ScheduledMessage[] }) => {
      if (field === 'upcoming' && messages.some((item) => item.id === message.id && item.telegramMessageId === undefined)) {
        events.push('persist-cleared-id');
      }
      return { success: true };
    });
    const showNotification = vi.fn();
    const { result } = renderWorkspaceHistory([message], [], { cancel, send, saveScheduleHistory }, showNotification);

    await waitFor(() => expect(result.current.upcoming).toEqual([message]));
    act(() => {
      result.current.dateEditedRef.current = true;
      result.current.timeEditedRef.current = true;
      result.current.setDate('2035-01-15');
      result.current.setTime('18:30');
    });
    await act(async () => {
      await result.current.handleSendNow(message);
    });

    await waitFor(() => expect(result.current.sent).toHaveLength(1));
    expect(result.current.date).toBe(getTodayStr());
    expect(result.current.time).toMatch(/^\d{2}:\d{2}$/);
    expect(result.current.dateEditedRef.current).toBe(false);
    expect(result.current.timeEditedRef.current).toBe(false);
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
      true,
      '12345',
      'account-1',
      expect.stringMatching(/^\d+:[a-z0-9]+$/i),
    );
    expect(events.indexOf('cancel')).toBeLessThan(events.indexOf('persist-cleared-id'));
    expect(events.indexOf('persist-cleared-id')).toBeLessThan(events.indexOf('send'));
    expect(showNotification.mock.calls.some(([, , , , actions]) => actions)).toBe(false);
  });

  it('keeps Send Now confirmed in memory and warns when its final history save fails', async () => {
    const message: ScheduledMessage = {
      id: 'send-now-history-write-failure',
      chatId: 'chat-send-now-history',
      chatName: 'Send Now history chat',
      text: 'Confirmed before local save',
      when: '2035-01-15T18:00:00.000Z',
      createdAt: '2035-01-15T17:00:00.000Z',
      status: 'scheduled',
    };
    const send = vi.fn().mockResolvedValue({
      success: true,
      telegramMessageId: 508,
      telegramMessageIds: [508],
      sentAt: '2035-01-15T18:00:10.000Z',
    });
    const saveScheduleHistory = vi.fn(async ({ field, messages }: {
      field: string;
      messages: ScheduledMessage[] | { upcoming: ScheduledMessage[]; sent: ScheduledMessage[] };
    }) => {
      const isFailedFinalSnapshot = field === 'snapshot'
        && !Array.isArray(messages)
        && messages.sent.some((item) => item.id === message.id && item.status === 'sent');
      return { success: !isFailedFinalSnapshot, error: isFailedFinalSnapshot ? 'Disk full' : undefined };
    });
    const showNotification = vi.fn();
    const { result } = renderWorkspaceHistory(
      [message],
      [],
      { send, saveScheduleHistory },
      showNotification,
    );

    await waitFor(() => expect(result.current.upcoming).toEqual([message]));
    act(() => {
      result.current.dateEditedRef.current = true;
      result.current.timeEditedRef.current = true;
      result.current.setDate('2035-01-15');
      result.current.setTime('18:30');
    });
    await act(async () => {
      await result.current.handleSendNow(message);
    });

    expect(result.current.date).toBe(getTodayStr());
    expect(result.current.time).toMatch(/^\d{2}:\d{2}$/);
    expect(result.current.dateEditedRef.current).toBe(false);
    expect(result.current.timeEditedRef.current).toBe(false);
    expect(result.current.sent[0]).toMatchObject({
      id: message.id,
      status: 'sent',
      telegramMessageId: 508,
      sentAt: '2035-01-15T18:00:10.000Z',
    });
    expect(result.current.upcoming).toHaveLength(0);
    expect(showNotification).toHaveBeenCalledWith(
      'Telegram sent the message, but history could not be saved. Do not retry this message.',
      'warning',
      expect.any(String),
    );

    await act(async () => {
      await result.current.handleSendNow(result.current.sent[0]);
    });
    expect(send).toHaveBeenCalledOnce();
  });

  it('does not call Telegram when the Send Now Sending record cannot be persisted', async () => {
    const message: ScheduledMessage = {
      id: 'send-now-persist-before-send',
      chatId: 'chat-send-now-persist',
      chatName: 'Send Now persist chat',
      text: 'Persist this Sending status first',
      when: '2035-01-15T18:00:00.000Z',
      createdAt: '2035-01-15T17:00:00.000Z',
      status: 'scheduled',
    };
    const send = vi.fn();
    const saveScheduleHistory = vi.fn(async ({ field, messages }: {
      field: string;
      messages: ScheduledMessage[] | { upcoming: ScheduledMessage[]; sent: ScheduledMessage[] };
    }) => {
      const containsSending = field === 'upcoming'
        && Array.isArray(messages)
        && messages.some((item) => item.status === 'sending');
      return { success: !containsSending, error: containsSending ? 'Disk full' : undefined };
    });
    const { result } = renderWorkspaceHistory(
      [message],
      [],
      { send, saveScheduleHistory },
    );

    await waitFor(() => expect(result.current.upcoming).toEqual([message]));
    await act(async () => {
      await result.current.handleSendNow(message);
    });

    expect(send).not.toHaveBeenCalled();
    expect(result.current.upcoming[0]).toMatchObject({ status: 'failed', retryAction: 'send' });
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

  it('keeps an uncertain Send Now result unknown and blocks a repeat send', async () => {
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
    const send = vi.fn().mockResolvedValue({
      success: false,
      error: 'Telegram rejected the message.',
      code: 'HTTP_503',
      category: 'network',
      retryable: true,
    });
    const { result } = renderWorkspaceHistory([message], [], { cancel, send }, showNotification);

    await waitFor(() => expect(result.current.upcoming).toEqual([message]));
    await act(async () => {
      await result.current.handleSendNow(message);
    });

    await waitFor(() => expect(showNotification).toHaveBeenCalledWith(
      expect.any(String),
      'warning',
      expect.any(String),
      expect.objectContaining({ operation: 'publish', category: 'network', code: 'HTTP_503', retryable: true }),
    ));
    expect(result.current.upcoming[0]).toMatchObject({
      id: message.id,
      status: 'unknown',
      lastError: 'Telegram rejected the message.',
      lastErrorDetails: expect.objectContaining({ operation: 'publish', category: 'network', code: 'HTTP_503', retryable: true }),
      retryAction: undefined,
      telegramMessageId: undefined,
    });
    expect(result.current.sent).toHaveLength(0);

    const unknownMessage = result.current.upcoming[0];
    await act(async () => {
      await result.current.handleRetry(unknownMessage);
    });

    expect(result.current.sent).toHaveLength(0);
    expect(result.current.upcoming[0]).toMatchObject({ status: 'unknown', id: message.id });
    expect(cancel).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledOnce();
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
    let resolveSend!: (result: { success: boolean; telegramMessageId: number }) => void;
    const send = vi.fn(() => new Promise<{ success: boolean; telegramMessageId: number }>((resolve) => { resolveSend = resolve; }));
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
      resolveSend({ success: true, telegramMessageId: 42 });
      await firstAttempt;
    });
    expect(result.current.sent).toHaveLength(1);
  });

  it('preserves both results when distinct Send Now operations finish concurrently', async () => {
    const firstMessage: ScheduledMessage = {
      id: 'send-now-parallel-1',
      chatId: 'chat-1',
      chatName: 'Test chat',
      text: 'First message',
      when: '2035-01-15T18:00:00.000Z',
      createdAt: '2035-01-15T17:00:00.000Z',
      status: 'scheduled',
    };
    const secondMessage: ScheduledMessage = {
      ...firstMessage,
      id: 'send-now-parallel-2',
      text: 'Second message',
    };
    let resolveFirst!: (result: { success: boolean; telegramMessageId: number }) => void;
    let resolveSecond!: (result: { success: boolean; telegramMessageId: number }) => void;
    const send = vi.fn((chatId: string) => new Promise<{ success: boolean; telegramMessageId: number }>((resolve) => {
      if (chatId === 'chat-1') {
        if (!resolveFirst) resolveFirst = resolve;
        else resolveSecond = resolve;
      }
    }));
    const { result } = renderWorkspaceHistory([firstMessage, secondMessage], [], { send });

    await waitFor(() => expect(result.current.upcoming).toHaveLength(2));
    let firstAttempt!: Promise<void>;
    let secondAttempt!: Promise<void>;
    await act(async () => {
      firstAttempt = result.current.handleSendNow(firstMessage);
      secondAttempt = result.current.handleSendNow(secondMessage);
    });
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));

    await act(async () => {
      resolveFirst({ success: true, telegramMessageId: 41 });
      await firstAttempt;
    });
    await act(async () => {
      resolveSecond({ success: true, telegramMessageId: 42 });
      await secondAttempt;
    });

    expect(result.current.sent.map((item) => item.id).sort()).toEqual([
      firstMessage.id,
      secondMessage.id,
    ]);
    expect(result.current.upcoming).toHaveLength(0);
  });

  it('preserves both results when distinct schedule retries finish concurrently', async () => {
    const firstMessage: ScheduledMessage = {
      id: 'retry-schedule-parallel-1',
      chatId: 'chat-1',
      chatName: 'Test chat',
      text: 'First retry',
      when: '2035-01-15T18:00:00.000Z',
      createdAt: '2035-01-15T17:00:00.000Z',
      status: 'failed',
      retryAction: 'schedule',
    };
    const secondMessage: ScheduledMessage = {
      ...firstMessage,
      id: 'retry-schedule-parallel-2',
      text: 'Second retry',
    };
    let resolveFirst!: (result: { success: boolean; confirmed: boolean; telegramMessageId: string }) => void;
    let resolveSecond!: (result: { success: boolean; confirmed: boolean; telegramMessageId: string }) => void;
    const schedule = vi.fn(() => new Promise<{ success: boolean; confirmed: boolean; telegramMessageId: string }>((resolve) => {
      if (!resolveFirst) resolveFirst = resolve;
      else resolveSecond = resolve;
    }));
    const { result } = renderWorkspaceHistory([firstMessage, secondMessage], [], { schedule });

    await waitFor(() => expect(result.current.upcoming).toHaveLength(2));
    let firstAttempt!: Promise<void>;
    let secondAttempt!: Promise<void>;
    await act(async () => {
      firstAttempt = result.current.handleRetry(firstMessage);
      secondAttempt = result.current.handleRetry(secondMessage);
    });
    await waitFor(() => expect(schedule).toHaveBeenCalledTimes(2));

    await act(async () => {
      resolveFirst({ success: true, confirmed: true, telegramMessageId: 'retry-scheduled-1' });
      await firstAttempt;
    });
    await act(async () => {
      resolveSecond({ success: true, confirmed: true, telegramMessageId: 'retry-scheduled-2' });
      await secondAttempt;
    });

    expect(result.current.upcoming.map((item) => item.id).sort()).toEqual([
      firstMessage.id,
      secondMessage.id,
    ]);
    expect(result.current.upcoming.every((item) => item.status === 'scheduled')).toBe(true);
  });

  it('keeps Send Now behind the account FloodWait gate', async () => {
    const message: ScheduledMessage = {
      id: 'send-now-rate-limited',
      chatId: 'chat-1',
      chatName: 'Test chat',
      text: 'Wait until account is available',
      when: '2035-01-15T18:00:00.000Z',
      createdAt: '2035-01-15T17:00:00.000Z',
      status: 'scheduled',
    };
    let resumeRateLimit!: (result: { success: boolean }) => void;
    const rateLimitGate = new Promise<{ success: boolean }>((resolve) => { resumeRateLimit = resolve; });
    const waitForRateLimit = vi.fn(() => rateLimitGate);
    const send = vi.fn().mockResolvedValue({ success: true, telegramMessageId: 505 });
    const { result, loadScheduleHistory } = renderWorkspaceHistory([message], [], { waitForRateLimit, send });

    await waitFor(() => expect(result.current.upcoming).toEqual([message]));
    let attempt!: Promise<void>;
    await act(async () => {
      attempt = result.current.handleSendNow(message);
      await Promise.resolve();
    });

    expect(waitForRateLimit).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalled();
    expect(result.current.upcoming[0]).toMatchObject({ status: 'sending' });

    await act(async () => {
      resumeRateLimit({ success: true });
      await attempt;
    });

    expect(send).toHaveBeenCalledOnce();
    expect(result.current.sent).toHaveLength(1);
    expect(loadScheduleHistory).toHaveBeenCalledWith('workspace');
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

  it('preserves both results when distinct cancellations finish concurrently', async () => {
    const firstMessage: ScheduledMessage = {
      id: 'cancel-parallel-1',
      chatId: 'chat-1',
      chatName: 'Test chat',
      text: 'First cancellation',
      when: '2035-01-15T18:00:00.000Z',
      createdAt: '2035-01-15T17:00:00.000Z',
      status: 'scheduled',
      telegramMessageId: 'telegram-cancel-parallel-1',
    };
    const secondMessage: ScheduledMessage = {
      ...firstMessage,
      id: 'cancel-parallel-2',
      text: 'Second cancellation',
      telegramMessageId: 'telegram-cancel-parallel-2',
    };
    let resolveFirst!: (result: { success: boolean }) => void;
    let resolveSecond!: (result: { success: boolean }) => void;
    const cancel = vi.fn(({ telegramMessageId }: { telegramMessageId: string }) => new Promise<{ success: boolean }>((resolve) => {
      if (telegramMessageId === firstMessage.telegramMessageId) resolveFirst = resolve;
      else resolveSecond = resolve;
    }));
    const { result } = renderWorkspaceHistory([firstMessage, secondMessage], [], { cancel });

    await waitFor(() => expect(result.current.upcoming).toHaveLength(2));
    let firstAttempt!: Promise<boolean>;
    let secondAttempt!: Promise<boolean>;
    await act(async () => {
      firstAttempt = result.current.handleCancelMessage(firstMessage);
      secondAttempt = result.current.handleCancelMessage(secondMessage);
    });
    await waitFor(() => expect(cancel).toHaveBeenCalledTimes(2));

    await act(async () => {
      resolveFirst({ success: true });
      await firstAttempt;
    });
    await act(async () => {
      resolveSecond({ success: true });
      await secondAttempt;
    });

    expect(result.current.upcoming).toHaveLength(0);
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
    await act(async () => { await result.current.handleDeleteMessage(message); });

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
    await act(async () => { await result.current.handleDeleteMessage(message, true); });

    await waitFor(() => expect(result.current.upcoming).toHaveLength(0));
    expect(confirm).not.toHaveBeenCalled();
    expect(saveScheduleHistory).toHaveBeenCalledWith({ scope: 'workspace', field: 'upcoming', messages: [] });
  });

  it('does not warn below the bulk scheduling threshold', async () => {
    const chat = { id: 'bulk-9', name: 'Bulk chat' };
    const { date, time } = getFutureReplacementTimes().replacementDateTime;
    const schedule = vi.fn().mockResolvedValue({ success: true, confirmed: true });
    const showNotification = vi.fn();
    const { result } = renderWorkspaceHistory([], [], { schedule }, showNotification, 'workspace', chat);

    await waitFor(() => expect(result.current.scheduling).toBe(false));
    vi.useFakeTimers();
    await act(async () => {
      await result.current.handleSchedule(
        { chatId: chat.id, message: 'Nine messages', date, time },
        { mode: 'daily', occurrences: 9 },
      );
      await vi.runAllTimersAsync();
    });
    vi.useRealTimers();

    expect(schedule).toHaveBeenCalledTimes(9);
    expect(showNotification.mock.calls.some(([, type, title]) => type === 'warning' && title === 'Mass scheduling warning')).toBe(false);
  });

  it('does not restore a cancelled record after schedule identity lookup', async () => {
    const chat = { id: 'identity-race-chat', name: 'Identity race chat' };
    const cancelledMessage: ScheduledMessage = {
      id: 'identity-race-cancelled',
      chatId: chat.id,
      chatName: chat.name,
      text: 'Cancel while identities load',
      when: '2035-01-15T18:00:00.000Z',
      createdAt: '2035-01-15T17:00:00.000Z',
      status: 'scheduled',
      telegramMessageId: 'telegram-identity-race',
    };
    let resolveIdentities!: (value: { success: boolean; identities: string[] }) => void;
    const getScheduleIdentities = vi.fn(() => new Promise<{ success: boolean; identities: string[] }>((resolve) => {
      resolveIdentities = resolve;
    }));
    const schedule = vi.fn().mockResolvedValue({ success: true, confirmed: true, telegramMessageId: 'new-scheduled-message' });
    const cancel = vi.fn().mockResolvedValue({ success: true });
    const { result } = renderWorkspaceHistory(
      [cancelledMessage],
      [],
      { getScheduleIdentities, schedule, cancel },
      vi.fn(),
      'workspace',
      chat,
    );
    const { date, time } = getFutureReplacementTimes().replacementDateTime;

    await waitFor(() => expect(result.current.upcoming).toEqual([cancelledMessage]));
    let scheduleRequest!: Promise<boolean | void | 'sent-history-failed'>;
    act(() => {
      scheduleRequest = result.current.handleSchedule({
        chatId: chat.id,
        message: 'New scheduled message',
        date,
        time,
        waitForConfirmation: true,
      });
    });
    await waitFor(() => expect(getScheduleIdentities).toHaveBeenCalledOnce());

    await act(async () => {
      await result.current.handleCancelMessage(cancelledMessage);
    });
    expect(result.current.upcoming).toHaveLength(0);

    await act(async () => {
      resolveIdentities({ success: true, identities: ['new-operation-identity'] });
      await scheduleRequest;
    });

    expect(result.current.upcoming.map((item) => item.id)).toHaveLength(1);
    expect(result.current.upcoming[0]).toMatchObject({ text: 'New scheduled message', status: 'scheduled' });
  });

  it('warns at ten messages for five seconds and continues scheduling once', async () => {
    const chat = { id: 'bulk-10', name: 'Bulk chat' };
    const { date, time } = getFutureReplacementTimes().replacementDateTime;
    const schedule = vi.fn(async () => ({ success: true, confirmed: true }));
    const getScheduleIdentities = vi.fn(async (operations: Array<Record<string, unknown>>) => createScheduleIdentityResult(operations));
    const showNotification = vi.fn();
    const { result } = renderWorkspaceHistory(
      [],
      [],
      { schedule, getScheduleIdentities },
      showNotification,
      'workspace',
      chat,
    );

    await waitFor(() => expect(result.current.scheduling).toBe(false));
    vi.useFakeTimers();
    await act(async () => {
      const firstRequest = result.current.handleSchedule(
        { chatId: chat.id, message: 'Ten messages', date, time },
        { mode: 'daily', occurrences: 10 },
      );
      const duplicateRequest = result.current.handleSchedule(
        { chatId: chat.id, message: 'Ten messages', date, time },
        { mode: 'daily', occurrences: 10 },
      );
      await Promise.all([firstRequest, duplicateRequest]);
      await vi.runAllTimersAsync();
    });
    vi.useRealTimers();

    const warningCall = showNotification.mock.calls.find(([, type, , , duration]) => type === 'warning' && duration === 5000);
    expect(warningCall?.[0]).toContain('10');
    expect(warningCall?.[1]).toBe('warning');
    expect(warningCall?.[4]).toBe(5000);
    expect(getScheduleIdentities).toHaveBeenCalledOnce();
    expect(schedule).toHaveBeenCalledTimes(10);
    expect(showNotification.mock.invocationCallOrder[0]).toBeLessThan(getScheduleIdentities.mock.invocationCallOrder[0]);
  });

  it('shows the correct count for the maximum repeat count', async () => {
    const previousLocale = window.localStorage.getItem('awaitmsg_locale');
    window.localStorage.setItem('awaitmsg_locale', 'en');

    try {
      const chat = { id: 'bulk-15', name: 'Bulk chat' };
      const schedule = vi.fn().mockResolvedValue({ success: true, confirmed: true });
      const showNotification = vi.fn();
      const { result, loadScheduleHistory } = renderWorkspaceHistory([], [], { schedule }, showNotification, 'workspace', chat);

      await waitFor(() => expect(loadScheduleHistory).toHaveBeenCalledWith('workspace'));
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date('2035-01-15T12:00:00.000Z'));
        const { date, time } = localDateTimeAt(Date.now() + 60 * 60 * 1000);
        await act(async () => {
          await result.current.handleSchedule(
            { chatId: chat.id, message: 'Fifteen messages', date, time },
            { mode: 'daily', occurrences: 15 },
          );
          await vi.runAllTimersAsync();
        });
      } finally {
        vi.useRealTimers();
      }

      const warningCall = showNotification.mock.calls.find(([, type, , , duration]) => type === 'warning' && duration === 5000);
      expect([
        ['15 messages · FloodWait risk', 'Mass scheduling warning'],
        ['15 сообщений · риск FloodWait', 'Массовое планирование'],
      ]).toContainEqual([warningCall?.[0], warningCall?.[2]]);
      expect(warningCall?.[4]).toBe(5000);
      expect(schedule).toHaveBeenCalledTimes(15);
    } finally {
      if (previousLocale === null) window.localStorage.removeItem('awaitmsg_locale');
      else window.localStorage.setItem('awaitmsg_locale', previousLocale);
    }
  });
});