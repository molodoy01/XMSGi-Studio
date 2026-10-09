import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { Chat, NotificationType, RichTextEntity, ScheduledMessage } from '@/types';
import type { BridgeErrorDetails } from '@shared/bridge';
import { createBridgeValidationError, normalizeTelegramBridgeError } from '@shared/bridge';
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
const MAX_SCHEDULE_FUTURE_DAYS = 367;

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
  showNotification: (message: string, type: NotificationType, title: string, errorDetails?: BridgeErrorDetails) => void;
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
  const showValidationNotification = (message: string, type: NotificationType, title: string, code: string) => (
    showNotification(message, type, title, createBridgeValidationError(message, code))
  );
  const [date, setDate] = useState(getTodayStr());
  const [time, setTime] = useState(getCurrentTimeStr());
  const dateEditedRef = useRef(false);
  const timeEditedRef = useRef(false);
  const [upcoming, setUpcoming] = useState<ScheduledMessage[]>([]);
  const [sent, setSent] = useState<ScheduledMessage[]>([]);
  const upcomingStateRef = useRef(upcoming);
  const sentStateRef = useRef(sent);
  const handleCancelMessageRef = useRef<(
    message: ScheduledMessage,
    replacementMessages?: ScheduledMessage[],
    quiet?: boolean,
  ) => Promise<boolean>>(async () => false);
  const [historyReady, setHistoryReady] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const schedulingLockRef = useRef(false);
  const [successPulse, setSuccessPulse] = useState(false);
  const [lastAction, setLastAction] = useState<'sent' | 'scheduled' | null>(null);
  const [revealingId, setRevealingId] = useState<string | null>(null);
  const [cancelingIds, setCancelingIds] = useState<Set<string>>(new Set());
  const [sendingIds, setSendingIds] = useState<Set<string>>(new Set());
  const timeoutIdsRef = useRef<Set<number>>(new Set());
  const mountedRef = useRef(true);
  const activePublishIdsRef = useRef(new Set<string>());
  const cancelingIdsRef = useRef(new Set<string>());
  const [publishingDraft, setPublishingDraft] = useState(false);
  const openPickerRef = useRef<'date' | 'time' | null>(null);
  const loadUpcoming = useCallback(() => loadUpcomingFromStorage(historyScope), [historyScope]);
  const loadSent = useCallback(() => loadSentFromStorage(historyScope), [historyScope]);
  const saveUpcoming = useCallback((messages: ScheduledMessage[]) => saveUpcomingToStorage(messages, historyScope), [historyScope]);
  const saveSent = useCallback((messages: ScheduledMessage[]) => saveSentToStorage(messages, historyScope), [historyScope]);

  const scheduleTimeout = (callback: () => void, milliseconds: number) => {
    if (!mountedRef.current) return;

    const timeoutId = window.setTimeout(() => {
      timeoutIdsRef.current.delete(timeoutId);
      if (mountedRef.current) callback();
    }, milliseconds);
    timeoutIdsRef.current.add(timeoutId);
  };

  useEffect(() => { upcomingStateRef.current = upcoming; }, [upcoming]);
  useEffect(() => { sentStateRef.current = sent; }, [sent]);
  useEffect(() => { handleCancelMessageRef.current = handleCancelMessage; });

  useEffect(() => {
    mountedRef.current = true;
    const activeTimeoutIds = timeoutIdsRef.current;
    return () => {
      mountedRef.current = false;
      activeTimeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
      activeTimeoutIds.clear();
    };
  }, []);

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

        const scheduleConfirmed = result.success
          && (!pendingMessage.replacementOfId || result.confirmed === true);
        setUpcoming((current) => {
          const updated = current.map((message) => {
            if (message.operationId !== pendingMessage.operationId) return message;
            if (!scheduleConfirmed) {
              const partialIds = result.telegramMessageIds ?? [];
              return {
                ...message,
                ...(partialIds.length ? {
                  telegramMessageId: result.telegramMessageId ?? partialIds[0],
                  telegramMessageIds: partialIds,
                } : {}),
                status: 'failed' as const,
                lastError: result.error || 'Telegram did not confirm that this replacement was saved.',
                retryAction: partialIds.length ? 'cancel' as const : 'schedule' as const,
              };
            }
            return applyScheduleResult(current, pendingMessage.operationId!, result)
              .find((item) => item.operationId === pendingMessage.operationId) ?? message;
          });

          saveUpcoming(updated);
          return updated;
        });

        if (!scheduleConfirmed) {
          showNotification(
            result.error || 'Telegram did not confirm that this replacement was saved.',
            'error',
            'Scheduling failed'
          );
        } else if (pendingMessage.replacementOfId) {
          const originalMessage = upcomingStateRef.current.find((item) => item.id === pendingMessage.replacementOfId);
          const replacementMessage = applyScheduleResult([pendingMessage], pendingMessage.operationId!, result)
            .find((item) => item.operationId === pendingMessage.operationId);
          if (originalMessage && replacementMessage) {
            handleCancelMessageRef.current(originalMessage, [replacementMessage], true);
          }
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

  async function handleSchedule(assistantSchedule?: {
    chatId: string;
    message: string;
    date: string;
    time: string;
    attachments?: string[];
    entities?: RichTextEntity[];
    replyMarkup?: InlineKeyboardMarkup;
    silent?: boolean;
    effect?: string;
    replaceMessage?: ScheduledMessage;
  }, repeatOptions: ScheduleRepeatOptions = { mode: 'none', occurrences: 1 }) {
    if (!historyReady || scheduling || schedulingLockRef.current || typeof window.telegram?.schedule !== 'function') return;

    const scheduleChat = assistantSchedule
      ? chats.find((chat) => chat.id === assistantSchedule.chatId) || null
      : selectedChat;
    const scheduleMessage = assistantSchedule?.message ?? message;
    const scheduleDate = assistantSchedule?.date ?? date;
    const scheduleTime = assistantSchedule?.time ?? time;
    const replaceMessage = assistantSchedule?.replaceMessage;

    if (!scheduleChat) {
      showValidationNotification(
        t('schedule.selectChat'),
        'warning',
        t('schedule.noChatTitle'),
        'CHAT_REQUIRED',
      );
      return;
    }

    if (replaceMessage && (replaceMessage.telegramMessageId === undefined || replaceMessage.telegramMessageId === null)) {
      const errorDetails = createBridgeValidationError(t('schedule.telegramIdMissing'), 'TELEGRAM_SCHEDULE_ID_MISSING');
      showNotification(errorDetails.message, 'error', t('schedule.cannotUnschedule'), errorDetails);
      return;
    }

    if (!scheduleMessage.trim() && !(assistantSchedule?.attachments ?? []).length) {
      showValidationNotification(
        t('schedule.emptyMessage'),
        'warning',
        t('schedule.emptyMessageTitle'),
        'MESSAGE_REQUIRED',
      );
      return;
    }

    const messageLimit = getMessageMaxLength((assistantSchedule?.attachments?.length ?? 0) > 0);
    if (scheduleMessage.length > messageLimit) {
      showValidationNotification(
        t('composer.messageExceedsLimit', { limit: messageLimit }),
        'warning',
        t('composer.messageTooLongTitle'),
        'MESSAGE_TOO_LONG',
      );
      return;
    }

    if (!scheduleDate || !scheduleTime) {
      showValidationNotification(
        t('schedule.setDateTime'),
        'warning',
        t('schedule.missingDateTitle'),
        'SCHEDULE_DATETIME_REQUIRED',
      );
      return;
    }

    const whenDate = new Date(`${scheduleDate}T${scheduleTime}`);

    if (Number.isNaN(whenDate.getTime())) {
      showValidationNotification(
        t('schedule.invalidDateTime'),
        'error',
        t('schedule.invalidDateTitle'),
        'SCHEDULE_DATETIME_INVALID',
      );
      return;
    }

    const scheduleNow = Date.now();
    const isCurrentTime = scheduleDate === getTodayStr() && scheduleTime === getCurrentTimeStr();

    if (whenDate.getTime() <= scheduleNow && !isCurrentTime) {
      showValidationNotification(
        t('schedule.futureTime'),
        'warning',
        t('schedule.pastTimeTitle'),
        'SCHEDULE_NOT_IN_FUTURE',
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
      showValidationNotification(
        t('schedule.repeatRange', { count: MAX_SCHEDULE_OCCURRENCES }),
        'warning',
        t('schedule.invalidRepeatCount'),
        'REPEAT_COUNT_INVALID',
      );
      return;
    }

    const validWeekdays = new Set(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
    if (repeatOptions.days?.some((day) => !validWeekdays.has(day))) {
      showValidationNotification(t('schedule.validWeekdays'), 'warning', t('schedule.invalidRepeatDays'), 'REPEAT_DAY_INVALID');
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
    const maximumScheduleTime = scheduleNow + MAX_SCHEDULE_FUTURE_DAYS * 24 * 60 * 60 * 1000;
    if (occurrenceDates.some((occurrenceDate) => occurrenceDate.getTime() > maximumScheduleTime)) {
      showValidationNotification(
        t('schedule.tooFarFuture'),
        'warning',
        t('schedule.tooFarFutureTitle'),
        'SCHEDULE_TOO_FAR',
      );
      return;
    }
    if (replaceMessage && occurrenceDates.length !== 1) {
      showValidationNotification(
        t('schedule.repeatRange', { count: 1 }),
        'warning',
        t('schedule.invalidRepeatCount'),
        'REPLACEMENT_REPEAT_NOT_ALLOWED',
      );
      return;
    }
    const candidateOperations = occurrenceDates.map((occurrenceDate) => ({
      chatId,
      message: text,
      targetTimestamp: Math.floor(occurrenceDate.getTime() / 1000),
      attachments,
      entities,
      replyMarkup,
      silent,
      effect,
    }));
    const candidateTimestamps = new Set(candidateOperations.map((operation) => operation.targetTimestamp));
    const comparableUpcoming = upcoming.filter((scheduledMessage) => {
      const scheduledTimestamp = Math.floor(new Date(scheduledMessage.when).getTime() / 1000);
      return scheduledMessage.id !== replaceMessage?.id
        && scheduledMessage.status !== 'sent'
        && scheduledMessage.chatId === chatId
        && scheduledMessage.text === text
        && candidateTimestamps.has(scheduledTimestamp)
        && (scheduledMessage.attachments ?? []).length === attachments.length;
    });
    const legacyUpcoming = comparableUpcoming.filter((scheduledMessage) => !scheduledMessage.operationIdentity);
    const identityOperations = [
      ...candidateOperations,
      ...legacyUpcoming.map((scheduledMessage) => ({
        chatId: scheduledMessage.chatId,
        message: scheduledMessage.text,
        targetTimestamp: Math.floor(new Date(scheduledMessage.when).getTime() / 1000),
        attachments: scheduledMessage.attachments ?? [],
        entities: scheduledMessage.entities ?? [],
        replyMarkup: scheduledMessage.replyMarkup,
        silent: scheduledMessage.silent,
        effect: scheduledMessage.effect,
      })),
    ];

    schedulingLockRef.current = true;
    if (replaceMessage) activePublishIdsRef.current.add(replaceMessage.id);
    setScheduling(true);

    let identityResult: Awaited<ReturnType<typeof window.telegram.getScheduleIdentities>>;
    try {
      if (typeof window.telegram?.getScheduleIdentities !== 'function') {
        throw new Error('Schedule identity is unavailable in this renderer.');
      }
      identityResult = await window.telegram.getScheduleIdentities(identityOperations);
      if (!identityResult.success || !identityResult.identities || identityResult.identities.length !== identityOperations.length) {
        throw new Error(identityResult.error || t('schedule.failed'));
      }
    } catch (error) {
      schedulingLockRef.current = false;
      if (replaceMessage) activePublishIdsRef.current.delete(replaceMessage.id);
      setScheduling(false);
      const errorDetails = normalizeTelegramBridgeError(error, 'publish', t('schedule.failed'));
      showNotification(errorDetails.message, 'error', t('schedule.schedulingFailed'), errorDetails);
      return;
    }

    const candidateIdentities = identityResult.identities.slice(0, candidateOperations.length);
    if (candidateIdentities.some((identity) => typeof identity !== 'string')) {
      schedulingLockRef.current = false;
      if (replaceMessage) activePublishIdsRef.current.delete(replaceMessage.id);
      setScheduling(false);
      const errorDetails = createBridgeValidationError(t('schedule.failed'), 'SCHEDULE_IDENTITY_INVALID');
      showNotification(errorDetails.message, 'error', t('schedule.schedulingFailed'), errorDetails);
      return;
    }

    const legacyIdentityByMessage = new Map<ScheduledMessage, string | null>();
    legacyUpcoming.forEach((scheduledMessage, index) => {
      legacyIdentityByMessage.set(scheduledMessage, identityResult.identities![candidateOperations.length + index]);
    });
    const unverifiableLegacyMedia = legacyUpcoming.some((scheduledMessage) => (
      (scheduledMessage.attachments?.length ?? 0) > 0
      && typeof legacyIdentityByMessage.get(scheduledMessage) !== 'string'
    ));
    if (unverifiableLegacyMedia) {
      schedulingLockRef.current = false;
      if (replaceMessage) activePublishIdsRef.current.delete(replaceMessage.id);
      setScheduling(false);
      const errorDetails = createBridgeValidationError(t('schedule.failed'), 'LEGACY_MEDIA_IDENTITY_UNAVAILABLE');
      showNotification(errorDetails.message, 'warning', t('schedule.errorTitle'), errorDetails);
      return;
    }

    const upcomingWithIdentities = upcoming.map((scheduledMessage) => {
      const operationIdentity = legacyIdentityByMessage.get(scheduledMessage);
      return !scheduledMessage.operationIdentity && operationIdentity
        ? { ...scheduledMessage, operationIdentity }
        : scheduledMessage;
    });
    const existingIdentities = new Set(comparableUpcoming.map((scheduledMessage) => (
      scheduledMessage.operationIdentity || legacyIdentityByMessage.get(scheduledMessage)
    )).filter((identity): identity is string => typeof identity === 'string'));
    const duplicateExists = candidateIdentities.some((identity) => existingIdentities.has(identity!));

    if (duplicateExists) {
      if (legacyUpcoming.some((scheduledMessage) => legacyIdentityByMessage.get(scheduledMessage))) {
        setUpcoming(upcomingWithIdentities);
        upcomingStateRef.current = upcomingWithIdentities;
        await persistScheduleHistoryAndWait(historyScope, 'upcoming', upcomingWithIdentities);
      }
      schedulingLockRef.current = false;
      if (replaceMessage) activePublishIdsRef.current.delete(replaceMessage.id);
      setScheduling(false);
      showNotification(t('schedule.duplicate'), 'warning', t('schedule.duplicateTitle'));
      return;
    }

    setLastAction(null);
    setSuccessPulse(false);
    const pendingMessages = occurrenceDates.map((occurrenceDate, index) => createPendingSchedule({
      accountId,
      operationId: uid(),
      operationIdentity: candidateIdentities[index]!,
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
    })).map((pendingMessage) => replaceMessage
      ? { ...pendingMessage, replacementOfId: replaceMessage.id }
      : pendingMessage);
    const pendingUpcoming = [...pendingMessages, ...upcomingWithIdentities];
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
      .then(async (results) => {
        schedulingLockRef.current = false;
        setScheduling(false);
        const confirmedSchedules = results.filter(({ result }) => result.success && result.confirmed === true);
        const failedSchedules = results.length - confirmedSchedules.length;
        const replacementMessages = confirmedSchedules.flatMap(({ result, operationId }) => {
          const pendingMessage = pendingMessages.find((message) => message.operationId === operationId);
          if (!pendingMessage) return [];
          return applyScheduleResult([{
            ...pendingMessage,
            operationIdentity: result.operationIdentity ?? pendingMessage.operationIdentity,
          }], operationId, {
            success: true,
            telegramMessageId: result.telegramMessageId ?? result.id,
            telegramMessageIds: result.telegramMessageIds,
            confirmed: true,
          });
        });

        setUpcoming((current) => {
          const updated = current.map((message) => {
            const resultEntry = results.find(({ operationId }) => operationId === message.operationId);
            if (!resultEntry) return message;
            if (!resultEntry.result.success || resultEntry.result.confirmed !== true) {
              const errorDetails = normalizeTelegramBridgeError(resultEntry.result, 'publish', 'Telegram did not confirm that this schedule was saved.');
              const partialIds = resultEntry.result.telegramMessageIds ?? [];
              return {
                ...message,
                ...(partialIds.length ? {
                  telegramMessageId: resultEntry.result.telegramMessageId ?? partialIds[0],
                  telegramMessageIds: partialIds,
                } : {}),
                status: 'failed' as const,
                lastError: errorDetails.message,
                lastErrorDetails: errorDetails,
                retryAction: partialIds.length ? 'cancel' as const : 'schedule' as const,
              };
            }
            const scheduledMessage = applyScheduleResult(current, message.operationId!, {
              success: true,
              telegramMessageId: resultEntry.result.telegramMessageId ?? resultEntry.result.id,
              telegramMessageIds: resultEntry.result.telegramMessageIds,
              confirmed: true,
            }).find((item) => item.operationId === message.operationId) ?? message;
            return {
              ...scheduledMessage,
              operationIdentity: resultEntry.result.operationIdentity ?? scheduledMessage.operationIdentity,
            };
          });

          saveUpcoming(updated);
          return updated;
        });

        if (confirmedSchedules.length === 0) {
          if (replaceMessage) activePublishIdsRef.current.delete(replaceMessage.id);
          if (results[0]?.result.error && refreshChatPermissions) {
            void refreshChatPermissions(chatId);
          }
          const errorDetails = results[0]
            ? normalizeTelegramBridgeError(results[0].result, 'publish', t('schedule.failed'))
            : undefined;
          showNotification(
            errorDetails?.message || t('schedule.failed'),
            'error',
            t('schedule.errorTitle'),
            errorDetails,
          );
          return;
        }

        let replacementCancellationFailed = false;
        if (replaceMessage) {
          activePublishIdsRef.current.delete(replaceMessage.id);
          if (confirmedSchedules.length === 1 && failedSchedules === 0 && replacementMessages.length === 1) {
            replacementCancellationFailed = !await handleCancelMessage(replaceMessage, replacementMessages, true);
          } else {
            replacementCancellationFailed = true;
          }
        }

        setMessage('');
        setAssistantPrompt('');
        setAssistantResponse('');
        setAssistantIntent(null);
        const firstFailure = results.find(({ result }) => !result.success || result.confirmed !== true);
        const errorDetails = firstFailure
          ? normalizeTelegramBridgeError(firstFailure.result, 'publish', t('schedule.failed'))
          : undefined;
        const notificationMessage = replacementCancellationFailed
          ? t('schedule.partialCancellation')
          : confirmedSchedules.length === 1 && failedSchedules === 0
            ? t('schedule.scheduledOne')
            : confirmedSchedules.length > 1 && failedSchedules === 0
              ? t('schedule.scheduledMany', { count: confirmedSchedules.length })
              : `${confirmedSchedules.length} scheduled; ${failedSchedules} failed.`;
        const notificationType = failedSchedules || replacementCancellationFailed ? 'warning' : 'success';
        const notificationTitle = replacementCancellationFailed ? t('schedule.partialCancellationTitle') : t('schedule.scheduledTitle');
        if (errorDetails) showNotification(notificationMessage, notificationType, notificationTitle, errorDetails);
        else showNotification(notificationMessage, notificationType, notificationTitle);
        setLastAction('scheduled');
        setSuccessPulse(true);
        scheduleTimeout(() => setSuccessPulse(false), 1500);
      })
      .catch(async (error) => {
        schedulingLockRef.current = false;
        setScheduling(false);
        if (replaceMessage) activePublishIdsRef.current.delete(replaceMessage.id);
        const errorDetails = normalizeTelegramBridgeError(error, 'publish', t('schedule.networkScheduling'));
        const lastError = errorDetails.message;
        const pendingIds = new Set(pendingMessages.map((message) => message.operationId));
        const failedUpcoming = pendingUpcoming.map((message) => pendingIds.has(message.operationId)
          ? { ...message, status: 'failed' as const, lastError, lastErrorDetails: errorDetails, retryAction: 'schedule' as const }
          : message);
        setUpcoming(failedUpcoming);
        await persistScheduleHistoryAndWait(historyScope, 'upcoming', failedUpcoming);
        showNotification(
          lastError,
          'error',
          t('schedule.errorTitle'),
          errorDetails,
        );
      });
  }

  async function handleCancelMessage(msg: ScheduledMessage, replacementMessages: ScheduledMessage[] = [], quiet = false): Promise<boolean> {
    if (cancelingIdsRef.current.has(msg.id) || activePublishIdsRef.current.has(msg.id) || typeof window.telegram?.cancel !== 'function') return false;

    if (
      msg.telegramMessageId === undefined ||
      msg.telegramMessageId === null
    ) {
      showNotification(
        t('schedule.telegramIdMissing'),
        'error',
        t('schedule.cannotUnschedule')
      );
      return false;
    }

    const cancelContextUpcoming = [...upcomingStateRef.current];
    for (const replacementMessage of replacementMessages) {
      const existingIndex = cancelContextUpcoming.findIndex((item) => item.id === replacementMessage.id);
      if (existingIndex >= 0) {
        cancelContextUpcoming[existingIndex] = replacementMessage;
      } else {
        cancelContextUpcoming.unshift(replacementMessage);
      }
    }
    const currentMessage = cancelContextUpcoming.find((item) => item.id === msg.id) ?? msg;
    const attempt: ScheduledMessage = {
      ...currentMessage,
      status: 'sending',
      lastAttemptAt: new Date().toISOString(),
      lastError: undefined,
      retryAction: 'cancel',
    };
    const sendingUpcoming = cancelContextUpcoming.map((item) => item.id === msg.id ? attempt : item);
    activePublishIdsRef.current.add(msg.id);
    cancelingIdsRef.current.add(msg.id);
    setCancelingIds((prev) => {
      const next = new Set(prev);
      next.add(msg.id);
      return next;
    });
    setUpcoming(sendingUpcoming);
    upcomingStateRef.current = sendingUpcoming;

    let cancellationSucceeded = false;
    let cancellationErrorDetails: ReturnType<typeof normalizeTelegramBridgeError> | undefined;
    await (async () => {
      try {
        if (!await persistScheduleHistoryAndWait(historyScope, 'upcoming', sendingUpcoming)) {
          throw new Error('The cancellation state could not be saved. Telegram was not contacted.');
        }
        const result = await window.telegram.cancel({
          chatId: attempt.chatId,
          telegramMessageId: attempt.telegramMessageId!,
          telegramMessageIds: attempt.telegramMessageIds,
          message: attempt.text,
          targetTimestamp: Math.floor(new Date(attempt.when).getTime() / 1000),
        });
        if (!result.success) {
          cancellationErrorDetails = normalizeTelegramBridgeError(result, 'cancel', t('schedule.cancelFailed'));
          throw new Error(cancellationErrorDetails.message);
        }

        if (result.alreadySent) {
          const sentMessage: ScheduledMessage = {
            ...attempt,
            status: 'sent',
            sentAt: result.sentAt || new Date().toISOString(),
            telegramMessageId: result.telegramMessageId,
            lastError: undefined,
            retryAction: undefined,
          };
          const cancelledReplacementIds = new Set<string>();
          const replacementErrors = new Map<string, BridgeErrorDetails>();
          const replacementSentMessages: ScheduledMessage[] = [];
          for (const replacementMessage of replacementMessages) {
            if (replacementMessage.telegramMessageId === undefined || replacementMessage.telegramMessageId === null) {
              replacementErrors.set(replacementMessage.id, {
                operation: 'validate',
                category: 'validation',
                retryable: false,
                message: t('schedule.telegramIdMissing'),
                code: 'TELEGRAM_SCHEDULE_ID_MISSING',
              });
              continue;
            }

            try {
              const replacementCancelResult = await window.telegram.cancel({
                chatId: replacementMessage.chatId,
                telegramMessageId: replacementMessage.telegramMessageId,
                telegramMessageIds: replacementMessage.telegramMessageIds,
                message: replacementMessage.text,
                targetTimestamp: Math.floor(new Date(replacementMessage.when).getTime() / 1000),
              });
              if (!replacementCancelResult.success) {
                replacementErrors.set(
                  replacementMessage.id,
                  normalizeTelegramBridgeError(replacementCancelResult, 'cancel', t('schedule.cancelFailed')),
                );
                continue;
              }

              if (replacementCancelResult.alreadySent) {
                replacementSentMessages.push({
                  ...replacementMessage,
                  status: 'sent',
                  sentAt: replacementCancelResult.sentAt || new Date().toISOString(),
                  telegramMessageId: replacementCancelResult.telegramMessageId,
                });
              } else {
                cancelledReplacementIds.add(replacementMessage.id);
              }
            } catch (error) {
              replacementErrors.set(replacementMessage.id, normalizeTelegramBridgeError(error, 'cancel', t('schedule.cancelFailed')));
            }
          }

          const remaining = cancelContextUpcoming
            .filter((item) => item.id !== msg.id && !cancelledReplacementIds.has(item.id))
            .map((item) => {
              const errorDetails = replacementErrors.get(item.id);
              return errorDetails
                ? { ...item, status: 'failed' as const, lastError: errorDetails.message, lastErrorDetails: errorDetails, retryAction: 'cancel' as const }
                : item;
            });
          const nextSent = [...replacementSentMessages, sentMessage, ...sentStateRef.current.filter((item) => item.id !== msg.id)];
          setUpcoming(remaining);
          upcomingStateRef.current = remaining;
          setSent(nextSent);
          sentStateRef.current = nextSent;
          const persisted = await persistScheduleHistoryAndWait(historyScope, 'snapshot', { upcoming: remaining, sent: nextSent });
          const replacementWasSent = replacementSentMessages.length > 0;
          cancellationSucceeded = persisted && replacementErrors.size === 0 && !replacementWasSent;
          if (replacementErrors.size > 0 || replacementWasSent || !persisted) {
            const errorDetails = replacementErrors.values().next().value;
            showNotification(
              t('schedule.partialCancellation'),
              'warning',
              t('schedule.partialCancellationTitle'),
              errorDetails,
            );
          } else {
            showNotification('Telegram had already sent this scheduled message; its replacement was cancelled.', 'info', t('schedule.sent'));
          }
          return;
        }

        const remaining = cancelContextUpcoming.filter((item) => item.id !== msg.id);
        setUpcoming(remaining);
        upcomingStateRef.current = remaining;
        if (!await persistScheduleHistoryAndWait(historyScope, 'upcoming', remaining)) {
          const lastError = 'Telegram cancelled this schedule, but the history update could not be saved.';
          const errorDetails = normalizeTelegramBridgeError({ error: lastError, code: 'SCHEDULE_HISTORY_WRITE_FAILED' }, 'cancel', lastError);
          const failedMessage: ScheduledMessage = {
            ...attempt,
            telegramMessageId: undefined,
            status: 'failed',
            lastError,
            lastErrorDetails: errorDetails,
            retryAction: 'send',
          };
          const failedUpcoming = cancelContextUpcoming.map((item) => item.id === msg.id ? failedMessage : item);
          setUpcoming(failedUpcoming);
          upcomingStateRef.current = failedUpcoming;
          await persistScheduleHistoryAndWait(historyScope, 'upcoming', failedUpcoming);
          showNotification(`${lastError} Retry will send without cancelling the old schedule again.`, 'error', t('schedule.errorTitle'), errorDetails);
          return;
        }

        cancellationSucceeded = true;
        if (!quiet) showNotification(t('schedule.unscheduled'), 'info', t('schedule.unscheduledTitle'));
      } catch (error) {
        const baseErrorDetails = cancellationErrorDetails ?? normalizeTelegramBridgeError(error, 'cancel', t('schedule.networkCancelling'));
        const cancellationError = baseErrorDetails.message;
        const lastError = replacementMessages.length > 0
          ? `${t('schedule.partialCancellation')} ${cancellationError}`
          : cancellationError;
        const errorDetails = { ...baseErrorDetails, message: lastError };
        const failedMessage: ScheduledMessage = {
          ...attempt,
          status: 'failed',
          lastError,
          lastErrorDetails: errorDetails,
          retryAction: 'cancel',
        };
        const failedUpcoming = cancelContextUpcoming.map((item) => item.id === msg.id ? failedMessage : item);
        setUpcoming(failedUpcoming);
        upcomingStateRef.current = failedUpcoming;
        await persistScheduleHistoryAndWait(historyScope, 'upcoming', failedUpcoming);
        if (!quiet) showNotification(lastError, replacementMessages.length > 0 ? 'warning' : 'error', replacementMessages.length > 0 ? t('schedule.partialCancellationTitle') : t('schedule.errorTitle'), errorDetails);
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
    return cancellationSucceeded;
  }

  async function handleCancelMessages(messages: ScheduledMessage[]): Promise<boolean> {
    const uniqueMessages = [...new Map(messages.map((message) => [message.id, message])).values()];
    let allCancelled = true;

    for (const message of uniqueMessages) {
      if (message.telegramMessageId === undefined || message.telegramMessageId === null) {
        allCancelled = false;
        continue;
      }
      if (!await handleCancelMessage(message, [], true)) allCancelled = false;
    }

    return allCancelled;
  }

  async function handleSendNow(msg: ScheduledMessage) {
    if (msg.retryAction === 'cancel') {
      await handleCancelMessage(msg);
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
    let failureDetails: ReturnType<typeof normalizeTelegramBridgeError> | undefined;
    let failureOperation: 'publish' | 'cancel' = 'publish';

    try {
      if (!await persistScheduleHistoryAndWait(historyScope, 'upcoming', sendingUpcoming)) {
        throw new Error('The sending state could not be saved. Telegram was not contacted.');
      }

      await waitForTelegramAccount();
      if (sendingMessage.telegramMessageId !== undefined) {
        failureOperation = 'cancel';
        if (typeof window.telegram?.cancel !== 'function') throw new Error(t('schedule.cancelFailed'));
        const cancelResult = await window.telegram.cancel({
          chatId: sendingMessage.chatId,
          telegramMessageId: sendingMessage.telegramMessageId,
          telegramMessageIds: sendingMessage.telegramMessageIds,
          message: sendingMessage.text,
          targetTimestamp: Math.floor(new Date(sendingMessage.when).getTime() / 1000),
        });
        if (!cancelResult.success) {
          failureDetails = normalizeTelegramBridgeError(cancelResult, 'cancel', t('schedule.cancelFailed'));
          throw new Error(failureDetails.message);
        }

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

      failureOperation = 'publish';
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
      if (!result.success) {
        failureDetails = normalizeTelegramBridgeError(result, 'publish', t('schedule.sendFailed'));
        throw new Error(failureDetails.message);
      }

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
      scheduleTimeout(() => setRevealingId(null), 1500);
    } catch (error) {
      const errorDetails = failureDetails ?? normalizeTelegramBridgeError(
        error,
        failureOperation,
        failureOperation === 'cancel' ? t('schedule.networkCancelling') : t('schedule.networkSending'),
      );
      const lastError = errorDetails.message;
      const failedMessage: ScheduledMessage = {
        ...sendingMessage,
        status: 'failed',
        lastError,
        lastErrorDetails: errorDetails,
        retryAction: 'send',
      };
      const failedUpcoming = upcoming.map((item) => item.id === msg.id ? failedMessage : item);
      setUpcoming(failedUpcoming);
      await persistScheduleHistoryAndWait(historyScope, 'upcoming', failedUpcoming);
      if (refreshChatPermissions) void refreshChatPermissions(msg.chatId);
      showNotification(lastError, 'error', t('schedule.errorTitle'), errorDetails);
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

    let failedScheduleResult: Awaited<ReturnType<typeof window.telegram.schedule>> | null = null;
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
      failedScheduleResult = result;
      if (!result.success || result.confirmed !== true) {
        throw new Error(result.error || 'Telegram did not confirm that this schedule was saved.');
      }

      const scheduledMessage: ScheduledMessage = {
        ...attempt,
        status: 'scheduled',
        telegramMessageId: result.telegramMessageId ?? result.id,
        telegramMessageIds: result.telegramMessageIds,
        operationIdentity: result.operationIdentity ?? attempt.operationIdentity,
        lastError: undefined,
        retryAction: undefined,
      };
      const nextUpcoming = upcoming.map((item) => item.id === msg.id ? scheduledMessage : item);
      setUpcoming(nextUpcoming);
      await persistScheduleHistoryAndWait(historyScope, 'upcoming', nextUpcoming);
      if (attempt.replacementOfId) {
        const originalMessage = upcoming.find((item) => item.id === attempt.replacementOfId);
        if (originalMessage) handleCancelMessage(originalMessage, [scheduledMessage], true);
      }
      showNotification(t('schedule.scheduledOne'), 'success', t('schedule.scheduledTitle'));
    } catch (error) {
      const errorDetails = failedScheduleResult
        ? normalizeTelegramBridgeError(failedScheduleResult, 'publish', t('schedule.networkScheduling'))
        : normalizeTelegramBridgeError(error, 'publish', t('schedule.networkScheduling'));
      const lastError = errorDetails.message;
      const partialIds = failedScheduleResult?.telegramMessageIds ?? [];
      const failedMessage: ScheduledMessage = {
        ...attempt,
        ...(partialIds.length ? {
          telegramMessageId: failedScheduleResult?.telegramMessageId ?? partialIds[0],
          telegramMessageIds: partialIds,
        } : {}),
        status: 'failed',
        lastError,
        lastErrorDetails: errorDetails,
        retryAction: partialIds.length ? 'cancel' : 'schedule',
      };
      const failedUpcoming = upcoming.map((item) => item.id === msg.id ? failedMessage : item);
      setUpcoming(failedUpcoming);
      await persistScheduleHistoryAndWait(historyScope, 'upcoming', failedUpcoming);
      showNotification(lastError, 'error', t('schedule.errorTitle'), errorDetails);
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
    if (!historyReady || publishingDraft || (!text.trim() && attachments.length === 0) || typeof window.telegram?.send !== 'function') return false;

    setPublishingDraft(true);

    let sendErrorDetails: ReturnType<typeof normalizeTelegramBridgeError> | undefined;
    try {
      await waitForTelegramAccount();
      const result = await window.telegram.send(chat.id, text, attachments, entities, replyMarkup, silent, effect, accountId);

      if (!result.success) {
        sendErrorDetails = normalizeTelegramBridgeError(result, 'publish', t('schedule.sendFailed'));
        throw new Error(sendErrorDetails.message);
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
      scheduleTimeout(() => setSuccessPulse(false), 1500);
      scheduleTimeout(() => setLastAction(null), 1500);
      return true;
    } catch (error) {
      if (refreshChatPermissions) void refreshChatPermissions(chat.id);
      const errorDetails = sendErrorDetails ?? normalizeTelegramBridgeError(error, 'publish', t('schedule.networkSending'));
      showNotification(
        errorDetails.message,
        'error',
        t('schedule.sendFailedTitle'),
        errorDetails,
      );
      return false;
    } finally {
      setPublishingDraft(false);
    }
  }

  function handleDeleteMessage(msg: ScheduledMessage, skipConfirmation = false) {
    if (!skipConfirmation && !window.confirm(t('schedule.confirmDelete'))) return;

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
    handleCancelMessages,
    handleSendNow,
    handleRetry,
    handleSendDraftNow,
    handleDeleteMessage,
    handleClearSent,
  };
}
