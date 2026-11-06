import { Bell, CalendarDays, CheckCircle2, Clock, Lightbulb } from 'lucide-react';
import type { Locale, useLocale } from '@/lib/i18n';
import type { HistoryItem, PlannerReminderType } from './historyModel';

export type HistorySourceFilter = 'all' | 'workspace' | 'personal';
export type HistoryStatusFilter = 'scheduled' | 'sent' | 'drafts' | 'notes' | 'errors';
export type HistoryExportStatus = HistoryStatusFilter | 'all';
export type HistoryExportFormat = 'txt' | 'json';
export type HistoryTranslate = ReturnType<typeof useLocale>['t'];

function getAttachmentName(filePath: string, t: HistoryTranslate) {
  if (/^data:image\//i.test(filePath)) return t('history.image');
  return filePath.split(/[\\/]/).pop() || filePath;
}

function formatDateLabel(value: string, locale: Locale, t: HistoryTranslate) {
  const date = new Date(value);
  const today = new Date();
  const daysDiff = Math.round((new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 86400000);

  if (daysDiff === 0) return t('history.today');
  if (daysDiff === 1) return t('history.tomorrow');
  if (daysDiff === -1) return t('history.yesterday');

  return new Intl.DateTimeFormat(locale === 'ru' ? 'ru-RU' : 'en-US', {
    day: 'numeric',
    month: 'short',
  }).format(date);
}

export function getHistoryDayKey(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'unknown';
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export function getHistoryMonthKey(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${date.getMonth()}`;
}

export function formatHistoryMonthLabel(value: string, locale: Locale) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  return new Intl.DateTimeFormat(locale === 'ru' ? 'ru-RU' : 'en-US', {
    month: 'long',
    year: 'numeric',
  }).format(date);
}

export function formatHistoryDayLabel(value: string, locale: Locale, t: HistoryTranslate) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return t('history.noDate');

  const today = new Date();
  const todayKey = getHistoryDayKey(today.toISOString());
  const dateKey = getHistoryDayKey(value);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  if (dateKey === todayKey) return t('history.today');
  if (dateKey === getHistoryDayKey(yesterday.toISOString())) return t('history.yesterday');

  return new Intl.DateTimeFormat(locale === 'ru' ? 'ru-RU' : 'en-US', {
    day: 'numeric',
    month: 'long',
    ...(date.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' as const }),
  }).format(date);
}

export function isSavedMessagesRecord(record: HistoryItem) {
  if (record.source !== 'personal') return false;

  const chatName = record.original.kind === 'scheduled' ? record.original.message.chatName : '';
  const normalizedName = chatName.trim().toLocaleLowerCase();
  return normalizedName === 'saved messages' || normalizedName === 'сохранённые сообщения';
}

export function getPlannerReminderType(record: HistoryItem): PlannerReminderType | null {
  if (record.original.kind === 'planner-draft') return record.original.reminderType;
  if (record.original.kind === 'saved-planner-draft') return record.original.draft.reminderType;
  return null;
}

export function getPlannerReminderTypePresentation(type: PlannerReminderType, t: HistoryTranslate) {
  switch (type) {
    case 'task': return { Icon: CheckCircle2, label: t('quickplanner.reminderType.task') };
    case 'meeting': return { Icon: Clock, label: t('quickplanner.reminderType.meeting') };
    case 'reminder': return { Icon: Bell, label: t('quickplanner.reminderType.reminder') };
    case 'event': return { Icon: CalendarDays, label: t('quickplanner.reminderType.event') };
    case 'idea': return { Icon: Lightbulb, label: t('quickplanner.reminderType.idea') };
  }
}

export function matchesHistoryStatus(record: HistoryItem, filter: HistoryStatusFilter) {
  if (filter === 'errors') return record.status === 'failed';
  if (record.status === 'failed') return false;

  if (filter === 'notes') return isSavedMessagesRecord(record);

  if (filter === 'scheduled') {
    return record.status === 'scheduled'
      || record.status === 'sending'
      || record.status === 'unknown'
      || record.status === 'cancelled';
  }
  if (filter === 'sent') return record.status === 'sent';
  return record.status === 'draft';
}

export function getHistoryRecordCategory(record: HistoryItem): HistoryStatusFilter {
  if (record.status === 'failed') return 'errors';
  if (isSavedMessagesRecord(record)) return 'notes';
  if (record.status === 'sent') return 'sent';
  if (record.status === 'draft') return 'drafts';
  return 'scheduled';
}

export function formatHistoryCount(count: number, locale: Locale) {
  if (locale !== 'ru') return `${count} ${count === 1 ? 'record' : 'records'}`;

  const lastTwoDigits = count % 100;
  const lastDigit = count % 10;
  const label = lastTwoDigits >= 11 && lastTwoDigits <= 14
    ? 'записей'
    : lastDigit === 1
      ? 'запись'
      : lastDigit >= 2 && lastDigit <= 4
        ? 'записи'
        : 'записей';
  return `${count} ${label}`;
}

export function formatDisplayCount(count: number, locale: Locale) {
  return new Intl.NumberFormat(locale === 'ru' ? 'ru-RU' : 'en-US').format(count);
}

export function formatDraftCount(count: number, locale: Locale) {
  if (locale !== 'ru') return `${count} ${count === 1 ? 'draft' : 'drafts'}`;

  const lastTwoDigits = count % 100;
  const lastDigit = count % 10;
  const label = lastTwoDigits >= 11 && lastTwoDigits <= 14
    ? 'черновиков'
    : lastDigit === 1
      ? 'черновик'
      : lastDigit >= 2 && lastDigit <= 4
        ? 'черновика'
        : 'черновиков';
  return `${count} ${label}`;
}

export function scrollHistoryRecordIntoView(list: HTMLDivElement, record: HTMLElement) {
  const listBounds = list.getBoundingClientRect();
  const recordBounds = record.getBoundingClientRect();
  const scaleY = list.offsetHeight > 0 && listBounds.height > 0
    ? listBounds.height / list.offsetHeight
    : 1;
  const stickyDateHeading = list.querySelector<HTMLElement>('.history-date-sticky, .history-date-heading');
  const stickyDateHeight = stickyDateHeading?.getBoundingClientRect().height ?? 0;
  const visibleTop = listBounds.top + list.clientTop * scaleY + stickyDateHeight;
  const visibleBottom = listBounds.top + (list.clientTop + list.clientHeight) * scaleY;
  const recordHeight = recordBounds.height;
  const visibleHeight = list.clientHeight * scaleY;
  let nextScrollTop = list.scrollTop;

  if (recordHeight >= visibleHeight) {
    nextScrollTop += (recordBounds.bottom - visibleBottom) / scaleY;
  } else if (recordBounds.top < visibleTop) {
    nextScrollTop += (recordBounds.top - visibleTop) / scaleY;
  } else if (recordBounds.bottom > visibleBottom) {
    nextScrollTop += (recordBounds.bottom - visibleBottom) / scaleY;
  } else {
    return;
  }

  const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const options: ScrollToOptions = {
    top: Math.max(0, nextScrollTop),
    behavior: prefersReducedMotion ? 'auto' : 'smooth',
  };

  if (typeof list.scrollTo === 'function') list.scrollTo(options);
  else list.scrollTop = options.top ?? 0;
}

export function alignHistoryScroll(list: HTMLDivElement, element: HTMLElement) {
  scrollHistoryRecordIntoView(list, element);

  const realign = () => {
    if (element.isConnected) scrollHistoryRecordIntoView(list, element);
  };
  const onScrollEnd = () => {
    list.removeEventListener('scrollend', onScrollEnd);
    window.clearTimeout(retryId);
    realign();
  };
  const retryId = window.setTimeout(() => {
    list.removeEventListener('scrollend', onScrollEnd);
    realign();
  }, 260);
  list.addEventListener('scrollend', onScrollEnd);
  return () => {
    list.removeEventListener('scrollend', onScrollEnd);
    window.clearTimeout(retryId);
  };
}

export function formatTime(value: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale === 'ru' ? 'ru-RU' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function normalizeSearchText(value: string, locale: Locale) {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase(locale === 'ru' ? 'ru-RU' : 'en-US')
    .replace(/(\d{1,2})[.:](\d{2})/g, '$1:$2')
    .replace(/[.,/_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function getHistoryStatusLabel(status: HistoryItem['status'], t: HistoryTranslate) {
  if (status === 'scheduled') return t('history.statusScheduled');
  if (status === 'sending') return t('history.statusSending');
  if (status === 'sent') return t('history.statusSent');
  if (status === 'failed') return t('history.statusFailed');
  if (status === 'unknown') return t('history.statusUnknown');
  if (status === 'cancelled') return t('history.statusCancelled');
  return t('history.statusDraft');
}

export function formatAttachmentCount(count: number, locale: Locale) {
  if (locale !== 'ru') return `${count} ${count === 1 ? 'attachment' : 'attachments'}`;

  const lastTwoDigits = count % 100;
  const lastDigit = count % 10;
  const label = lastTwoDigits >= 11 && lastTwoDigits <= 14
    ? 'вложений'
    : lastDigit === 1
      ? 'вложение'
      : lastDigit >= 2 && lastDigit <= 4
        ? 'вложения'
        : 'вложений';
  return `${count} ${label}`;
}

export function getHistoryTimestamp(record: HistoryItem) {
  if (record.status === 'failed') return record.updatedAt || record.scheduledAt || record.sentAt || '';
  return record.scheduledAt || record.sentAt || record.updatedAt || '';
}

export function getHistoryOrderingTimestamp(record: HistoryItem, status: HistoryStatusFilter) {
  if (status === 'scheduled') return record.scheduledAt || record.updatedAt || '';
  return getHistoryTimestamp(record);
}

export function matchesHistoryQuery(record: HistoryItem, query: string, locale: Locale, t: HistoryTranslate) {
  const tokens = normalizeSearchText(query, locale).split(' ').filter(Boolean);
  if (tokens.length === 0) return true;

  const timestamp = getHistoryTimestamp(record);
  const date = new Date(timestamp);
  const reminderType = getPlannerReminderType(record);
  const searchableValues = [
    record.title,
    record.text,
    record.channelName,
    record.channelLabel,
    ...record.attachments.map((attachment) => getAttachmentName(attachment, t)),
    ...(reminderType ? [getPlannerReminderTypePresentation(reminderType, t).label] : []),
    record.source === 'workspace' ? t('history.sourceStudio') : t('history.sourcePersonal'),
    getHistoryStatusLabel(record.status, t),
    record.lastError ?? '',
    record.lastErrorDetails?.message ?? '',
    record.lastErrorDetails?.code ?? '',
    formatTime(timestamp, locale),
    formatDateLabel(timestamp, locale, t),
    new Intl.DateTimeFormat(locale === 'ru' ? 'ru-RU' : 'en-US', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date),
    timestamp,
  ].map((value) => normalizeSearchText(value, locale));

  return tokens.every((token) => searchableValues.some((value) => value.includes(token)));
}

export function getHistoryCategoryLabel(status: HistoryExportStatus, t: HistoryTranslate) {
  if (status === 'all') return t('history.allPosts');
  if (status === 'errors') return t('history.categoryErrors');
  if (status === 'scheduled') return t('history.categoryScheduled');
  if (status === 'sent') return t('history.categorySent');
  if (status === 'notes') return t('history.categoryNotes');
  return t('history.categoryDrafts');
}

function formatExportText(records: HistoryItem[], status: HistoryExportStatus, source: HistorySourceFilter, locale: Locale, t: HistoryTranslate) {
  const dateLocale = locale === 'ru' ? 'ru-RU' : 'en-US';
  const exportedAt = new Intl.DateTimeFormat(dateLocale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date());
  const entries = records.map((record, index) => {
    const timestamp = getHistoryTimestamp(record);
    const dateTime = timestamp && !Number.isNaN(new Date(timestamp).getTime())
      ? new Intl.DateTimeFormat(dateLocale, {
      dateStyle: 'medium',
      timeStyle: 'short',
      }).format(new Date(timestamp))
      : '—';
    const lines = [
      `${index + 1}. ${record.title}`,
      `${t('history.exportSource')}: ${record.source === 'workspace' ? t('history.sourceStudio') : t('history.sourcePersonal')}`,
      ...(record.channelName
        ? [`${t('history.exportChat')}: ${record.channelLabel ? `${record.channelName} (${record.channelLabel})` : record.channelName}`]
        : []),
      `${t('history.exportDateTime')}: ${dateTime}`,
      `${t('history.exportStatus')}: ${getHistoryStatusLabel(record.status, t)}`,
      '',
      `${t('history.exportText')}:`,
      record.text || '—',
    ];

    if (record.attachments.length) {
      lines.push('', `${t('history.exportAttachments')}:`, ...record.attachments.map((attachment) => `- ${getAttachmentName(attachment, t)}`));
    }

    if (record.lastError) lines.push('', `${t('history.exportError')}: ${record.lastError}`);
    if (record.silent) lines.push('', t('history.exportSilent'));
    if (record.effect) lines.push(`${t('history.exportEffect')}: ${record.effect}`);

    return lines.join('\n');
  });

  return [
    `XMSGi — ${getHistoryCategoryLabel(status, t)}`,
    `${t('history.exportSource')}: ${source === 'all' ? t('history.sourceAll') : source === 'workspace' ? t('history.sourceStudio') : t('history.sourcePersonal')}`,
    `${t('history.exportedAt')}: ${exportedAt}`,
    `${t('history.exportTotal')}: ${records.length}`,
    '',
    entries.join('\n\n----------------------------------------\n\n'),
    '',
  ].join('\n');
}

export function exportHistoryRecords(
  records: HistoryItem[],
  status: HistoryExportStatus,
  source: HistorySourceFilter,
  query: string,
  format: HistoryExportFormat,
  locale: Locale,
  t: HistoryTranslate,
  recordTitle?: string,
) {
  const payload = format === 'json'
    ? JSON.stringify({
      exportedAt: new Date().toISOString(),
      filters: { source, status, query: query.trim() },
      records,
    }, null, 2)
    : formatExportText(records, status, source, locale, t);
  const mimeType = format === 'json' ? 'application/json;charset=utf-8' : 'text/plain;charset=utf-8';
  const blob = new Blob([payload], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const date = new Date().toISOString().slice(0, 10);
  const category = status === 'scheduled' || status === 'sent' || status === 'notes' || status === 'errors' ? status : 'drafts';

  link.href = url;
  const recordName = recordTitle
    ? `-${Array.from(recordTitle).filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 0x20 && code !== 0x7f && !'<>:"|?*'.includes(character);
    }).join('').replace(/\//g, '').replace(/\\/g, '').trim().replace(/\s+/g, '-').replace(/[.]+$/g, '').slice(0, 80) || 'record'}`
    : '';
  link.download = `xmsgi-${category}${recordName}-${date}.${format}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
