import { useEffect, useRef, useState } from 'react';
import type { Chat, NotificationState, RichTextEntity, ScheduledMessage } from '@studio/types';
import { getScheduleDateTimeAfter, isFutureSchedule, type ScheduleRepeatOptions } from '@studio/lib/scheduling';
import { createScheduledEntries } from '@studio/services/scheduleDomainService';
import { publishToChannel, scheduleToChannel } from '@studio/services/publishingService';
import { telegramChannelAdapter } from '@studio/services/telegramChannelAdapter';
import { normalizeTelegramBridgeError } from '@shared/bridge';
import type { BridgeErrorDetails, BridgeValidationErrorDetails } from '@shared/bridge';

type SchedulePayload = {
  chatId: string;
  message: string;
  date: string;
  time: string;
  attachments?: string[];
  attachmentGroups?: string[][];
  entities?: unknown;
  effect?: string;
  waitForConfirmation?: boolean;
  replaceMessage?: ScheduledMessage;
};

type Options = {
  accountId: 'account-1' | 'account-2';
  chats: Chat[];
  selectedChat: Chat | null;
  showNotification: (message: string, type: NotificationState['type'], title: string, errorDetails?: BridgeErrorDetails) => void;
};

function makeMessage(chat: Chat, text: string, date: string, time: string, status: ScheduledMessage['status'], attachments?: string[]): ScheduledMessage {
  return {
    id: crypto.randomUUID(),
    chatId: chat.id,
    chatName: chat.name,
    text,
    when: `${date}T${time}:00`,
    createdAt: new Date().toISOString(),
    status,
    attachments: attachments?.filter(Boolean),
  };
}

function resolveAttachmentGroups(attachments: string[] = [], suppliedGroups?: string[][]) {
  const groups = suppliedGroups?.filter((group) => group.length > 0);
  return groups?.length ? groups : attachments.length > 0 ? [attachments] : [[]];
}

async function loadStudioScheduleHistory() {
  const result = await window.telegram.loadScheduleHistory('workspace');
  if (!result.success || !result.history) {
    throw new Error(result.error || 'Studio send history could not be loaded.');
  }
  return result.history;
}

async function saveStudioSendAttempt(attempt: ScheduledMessage) {
  const history = await loadStudioScheduleHistory();
  const existing = history.upcoming.filter((message) => message.sendAttemptId !== attempt.sendAttemptId);
  const result = await window.telegram.saveScheduleHistory({
    scope: 'workspace',
    field: 'upcoming',
    messages: [attempt, ...existing],
  });
  if (!result.success) {
    throw new Error(result.error || 'Studio send attempt could not be saved.');
  }
}

async function updateStudioSendAttempt(attempt: ScheduledMessage) {
  const history = await loadStudioScheduleHistory();
  const upcoming = history.upcoming.map((message) => (
    message.sendAttemptId === attempt.sendAttemptId ? attempt : message
  ));
  const result = await window.telegram.saveScheduleHistory({
    scope: 'workspace',
    field: 'upcoming',
    messages: upcoming,
  });
  if (!result.success) {
    throw new Error(result.error || 'Studio send result could not be saved.');
  }
}

function getDefaultScheduleDateTime() {
  const nextHour = new Date();
  nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0);
  const date = `${nextHour.getFullYear()}-${String(nextHour.getMonth() + 1).padStart(2, '0')}-${String(nextHour.getDate()).padStart(2, '0')}`;
  const time = `${String(nextHour.getHours()).padStart(2, '0')}:${String(nextHour.getMinutes()).padStart(2, '0')}`;
  return { date, time };
}

