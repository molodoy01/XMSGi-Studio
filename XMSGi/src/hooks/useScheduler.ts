import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { Chat, NotificationType, RichTextEntity, ScheduledMessage } from '@/types';
import type { InlineKeyboardMarkup } from '@/lib/inlineKeyboard';
import {
  applyScheduleResult,
  createPendingSchedule,
  getScheduleOccurrences,
  getPendingSchedules,
} from '@/lib/scheduling';
import { MAX_SCHEDULE_OCCURRENCES, type ScheduleRepeatOptions } from '@/lib/scheduling';
import { getMessageMaxLength } from '@/lib/messageLimits';
import {
  loadSent as loadSentFromStorage,
  loadUpcoming as loadUpcomingFromStorage,
  saveSent as saveSentToStorage,
  saveUpcoming as saveUpcomingToStorage,
  persistScheduleHistoryAndWait,
  type MessageHistoryScope,
} from '@/lib/storage';
import {
  getCurrentTimeStr,
  getTodayStr,
  uid,
} from '@/lib/utils';
import { useLocale } from '@/lib/i18n';

const REPEAT_SCHEDULE_DELAY_MS = 1500;

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
}

async function waitForTelegramAccount() {
  if (typeof window === 'undefined' || typeof window.telegram?.waitForRateLimit !== 'function') return;

  const result = await window.telegram.waitForRateLimit();
  if (!result.success) {
    throw new Error(result.error || 'Telegram account is not ready to resume requests.');
  }
}

function normalizeRestoredMessage(message: ScheduledMessage): ScheduledMessage {
  const status = String(message.status);
  if (status === 'confirmed') return { ...message, status: 'scheduled' };
  if (status === 'sending' || status === 'pending') {
    return {
      ...message,
      status: 'failed',
      lastError: message.lastError || (status === 'pending'
        ? 'This schedule was interrupted before Telegram confirmed it.'
        : 'The app closed while this message was sending. Check Telegram before retrying.'),
      retryAction: message.retryAction ?? (status === 'pending' ? 'schedule' : 'send'),
    };
  }
  if (['pending', 'scheduled', 'sent', 'failed'].includes(status)) return message;
  return {
    ...message,
    status: 'failed',
    lastError: message.lastError || `Unsupported saved status: ${status}`,
    retryAction: message.retryAction ?? 'send',
  };
}

export type AssistantIntentLike = {
  action: 'schedule' | 'clarify';
  chat: string;
  message: string;
  date: string;
  time: string;
  clarification: string;
  attachments?: string[];
};

export type UseSchedulerOptions = {
  historyScope?: MessageHistoryScope;
  accountId?: string;
  connected: boolean;
  selectedChat: Chat | null;
  chats: Chat[];
  message: string;
  showNotification: (message: string, type: NotificationType, title: string) => void;
  setMessage: Dispatch<SetStateAction<string>>;
  setAssistantPrompt: Dispatch<SetStateAction<string>>;
  setAssistantResponse: Dispatch<SetStateAction<string>>;
  setAssistantIntent: Dispatch<SetStateAction<AssistantIntentLike | null>>;
  refreshChatPermissions?: (chatId: string) => Promise<unknown>;
};

