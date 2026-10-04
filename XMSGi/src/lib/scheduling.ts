import type { RichTextEntity, ScheduledMessage } from '@/types';
import type { InlineKeyboardMarkup } from './inlineKeyboard';

export type PendingScheduleInput = Pick<
  ScheduledMessage,
  'accountId' | 'chatId' | 'chatName' | 'text' | 'when' | 'createdAt'
> & {
  operationId: string;
  attachments?: string[];
  entities?: RichTextEntity[];
  replyMarkup?: InlineKeyboardMarkup;
  silent?: boolean;
  effect?: string;
  operationIdentity?: string;
};

export type TelegramScheduledMessage = {
  id: string | number;
  message: string;
  date: Date | number;
};

export type TelegramScheduleResult = {
  success: boolean;
  telegramMessageId?: string | number;
  telegramMessageIds?: Array<string | number>;
  id?: string | number;
  confirmed?: boolean;
  error?: string;
};

export type ScheduleRepeatMode = 'none' | 'daily' | 'weekly' | 'biweekly' | 'monthly';

export type ScheduleRepeatOptions = {
  mode: ScheduleRepeatMode;
  days?: string[];
  occurrences: number;
};

export const MAX_SCHEDULE_OCCURRENCES = 15;

const weekdayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function startOfDay(value: Date) {
  const result = new Date(value);
  result.setHours(0, 0, 0, 0);
  return result;
}

function getMonday(value: Date) {
  const result = startOfDay(value);
  const day = result.getDay();
  result.setDate(result.getDate() - (day === 0 ? 6 : day - 1));
  return result;
}

function addMonths(value: Date, months: number) {
  const result = new Date(value);
  const day = result.getDate();
  result.setDate(1);
  result.setMonth(result.getMonth() + months);
  const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(day, lastDay));
  return result;
}

export function getScheduleOccurrences(
  start: Date,
  options: ScheduleRepeatOptions
): Date[] {
  const count = Math.max(1, Math.min(MAX_SCHEDULE_OCCURRENCES, Math.floor(options.occurrences) || 1));
  if (options.mode === 'none' || count === 1) return [new Date(start)];

  const occurrences = [new Date(start)];

  if (options.mode === 'daily') {
    for (let index = 1; index < count; index += 1) {
      const next = new Date(start);
      next.setDate(next.getDate() + index);
      occurrences.push(next);
    }
    return occurrences;
  }

  if (options.mode === 'monthly') {
    for (let index = 1; index < count; index += 1) {
      occurrences.push(addMonths(start, index));
    }
    return occurrences;
  }

  const intervalWeeks = options.mode === 'biweekly' ? 2 : 1;
  const selectedDays = new Set(
    (options.days?.length ? options.days : [weekdayNames[start.getDay()]]),
  );
  const startWeek = getMonday(start);
  const cursor = new Date(start);
  cursor.setDate(cursor.getDate() + 1);

  for (let guard = 0; occurrences.length < count && guard < 370; guard += 1) {
    const weekDifference = Math.round(
      (getMonday(cursor).getTime() - startWeek.getTime()) / 86400000,
    ) / 7;

    if (weekDifference % intervalWeeks === 0 && selectedDays.has(weekdayNames[cursor.getDay()])) {
      occurrences.push(new Date(cursor));
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return occurrences;
}

export function createPendingSchedule(
  input: PendingScheduleInput
): ScheduledMessage {
  return {
    ...input,
    id: input.operationId,
    status: 'sending',
    retryAction: 'schedule',
  };
}

export function applyScheduleResult(
  messages: ScheduledMessage[],
  operationId: string,
  result: TelegramScheduleResult
): ScheduledMessage[] {
  if (!result.success) {
    return messages.map((message) => message.operationId === operationId
      ? (() => {
        const telegramMessageIds = result.telegramMessageIds ?? message.telegramMessageIds;
        const telegramMessageId = result.telegramMessageId
          ?? result.id
          ?? telegramMessageIds?.[0]
          ?? message.telegramMessageId;
        return {
          ...message,
          ...(telegramMessageId !== undefined ? { telegramMessageId } : {}),
          ...(telegramMessageIds ? { telegramMessageIds } : {}),
          status: 'failed' as const,
          lastError: result.error || 'Telegram did not confirm that this schedule was saved.',
          retryAction: telegramMessageIds?.length ? 'cancel' as const : 'schedule' as const,
        };
      })()
      : message);
  }

  const telegramMessageId = result.telegramMessageId ?? result.id;

  return messages.map((message) =>
    message.operationId === operationId
      ? {
          ...message,
          status: 'scheduled',
          telegramMessageId,
          telegramMessageIds: result.telegramMessageIds ?? (telegramMessageId === undefined ? undefined : [telegramMessageId]),
        }
      : message
  );
}

export function getPendingSchedules(
  messages: ScheduledMessage[]
): ScheduledMessage[] {
  return messages.filter((message) => message.status === 'pending');
}

export function findMatchingScheduledMessage(
  messages: TelegramScheduledMessage[],
  text: string,
  targetTimestamp: number,
  toleranceSeconds = 10
): TelegramScheduledMessage | undefined {
  return messages.find((message) => {
    const messageTimestamp = message.date instanceof Date
      ? Math.floor(message.date.getTime() / 1000)
      : Number(message.date);

    return (
      message.message === text &&
      Math.abs(messageTimestamp - targetTimestamp) <= toleranceSeconds
    );
  });
}