export function useStudioScheduler({ accountId, chats, selectedChat, showNotification }: Options) {
  const [defaultSchedule] = useState(getDefaultScheduleDateTime);
  const [date, setDate] = useState(defaultSchedule.date);
  const [time, setTime] = useState(defaultSchedule.time);
  const [upcoming, setUpcoming] = useState<ScheduledMessage[]>([]);
  const [sent, setSent] = useState<ScheduledMessage[]>([]);
  const [scheduling, setScheduling] = useState(false);
  const [publishingDraft, setPublishingDraft] = useState(false);
  const [successPulse, setSuccessPulse] = useState(false);
  const [lastAction, setLastAction] = useState<'sent' | 'scheduled' | null>(null);
  const [cancelingIds, setCancelingIds] = useState<Set<string>>(new Set());
  const [sendingIds, setSendingIds] = useState<Set<string>>(new Set());
  const hasLocalHistoryChangesRef = useRef(false);

  const resetScheduleDateTime = () => {
    const nextSchedule = getScheduleDateTimeAfter(0);
    setDate(nextSchedule.date);
    setTime(nextSchedule.time);
  };

  useEffect(() => {
    let cancelled = false;
    const loadHistory = async () => {
      if (typeof window === 'undefined' || typeof window.telegram?.loadScheduleHistory !== 'function') return;
      try {
        const history = await loadStudioScheduleHistory();
        if (cancelled || hasLocalHistoryChangesRef.current) return;
        setUpcoming(history.upcoming);
        setSent(history.sent);
      } catch (error) {
        if (!cancelled) {
          showNotification(
            error instanceof Error ? error.message : 'Studio send history could not be loaded.',
            'warning',
            'Studio',
          );
        }
      }
    };
    void loadHistory();
    return () => { cancelled = true; };
  }, [showNotification]);

  const handleCancelMessage = async (message: ScheduledMessage) => {
    if (cancelingIds.has(message.id)) return;
    if (message.telegramMessageId === undefined) {
      showNotification('Telegram schedule ID is missing; the message was not removed.', 'error', 'Studio');
      return;
    }

    setCancelingIds((current) => new Set(current).add(message.id));
    try {
      const result = await telegramChannelAdapter.cancelScheduled(message.chatId, message.telegramMessageId);
      if (!result.ok) {
        const errorDetails = result.errorDetails ?? normalizeTelegramBridgeError(result, 'cancel', 'Telegram could not cancel the scheduled message.');
        showNotification(errorDetails.message, 'error', 'Studio', errorDetails);
        return;
      }
      setUpcoming((current) => current.filter((item) => item.id !== message.id));
      showNotification('Scheduled message cancelled.', 'success', 'Studio');
    } catch (error) {
      const errorDetails = normalizeTelegramBridgeError(error, 'cancel', 'Telegram could not cancel the scheduled message.');
      showNotification(errorDetails.message, 'error', 'Studio', errorDetails);
    } finally {
      setCancelingIds((current) => {
        const next = new Set(current);
        next.delete(message.id);
        return next;
      });
    }
  };

  const handleSchedule = async (payload?: SchedulePayload, repeat?: ScheduleRepeatOptions) => {
    if (!payload || scheduling) return;
    if (!isFutureSchedule(payload.date, payload.time)) {
      const errorDetails: BridgeValidationErrorDetails = {
        operation: 'validate',
        category: 'validation',
        retryable: false,
        message: 'Дата и время должны быть в будущем.',
        code: 'SCHEDULE_NOT_IN_FUTURE',
      };
      showNotification(errorDetails.message, 'error', 'Studio', errorDetails);
      return;
    }
    const chat = chats.find((item) => item.id === payload.chatId) ?? selectedChat;
    if (!chat) return;

    const entities = Array.isArray(payload.entities)
      ? payload.entities as Array<{ type: 'bold' | 'italic' | 'underline' | 'strikethrough' | 'text_url' | 'code' | 'pre' | 'blockquote'; offset: number; length: number; url?: string; language?: string }>
      : [];
    const scheduledEntries = createScheduledEntries({
      chatId: chat.id,
      chatName: chat.name,
      message: payload.message,
      date: payload.date,
      time: payload.time,
      attachments: payload.attachments,
      entities,
      effect: payload.effect,
      repeat,
    });
    const attachmentGroups = resolveAttachmentGroups(payload.attachments ?? [], payload.attachmentGroups);
    setLastAction(null);
    setSuccessPulse(false);
    hasLocalHistoryChangesRef.current = true;
    setScheduling(true);

    const scheduledMessages: ScheduledMessage[] = [];
    const failures: BridgeErrorDetails[] = [];
    try {
      for (const entry of scheduledEntries) {
        for (const [groupIndex, attachmentGroup] of attachmentGroups.entries()) {
          const isPrimaryGroup = groupIndex === 0;
          const groupText = isPrimaryGroup ? entry.text : '';
          const groupEntities = isPrimaryGroup ? entry.entities : [];
          const { publishResult } = await scheduleToChannel({
            accountId,
            channelId: chat.id,
            body: groupText,
            entities: groupEntities,
            mediaIds: attachmentGroup,
            effect: isPrimaryGroup ? entry.effect : undefined,
            scheduleAt: new Date(entry.when).toISOString(),
          });
          if (!publishResult.ok) {
            failures.push(publishResult.errorDetails ?? normalizeTelegramBridgeError(publishResult, 'publish', 'Telegram could not schedule the message.'));
            continue;
          }

          scheduledMessages.push({
            ...makeMessage(chat, groupText, entry.when.slice(0, 10), entry.when.slice(11, 16), 'scheduled', attachmentGroup),
            id: attachmentGroups.length === 1 ? entry.id : `${entry.id}:group:${groupIndex}`,
            operationId: attachmentGroups.length === 1 ? entry.operationId : `${entry.operationId}:group:${groupIndex}`,
            createdAt: entry.createdAt,
            status: publishResult.confirmed ? 'confirmed' : 'scheduled',
            telegramMessageId: publishResult.messageId,
            entities: groupEntities,
            effect: isPrimaryGroup ? entry.effect : undefined,
          });
        }
      }
    } catch (error) {
      failures.push(normalizeTelegramBridgeError(error, 'publish', 'Telegram could not schedule the message.'));
    } finally {
      setScheduling(false);
    }

    if (scheduledMessages.length > 0) {
      setUpcoming((current) => [...scheduledMessages, ...current]);
      resetScheduleDateTime();
      setLastAction('scheduled');
      setSuccessPulse(true);
      showNotification(
        failures.length ? `${scheduledMessages.length} scheduled; ${failures.length} failed.` : 'Scheduled with Telegram.',
        failures.length ? 'warning' : 'success',
        'Studio',
        failures[0],
      );
      if (
        payload.replaceMessage
        && failures.length === 0
        && scheduledMessages.every((message) => message.status === 'confirmed')
      ) {
        await handleCancelMessage(payload.replaceMessage);
      }
    } else {
      const errorDetails = failures[0] ?? normalizeTelegramBridgeError(undefined, 'publish', 'Telegram could not schedule the message.');
      showNotification(errorDetails.message, 'error', 'Studio', errorDetails);
    }
  };

  const handleSendDraftNow = async (
    chat: Chat,
    text: string,
    attachments?: string[],
    entities?: unknown,
    suppliedAttachmentGroups?: string[][],
    onAttachmentGroupResult?: (groupIndex: number, sent: boolean) => void,
    effect?: string,
    suppressNotifications = false,
  ): Promise<boolean | 'sent-history-failed'> => {
    hasLocalHistoryChangesRef.current = true;
    setPublishingDraft(true);
    try {
      const attachmentGroups = resolveAttachmentGroups(attachments ?? [], suppliedAttachmentGroups);
      const formattedEntities = Array.isArray(entities)
        ? entities as RichTextEntity[]
        : [];
      const sentAt = new Date().toISOString();
      let historyPersistenceFailed = false;

      for (const [groupIndex, mediaIds] of attachmentGroups.entries()) {
        const isPrimaryGroup = groupIndex === 0;
        const sendAttemptId = `${Date.now()}:${crypto.randomUUID()}`;
        const attemptTime = new Date().toISOString();
        const sendingMessage: ScheduledMessage = {
          ...makeMessage(chat, isPrimaryGroup ? text : '', attemptTime.slice(0, 10), attemptTime.slice(11, 16), 'sending', mediaIds),
          id: sendAttemptId,
          accountId,
          when: attemptTime,
          createdAt: attemptTime,
          sendAttemptId,
          lastAttemptAt: attemptTime,
          retryAction: 'send',
          entities: isPrimaryGroup ? formattedEntities : [],
          effect: isPrimaryGroup ? effect : undefined,
        };

        try {
          await saveStudioSendAttempt(sendingMessage);
        } catch (error) {
          onAttachmentGroupResult?.(groupIndex, false);
          for (let pendingGroupIndex = groupIndex + 1; pendingGroupIndex < attachmentGroups.length; pendingGroupIndex += 1) {
            onAttachmentGroupResult?.(pendingGroupIndex, false);
          }
          if (!suppressNotifications) {
            showNotification(
              error instanceof Error ? error.message : 'Send attempt could not be saved. Telegram was not contacted.',
              'error',
              'Studio',
            );
          }
          return false;
        }
        setUpcoming((current) => [sendingMessage, ...current.filter((message) => message.sendAttemptId !== sendAttemptId)]);

        let publishResult;
        try {
          ({ publishResult } = await publishToChannel({
            accountId,
            channelId: chat.id,
            sendAttemptId,
            body: isPrimaryGroup ? text : '',
            entities: isPrimaryGroup ? formattedEntities : [],
            mediaIds,
            effect: isPrimaryGroup ? effect : undefined,
          }));
        } catch (error) {
          publishResult = {
            ok: false as const,
            provider: 'telegram' as const,
            errorDetails: normalizeTelegramBridgeError(error, 'publish', 'Telegram send result is unknown.'),
            error: error instanceof Error ? error.message : 'Telegram send result is unknown.',
          };
        }

        if (!publishResult.ok) {
          const errorDetails = publishResult.errorDetails ?? normalizeTelegramBridgeError(publishResult, 'publish', 'Telegram could not send the message.');
          const definitelyRejected = ['auth', 'permission', 'flood', 'slowmode'].includes(errorDetails.category ?? '');
          const failedMessage: ScheduledMessage = {
            ...sendingMessage,
            status: definitelyRejected ? 'failed' : 'unknown',
            lastError: errorDetails.message,
            retryAction: definitelyRejected ? 'send' : undefined,
          };
          try {
            await updateStudioSendAttempt(failedMessage);
            setUpcoming((current) => current.map((message) => (
              message.sendAttemptId === sendAttemptId ? failedMessage : message
            )));
          } catch (error) {
            historyPersistenceFailed = true;
            if (!suppressNotifications) {
              showNotification(
                error instanceof Error ? error.message : 'Send result could not be saved.',
                'warning',
                'Studio',
              );
            }
          }
          onAttachmentGroupResult?.(groupIndex, false);
          for (let pendingGroupIndex = groupIndex + 1; pendingGroupIndex < attachmentGroups.length; pendingGroupIndex += 1) {
            onAttachmentGroupResult?.(pendingGroupIndex, false);
          }
          if (!suppressNotifications) {
            showNotification(
              definitelyRejected ? errorDetails.message : 'Telegram send result is unknown. Do not retry this message.',
              definitelyRejected ? 'error' : 'warning',
              'Studio',
              errorDetails,
            );
          }
          return false;
        }

        const sentMessage: ScheduledMessage = {
          ...sendingMessage,
          status: 'sent',
          sentAt: publishResult.sentAt ?? sentAt,
          telegramMessageId: publishResult.messageId,
          telegramMessageIds: publishResult.messageIds,
          lastError: undefined,
          retryAction: undefined,
        };
        const historyPersisted = publishResult.historyPersisted === true;
        if (!historyPersisted) historyPersistenceFailed = true;
        resetScheduleDateTime();
        setUpcoming((current) => current.filter((message) => message.sendAttemptId !== sendAttemptId));
        setSent((current) => [sentMessage, ...current.filter((message) => message.sendAttemptId !== sendAttemptId)]);
        onAttachmentGroupResult?.(groupIndex, true);
      }

      setLastAction('sent');
      setSuccessPulse(true);
      if (historyPersistenceFailed) {
        if (!suppressNotifications) {
          showNotification(
            'Telegram sent the message, but its history could not be saved. Do not retry this message.',
            'warning',
            'Studio',
          );
        }
        return 'sent-history-failed';
      }
      if (!suppressNotifications) {
        showNotification('Message sent through Telegram.', 'success', 'Studio');
      }
      return true;
    } catch (error) {
      const errorDetails = normalizeTelegramBridgeError(error, 'publish', 'Telegram could not send the message.');
      if (!suppressNotifications) {
        showNotification(errorDetails.message, 'error', 'Studio', errorDetails);
      }
      return false;
    } finally {
      setPublishingDraft(false);
    }
  };

  const handleSendNow = async (message: ScheduledMessage) => {
    hasLocalHistoryChangesRef.current = true;
    setSendingIds((current) => new Set(current).add(message.id));
    let failureDetails: BridgeErrorDetails | undefined;
    let failedOperation: 'publish' | 'cancel' = 'publish';
    try {
      if (message.telegramMessageId !== undefined) {
        failedOperation = 'cancel';
        const cancelled = await telegramChannelAdapter.cancelScheduled(message.chatId, message.telegramMessageId);
        if (!cancelled.ok) {
          failureDetails = cancelled.errorDetails ?? normalizeTelegramBridgeError(cancelled, 'cancel', 'Telegram could not cancel the scheduled message.');
          throw new Error(failureDetails.message);
        }
      }

      failedOperation = 'publish';
      const { publishResult } = await publishToChannel({
        accountId,
        channelId: message.chatId,
        body: message.text,
        entities: message.entities,
        mediaIds: message.attachments,
        effect: message.effect,
      });
      if (!publishResult.ok) {
        failureDetails = publishResult.errorDetails ?? normalizeTelegramBridgeError(publishResult, 'publish', 'Telegram could not send the message.');
        throw new Error(failureDetails.message);
      }

      setUpcoming((current) => current.filter((item) => item.id !== message.id));
      setSent((current) => [{ ...message, status: 'sent', sentAt: new Date().toISOString() }, ...current]);
      resetScheduleDateTime();
    } catch (error) {
      const errorDetails = failureDetails ?? normalizeTelegramBridgeError(
        error,
        failedOperation,
        failedOperation === 'cancel' ? 'Telegram could not cancel the scheduled message.' : 'Telegram could not send the message.',
      );
      showNotification(errorDetails.message, 'error', 'Studio', errorDetails);
    } finally {
      setSendingIds((current) => {
        const next = new Set(current);
        next.delete(message.id);
        return next;
      });
    }
  };

  const handleDeleteMessage = (message: ScheduledMessage) => {
    hasLocalHistoryChangesRef.current = true;
    setUpcoming((current) => current.filter((item) => item.id !== message.id));
    setSent((current) => current.filter((item) => item.id !== message.id));
  };
  const handleClearSent = () => {
    hasLocalHistoryChangesRef.current = true;
    setSent([]);
  };

  useEffect(() => {
    if (!successPulse) return;
    const timeoutId = window.setTimeout(() => setSuccessPulse(false), 2200);
    return () => window.clearTimeout(timeoutId);
  }, [successPulse]);

  return {
    date,
    setDate,
    time,
    setTime,
    upcoming,
    sent,
    scheduling,
    publishingDraft,
    successPulse,
    lastAction,
    cancelingIds,
    sendingIds,
    revealingId: null,
    handleSchedule,
    handleSendDraftNow,
    handleSendNow,
    handleDeleteMessage,
    handleClearSent,
    handleCancelMessage,
  };
}