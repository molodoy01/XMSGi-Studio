import type { RichTextEntity, ScheduledMessage } from '@/types';
import type { InlineKeyboardMarkup } from './inlineKeyboard';

export type PendingScheduleInput = Pick<
  ScheduledMessage,
  'chatId' | 'chatName' | 'text' | 'when' | 'createdAt'
> & {
  operationId: string;
  attachments?: string[];
  entities?: RichTextEntity[];
  replyMarkup?: InlineKeyboardMarkup;
};

export type TelegramScheduledMessage = {
  id: string | number;
  message: string;
  date: Date | number;
};

export type TelegramScheduleResult = {
  success: boolean;
  telegramMessageId?: string | number;
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

export function getScheduleDateTimeAfter(minutes: number, now = new Date()): { date: string; time: string } {
  const offset = Math.max(0, Math.floor(minutes));
  const requestedTime = now.getTime() + offset * 60_000;
  const scheduledAt = new Date(requestedTime);
  scheduledAt.setSeconds(0, 0);
  if (scheduledAt.getTime() <= requestedTime) scheduledAt.setMinutes(scheduledAt.getMinutes() + 1);

  return {
    date: `${scheduledAt.getFullYear()}-${String(scheduledAt.getMonth() + 1).padStart(2, '0')}-${String(scheduledAt.getDate()).padStart(2, '0')}`,
    time: `${String(scheduledAt.getHours()).padStart(2, '0')}:${String(scheduledAt.getMinutes()).padStart(2, '0')}`,
  };
}

export function isFutureSchedule(date: string, time: string, now = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    return false;
  }

  const scheduledAt = new Date(`${date}T${time}:00`);
  if (Number.isNaN(scheduledAt.getTime())) return false;

  const [year, month, day] = date.split('-').map(Number);
  const [hours, minutes] = time.split(':').map(Number);
  if (
    scheduledAt.getFullYear() !== year
    || scheduledAt.getMonth() !== month - 1
    || scheduledAt.getDate() !== day
    || scheduledAt.getHours() !== hours
    || scheduledAt.getMinutes() !== minutes
  ) {
    return false;
  }

  return scheduledAt.getTime() > now.getTime();
}

const russianWeekdays: Record<string, string> = {
  Mon: 'Пн',
  Tue: 'Вт',
  Wed: 'Ср',
  Thu: 'Чт',
  Fri: 'Пт',
  Sat: 'Сб',
  Sun: 'Вс',
};

const russianWeekdayLong: Record<string, string> = {
  Mon: 'понедельник',
  Tue: 'вторник',
  Wed: 'среду',
  Thu: 'четверг',
  Fri: 'пятницу',
  Sat: 'субботу',
  Sun: 'воскресенье',
};

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

function formatScheduleDate(value: Date, locale: 'en' | 'ru') {
  return new Intl.DateTimeFormat(locale === 'ru' ? 'ru-RU' : 'en-US', { day: 'numeric', month: 'short' })
    .format(value)
    .replace(/\s*г\.?$/, '');
}

function formatRepeatCount(value: number, locale: 'en' | 'ru') {
  const count = Math.max(1, Math.floor(value) || 1);
  if (locale === 'en') return `${count} ${count === 1 ? 'time' : 'times'}`;
  return `${count} ${count === 1 ? 'раз' : count >= 2 && count <= 4 ? 'раза' : 'раз'}`;
}

export function formatScheduleSummary(
  date: string,
  time: string,
  repeat: ScheduleRepeatOptions,
  locale: 'en' | 'ru' = 'ru',
): string {
  if (!date || !time || !/^\d{2}:\d{2}$/.test(time)) return '';

  const start = new Date(`${date}T${time}:00`);
  if (Number.isNaN(start.getTime())) return '';

  if (repeat.mode === 'none') {
    return locale === 'ru'
      ? `Запланировано: ${formatScheduleDate(start, locale)} · ${time}`
      : `Scheduled: ${formatScheduleDate(start, locale)} · ${time}`;
  }

  const selectedDays = repeat.days?.filter((day) => russianWeekdays[day]) ?? [];
  let recurrenceLabel = locale === 'ru' ? 'Каждый день' : 'Every day';
  if (repeat.mode === 'weekly' || repeat.mode === 'biweekly') {
    const formatWeekday = (day: string) => {
      if (locale === 'ru') return russianWeekdayLong[day];
      const weekdayIndex = weekdayNames.indexOf(day);
      return new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(new Date(Date.UTC(2023, 0, 1 + weekdayIndex)));
    };
    if (selectedDays.length === 1) {
      if (locale === 'ru') {
        recurrenceLabel = repeat.mode === 'biweekly'
          ? `Каждые 2 недели · ${formatWeekday(selectedDays[0])}`
          : `Каждый ${formatWeekday(selectedDays[0])}`;
      } else {
        recurrenceLabel = repeat.mode === 'biweekly'
          ? `Every other week · ${formatWeekday(selectedDays[0])}`
          : `Every ${formatWeekday(selectedDays[0])}`;
      }
    } else if (selectedDays.length > 1) {
      recurrenceLabel = selectedDays.map((day) => locale === 'ru' ? russianWeekdays[day] : formatWeekday(day)).join(', ');
    }
  } else if (repeat.mode === 'monthly') {
    recurrenceLabel = locale === 'ru' ? 'Каждый месяц' : 'Every month';
  }

  const occurrences = getScheduleOccurrences(start, repeat);
  const endDate = occurrences.length > 1
    ? locale === 'ru'
      ? ` · до ${formatScheduleDate(occurrences[occurrences.length - 1], locale)}`
      : ` · until ${formatScheduleDate(occurrences[occurrences.length - 1], locale)}`
    : '';
  return locale === 'ru'
    ? `Повтор: ${formatRepeatCount(repeat.occurrences, locale)} · ${recurrenceLabel} · ${time}${endDate}`
    : `Repeats: ${formatRepeatCount(repeat.occurrences, locale)} · ${recurrenceLabel} · ${time}${endDate}`;
}

export function createPendingSchedule(
  input: PendingScheduleInput
): ScheduledMessage {
  return {
    ...input,
    id: input.operationId,
    status: 'pending',
  };
}

export function applyScheduleResult(
  messages: ScheduledMessage[],
  operationId: string,
  result: TelegramScheduleResult
): ScheduledMessage[] {
  if (!result.success) {
    return messages.map((message) =>
      message.operationId === operationId
        ? { ...message, status: 'failed' }
        : message
    );
  }

  const telegramMessageId = result.telegramMessageId ?? result.id;

  return messages.map((message) =>
    message.operationId === operationId
      ? {
          ...message,
          status: result.confirmed ? 'confirmed' : 'scheduled',
          telegramMessageId,
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
