import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { Chat, NotificationType, RichTextEntity, ScheduledMessage } from '@/types';
import type { BridgeErrorDetails } from '@shared/bridge';
import { createBridgeValidationError, normalizeTelegramBridgeError } from '@shared/bridge';
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
  persistScheduleHistoryAndWait,
  type MessageHistoryScope,
} from '@/lib/storage';
import {
  getCurrentTimeStr,
  getTodayStr,
  uid,
} from '@/lib/utils';
import { useLocale } from '@/lib/i18n';
import { useConfirm } from '@/components/useConfirm';
import {
  cancelScheduledMessage,
  getScheduleIdentities,
  loadScheduleHistory,
  reconcileImmediateSendAttempt,
  reconcilePendingSchedule,
  scheduleMessage,
  scheduleTelegramMessage,
  sendNow,
  waitForTelegramRateLimit,
} from '@/services/schedulerAppService';

const REPEAT_SCHEDULE_DELAY_MS = 1500;
const MASS_SCHEDULE_WARNING_THRESHOLD = 10;
const MASS_SCHEDULE_WARNING_DURATION_MS = 5000;
const MAX_SCHEDULE_FUTURE_DAYS = 367;

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
}

async function waitForTelegramAccount() {
  const result = await waitForTelegramRateLimit();
  if (!result.success) {
    throw new Error(result.error || 'Telegram account is not ready to resume requests.');
  }
}

function normalizeRestoredMessage(message: ScheduledMessage): ScheduledMessage {
  const status = String(message.status);
  if (status === 'confirmed') return { ...message, status: 'scheduled' };
  if (status === 'sending') {
    if (message.retryAction === 'schedule') {
      return {
        ...message,
        status: 'failed',
        lastError: message.lastError || 'The app closed while this message was being scheduled.',
        retryAction: 'schedule',
      };
    }
    return {
      ...message,
      status: 'unknown',
      lastError: message.lastError || 'The app closed while this message was sending. Studio cannot verify the result automatically after restart; check Telegram before sending again.',
      retryAction: undefined,
    };
  }
  if (['pending', 'scheduled', 'sent', 'failed', 'unknown'].includes(status)) return message;
  return {
    ...message,
    status: 'failed',
    lastError: message.lastError || `Unsupported saved status: ${status}`,
    retryAction: message.retryAction ?? 'send',
  };
}

export type UseSchedulerOptions = {
  historyScope?: MessageHistoryScope;
  accountId?: string;
  connected: boolean;
  selectedChat: Chat | null;
  chats: Chat[];
  message: string;
  composerAttachments?: string[];
  composerEntities?: RichTextEntity[];
  showNotification: (
    message: string,
    type: NotificationType,
    title: string,
    errorDetails?: BridgeErrorDetails,
    durationMs?: number,
  ) => void;
  setMessage: Dispatch<SetStateAction<string>>;
  refreshChatPermissions?: (chatId: string) => Promise<unknown>;
};

