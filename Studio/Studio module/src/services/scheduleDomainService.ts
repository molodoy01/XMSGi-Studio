import type { RichTextEntity } from '../types';
import type { InlineKeyboardMarkup } from '../lib/inlineKeyboard';
import { getScheduleOccurrences, type ScheduleRepeatOptions } from '../lib/scheduling';

export type ScheduleDomainInput = {
  chatId: string;
  chatName: string;
  message: string;
  date: string;
  time: string;
  attachments?: string[];
  entities?: RichTextEntity[];
  replyMarkup?: InlineKeyboardMarkup;
  silent?: boolean;
  effect?: string;
  repeat?: ScheduleRepeatOptions;
};

export type ScheduleEntry = {
  id: string;
  chatId: string;
  chatName: string;
  text: string;
  when: string;
  createdAt: string;
  status: 'scheduled' | 'pending' | 'sent' | 'failed';
  attachments?: string[];
  entities?: RichTextEntity[];
  replyMarkup?: InlineKeyboardMarkup;
  silent?: boolean;
  effect?: string;
  operationId?: string;
};

function toLocalDateTimeString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export function createScheduledEntries(input: ScheduleDomainInput): ScheduleEntry[] {
  const baseDate = new Date(`${input.date}T${input.time}:00`);
  const occurrences = input.repeat && !Number.isNaN(baseDate.getTime())
    ? getScheduleOccurrences(baseDate, input.repeat)
    : [baseDate];

  return occurrences.map((occurrence, index) => ({
    id: crypto.randomUUID(),
    chatId: input.chatId,
    chatName: input.chatName,
    text: input.message,
    when: toLocalDateTimeString(occurrence),
    createdAt: new Date().toISOString(),
    status: 'scheduled',
    attachments: input.attachments?.filter(Boolean),
    entities: input.entities ?? [],
    replyMarkup: input.replyMarkup,
    silent: input.silent,
    effect: input.effect,
    operationId: `${input.chatId}:${Date.now()}:${index}`,
  }));
}