export function useScheduler({
  historyScope = 'personal',
  accountId = 'account-1',
  connected,
  selectedChat,
  chats,
  message,
  showNotification,
  setMessage,
  setAssistantPrompt,
  setAssistantResponse,
  setAssistantIntent,
  refreshChatPermissions,
}: UseSchedulerOptions) {
  const { t } = useLocale();
  const [date, setDate] = useState(getTodayStr());
  const [time, setTime] = useState(getCurrentTimeStr());
  const dateEditedRef = useRef(false);
  const timeEditedRef = useRef(false);
  const [upcoming, setUpcoming] = useState<ScheduledMessage[]>([]);
  const [sent, setSent] = useState<ScheduledMessage[]>([]);
  const [historyReady, setHistoryReady] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const schedulingLockRef = useRef(false);
  const [successPulse, setSuccessPulse] = useState(false);
  const [lastAction, setLastAction] = useState<'sent' | 'scheduled' | null>(null);
  const [revealingId, setRevealingId] = useState<string | null>(null);
  const [cancelingIds, setCancelingIds] = useState<Set<string>>(new Set());
  const [sendingIds, setSendingIds] = useState<Set<string>>(new Set());
  const activePublishIdsRef = useRef(new Set<string>());
  const cancelingIdsRef = useRef(new Set<string>());
  const [publishingDraft, setPublishingDraft] = useState(false);
  const openPickerRef = useRef<'date' | 'time' | null>(null);
  const loadUpcoming = useCallback(() => loadUpcomingFromStorage(historyScope), [historyScope]);
  const loadSent = useCallback(() => loadSentFromStorage(historyScope), [historyScope]);
  const saveUpcoming = useCallback((messages: ScheduledMessage[]) => saveUpcomingToStorage(messages, historyScope), [historyScope]);
  const saveSent = useCallback((messages: ScheduledMessage[]) => saveSentToStorage(messages, historyScope), [historyScope]);

  useEffect(() => {
    if (historyScope !== 'personal') return;

    const refreshCurrentDateTime = () => {
      if (!timeEditedRef.current) setTime(getCurrentTimeStr());
      if (!dateEditedRef.current) setDate(getTodayStr());
    };

    refreshCurrentDateTime();
    const intervalId = window.setInterval(refreshCurrentDateTime, 1000);

    return () => window.clearInterval(intervalId);
  }, [historyScope]);

  useEffect(() => {
    let cancelled = false;

    const restoreHistory = async () => {
      const fallbackUpcoming = loadUpcoming();
      const fallbackSent = loadSent();

      if (typeof window === 'undefined' || typeof window.telegram?.loadScheduleHistory !== 'function') {
        setUpcoming(fallbackUpcoming);
        setSent(fallbackSent);
        setHistoryReady(true);
        return;
      }

      try {
        const result = await window.telegram.loadScheduleHistory(historyScope);
        if (!result.success) throw new Error(result.error || 'Schedule history could not be restored.');

        const restoredUpcoming = (result.needsMigration ? fallbackUpcoming : result.history?.upcoming ?? [])
          .map(normalizeRestoredMessage);
        const restoredSent = (result.needsMigration ? fallbackSent : result.history?.sent ?? [])
          .map(normalizeRestoredMessage);
        if (cancelled) return;

        setUpcoming(restoredUpcoming);
        setSent(restoredSent);
        saveUpcomingToStorage(restoredUpcoming, historyScope);
        saveSentToStorage(restoredSent, historyScope);
      } catch (error) {
        if (cancelled) return;
        setUpcoming(fallbackUpcoming);
        setSent(fallbackSent);
        showNotification(
          error instanceof Error ? error.message : 'Schedule history could not be restored.',
          'error',
          t('schedule.recoverFailed'),
        );
      } finally {
        if (!cancelled) setHistoryReady(true);
      }
    };

    void restoreHistory();
    return () => { cancelled = true; };
  }, [historyScope, loadSent, loadUpcoming, showNotification, t]);

  useEffect(() => {
    if (!connected || !historyReady) return;

    let cancelled = false;

    async function recoverPendingSchedules() {
      const pendingMessages = getPendingSchedules(loadUpcoming());

      for (const pendingMessage of pendingMessages) {
        const pendingTimestamp = new Date(pendingMessage.when).getTime();

        if (Number.isFinite(pendingTimestamp) && pendingTimestamp <= Date.now()) {
          setUpcoming((current) => {
            const updated = current.map((message) => message.id === pendingMessage.id
              ? {
                ...message,
                status: 'failed' as const,
                lastError: 'The scheduled time passed before Telegram confirmed the schedule.',
                retryAction: 'schedule' as const,
              }
              : message);
            saveUpcoming(updated);
            return updated;
          });
          showNotification(
            'The scheduled time passed before Telegram confirmed the schedule.',
            'error',
            t('schedule.errorTitle'),
          );
          continue;
        }

        await waitForTelegramAccount();
        if (cancelled) return;

        const result = await window.telegram.schedule({
          accountId,
          chatId: pendingMessage.chatId,
          message: pendingMessage.text,
          targetTimestamp: Math.floor(
            new Date(pendingMessage.when).getTime() / 1000
          ),
          attachments: pendingMessage.attachments ?? [],
          entities: pendingMessage.entities ?? [],
          replyMarkup: pendingMessage.replyMarkup,
          silent: pendingMessage.silent,
          effect: pendingMessage.effect,
        });

        if (cancelled) return;

        setUpcoming((current) => {
          const updated = current.map((message) => {
            if (message.operationId !== pendingMessage.operationId) return message;
            if (!result.success) {
              return {
                ...message,
                status: 'failed' as const,
                lastError: result.error || t('schedule.pendingFailed'),
                retryAction: 'schedule' as const,
              };
            }
            return applyScheduleResult(current, pendingMessage.operationId!, result)
              .find((item) => item.operationId === pendingMessage.operationId) ?? message;
          });

          saveUpcoming(updated);
          return updated;
        });

        if (!result.success) {
          showNotification(
            result.error || t('schedule.pendingFailed'),
            'error',
            'Scheduling failed'
          );
        }
      }
    }

    recoverPendingSchedules().catch((error) => {
      if (!cancelled) {
        showNotification(
          error instanceof Error
            ? error.message
            : t('schedule.recoverFailed'),
          'error',
          t('schedule.schedulingFailed')
        );
      }
    });

    return () => {
      cancelled = true;
    };
  }, [accountId, connected, historyReady, loadUpcoming, saveSent, saveUpcoming, showNotification, t]);

  function handleSchedule(assistantSchedule?: {
    chatId: string;
    message: string;
    date: string;
    time: string;
    attachments?: string[];
    entities?: RichTextEntity[];
    replyMarkup?: InlineKeyboardMarkup;
    silent?: boolean;
    effect?: string;
  }, repeatOptions: ScheduleRepeatOptions = { mode: 'none', occurrences: 1 }) {
    if (!historyReady || scheduling || schedulingLockRef.current || typeof window.telegram?.schedule !== 'function') return;

    const scheduleChat = assistantSchedule
      ? chats.find((chat) => chat.id === assistantSchedule.chatId) || null
      : selectedChat;
    const scheduleMessage = assistantSchedule?.message ?? message;
    const scheduleDate = assistantSchedule?.date ?? date;
    const scheduleTime = assistantSchedule?.time ?? time;

    if (!scheduleChat) {
      showNotification(
        t('schedule.selectChat'),
        'warning',
        t('schedule.noChatTitle')
      );
      return;
    }

    if (!scheduleMessage.trim()) {
      showNotification(
        t('schedule.emptyMessage'),
        'warning',
        t('schedule.emptyMessageTitle')
      );
      return;
    }

    const messageLimit = getMessageMaxLength((assistantSchedule?.attachments?.length ?? 0) > 0);
    if (scheduleMessage.length > messageLimit) {
      showNotification(
        t('composer.messageExceedsLimit', { limit: messageLimit }),
        'warning',
        t('composer.messageTooLongTitle'),
      );
      return;
    }

    if (!scheduleDate || !scheduleTime) {
      showNotification(
        t('schedule.setDateTime'),
        'warning',
        t('schedule.missingDateTitle')
      );
      return;
    }

    const whenDate = new Date(`${scheduleDate}T${scheduleTime}`);

    if (Number.isNaN(whenDate.getTime())) {
      showNotification(
        t('schedule.invalidDateTime'),
        'error',
        t('schedule.invalidDateTitle')
      );
      return;
    }

    const isCurrentTime = scheduleDate === getTodayStr() && scheduleTime === getCurrentTimeStr();

    if (whenDate.getTime() <= Date.now() && !isCurrentTime) {
      showNotification(
        t('schedule.futureTime'),
        'warning',
        t('schedule.pastTimeTitle')
      );
      return;
    }

    if (isCurrentTime) {
      void handleSendDraftNow(
        scheduleChat,
        scheduleMessage,
        assistantSchedule?.attachments ?? [],
        assistantSchedule?.entities ?? [],
        assistantSchedule?.replyMarkup,
        assistantSchedule?.silent === true,
        assistantSchedule?.effect,
      );
      return;
    }

    const requestedOccurrences = Number(repeatOptions.occurrences);
    if (!Number.isInteger(requestedOccurrences) || requestedOccurrences < 1 || requestedOccurrences > MAX_SCHEDULE_OCCURRENCES) {
      showNotification(
        t('schedule.repeatRange', { count: MAX_SCHEDULE_OCCURRENCES }),
        'warning',
        t('schedule.invalidRepeatCount'),
      );
      return;
    }

    const validWeekdays = new Set(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
    if (repeatOptions.days?.some((day) => !validWeekdays.has(day))) {
      showNotification(t('schedule.validWeekdays'), 'warning', t('schedule.invalidRepeatDays'));
      return;
    }

    const chatId = scheduleChat.id;
    const chatName = scheduleChat.name;
    const text = scheduleMessage;
    const attachments = assistantSchedule?.attachments ?? [];
    const entities = assistantSchedule?.entities ?? [];
    const replyMarkup = assistantSchedule?.replyMarkup;
    const silent = assistantSchedule?.silent === true;
    const effect = assistantSchedule?.effect;
    const occurrenceDates = getScheduleOccurrences(whenDate, repeatOptions);
    const duplicateExists = occurrenceDates.some((occurrenceDate) => {
      const when = occurrenceDate.toISOString();
      return upcoming.some((scheduledMessage) =>
        scheduledMessage.chatId === chatId
        && scheduledMessage.text === text
        && scheduledMessage.when === when
        && scheduledMessage.status !== 'sent',
      );
    });

    if (duplicateExists) {
      showNotification(
        t('schedule.duplicate'),
        'warning',
        t('schedule.duplicateTitle'),
      );
      return;
    }

    schedulingLockRef.current = true;
    setScheduling(true);
    const pendingMessages = occurrenceDates.map((occurrenceDate) => createPendingSchedule({
      accountId,
      operationId: uid(),
      chatId,
      chatName,
      text,
      attachments,
      when: occurrenceDate.toISOString(),
      createdAt: new Date().toISOString(),
      entities,
      replyMarkup,
      silent,
      effect,
    }));
    const pendingUpcoming = [...pendingMessages, ...upcoming];
    setUpcoming(pendingUpcoming);

    (async () => {
      if (!await persistScheduleHistoryAndWait(historyScope, 'upcoming', pendingUpcoming)) {
        throw new Error('The pending schedule could not be saved. Telegram was not contacted.');
      }

      const results: Array<{ result: Awaited<ReturnType<typeof window.telegram.schedule>>; operationId: string }> = [];

      for (const [index, pendingMessage] of pendingMessages.entries()) {
        try {
          await waitForTelegramAccount();
          const result = await window.telegram.schedule({
            accountId,
            chatId,
            message: text,
            targetTimestamp: Math.floor(new Date(pendingMessage.when).getTime() / 1000),
            attachments,
            entities,
            replyMarkup,
            silent,
            effect,
          });
          results.push({ result, operationId: pendingMessage.operationId! });
        } catch (error) {
          results.push({
            result: {
              success: false,
              error: error instanceof Error ? error.message : t('schedule.failed'),
            },
            operationId: pendingMessage.operationId!,
          });
        }

        if (index < pendingMessages.length - 1) {
          await wait(REPEAT_SCHEDULE_DELAY_MS);
        }
      }

      return results;
    })()
      .then((results) => {
        schedulingLockRef.current = false;
        setScheduling(false);
        const confirmedSchedules = results.filter(({ result }) => result.success && result.confirmed === true);
        const failedSchedules = results.length - confirmedSchedules.length;

        setUpcoming((current) => {
          const updated = current.map((message) => {
            const resultEntry = results.find(({ operationId }) => operationId === message.operationId);
            if (!resultEntry) return message;
            if (!resultEntry.result.success || resultEntry.result.confirmed !== true) {
              return {
                ...message,
                status: 'failed' as const,
                lastError: resultEntry.result.error || 'Telegram did not confirm that this schedule was saved.',
                retryAction: 'schedule' as const,
              };
            }
            return applyScheduleResult(current, message.operationId!, {
              success: true,
              telegramMessageId: resultEntry.result.telegramMessageId ?? resultEntry.result.id,
              confirmed: true,
            }).find((item) => item.operationId === message.operationId) ?? message;
          });

          saveUpcoming(updated);
          return updated;
        });

        if (confirmedSchedules.length === 0) {
          if (results[0]?.result.error && refreshChatPermissions) {
            void refreshChatPermissions(chatId);
          }
          showNotification(
            results[0]?.result.error || t('schedule.failed'),
            'error',
            t('schedule.errorTitle')
          );
          return;
        }

        setMessage('');
        setAssistantPrompt('');
        setAssistantResponse('');
        setAssistantIntent(null);
        showNotification(
          confirmedSchedules.length === 1 && failedSchedules === 0
            ? t('schedule.scheduledOne')
            : confirmedSchedules.length > 1 && failedSchedules === 0
              ? t('schedule.scheduledMany', { count: confirmedSchedules.length })
              : `${confirmedSchedules.length} scheduled; ${failedSchedules} failed.`,
          failedSchedules ? 'warning' : 'success',
          t('schedule.scheduledTitle')
        );
        setLastAction('scheduled');
        setSuccessPulse(true);
        window.setTimeout(() => setSuccessPulse(false), 1500);
      })
      .catch(async (error) => {
        schedulingLockRef.current = false;
        setScheduling(false);
        const lastError = error instanceof Error ? error.message : t('schedule.networkScheduling');
        const pendingIds = new Set(pendingMessages.map((message) => message.operationId));
        const failedUpcoming = pendingUpcoming.map((message) => pendingIds.has(message.operationId)
          ? { ...message, status: 'failed' as const, lastError, retryAction: 'schedule' as const }
          : message);
        setUpcoming(failedUpcoming);
        await persistScheduleHistoryAndWait(historyScope, 'upcoming', failedUpcoming);
        showNotification(
          lastError,
          'error',
          t('schedule.errorTitle')
        );
      });
  }

  function handleCancelMessage(msg: ScheduledMessage) {
    if (cancelingIdsRef.current.has(msg.id) || activePublishIdsRef.current.has(msg.id) || typeof window.telegram?.cancel !== 'function') return;

    if (
      msg.telegramMessageId === undefined ||
      msg.telegramMessageId === null
    ) {
      showNotification(
        t('schedule.telegramIdMissing'),
        'error',
        t('schedule.cannotUnschedule')
      );
      return;
    }

    const currentMessage = upcoming.find((item) => item.id === msg.id) ?? msg;
    const attempt: ScheduledMessage = {
      ...currentMessage,
      status: 'sending',
      lastAttemptAt: new Date().toISOString(),
      lastError: undefined,
      retryAction: 'cancel',
    };
    const sendingUpcoming = upcoming.map((item) => item.id === msg.id ? attempt : item);
    activePublishIdsRef.current.add(msg.id);
    cancelingIdsRef.current.add(msg.id);
    setCancelingIds((prev) => {
      const next = new Set(prev);
      next.add(msg.id);
      return next;
    });
    setUpcoming(sendingUpcoming);

    void (async () => {
      try {
        if (!await persistScheduleHistoryAndWait(historyScope, 'upcoming', sendingUpcoming)) {
          throw new Error('The cancellation state could not be saved. Telegram was not contacted.');
        }
        const result = await window.telegram.cancel({
          chatId: attempt.chatId,
          telegramMessageId: attempt.telegramMessageId!,
          message: attempt.text,
          targetTimestamp: Math.floor(new Date(attempt.when).getTime() / 1000),
        });
        if (!result.success) throw new Error(result.error || t('schedule.cancelFailed'));

        if (result.alreadySent) {
          const sentMessage: ScheduledMessage = {
            ...attempt,
            status: 'sent',
            sentAt: result.sentAt || new Date().toISOString(),
            telegramMessageId: result.telegramMessageId,
            lastError: undefined,
            retryAction: undefined,
          };
          const remaining = upcoming.filter((item) => item.id !== msg.id);
          const nextSent = [sentMessage, ...sent.filter((item) => item.id !== msg.id)];
          setUpcoming(remaining);
          setSent(nextSent);
          await persistScheduleHistoryAndWait(historyScope, 'snapshot', { upcoming: remaining, sent: nextSent });
          showNotification('Telegram had already sent this scheduled message.', 'info', t('schedule.sent'));
          return;
        }

        const remaining = upcoming.filter((item) => item.id !== msg.id);
        setUpcoming(remaining);
        if (!await persistScheduleHistoryAndWait(historyScope, 'upcoming', remaining)) {
          const lastError = 'Telegram cancelled this schedule, but the history update could not be saved.';
          const failedMessage: ScheduledMessage = {
            ...attempt,
            telegramMessageId: undefined,
            status: 'failed',
            lastError,
            retryAction: 'send',
          };
          const failedUpcoming = upcoming.map((item) => item.id === msg.id ? failedMessage : item);
          setUpcoming(failedUpcoming);
          await persistScheduleHistoryAndWait(historyScope, 'upcoming', failedUpcoming);
          showNotification(`${lastError} Retry will send without cancelling the old schedule again.`, 'error', t('schedule.errorTitle'));
          return;
        }

        showNotification(t('schedule.unscheduled'), 'info', t('schedule.unscheduledTitle'));
      } catch (error) {
        const lastError = error instanceof Error ? error.message : t('schedule.networkCancelling');
        const failedMessage: ScheduledMessage = {
          ...attempt,
          status: 'failed',
          lastError,
          retryAction: 'cancel',
        };
        const failedUpcoming = upcoming.map((item) => item.id === msg.id ? failedMessage : item);
        setUpcoming(failedUpcoming);
        await persistScheduleHistoryAndWait(historyScope, 'upcoming', failedUpcoming);
        showNotification(lastError, 'error', t('schedule.errorTitle'));
      } finally {
        activePublishIdsRef.current.delete(msg.id);
        cancelingIdsRef.current.delete(msg.id);
        setCancelingIds((prev) => {
          const next = new Set(prev);
          next.delete(msg.id);
          return next;
        });
      }
    })();
  }

  async function handleSendNow(msg: ScheduledMessage) {
    if (msg.retryAction === 'cancel') {
      handleCancelMessage(msg);
      return;
    }
    if (msg.retryAction === 'schedule') {
      await handleRetrySchedule(msg);
      return;
    }
    if (activePublishIdsRef.current.has(msg.id) || typeof window.telegram?.send !== 'function') return;

    const currentMessage = upcoming.find((item) => item.id === msg.id) ?? msg;
    if (!['scheduled', 'confirmed', 'failed'].includes(currentMessage.status)) return;

    activePublishIdsRef.current.add(msg.id);
    setSendingIds((current) => new Set(current).add(msg.id));
    let sendingMessage: ScheduledMessage = {
      ...currentMessage,
      status: 'sending',
      lastAttemptAt: new Date().toISOString(),
      lastError: undefined,
      retryAction: 'send',
      sendAttemptId: currentMessage.sendAttemptId || `${Date.now()}:${uid()}`,
    };

    const sendingUpcoming = upcoming.map((item) => item.id === msg.id ? sendingMessage : item);
    setUpcoming(sendingUpcoming);

    try {
      if (!await persistScheduleHistoryAndWait(historyScope, 'upcoming', sendingUpcoming)) {
        throw new Error('The sending state could not be saved. Telegram was not contacted.');
      }

      await waitForTelegramAccount();
      if (sendingMessage.telegramMessageId !== undefined) {
        if (typeof window.telegram?.cancel !== 'function') throw new Error(t('schedule.cancelFailed'));
        const cancelResult = await window.telegram.cancel({
          chatId: sendingMessage.chatId,
          telegramMessageId: sendingMessage.telegramMessageId,
          message: sendingMessage.text,
          targetTimestamp: Math.floor(new Date(sendingMessage.when).getTime() / 1000),
        });
        if (!cancelResult.success) throw new Error(cancelResult.error || t('schedule.cancelFailed'));

        if (cancelResult.alreadySent) {
          const sentMessage: ScheduledMessage = {
            ...sendingMessage,
            status: 'sent',
            sentAt: cancelResult.sentAt || new Date().toISOString(),
            telegramMessageId: cancelResult.telegramMessageId,
            lastError: undefined,
            retryAction: undefined,
          };
          const nextUpcoming = upcoming.filter((item) => item.id !== msg.id);
          const nextSent = [sentMessage, ...sent.filter((item) => item.id !== msg.id)];
          setUpcoming(nextUpcoming);
          setSent(nextSent);
          await persistScheduleHistoryAndWait(historyScope, 'snapshot', { upcoming: nextUpcoming, sent: nextSent });
          showNotification('Telegram had already sent this scheduled message.', 'info', t('schedule.sent'));
          return;
        }

        sendingMessage = { ...sendingMessage, telegramMessageId: undefined };
        const uncancelledUpcoming = sendingUpcoming.map((item) => item.id === msg.id ? sendingMessage : item);
        setUpcoming(uncancelledUpcoming);
        if (!await persistScheduleHistoryAndWait(historyScope, 'upcoming', uncancelledUpcoming)) {
          throw new Error('Telegram cancelled the schedule, but the updated state could not be saved. Do not retry until the queue is checked.');
        }
      }

      const result = await window.telegram.send(
        sendingMessage.chatId,
        sendingMessage.text,
        sendingMessage.attachments ?? [],
        sendingMessage.entities ?? [],
        sendingMessage.replyMarkup,
        sendingMessage.silent,
        sendingMessage.effect,
        accountId,
        sendingMessage.sendAttemptId,
      );
      if (!result.success) throw new Error(result.error || t('schedule.sendFailed'));

      const sentMessage: ScheduledMessage = {
        ...sendingMessage,
        status: 'sent',
        sentAt: new Date().toISOString(),
        lastError: undefined,
        retryAction: undefined,
      };
      const nextSent = [sentMessage, ...sent.filter((item) => item.id !== msg.id)];
      const nextUpcoming = upcoming.filter((item) => item.id !== msg.id);
      setSent(nextSent);
      setUpcoming(nextUpcoming);
      const persisted = await persistScheduleHistoryAndWait(historyScope, 'snapshot', {
        upcoming: nextUpcoming,
        sent: nextSent,
      });
      showNotification(
        persisted
          ? t('schedule.messageSent')
          : 'Telegram sent the message, but history could not be saved. Do not retry this message.',
        persisted ? 'success' : 'warning',
        persisted ? t('schedule.sent') : t('schedule.errorTitle'),
      );
      setRevealingId(msg.id);
      window.setTimeout(() => setRevealingId(null), 1500);
    } catch (error) {
      const lastError = error instanceof Error ? error.message : t('schedule.networkSending');
      const failedMessage: ScheduledMessage = {
        ...sendingMessage,
        status: 'failed',
        lastError,
        retryAction: 'send',
      };
      const failedUpcoming = upcoming.map((item) => item.id === msg.id ? failedMessage : item);
      setUpcoming(failedUpcoming);
      await persistScheduleHistoryAndWait(historyScope, 'upcoming', failedUpcoming);
      if (refreshChatPermissions) void refreshChatPermissions(msg.chatId);
      showNotification(lastError, 'error', t('schedule.errorTitle'));
    } finally {
      activePublishIdsRef.current.delete(msg.id);
      setSendingIds((current) => {
        const next = new Set(current);
        next.delete(msg.id);
        return next;
      });
    }
  }

  async function handleRetrySchedule(msg: ScheduledMessage) {
    if (activePublishIdsRef.current.has(msg.id) || typeof window.telegram?.schedule !== 'function') return;
    activePublishIdsRef.current.add(msg.id);
    setSendingIds((current) => new Set(current).add(msg.id));
    const attempt: ScheduledMessage = {
      ...msg,
      status: 'sending',
      lastAttemptAt: new Date().toISOString(),
      lastError: undefined,
      retryAction: 'schedule',
    };
    const sendingUpcoming = upcoming.map((item) => item.id === msg.id ? attempt : item);
    setUpcoming(sendingUpcoming);

    try {
      if (!await persistScheduleHistoryAndWait(historyScope, 'upcoming', sendingUpcoming)) {
        throw new Error('The retry state could not be saved. Telegram was not contacted.');
      }
      await waitForTelegramAccount();
      const result = await window.telegram.schedule({
        accountId,
        chatId: attempt.chatId,
        message: attempt.text,
        targetTimestamp: Math.floor(new Date(attempt.when).getTime() / 1000),
        attachments: attempt.attachments ?? [],
        entities: attempt.entities ?? [],
        replyMarkup: attempt.replyMarkup,
        silent: attempt.silent,
        effect: attempt.effect,
      });
      if (!result.success || result.confirmed !== true) {
        throw new Error(result.error || 'Telegram did not confirm that this schedule was saved.');
      }

      const scheduledMessage: ScheduledMessage = {
        ...attempt,
        status: 'scheduled',
        telegramMessageId: result.telegramMessageId ?? result.id,
        lastError: undefined,
        retryAction: undefined,
      };
      const nextUpcoming = upcoming.map((item) => item.id === msg.id ? scheduledMessage : item);
      setUpcoming(nextUpcoming);
      await persistScheduleHistoryAndWait(historyScope, 'upcoming', nextUpcoming);
      showNotification(t('schedule.scheduledOne'), 'success', t('schedule.scheduledTitle'));
    } catch (error) {
      const lastError = error instanceof Error ? error.message : t('schedule.networkScheduling');
      const failedMessage: ScheduledMessage = {
        ...attempt,
        status: 'failed',
        lastError,
        retryAction: 'schedule',
      };
      const failedUpcoming = upcoming.map((item) => item.id === msg.id ? failedMessage : item);
      setUpcoming(failedUpcoming);
      await persistScheduleHistoryAndWait(historyScope, 'upcoming', failedUpcoming);
      showNotification(lastError, 'error', t('schedule.errorTitle'));
    } finally {
      activePublishIdsRef.current.delete(msg.id);
      setSendingIds((current) => {
        const next = new Set(current);
        next.delete(msg.id);
        return next;
      });
    }
  }

  function handleRetry(msg: ScheduledMessage) {
    if (msg.retryAction === 'schedule') {
      return handleRetrySchedule(msg);
    }
    return handleSendNow(msg);
  }

  async function handleSendDraftNow(
    chat: Chat,
    text: string,
    attachments: string[] = [],
    entities: RichTextEntity[] = [],
    replyMarkup?: InlineKeyboardMarkup,
    silent = false,
    effect?: string,
  ) {
    if (!historyReady || publishingDraft || !text.trim() || typeof window.telegram?.send !== 'function') return false;

    setPublishingDraft(true);

    try {
      await waitForTelegramAccount();
      const result = await window.telegram.send(chat.id, text, attachments, entities, replyMarkup, silent, effect, accountId);

      if (!result.success) {
        throw new Error(result.error || t('schedule.sendFailed'));
      }

      const sentMessage: ScheduledMessage = {
        id: uid(),
        chatId: chat.id,
        chatName: chat.name,
        text,
        attachments,
        when: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        status: 'sent',
        sentAt: new Date().toISOString(),
        entities,
        silent,
        effect,
      };

      setSent((current) => {
        const updated = [sentMessage, ...current];
        saveSent(updated);
        return updated;
      });
      setMessage('');
      setSuccessPulse(true);
      setLastAction('sent');
      showNotification(t('schedule.messageSent'), 'success', t('schedule.sent'));
      window.setTimeout(() => setSuccessPulse(false), 1500);
      window.setTimeout(() => setLastAction(null), 1500);
      return true;
    } catch (error) {
      if (refreshChatPermissions) void refreshChatPermissions(chat.id);
      showNotification(
        error instanceof Error ? error.message : t('schedule.networkSending'),
        'error',
        t('schedule.sendFailedTitle'),
      );
      return false;
    } finally {
      setPublishingDraft(false);
    }
  }

  function handleDeleteMessage(msg: ScheduledMessage) {
    if (!window.confirm(t('schedule.confirmDelete'))) return;

    if (msg.status !== 'sent') {
      setUpcoming((current) => {
        const updated = current.filter((item) => item.id !== msg.id);
        saveUpcoming(updated);
        return updated;
      });
    } else {
      setSent((current) => {
        const updated = current.filter((item) => item.id !== msg.id);
        saveSent(updated);
        return updated;
      });
    }
  }

  function handleClearSent() {
    setSent([]);
    saveSent([]);

    showNotification(
      t('schedule.sentCleared'),
      'info',
      t('schedule.clearedTitle')
    );
  }

  function handleClearAll() {
    if (upcoming.length === 0) return;

    if (!window.confirm(t('schedule.confirmClearAll'))) return;

    const cancelable = upcoming.filter(
      (msg) =>
        msg.telegramMessageId !== undefined &&
        msg.telegramMessageId !== null
    );

    Promise.all(
      cancelable.map((msg) =>
        window.telegram
          .cancel({
            chatId: msg.chatId,
            telegramMessageId: msg.telegramMessageId!,
          })
          .then((result) => ({ message: msg, success: result.success }))
          .catch(() => ({ message: msg, success: false }))
      )
    ).then((results) => {
      const failedIds = new Set(
        results.filter((result) => !result.success).map((result) => result.message.id),
      );
      const cancelableIds = new Set(cancelable.map((msg) => msg.id));
      setUpcoming((current) => {
        const remaining = current.filter(
          (msg) => !cancelableIds.has(msg.id) || failedIds.has(msg.id),
        );
        saveUpcoming(remaining);
        return remaining;
      });

      showNotification(
        failedIds.size > 0
          ? t('schedule.partialCancellation')
          : t('schedule.allCancelled'),
        failedIds.size > 0 ? 'warning' : 'success',
        failedIds.size > 0 ? t('schedule.partialCancellationTitle') : t('schedule.clearedTitle'),
      );
    });
  }

  return {
    date,
    setDate,
    time,
    setTime,
    dateEditedRef,
    timeEditedRef,
    upcoming,
    setUpcoming,
    sent,
    setSent,
    scheduling: scheduling || !historyReady,
    setScheduling,
    successPulse,
    lastAction,
    setSuccessPulse,
    revealingId,
    setRevealingId,
    cancelingIds,
    sendingIds,
    publishingDraft,
    openPickerRef,
    handleSchedule,
    handleCancelMessage,
    handleSendNow,
    handleRetry,
    handleSendDraftNow,
    handleDeleteMessage,
    handleClearSent,
    handleClearAll,
  };
}