export function useScheduler({
  historyScope = 'personal',
  accountId = 'account-1',
  connected,
  selectedChat,
  chats,
  message,
  composerAttachments = [],
  composerEntities = [],
  showNotification,
  setMessage,
  refreshChatPermissions,
}: UseSchedulerOptions) {
  const { t } = useLocale();
  const confirm = useConfirm();
  const showValidationNotification = (message: string, type: NotificationType, title: string, code: string) => (
    showNotification(message, type, title, createBridgeValidationError(message, code))
  );
  const [date, setDate] = useState(getTodayStr());
  const [time, setTime] = useState(getCurrentTimeStr());
  const dateEditedRef = useRef(false);
  const timeEditedRef = useRef(false);
  const resetScheduleDateTime = () => {
    dateEditedRef.current = false;
    timeEditedRef.current = false;
    setDate(getTodayStr());
    setTime(getCurrentTimeStr());
  };
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
  const [historyLoadError, setHistoryLoadError] = useState<string | null>(null);
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
  const publishingDraftLockRef = useRef(false);
  const draftSendAttemptRef = useRef<{ fingerprint: string; id: string; recordId?: string } | null>(null);
  const [publishingDraft, setPublishingDraft] = useState(false);
  const openPickerRef = useRef<'date' | 'time' | null>(null);
  const loadUpcoming = useCallback(() => loadUpcomingFromStorage(historyScope), [historyScope]);
  const loadSent = useCallback(() => loadSentFromStorage(historyScope), [historyScope]);

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

    let timeoutId = 0;
    const scheduleTick = () => {
      refreshCurrentDateTime();
      timeoutId = window.setTimeout(scheduleTick, 1000 - (Date.now() % 1000) + 10);
    };
    const resync = () => {
      if (document.hidden) return;
      window.clearTimeout(timeoutId);
      scheduleTick();
    };
    scheduleTick();
    document.addEventListener('visibilitychange', resync);
    window.addEventListener('focus', resync);

    return () => {
      window.clearTimeout(timeoutId);
      document.removeEventListener('visibilitychange', resync);
      window.removeEventListener('focus', resync);
    };
  }, [historyScope]);

  useEffect(() => {
    let cancelled = false;

    const restoreHistory = async () => {
      setHistoryLoadError(null);
      const fallbackUpcoming = loadUpcoming();
      const fallbackSent = loadSent();

      try {
        const result = await loadScheduleHistory(historyScope);
        if (!result) {
          setUpcoming(fallbackUpcoming);
          setSent(fallbackSent);
          return;
        }
        if (!result.success) throw new Error(result.error || 'Schedule history could not be restored.');

        const nativeUpcoming = result.history?.upcoming ?? [];
        const nativeSent = result.history?.sent ?? [];
        let restoredUpcoming = (result.needsMigration ? fallbackUpcoming : nativeUpcoming)
          .map(normalizeRestoredMessage);
        let restoredSent = (result.needsMigration ? fallbackSent : nativeSent)
          .map(normalizeRestoredMessage);

        for (const message of [...restoredUpcoming]) {
          if (message.status !== 'unknown' || !message.sendAttemptId) continue;
          const reconciliation = await reconcileImmediateSendAttempt(
            message.sendAttemptId,
            message.attachments?.length ?? 0,
          );
          if (reconciliation.state !== 'sent') continue;

          const sentMessage: ScheduledMessage = {
            ...message,
            status: 'sent',
            ...(reconciliation.sentAt ? { sentAt: reconciliation.sentAt } : {}),
            telegramMessageId: reconciliation.telegramMessageId,
            telegramMessageIds: reconciliation.telegramMessageIds,
            lastError: undefined,
            lastErrorDetails: undefined,
            retryAction: undefined,
          };
          restoredUpcoming = restoredUpcoming.filter((item) => item.id !== message.id);
          restoredSent = [sentMessage, ...restoredSent.filter((item) => item.id !== message.id)];
        }
        if (cancelled) return;

        setUpcoming(restoredUpcoming);
        setSent(restoredSent);
        upcomingStateRef.current = restoredUpcoming;
        sentStateRef.current = restoredSent;
        if (result.needsMigration
          || JSON.stringify(restoredUpcoming) !== JSON.stringify(nativeUpcoming)
          || JSON.stringify(restoredSent) !== JSON.stringify(nativeSent)) {
          if (!await persistScheduleHistoryAndWait(historyScope, 'snapshot', {
            upcoming: restoredUpcoming,
            sent: restoredSent,
          })) {
            showNotification(t('schedule.historyWriteFailed'), 'warning', t('schedule.errorTitle'));
          }
        }
      } catch (error) {
        if (cancelled) return;
        setUpcoming(fallbackUpcoming);
        setSent(fallbackSent);
        setHistoryLoadError(error instanceof Error ? error.message : 'Schedule history could not be restored.');
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
      const pendingMessages = getPendingSchedules(upcomingStateRef.current);

      for (const pendingMessage of pendingMessages) {
        const pendingTimestamp = new Date(pendingMessage.when).getTime();

        if (Number.isFinite(pendingTimestamp) && pendingTimestamp <= Date.now()) {
          await waitForTelegramAccount();
          if (cancelled) return;

          const reconciliation = await reconcilePendingSchedule({
            chatId: pendingMessage.chatId,
            message: pendingMessage.text,
            targetTimestamp: Math.floor(pendingTimestamp / 1000),
            attachments: pendingMessage.attachments ?? [],
            entities: pendingMessage.entities ?? [],
            silent: pendingMessage.silent,
            effect: pendingMessage.effect,
            telegramMessageIds: pendingMessage.telegramMessageIds
              ?? (pendingMessage.telegramMessageId === undefined ? [] : [pendingMessage.telegramMessageId]),
          });
          if (cancelled) return;

          if (reconciliation.state === 'unknown') {
            showNotification(
              reconciliation.error || 'Telegram could not confirm the operation state. No automatic retry was made.',
              'warning',
              t('schedule.errorTitle'),
            );
            continue;
          }

          const updatedUpcoming = upcomingStateRef.current.filter((message) => message.id !== pendingMessage.id);
          const nextSent = sentStateRef.current;
          const nextUpcoming = [{
            ...pendingMessage,
            status: 'scheduled' as const,
            telegramMessageId: reconciliation.telegramMessageId,
            telegramMessageIds: reconciliation.telegramMessageIds,
            retryAction: undefined,
            lastError: undefined,
            lastErrorDetails: undefined,
          }, ...updatedUpcoming];
          upcomingStateRef.current = nextUpcoming;
          setUpcoming(nextUpcoming);

          const persisted = await persistScheduleHistoryAndWait(historyScope, 'snapshot', {
            upcoming: nextUpcoming,
            sent: nextSent,
          });
          if (!persisted) {
            showNotification(t('schedule.historyWriteFailed'), 'warning', t('schedule.errorTitle'));
          }
          continue;
        }

        await waitForTelegramAccount();
        if (cancelled) return;

        const result = await scheduleTelegramMessage({
          accountId,
          chatId: pendingMessage.chatId,
          message: pendingMessage.text,
          targetTimestamp: Math.floor(
            new Date(pendingMessage.when).getTime() / 1000
          ),
          attachments: pendingMessage.attachments ?? [],
          entities: pendingMessage.entities ?? [],
          silent: pendingMessage.silent,
          effect: pendingMessage.effect,
        });

        if (cancelled) return;

        const scheduleConfirmed = result.success
          && (!pendingMessage.replacementOfId || result.confirmed === true);
        const updatedUpcoming = upcomingStateRef.current.map((message) => {
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
          return applyScheduleResult(upcomingStateRef.current, pendingMessage.operationId!, result)
            .find((item) => item.operationId === pendingMessage.operationId) ?? message;
        });
        upcomingStateRef.current = updatedUpcoming;
        setUpcoming(updatedUpcoming);
        const historyPersisted = await persistScheduleHistoryAndWait(historyScope, 'upcoming', updatedUpcoming);

        if (!scheduleConfirmed) {
          showNotification(
            result.error || 'Telegram did not confirm that this replacement was saved.',
            'error',
            'Scheduling failed'
          );
        } else if (!historyPersisted) {
          showNotification(t('schedule.historySaveFailed'), 'warning', t('schedule.errorTitle'));
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
  }, [accountId, connected, historyReady, historyScope, loadUpcoming, showNotification, t]);

  async function handleSchedule(scheduleRequest?: {
    chatId: string;
    message: string;
    date: string;
    time: string;
    attachments?: string[];
    attachmentGroups?: string[][];
    entities?: RichTextEntity[];
    silent?: boolean;
    effect?: string;
    clearMessageOnSuccess?: boolean;
    waitForConfirmation?: boolean;
    replaceMessage?: ScheduledMessage;
  }, repeatOptions: ScheduleRepeatOptions = { mode: 'none', occurrences: 1 }): Promise<boolean | 'sent-history-failed' | void> {
    if (!historyReady || scheduling || schedulingLockRef.current) return false;

    const scheduleChat = scheduleRequest
      ? chats.find((chat) => chat.id === scheduleRequest.chatId) || null
      : selectedChat;
    const scheduleMessage = scheduleRequest?.message ?? message;
    const scheduleDate = scheduleRequest?.date ?? date;
    const scheduleTime = scheduleRequest?.time ?? time;
    const replaceMessage = scheduleRequest?.replaceMessage;
    const scheduleAttachments = scheduleRequest
      ? scheduleRequest.attachments ?? []
      : composerAttachments;
    const suppliedScheduleGroups = scheduleRequest?.attachmentGroups?.filter((group) => group.length > 0) ?? [];
    const scheduleGroups = suppliedScheduleGroups.length > 0
      ? suppliedScheduleGroups
      : scheduleAttachments.length > 0 ? [scheduleAttachments] : [[]];
    const scheduleEntities = scheduleRequest
      ? scheduleRequest.entities ?? []
      : composerEntities;

    if (!scheduleChat) {
      showValidationNotification(
        t('schedule.selectChat'),
        'warning',
        t('schedule.noChatTitle'),
        'CHAT_REQUIRED',
      );
      return false;
    }

    if (replaceMessage && (replaceMessage.telegramMessageId === undefined || replaceMessage.telegramMessageId === null)) {
      const errorDetails = createBridgeValidationError(t('schedule.telegramIdMissing'), 'TELEGRAM_SCHEDULE_ID_MISSING');
      showNotification(errorDetails.message, 'error', t('schedule.cannotUnschedule'), errorDetails);
      return false;
    }

    if (!scheduleMessage.trim() && scheduleAttachments.length === 0) {
      showValidationNotification(
        t('schedule.emptyMessage'),
        'warning',
        t('schedule.emptyMessageTitle'),
        'MESSAGE_REQUIRED',
      );
      return false;
    }

    const messageLimit = getMessageMaxLength(scheduleAttachments.length > 0);
    if (scheduleMessage.length > messageLimit) {
      showValidationNotification(
        t('composer.messageExceedsLimit', { limit: messageLimit }),
        'warning',
        t('composer.messageTooLongTitle'),
        'MESSAGE_TOO_LONG',
      );
      return false;
    }

    if (!scheduleDate || !scheduleTime) {
      showValidationNotification(
        t('schedule.setDateTime'),
        'warning',
        t('schedule.missingDateTitle'),
        'SCHEDULE_DATETIME_REQUIRED',
      );
      return false;
    }

    const whenDate = new Date(`${scheduleDate}T${scheduleTime}`);

    if (Number.isNaN(whenDate.getTime())) {
      showValidationNotification(
        t('schedule.invalidDateTime'),
        'error',
        t('schedule.invalidDateTitle'),
        'SCHEDULE_DATETIME_INVALID',
      );
      return false;
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
      return false;
    }

    if (isCurrentTime) {
      return handleSendDraftNow(
        scheduleChat,
        scheduleMessage,
        scheduleAttachments,
        scheduleEntities,
        scheduleRequest?.silent === true,
        scheduleRequest?.effect,
        undefined,
        scheduleGroups,
      );
    }

    const requestedOccurrences = Number(repeatOptions.occurrences);
    if (!Number.isInteger(requestedOccurrences) || requestedOccurrences < 1 || requestedOccurrences > MAX_SCHEDULE_OCCURRENCES) {
      showValidationNotification(
        t('schedule.repeatRange', { count: MAX_SCHEDULE_OCCURRENCES }),
        'warning',
        t('schedule.invalidRepeatCount'),
        'REPEAT_COUNT_INVALID',
      );
      return false;
    }

    const validWeekdays = new Set(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
    if (repeatOptions.days?.some((day) => !validWeekdays.has(day))) {
      showValidationNotification(t('schedule.validWeekdays'), 'warning', t('schedule.invalidRepeatDays'), 'REPEAT_DAY_INVALID');
      return false;
    }

    const chatId = scheduleChat.id;
    const chatName = scheduleChat.name;
    const text = scheduleMessage;
    const entities = scheduleEntities;
    const silent = scheduleRequest?.silent === true;
    const effect = scheduleRequest?.effect;
    const occurrenceDates = getScheduleOccurrences(whenDate, repeatOptions);
    const maximumScheduleTime = scheduleNow + MAX_SCHEDULE_FUTURE_DAYS * 24 * 60 * 60 * 1000;
    if (occurrenceDates.some((occurrenceDate) => occurrenceDate.getTime() > maximumScheduleTime)) {
      showValidationNotification(
        t('schedule.tooFarFuture'),
        'warning',
        t('schedule.tooFarFutureTitle'),
        'SCHEDULE_TOO_FAR',
      );
      return false;
    }
    if (replaceMessage && occurrenceDates.length !== 1) {
      showValidationNotification(
        t('schedule.repeatRange', { count: 1 }),
        'warning',
        t('schedule.invalidRepeatCount'),
        'REPLACEMENT_REPEAT_NOT_ALLOWED',
      );
      return false;
    }
    const candidateOperations = occurrenceDates.flatMap((occurrenceDate) => (
      scheduleGroups.map((groupAttachments, groupIndex) => {
        const isPrimaryGroup = groupIndex === 0;
        return {
          chatId,
          message: isPrimaryGroup ? text : '',
          targetTimestamp: Math.floor(occurrenceDate.getTime() / 1000),
          attachments: groupAttachments,
          entities: isPrimaryGroup ? entities : [],
          silent,
          effect: isPrimaryGroup ? effect : undefined,
        };
      })
    ));

    if (occurrenceDates.length >= MASS_SCHEDULE_WARNING_THRESHOLD) {
      showNotification(
        t('schedule.massWarningMessage', { count: occurrenceDates.length }),
        'warning',
        t('schedule.massWarningTitle'),
        undefined,
        MASS_SCHEDULE_WARNING_DURATION_MS,
      );
    }

    const candidateTimestamps = new Set(candidateOperations.map((operation) => operation.targetTimestamp));
    const comparableUpcoming = upcoming.filter((scheduledMessage) => {
      const scheduledTimestamp = Math.floor(new Date(scheduledMessage.when).getTime() / 1000);
      return scheduledMessage.id !== replaceMessage?.id
        && scheduledMessage.status !== 'sent'
        && scheduledMessage.chatId === chatId
        && candidateTimestamps.has(scheduledTimestamp)
        && candidateOperations.some((operation) => (
          operation.message === scheduledMessage.text
          && (scheduledMessage.attachments ?? []).length === operation.attachments.length
        ));
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
        silent: scheduledMessage.silent,
        effect: scheduledMessage.effect,
      })),
    ];

    schedulingLockRef.current = true;
    if (replaceMessage) activePublishIdsRef.current.add(replaceMessage.id);
    setScheduling(true);

    let identityResult: Awaited<ReturnType<typeof getScheduleIdentities>>;
    try {
      identityResult = await getScheduleIdentities(identityOperations);
      if (!identityResult.success || !identityResult.identities || identityResult.identities.length !== identityOperations.length) {
        throw new Error(identityResult.error || t('schedule.failed'));
      }
    } catch (error) {
      schedulingLockRef.current = false;
      if (replaceMessage) activePublishIdsRef.current.delete(replaceMessage.id);
      setScheduling(false);
      const errorDetails = normalizeTelegramBridgeError(error, 'publish', t('schedule.failed'));
      showNotification(errorDetails.message, 'error', t('schedule.schedulingFailed'), errorDetails);
      return false;
    }

    const candidateIdentities = identityResult.identities.slice(0, candidateOperations.length);
    if (candidateIdentities.some((identity) => typeof identity !== 'string')) {
      schedulingLockRef.current = false;
      if (replaceMessage) activePublishIdsRef.current.delete(replaceMessage.id);
      setScheduling(false);
      const errorDetails = createBridgeValidationError(t('schedule.failed'), 'SCHEDULE_IDENTITY_INVALID');
      showNotification(errorDetails.message, 'error', t('schedule.schedulingFailed'), errorDetails);
      return false;
    }

    const legacyIdentityByMessage = new Map<string, string | null>();
    legacyUpcoming.forEach((scheduledMessage, index) => {
      legacyIdentityByMessage.set(scheduledMessage.id, identityResult.identities![candidateOperations.length + index]);
    });
    const unverifiableLegacyMedia = legacyUpcoming.some((scheduledMessage) => (
      (scheduledMessage.attachments?.length ?? 0) > 0
      && typeof legacyIdentityByMessage.get(scheduledMessage.id) !== 'string'
    ));
    if (unverifiableLegacyMedia) {
      schedulingLockRef.current = false;
      if (replaceMessage) activePublishIdsRef.current.delete(replaceMessage.id);
      setScheduling(false);
      const errorDetails = createBridgeValidationError(t('schedule.failed'), 'LEGACY_MEDIA_IDENTITY_UNAVAILABLE');
      showNotification(errorDetails.message, 'warning', t('schedule.errorTitle'), errorDetails);
      return false;
    }

    const upcomingWithIdentities = upcomingStateRef.current.map((scheduledMessage) => {
      const operationIdentity = legacyIdentityByMessage.get(scheduledMessage.id);
      return !scheduledMessage.operationIdentity && operationIdentity
        ? { ...scheduledMessage, operationIdentity }
        : scheduledMessage;
    });
    const currentComparableUpcoming = upcomingWithIdentities.filter((scheduledMessage) => {
      const scheduledTimestamp = Math.floor(new Date(scheduledMessage.when).getTime() / 1000);
      return scheduledMessage.id !== replaceMessage?.id
        && scheduledMessage.status !== 'sent'
        && scheduledMessage.chatId === chatId
        && candidateTimestamps.has(scheduledTimestamp)
        && candidateOperations.some((operation) => (
          operation.message === scheduledMessage.text
          && (scheduledMessage.attachments ?? []).length === operation.attachments.length
        ));
    });
    const existingIdentities = new Set(currentComparableUpcoming.map((scheduledMessage) => (
      scheduledMessage.operationIdentity || legacyIdentityByMessage.get(scheduledMessage.id)
    )).filter((identity): identity is string => typeof identity === 'string'));
    const duplicateExists = candidateIdentities.some((identity) => existingIdentities.has(identity!));

    if (duplicateExists) {
      if (legacyUpcoming.some((scheduledMessage) => legacyIdentityByMessage.get(scheduledMessage.id))) {
        upcomingStateRef.current = upcomingWithIdentities;
        setUpcoming(upcomingWithIdentities);
        await persistScheduleHistoryAndWait(historyScope, 'upcoming', upcomingWithIdentities);
      }
      schedulingLockRef.current = false;
      if (replaceMessage) activePublishIdsRef.current.delete(replaceMessage.id);
      setScheduling(false);
      showNotification(t('schedule.duplicate'), 'warning', t('schedule.duplicateTitle'));
      return false;
    }

    setLastAction(null);
    setSuccessPulse(false);
    const pendingMessages = candidateOperations.map((operation, index) => createPendingSchedule({
      accountId,
      operationId: uid(),
      operationIdentity: candidateIdentities[index]!,
      chatId,
      chatName,
      text: operation.message,
      attachments: operation.attachments,
      when: new Date(operation.targetTimestamp * 1000).toISOString(),
      createdAt: new Date().toISOString(),
      entities: operation.entities,
      silent: operation.silent,
      effect: operation.effect,
    })).map((pendingMessage) => replaceMessage
      ? { ...pendingMessage, replacementOfId: replaceMessage.id }
      : pendingMessage);
    const pendingUpcoming = [...pendingMessages, ...upcomingWithIdentities];
    upcomingStateRef.current = pendingUpcoming;
    setUpcoming(pendingUpcoming);

    const schedulingTask = (async () => {
      if (!await persistScheduleHistoryAndWait(historyScope, 'upcoming', pendingUpcoming)) {
        throw new Error('The pending schedule could not be saved. Telegram was not contacted.');
      }

      const results: Array<{ result: Awaited<ReturnType<typeof scheduleTelegramMessage>>; operationId: string }> = [];

      for (const [index, pendingMessage] of pendingMessages.entries()) {
        try {
          await waitForTelegramAccount();
          const result = await scheduleTelegramMessage({
            accountId,
            chatId,
            message: pendingMessage.text,
            targetTimestamp: Math.floor(new Date(pendingMessage.when).getTime() / 1000),
            attachments: pendingMessage.attachments ?? [],
            entities: pendingMessage.entities ?? [],
            silent: pendingMessage.silent,
            effect: pendingMessage.effect,
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

        const updatedUpcoming = upcomingStateRef.current.map((message) => {
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
          const scheduledMessage = applyScheduleResult(upcomingStateRef.current, message.operationId!, {
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
        setUpcoming(updatedUpcoming);
        upcomingStateRef.current = updatedUpcoming;
        const historyPersisted = await persistScheduleHistoryAndWait(historyScope, 'upcoming', updatedUpcoming);
        schedulingLockRef.current = false;
        setScheduling(false);

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
          return false;
        }

        let replacementCancellationFailed = Boolean(replaceMessage && !historyPersisted);
        if (replaceMessage) {
          activePublishIdsRef.current.delete(replaceMessage.id);
          if (historyPersisted
            && confirmedSchedules.length === pendingMessages.length
            && failedSchedules === 0
            && replacementMessages.length === pendingMessages.length) {
            replacementCancellationFailed = !await handleCancelMessage(replaceMessage, replacementMessages, true);
          } else {
            replacementCancellationFailed = true;
          }
        }
        schedulingLockRef.current = false;
        setScheduling(false);

        const fullyConfirmed = confirmedSchedules.length === pendingMessages.length;
        if (scheduleRequest?.clearMessageOnSuccess !== false && fullyConfirmed && historyPersisted && !replacementCancellationFailed) {
          setMessage('');
        }
        const firstFailure = results.find(({ result }) => !result.success || result.confirmed !== true);
        const errorDetails = firstFailure
          ? normalizeTelegramBridgeError(firstFailure.result, 'publish', t('schedule.failed'))
          : undefined;
        const historyPersistenceFailed = confirmedSchedules.length > 0 && !historyPersisted;
        const notificationMessage = historyPersistenceFailed
          ? t('schedule.historySaveFailed')
          : replacementCancellationFailed
            ? t('schedule.partialCancellation')
            : confirmedSchedules.length === 1 && failedSchedules === 0
              ? t('schedule.scheduledOne')
              : confirmedSchedules.length > 1 && failedSchedules === 0
                ? t('schedule.scheduledMany', { count: confirmedSchedules.length })
                : `${confirmedSchedules.length} scheduled; ${failedSchedules} failed.`;
        const notificationType = failedSchedules || replacementCancellationFailed || historyPersistenceFailed ? 'warning' : 'success';
        const notificationTitle = historyPersistenceFailed
          ? t('schedule.errorTitle')
          : replacementCancellationFailed ? t('schedule.partialCancellationTitle') : t('schedule.scheduledTitle');
        if (errorDetails) showNotification(notificationMessage, notificationType, notificationTitle, errorDetails);
        else showNotification(notificationMessage, notificationType, notificationTitle);
        if (fullyConfirmed && historyPersisted && !replacementCancellationFailed) {
          resetScheduleDateTime();
          setLastAction('scheduled');
          setSuccessPulse(true);
          scheduleTimeout(() => setSuccessPulse(false), 1500);
        }
        return fullyConfirmed && historyPersisted && !replacementCancellationFailed;
      })
      .catch(async (error) => {
        schedulingLockRef.current = false;
        setScheduling(false);
        if (replaceMessage) activePublishIdsRef.current.delete(replaceMessage.id);
        const errorDetails = normalizeTelegramBridgeError(error, 'publish', t('schedule.networkScheduling'));
        const lastError = errorDetails.message;
        const pendingIds = new Set(pendingMessages.map((message) => message.operationId));
        const failedUpcoming = upcomingStateRef.current.map((message) => pendingIds.has(message.operationId)
          ? { ...message, status: 'failed' as const, lastError, lastErrorDetails: errorDetails, retryAction: 'schedule' as const }
          : message);
        upcomingStateRef.current = failedUpcoming;
        setUpcoming(failedUpcoming);
        await persistScheduleHistoryAndWait(historyScope, 'upcoming', failedUpcoming);
        showNotification(
          lastError,
          'error',
          t('schedule.errorTitle'),
          errorDetails,
        );
        return false;
      });
      if (scheduleRequest?.waitForConfirmation) return schedulingTask;
      void schedulingTask;
      return undefined;
  }

  async function handleCancelMessage(msg: ScheduledMessage, replacementMessages: ScheduledMessage[] = [], quiet = false): Promise<boolean> {
    if (cancelingIdsRef.current.has(msg.id) || activePublishIdsRef.current.has(msg.id)) return false;

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
        const result = await cancelScheduledMessage({
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
              const replacementCancelResult = await cancelScheduledMessage({
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

          const remaining = upcomingStateRef.current
            .filter((item) => item.id !== msg.id && !cancelledReplacementIds.has(item.id))
            .map((item) => {
              const errorDetails = replacementErrors.get(item.id);
              return errorDetails
                ? { ...item, status: 'failed' as const, lastError: errorDetails.message, lastErrorDetails: errorDetails, retryAction: 'cancel' as const }
                : item;
            });
          const nextSent = [...replacementSentMessages, sentMessage, ...sentStateRef.current.filter((item) => item.id !== msg.id)];
          upcomingStateRef.current = remaining;
          sentStateRef.current = nextSent;
          setUpcoming(remaining);
          setSent(nextSent);
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

        const remaining = upcomingStateRef.current.filter((item) => item.id !== msg.id);
        upcomingStateRef.current = remaining;
        setUpcoming(remaining);
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
          const currentUpcoming = upcomingStateRef.current;
          const failedUpcoming = currentUpcoming.some((item) => item.id === msg.id)
            ? currentUpcoming.map((item) => item.id === msg.id ? failedMessage : item)
            : [failedMessage, ...currentUpcoming];
          upcomingStateRef.current = failedUpcoming;
          setUpcoming(failedUpcoming);
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
        const failedUpcoming = upcomingStateRef.current.map((item) => item.id === msg.id ? failedMessage : item);
        upcomingStateRef.current = failedUpcoming;
        setUpcoming(failedUpcoming);
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
    if (activePublishIdsRef.current.has(msg.id)) return;

    const currentMessage = upcomingStateRef.current.find((item) => item.id === msg.id) ?? msg;
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

    const sendingUpcoming = upcomingStateRef.current.map((item) => item.id === msg.id ? sendingMessage : item);
    upcomingStateRef.current = sendingUpcoming;
    setUpcoming(sendingUpcoming);
    let failureDetails: ReturnType<typeof normalizeTelegramBridgeError> | undefined;
    let failureOperation: 'publish' | 'cancel' = 'publish';
    let sendRequestStarted = false;

    try {
      if (!await persistScheduleHistoryAndWait(historyScope, 'upcoming', sendingUpcoming)) {
        throw new Error('The sending state could not be saved. Telegram was not contacted.');
      }

      await waitForTelegramAccount();
      if (sendingMessage.telegramMessageId !== undefined) {
        failureOperation = 'cancel';
        const cancelResult = await cancelScheduledMessage({
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
          const nextUpcoming = upcomingStateRef.current.filter((item) => item.id !== msg.id);
          const nextSent = [sentMessage, ...sentStateRef.current.filter((item) => item.id !== msg.id)];
          upcomingStateRef.current = nextUpcoming;
          sentStateRef.current = nextSent;
          setUpcoming(nextUpcoming);
          setSent(nextSent);
          resetScheduleDateTime();
          await persistScheduleHistoryAndWait(historyScope, 'snapshot', { upcoming: nextUpcoming, sent: nextSent });
          showNotification('Telegram had already sent this scheduled message.', 'info', t('schedule.sent'));
          return;
        }

        sendingMessage = { ...sendingMessage, telegramMessageId: undefined };
        const uncancelledUpcoming = upcomingStateRef.current.map((item) => item.id === msg.id ? sendingMessage : item);
        upcomingStateRef.current = uncancelledUpcoming;
        setUpcoming(uncancelledUpcoming);
        if (!await persistScheduleHistoryAndWait(historyScope, 'upcoming', uncancelledUpcoming)) {
          throw new Error('Telegram cancelled the schedule, but the updated state could not be saved. Do not retry until the queue is checked.');
        }
      }

      failureOperation = 'publish';
      sendRequestStarted = true;
      const result = await sendNow({
        action: 'send-now',
        chatId: sendingMessage.chatId,
        text: sendingMessage.text,
        entities: sendingMessage.entities ?? [],
        attachments: sendingMessage.attachments ?? [],
        silent: sendingMessage.silent,
        effect: sendingMessage.effect,
        accountId,
        sendAttemptId: sendingMessage.sendAttemptId,
      });
      if (!result.success) {
        failureDetails = normalizeTelegramBridgeError(result, 'publish', t('schedule.sendFailed'));
        throw new Error(failureDetails.message);
      }

      resetScheduleDateTime();
      const sentMessage: ScheduledMessage = {
        ...sendingMessage,
        status: 'sent',
        ...(result.sentAt ? { sentAt: result.sentAt } : { sentAt: new Date().toISOString() }),
        telegramMessageId: result.telegramMessageId,
        telegramMessageIds: result.telegramMessageIds,
        lastError: undefined,
        retryAction: undefined,
      };
      const nextSent = [sentMessage, ...sentStateRef.current.filter((item) => item.id !== msg.id)];
      const nextUpcoming = upcomingStateRef.current.filter((item) => item.id !== msg.id);
      sentStateRef.current = nextSent;
      upcomingStateRef.current = nextUpcoming;
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
        status: sendRequestStarted ? 'unknown' : 'failed',
        lastError,
        lastErrorDetails: errorDetails,
        retryAction: sendRequestStarted ? undefined : 'send',
      };
      const failedUpcoming = upcomingStateRef.current.map((item) => item.id === msg.id ? failedMessage : item);
      upcomingStateRef.current = failedUpcoming;
      setUpcoming(failedUpcoming);
      await persistScheduleHistoryAndWait(historyScope, 'upcoming', failedUpcoming);
      if (refreshChatPermissions) void refreshChatPermissions(msg.chatId);
      showNotification(
        sendRequestStarted ? t('schedule.sendResultUnknown') : lastError,
        sendRequestStarted ? 'warning' : 'error',
        t('schedule.errorTitle'),
        errorDetails,
      );
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
    if (activePublishIdsRef.current.has(msg.id)) return;
    activePublishIdsRef.current.add(msg.id);
    setSendingIds((current) => new Set(current).add(msg.id));
    const attempt: ScheduledMessage = {
      ...msg,
      status: 'sending',
      lastAttemptAt: new Date().toISOString(),
      lastError: undefined,
      retryAction: 'schedule',
    };
    const sendingUpcoming = upcomingStateRef.current.map((item) => item.id === msg.id ? attempt : item);
    upcomingStateRef.current = sendingUpcoming;
    setUpcoming(sendingUpcoming);

    let failedScheduleResult: Awaited<ReturnType<typeof scheduleMessage>> | null = null;
    try {
      if (!await persistScheduleHistoryAndWait(historyScope, 'upcoming', sendingUpcoming)) {
        throw new Error('The retry state could not be saved. Telegram was not contacted.');
      }
      await waitForTelegramAccount();
      const result = await scheduleMessage({
        action: 'schedule',
        chatId: attempt.chatId,
        text: attempt.text,
        entities: attempt.entities ?? [],
        attachments: attempt.attachments ?? [],
        silent: attempt.silent,
        effect: attempt.effect,
        accountId,
        targetTimestamp: Math.floor(new Date(attempt.when).getTime() / 1000),
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
      const nextUpcoming = upcomingStateRef.current.map((item) => item.id === msg.id ? scheduledMessage : item);
      upcomingStateRef.current = nextUpcoming;
      setUpcoming(nextUpcoming);
      const historyPersisted = await persistScheduleHistoryAndWait(historyScope, 'upcoming', nextUpcoming);
      if (!historyPersisted) {
        showNotification(t('schedule.historySaveFailed'), 'warning', t('schedule.errorTitle'));
        return;
      }
      if (attempt.replacementOfId) {
        const originalMessage = upcomingStateRef.current.find((item) => item.id === attempt.replacementOfId);
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
      const failedUpcoming = upcomingStateRef.current.map((item) => item.id === msg.id ? failedMessage : item);
      upcomingStateRef.current = failedUpcoming;
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
    silent: boolean | string[][] = false,
    effect?: string,
    options: {
      clearMessageOnSuccess?: boolean;
      isNestedBatchGroup?: boolean;
      suppressNotifications?: boolean;
    } = {},
    attachmentGroups?: string[][],
    onAttachmentGroupResult?: (groupIndex: number, sent: boolean) => void,
  ): Promise<boolean | 'sent-history-failed'> {
    const isNestedBatchGroup = Boolean(options.isNestedBatchGroup);
    const suppliedGroups = Array.isArray(silent) ? silent : attachmentGroups;
    if (suppliedGroups?.length) {
      const groups = suppliedGroups.filter((group) => group.length > 0);
      if (groups.length > 1 || onAttachmentGroupResult) {
        const shouldManageBatchState = !publishingDraftLockRef.current;
        if (shouldManageBatchState) {
          publishingDraftLockRef.current = true;
          setPublishingDraft(true);
        }

        let allSent = true;
        let sentGroupCount = 0;
        let historyWriteFailed = false;
        try {
          for (const [groupIndex, group] of groups.entries()) {
            const isPrimaryGroup = groupIndex === 0;
            const sentResult = await handleSendDraftNow(
              chat,
              isPrimaryGroup ? text : '',
              group,
              isPrimaryGroup ? entities : [],
              false,
              isPrimaryGroup ? effect : undefined,
              { isNestedBatchGroup: true, suppressNotifications: options.suppressNotifications },
              [group],
            );
            const sent = sentResult !== false;
            if (sentResult === 'sent-history-failed') historyWriteFailed = true;
            onAttachmentGroupResult?.(groupIndex, sent);
            if (sent) {
              sentGroupCount += 1;
            } else {
              allSent = false;
              for (let pendingGroupIndex = groupIndex + 1; pendingGroupIndex < groups.length; pendingGroupIndex += 1) {
                onAttachmentGroupResult?.(pendingGroupIndex, false);
              }
              break;
            }
            allSent &&= sent;
          }

          if (sentGroupCount > 0) resetScheduleDateTime();
          if (allSent) {
            if (historyWriteFailed) {
              if (!options.suppressNotifications) {
                showNotification(t('schedule.historyWriteFailed'), 'warning', t('schedule.errorTitle'));
              }
              return 'sent-history-failed';
            } else {
              if (options.clearMessageOnSuccess !== false) setMessage('');
              draftSendAttemptRef.current = null;
              setSuccessPulse(true);
              setLastAction('sent');
              if (!options.suppressNotifications) {
                showNotification(t('schedule.messageSent'), 'success', t('schedule.sent'));
              }
              scheduleTimeout(() => setSuccessPulse(false), 1500);
              scheduleTimeout(() => setLastAction(null), 1500);
            }
          } else if (sentGroupCount > 0) {
            if (!options.suppressNotifications) {
              showNotification(t('schedule.partialAttachmentSend'), 'warning', t('schedule.sendFailedTitle'));
            }
          } else {
            if (!options.suppressNotifications) {
              showNotification(t('schedule.sendFailed'), 'error', t('schedule.sendFailedTitle'));
            }
          }

          return allSent;
        } finally {
          if (shouldManageBatchState) {
            publishingDraftLockRef.current = false;
            setPublishingDraft(false);
          }
        }
      }
    }
    const sendSilently = typeof silent === 'boolean' ? silent : false;
    if (!historyReady || (!text.trim() && attachments.length === 0)) return false;
    if (publishingDraftLockRef.current && !Array.isArray(silent) && !attachmentGroups && !isNestedBatchGroup) {
      return false;
    }

    publishingDraftLockRef.current = true;
    setPublishingDraft(true);
    const fingerprint = JSON.stringify([chat.id, text, attachments, entities, sendSilently, effect]);
    const unresolvedAttempt = upcomingStateRef.current.find((item) => (
      item.status === 'unknown'
      && JSON.stringify([
        item.chatId,
        item.text,
        item.attachments ?? [],
        item.entities ?? [],
        item.silent ?? false,
        item.effect,
      ]) === fingerprint
    ));
    if (unresolvedAttempt) {
      publishingDraftLockRef.current = false;
      setPublishingDraft(false);
      if (!options.suppressNotifications) {
        showNotification(t('schedule.sendResultUnknown'), 'warning', t('schedule.errorTitle'));
      }
      return false;
    }
    const restoredAttempt = upcomingStateRef.current.find((item) => (
      item.status === 'failed'
      && item.retryAction === 'send'
      && item.sendAttemptId
      && JSON.stringify([
        item.chatId,
        item.text,
        item.attachments ?? [],
        item.entities ?? [],
        item.silent ?? false,
        item.effect,
      ]) === fingerprint
    ));
    if (!draftSendAttemptRef.current || draftSendAttemptRef.current.fingerprint !== fingerprint) {
      draftSendAttemptRef.current = {
        fingerprint,
        id: restoredAttempt?.sendAttemptId ?? `${Date.now()}:${uid()}`,
        recordId: restoredAttempt?.id,
      };
    }
    const sendAttemptId = draftSendAttemptRef.current.id;
    const attemptRecordId = draftSendAttemptRef.current.recordId ?? uid();
    draftSendAttemptRef.current.recordId = attemptRecordId;
    const attemptedAt = new Date().toISOString();
    const sendingMessage: ScheduledMessage = {
      ...(restoredAttempt ?? {}),
      id: attemptRecordId,
      accountId,
      chatId: chat.id,
      chatName: chat.name,
      text,
      attachments,
      when: restoredAttempt?.when ?? attemptedAt,
      createdAt: restoredAttempt?.createdAt ?? attemptedAt,
      status: 'sending',
      lastAttemptAt: attemptedAt,
      lastError: undefined,
      lastErrorDetails: undefined,
      retryAction: 'send',
      sendAttemptId,
      entities,
      silent: sendSilently,
      effect,
    };
    const sendingUpcoming = [
      sendingMessage,
      ...upcomingStateRef.current.filter((item) => item.id !== attemptRecordId),
    ];
    upcomingStateRef.current = sendingUpcoming;
    setUpcoming(sendingUpcoming);
    let sendRequestStarted = false;

    try {
      if (!await persistScheduleHistoryAndWait(historyScope, 'upcoming', sendingUpcoming)) {
        throw new Error('The sending state could not be saved. Telegram was not contacted.');
      }
      await waitForTelegramAccount();
      sendRequestStarted = true;
      const result = await sendNow({
        action: 'send-now',
        chatId: chat.id,
        text,
        attachments,
        entities,
        silent: sendSilently,
        effect,
        accountId,
        sendAttemptId,
      });

      if (!result.success) {
        const errorDetails = normalizeTelegramBridgeError(result, 'publish', t('schedule.sendFailed'));
        throw Object.assign(new Error(errorDetails.message), { sendErrorDetails: errorDetails });
      }

      if (!isNestedBatchGroup) resetScheduleDateTime();
      const sentMessage: ScheduledMessage = {
        ...sendingMessage,
        status: 'sent',
        ...(result.sentAt ? { sentAt: result.sentAt } : { sentAt: new Date().toISOString() }),
        telegramMessageId: result.telegramMessageId,
        telegramMessageIds: result.telegramMessageIds,
        lastError: undefined,
        lastErrorDetails: undefined,
        retryAction: undefined,
      };
      const updatedSent = [sentMessage, ...sentStateRef.current.filter((item) => item.id !== sentMessage.id)];
      const nextUpcoming = upcomingStateRef.current.filter((item) => item.id !== attemptRecordId);
      sentStateRef.current = updatedSent;
      upcomingStateRef.current = nextUpcoming;
      setSent(updatedSent);
      setUpcoming(nextUpcoming);
      const historyWrite = persistScheduleHistoryAndWait(historyScope, 'snapshot', {
        upcoming: nextUpcoming,
        sent: updatedSent,
      });
      const historyPersisted = await historyWrite;
      if (!historyPersisted) {
        if (!isNestedBatchGroup && !options.suppressNotifications) {
          showNotification(t('schedule.historyWriteFailed'), 'warning', t('schedule.errorTitle'));
        }
        return 'sent-history-failed';
      }
      if (options.clearMessageOnSuccess !== false && !isNestedBatchGroup) setMessage('');
      draftSendAttemptRef.current = null;
      if (!isNestedBatchGroup) {
        setSuccessPulse(true);
        setLastAction('sent');
        if (!options.suppressNotifications) {
          showNotification(t('schedule.messageSent'), 'success', t('schedule.sent'));
        }
        scheduleTimeout(() => setSuccessPulse(false), 1500);
        scheduleTimeout(() => setLastAction(null), 1500);
      }
      return true;
    } catch (error) {
      if (refreshChatPermissions) void refreshChatPermissions(chat.id);
      const errorDetails = (error as { sendErrorDetails?: ReturnType<typeof normalizeTelegramBridgeError> }).sendErrorDetails
        ?? normalizeTelegramBridgeError(error, 'publish', t('schedule.networkSending'));
      const failedMessage: ScheduledMessage = {
        ...sendingMessage,
        status: sendRequestStarted ? 'unknown' : 'failed',
        lastError: errorDetails.message,
        lastErrorDetails: errorDetails,
        retryAction: sendRequestStarted ? undefined : 'send',
      };
      const failedUpcoming = upcomingStateRef.current.map((item) => item.id === attemptRecordId ? failedMessage : item);
      upcomingStateRef.current = failedUpcoming;
      setUpcoming(failedUpcoming);
      await persistScheduleHistoryAndWait(historyScope, 'upcoming', failedUpcoming);
      if (!isNestedBatchGroup && !options.suppressNotifications) {
        showNotification(
          sendRequestStarted ? t('schedule.sendResultUnknown') : errorDetails.message,
          sendRequestStarted ? 'warning' : 'error',
          t('schedule.sendFailedTitle'),
          errorDetails,
        );
      }
      return false;
    } finally {
      if (!isNestedBatchGroup) {
        publishingDraftLockRef.current = false;
        setPublishingDraft(false);
      }
    }
  }

  async function handleDeleteMessage(msg: ScheduledMessage, skipConfirmation = false) {
    if (!skipConfirmation && !await confirm({
      message: t('schedule.confirmDelete'),
      confirmLabel: t('common.remove'),
      cancelLabel: t('common.cancel'),
      destructive: true,
    })) return;

    if (msg.status !== 'sent') {
      const updatedUpcoming = upcomingStateRef.current.filter((item) => item.id !== msg.id);
      if (!await persistScheduleHistoryAndWait(historyScope, 'upcoming', updatedUpcoming)) {
        showNotification(t('schedule.historyWriteFailed'), 'warning', t('schedule.errorTitle'));
        return;
      }
      upcomingStateRef.current = updatedUpcoming;
      setUpcoming(updatedUpcoming);
    } else {
      const updatedSent = sentStateRef.current.filter((item) => item.id !== msg.id);
      if (!await persistScheduleHistoryAndWait(historyScope, 'sent', updatedSent)) {
        showNotification(t('schedule.historyWriteFailed'), 'warning', t('schedule.errorTitle'));
        return;
      }
      sentStateRef.current = updatedSent;
      setSent(updatedSent);
    }
  }

  async function handleClearSent() {
    if (!await persistScheduleHistoryAndWait(historyScope, 'sent', [])) {
      showNotification(t('schedule.historyWriteFailed'), 'warning', t('schedule.errorTitle'));
      return;
    }
    sentStateRef.current = [];
    setSent([]);

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
    historyReady,
    historyLoadError,
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
