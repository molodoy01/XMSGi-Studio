import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Chat } from '@studio/types';
import { useStudioScheduler } from './useStudioScheduler';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { publishToChannel, scheduleToChannel } = vi.hoisted(() => ({
  publishToChannel: vi.fn(),
  scheduleToChannel: vi.fn(),
}));

vi.mock('@studio/services/publishingService', () => ({
  publishToChannel,
  scheduleToChannel,
}));

vi.mock('@studio/lib/i18n', () => ({
  useLocale: () => ({
    locale: 'en',
    t: (key: string) => key,
  }),
}));

const chat: Chat = { id: 'chat-1', name: 'Test chat', type: 'group' };

function renderScheduler(showNotification = vi.fn(), scheduleHistoryOverrides: Record<string, unknown> = {}) {
  const history = { upcoming: [] as Array<Record<string, unknown>>, sent: [] as Array<Record<string, unknown>> };
  const loadScheduleHistory = vi.fn(async () => ({
    success: true,
    history: { upcoming: [...history.upcoming], sent: [...history.sent] },
  }));
  const saveScheduleHistory = vi.fn(async (data:
    | { field: 'snapshot'; messages: { upcoming: Array<Record<string, unknown>>; sent: Array<Record<string, unknown>> } }
    | { field: 'upcoming' | 'sent'; messages: Array<Record<string, unknown>> }
  ) => {
    if (data.field === 'snapshot') {
      history.upcoming = data.messages.upcoming;
      history.sent = data.messages.sent;
    } else {
      history[data.field] = data.messages as Array<Record<string, unknown>>;
    }
    return { success: true };
  });
  vi.stubGlobal('telegram', {
    loadScheduleHistory,
    saveScheduleHistory,
    ...scheduleHistoryOverrides,
  });
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
    history,
    loadScheduleHistory,
    saveScheduleHistory,
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('useStudioScheduler bridge errors', () => {
  beforeEach(() => {
    publishToChannel.mockReset();
    scheduleToChannel.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('persists the send attempt before publishing and forwards its idempotency key', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 19, 10, 10, 0));
    const events: string[] = [];
    const historyRef: { current: { upcoming: Array<Record<string, unknown>>; sent: Array<Record<string, unknown>> } | null } = { current: null };
    const scheduler = renderScheduler(vi.fn(), {
      saveScheduleHistory: vi.fn(async (data: { field: string; messages: Array<Record<string, unknown>> }) => {
        events.push('preflight-save');
        if (historyRef.current) historyRef.current.upcoming = data.messages;
        return { success: true };
      }),
    });
    historyRef.current = scheduler.history;
    publishToChannel.mockImplementationOnce(async (input: { sendAttemptId: string }) => {
      events.push('telegram-send');
      expect(historyRef.current?.upcoming).toHaveLength(1);
      expect(historyRef.current?.upcoming[0]).toMatchObject({
        status: 'sending',
        retryAction: 'send',
        sendAttemptId: input.sendAttemptId,
      });
      const [attempt] = historyRef.current!.upcoming;
      historyRef.current!.upcoming = [];
      historyRef.current!.sent = [{ ...attempt, status: 'sent', telegramMessageId: '42' }];
      return {
        publishResult: {
          ok: true,
          provider: 'telegram',
          messageId: '42',
          historyPersisted: true,
        },
      };
    });

    await act(async () => {
      scheduler.result.setDate('2099-01-15');
      scheduler.result.setTime('17:42');
      await expect(scheduler.result.handleSendDraftNow(chat, 'Persist first')).resolves.toBe(true);
    });

    expect(scheduler.result.date).toBe('2026-10-19');
    expect(scheduler.result.time).toBe('10:11');
    expect(events).toEqual(['preflight-save', 'telegram-send']);
    expect(publishToChannel).toHaveBeenCalledOnce();
    expect(publishToChannel.mock.calls[0][0]).toMatchObject({
      sendAttemptId: expect.any(String),
    });
    expect(historyRef.current?.upcoming).toHaveLength(0);
    expect(historyRef.current?.sent).toMatchObject([{
      sendAttemptId: publishToChannel.mock.calls[0][0].sendAttemptId,
      status: 'sent',
      telegramMessageId: '42',
    }]);
    scheduler.unmount();
  });

  it('does not contact Telegram when the pre-send history write fails', async () => {
    const showNotification = vi.fn();
    const scheduler = renderScheduler(showNotification, {
      saveScheduleHistory: vi.fn().mockResolvedValue({ success: false, error: 'Disk full' }),
    });

    await act(async () => {
      await expect(scheduler.result.handleSendDraftNow(chat, 'Do not send')).resolves.toBe(false);
    });

    expect(publishToChannel).not.toHaveBeenCalled();
    expect(showNotification).toHaveBeenCalledWith('Disk full', 'error', 'Studio');
    scheduler.unmount();
  });

  it('does not retry after Telegram confirms but final history persistence fails', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 19, 10, 10, 0));
    const showNotification = vi.fn();
    const scheduler = renderScheduler(showNotification);
    publishToChannel.mockResolvedValueOnce({
      publishResult: {
        ok: true,
        provider: 'telegram',
        messageId: '43',
        historyPersisted: false,
        historyError: 'Disk full',
      },
    });

    await act(async () => {
      scheduler.result.setDate('2099-01-15');
      scheduler.result.setTime('17:42');
      await expect(scheduler.result.handleSendDraftNow(chat, 'Send once')).resolves.toBe('sent-history-failed');
    });

    expect(scheduler.result.date).toBe('2026-10-19');
    expect(scheduler.result.time).toBe('10:11');
    expect(publishToChannel).toHaveBeenCalledOnce();
    expect(scheduler.history.upcoming).toHaveLength(1);
    expect(scheduler.history.upcoming[0]).toMatchObject({ status: 'sending' });
    expect(scheduler.result.upcoming).toHaveLength(0);
    expect(scheduler.result.sent[0]).toMatchObject({ status: 'sent', telegramMessageId: '43' });
    expect(showNotification).toHaveBeenCalledWith(
      'Telegram sent the message, but its history could not be saved. Do not retry this message.',
      'warning',
      'Studio',
    );
    scheduler.unmount();
  });

  it('persists an ambiguous send as unknown without a retry action', async () => {
    const scheduler = renderScheduler();
    publishToChannel.mockResolvedValueOnce({
      publishResult: {
        ok: false,
        provider: 'telegram',
        error: 'Connection lost after request started.',
        errorDetails: {
          operation: 'publish',
          category: 'network',
          retryable: true,
          message: 'Connection lost after request started.',
        },
      },
    });

    await act(async () => {
      await expect(scheduler.result.handleSendDraftNow(chat, 'Unknown outcome')).resolves.toBe(false);
    });

    expect(publishToChannel).toHaveBeenCalledOnce();
    expect(scheduler.history.upcoming).toHaveLength(1);
    expect(scheduler.history.upcoming[0]).toMatchObject({
      status: 'unknown',
      retryAction: undefined,
      sendAttemptId: expect.any(String),
    });
    scheduler.unmount();
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

  it('sends each photo album separately and puts the caption on the first album only', async () => {
    publishToChannel
      .mockResolvedValueOnce({ publishResult: { ok: true, provider: 'telegram', messageId: '201', historyPersisted: true } })
      .mockResolvedValueOnce({ publishResult: { ok: true, provider: 'telegram', messageId: '202', historyPersisted: true } });
    const entities = [{ type: 'bold', offset: 0, length: 11 }];
    const scheduler = renderScheduler();

    await act(async () => {
      expect(await scheduler.result.handleSendDraftNow(
        chat,
        'Album caption',
        ['a1', 'a2', 'b1', 'b2'],
        entities,
        [['a1', 'a2'], ['b1', 'b2']],
      )).toBe(true);
    });

    expect(publishToChannel).toHaveBeenCalledTimes(2);
    expect(publishToChannel.mock.calls.map(([input]) => input.mediaIds)).toEqual([['a1', 'a2'], ['b1', 'b2']]);
    expect(publishToChannel.mock.calls.map(([input]) => input.body)).toEqual(['Album caption', '']);
    expect(publishToChannel.mock.calls.map(([input]) => input.entities)).toEqual([entities, []]);
    expect(scheduler.result.sent).toHaveLength(2);
    scheduler.unmount();
  });

  it('forwards the selected Telegram effect when sending from Studio', async () => {
    publishToChannel.mockResolvedValueOnce({
      publishResult: { ok: true, provider: 'telegram', messageId: '203', historyPersisted: true },
    });
    const scheduler = renderScheduler();

    await act(async () => {
      expect(await scheduler.result.handleSendDraftNow(
        chat,
        'Effect caption',
        [],
        [],
        undefined,
        undefined,
        '123456789',
      )).toBe(true);
    });

    expect(publishToChannel).toHaveBeenCalledWith(expect.objectContaining({
      body: 'Effect caption',
      effect: '123456789',
    }));
    expect(scheduler.result.sent[0]).toMatchObject({ effect: '123456789' });
    scheduler.unmount();
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

  it('schedules each photo album separately at the same time', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 19, 10, 10, 0));
    scheduleToChannel
      .mockResolvedValueOnce({ publishResult: { ok: true, confirmed: true, messageId: '101' } })
      .mockResolvedValueOnce({ publishResult: { ok: true, confirmed: true, messageId: '102' } })
      .mockResolvedValueOnce({ publishResult: { ok: true, confirmed: true, messageId: '103' } });
    const scheduler = renderScheduler();

    await act(async () => {
      scheduler.result.setDate('2099-01-15');
      scheduler.result.setTime('17:42');
      await scheduler.result.handleSchedule({
        chatId: chat.id,
        message: 'Album post',
        date: '2099-01-15',
        time: '17:42',
        attachments: ['a1', 'a2', 'b1', 'b2', 'c1'],
        attachmentGroups: [['a1', 'a2'], ['b1', 'b2'], ['c1']],
        entities: [{ type: 'bold', offset: 0, length: 5 }],
      });
    });

    expect(scheduler.result.date).toBe('2026-10-19');
    expect(scheduler.result.time).toBe('10:11');
    expect(scheduleToChannel).toHaveBeenCalledTimes(3);
    expect(scheduleToChannel.mock.calls.map(([input]) => input.mediaIds)).toEqual([
      ['a1', 'a2'],
      ['b1', 'b2'],
      ['c1'],
    ]);
    expect(scheduleToChannel.mock.calls.map(([input]) => input.body)).toEqual(['Album post', '', '']);
    expect(new Set(scheduleToChannel.mock.calls.map(([input]) => input.scheduleAt)).size).toBe(1);
    expect(scheduler.result.upcoming).toHaveLength(3);
    expect(scheduler.result.upcoming.map((item) => item.telegramMessageId)).toEqual(['101', '102', '103']);
    scheduler.unmount();
  });

  it('still schedules text-only messages when attachment groups are empty', async () => {
    scheduleToChannel.mockResolvedValueOnce({
      publishResult: { ok: true, confirmed: true, messageId: '100' },
    });
    const scheduler = renderScheduler();

    await act(async () => {
      await scheduler.result.handleSchedule({
        chatId: chat.id,
        message: 'Text only',
        date: '2099-01-15',
        time: '17:42',
        attachmentGroups: [],
      });
    });

    expect(scheduleToChannel).toHaveBeenCalledOnce();
    expect(scheduleToChannel.mock.calls[0][0].mediaIds).toEqual([]);
    expect(scheduler.result.upcoming).toHaveLength(1);
    scheduler.unmount();
  });

  it('resets the schedule date and time after sending a scheduled item immediately', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 19, 10, 10, 0));
    publishToChannel.mockResolvedValueOnce({
      publishResult: { ok: true, confirmed: true, messageId: '105', historyPersisted: true },
    });
    const scheduler = renderScheduler();

    await act(async () => {
      scheduler.result.setDate('2099-01-15');
      scheduler.result.setTime('17:42');
      await scheduler.result.handleSendNow({
        id: 'scheduled-now',
        chatId: chat.id,
        chatName: chat.name,
        text: 'Send this scheduled item now',
        when: '2099-01-15T17:42:00.000Z',
        createdAt: '2026-10-19T10:00:00.000Z',
        status: 'scheduled',
      });
    });

    expect(scheduler.result.date).toBe('2026-10-19');
    expect(scheduler.result.time).toBe('10:11');
    expect(scheduler.result.sent).toMatchObject([{ id: 'scheduled-now', status: 'sent' }]);
    scheduler.unmount();
  });

  it('forwards Telegram effect IDs into scheduled posts and history', async () => {
    scheduleToChannel.mockResolvedValueOnce({
      publishResult: { ok: true, confirmed: true, messageId: '104' },
    });
    const scheduler = renderScheduler();

    await act(async () => {
      await scheduler.result.handleSchedule({
        chatId: chat.id,
        message: 'Effect schedule',
        date: '2099-01-15',
        time: '17:42',
        effect: '123456789',
      });
    });

    expect(scheduleToChannel).toHaveBeenCalledWith(expect.objectContaining({ effect: '123456789' }));
    expect(scheduler.result.upcoming[0]).toMatchObject({ effect: '123456789' });
    scheduler.unmount();
  });
});