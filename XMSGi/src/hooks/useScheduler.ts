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
import {
  loadSent as loadSentFromStorage,
  loadUpcoming as loadUpcomingFromStorage,
  saveSent as saveSentToStorage,
  saveUpcoming as saveUpcomingToStorage,
  type MessageHistoryScope,
} from '@/lib/storage';
import {
  getCurrentTimeStr,
  getTodayStr,
  uid,
} from '@/lib/utils';
import { useLocale } from '@/lib/i18n';

const TELEGRAM_CONFIRMATION_DELAY_MS = 3500;
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

        const restoredUpcoming = result.needsMigration ? fallbackUpcoming : result.history?.upcoming ?? [];
        const restoredSent = result.needsMigration ? fallbackSent : result.history?.sent ?? [];
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
          const completedMessage: ScheduledMessage = {
            ...pendingMessage,
            status: 'sent',
            sentAt: new Date().toISOString(),
          };

          setUpcoming((current) => {
            const updated = current.filter((message) => message.id !== pendingMessage.id);
            saveUpcoming(updated);
            return updated;
          });

          setSent((current) => {
            const updated = [
              completedMessage,
              ...current.filter((message) => message.id !== pendingMessage.id),
            ];
            saveSent(updated);
            return updated;
          });

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
          const updated = result.success
            ? applyScheduleResult(current, pendingMessage.operationId!, result)
            : current;

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
  }, [connected, historyReady, loadUpcoming, saveUpcoming, showNotification, t]);

  useEffect(() => {
    const moveDueMessages = () => {
      if (!historyReady) return;
      const now = Date.now();
      const dueMessages = upcoming.filter(
        (msg) =>
          (msg.status === 'scheduled' || msg.status === 'confirmed') &&
          new Date(msg.when).getTime() <= now
      );

      if (dueMessages.length === 0) return;

      const dueIds = new Set(dueMessages.map((msg) => msg.id));
      const sentMessages = dueMessages.map((msg) => ({
        ...msg,
        status: 'sent' as const,
        sentAt: new Date().toISOString(),
      }));

      setUpcoming((current) => {
        const updated = current.filter((msg) => !dueIds.has(msg.id));
        saveUpcoming(updated);
        return updated;
      });

      setSent((current) => {
        const existingIds = new Set(current.map((msg) => msg.id));
        const updated = [
          ...sentMessages.filter((msg) => !existingIds.has(msg.id)),
          ...current,
        ];
        saveSent(updated);
        return updated;
      });

      setRevealingId(dueMessages[0].id);
      window.setTimeout(() => setRevealingId(null), 1500);
    };

    moveDueMessages();
    const intervalId = window.setInterval(moveDueMessages, 1000);

    return () => window.clearInterval(intervalId);
  }, [historyReady, saveSent, saveUpcoming, upcoming]);

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

    setUpcoming((current) => {
      const scheduledMessages: ScheduledMessage[] = pendingMessages.map((pendingMessage) => ({
        ...pendingMessage,
        status: 'pending' as const,
      }));
      const updated = scheduledMessages.concat(current);
      saveUpcoming(updated);
      return updated;
    });

    (async () => {
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
        const successful = results.filter(({ result }) => result.success);

        window.setTimeout(() => {
          setUpcoming((current) => {
            const updated = current.map((message) => {
              const resultEntry = results.find(
                ({ operationId }) => operationId === message.operationId,
              );

              if (!resultEntry) return message;

              if (!resultEntry.result.success || !resultEntry.result.confirmed) {
                return { ...message, status: 'pending' as const };
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
        }, TELEGRAM_CONFIRMATION_DELAY_MS);

        if (successful.length === 0) {
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
          successful.length === 1
            ? t('schedule.scheduledOne')
            : t('schedule.scheduledMany', { count: successful.length }),
          'success',
          t('schedule.scheduledTitle')
        );
        setLastAction('scheduled');
        setSuccessPulse(true);
        window.setTimeout(() => setSuccessPulse(false), 1500);
      })
      .catch((error) => {
        schedulingLockRef.current = false;
        setScheduling(false);
        showNotification(
          error instanceof Error ? error.message : t('schedule.networkScheduling'),
          'error',
          t('schedule.errorTitle')
        );
      });
  }

  function handleCancelMessage(msg: ScheduledMessage) {
    if (cancelingIds.has(msg.id) || typeof window.telegram?.cancel !== 'function') return;

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

    setCancelingIds((prev) => {
      const next = new Set(prev);
      next.add(msg.id);
      return next;
    });

    window.telegram
      .cancel({
        chatId: msg.chatId,
        telegramMessageId: msg.telegramMessageId,
      })
      .then((result) => {
        setCancelingIds((prev) => {
          const next = new Set(prev);
          next.delete(msg.id);
          return next;
        });

        if (result.success) {
          setUpcoming((current) => {
            const updated = current.filter((item) => item.id !== msg.id);
            saveUpcoming(updated);
            return updated;
          });

          showNotification(
            t('schedule.unscheduled'),
            'info',
            t('schedule.unscheduledTitle')
          );
        } else {
          showNotification(
            result.error || t('schedule.cancelFailed'),
            'error',
            t('schedule.errorTitle')
          );
        }
      })
      .catch((error) => {
        setCancelingIds((prev) => {
          const next = new Set(prev);
          next.delete(msg.id);
          return next;
        });

        showNotification(
          error instanceof Error
            ? error.message
            : t('schedule.networkCancelling'),
          'error',
          t('schedule.errorTitle')
        );
      });
  }

  function handleSendNow(msg: ScheduledMessage) {
    if (sendingIds.has(msg.id) || typeof window.telegram?.cancel !== 'function' || typeof window.telegram?.send !== 'function') return;

    setSendingIds((prev) => {
      const next = new Set(prev);
      next.add(msg.id);
      return next;
    });

    let scheduleCancelled = msg.telegramMessageId === undefined;
    const cancelExistingSchedule: Promise<{ success: boolean; error?: string }> = waitForTelegramAccount()
      .then(() => msg.telegramMessageId === undefined
        ? { success: true }
        : window.telegram.cancel({
          chatId: msg.chatId,
          telegramMessageId: msg.telegramMessageId,
        }));

    cancelExistingSchedule
      .then((cancelResult) => {
        if (!cancelResult.success) {
          throw new Error(cancelResult.error || t('schedule.cancelFailed'));
        }

        scheduleCancelled = true;

        return window.telegram.send(msg.chatId, msg.text, msg.attachments ?? [], msg.entities ?? [], msg.replyMarkup, msg.silent, undefined, accountId);
      })
      .then((result) => {
        setSendingIds((prev) => {
          const next = new Set(prev);
          next.delete(msg.id);
          return next;
        });

        if (result.success) {
          const sentMsg: ScheduledMessage = {
            ...msg,
            status: 'sent',
            sentAt: new Date().toISOString(),
          };

          setUpcoming((current) => {
            const updated = current.filter((item) => item.id !== msg.id);
            saveUpcoming(updated);
            return updated;
          });

          setSent((current) => {
            const updated = [sentMsg, ...current];
            saveSent(updated);
            return updated;
          });

          showNotification(t('schedule.messageSent'), 'success', t('schedule.sent'));

          setRevealingId(msg.id);
          window.setTimeout(() => setRevealingId(null), 1500);
        } else {
          showNotification(
            result.error || t('schedule.sendFailed'),
            'error',
            t('schedule.errorTitle')
          );
        }
      })
      .catch((error) => {
        if (scheduleCancelled && msg.telegramMessageId !== undefined) {
          setUpcoming((current) => {
            const updated = current.map((item) =>
              item.id === msg.id
                ? { ...item, status: 'pending' as const, telegramMessageId: undefined }
                : item,
            );
            saveUpcoming(updated);
            return updated;
          });
        }

        setSendingIds((prev) => {
          const next = new Set(prev);
          next.delete(msg.id);
          return next;
        });

        if (refreshChatPermissions) void refreshChatPermissions(msg.chatId);

        showNotification(
          error instanceof Error
            ? error.message
            : t('schedule.networkSending'),
          'error',
          t('schedule.errorTitle')
        );
      });
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
    handleSendDraftNow,
    handleDeleteMessage,
    handleClearSent,
    handleClearAll,
  };
}
