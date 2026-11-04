import { Fragment, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Bell, CalendarDays, CalendarOff, Check, CheckCircle2, ChevronDown, Clock, Copy, Download, Ellipsis, ExternalLink, Eye, FileText, Lightbulb, Maximize2, Minimize2, Paperclip, Plus, Search, Send, Trash2, X } from 'lucide-react';
import { InlineKeyboardPreview } from '@/components/InlineKeyboardPreview';
import { richTextToHtml } from '@/lib/richText';
import { useLocale, type Locale } from '@/lib/i18n';
import { telegramGetChatHistory } from '@/services/chatAppService';
import type { PreviewChatHistory } from '@studio/types';
import { ChatPreviewHistory } from '@studio/components/ChatPreviewHistory';
import { getDraftStorageApi, SAVED_STUDIO_DRAFTS_UPDATED_EVENT } from '@studio/lib/draftStore';
import { normalizePersistedStudioDrafts, sortHistoryItems } from './historyModel';
import { groupHistory } from '@studio/components/chatPreviewHistoryUtils';
import { QuickPlannerNavigationContext } from './QuickPlannerNavigationContext';
import type { HistoryItem, PlannerReminderType } from './historyModel';

type HistorySourceFilter = 'all' | 'workspace' | 'personal';
type HistoryBulkActionSource = HistorySourceFilter;
type HistoryStatusFilter = 'scheduled' | 'sent' | 'drafts' | 'notes';
type HistoryExportStatus = HistoryStatusFilter | 'all';
type HistoryExportFormat = 'txt' | 'json';
type HistoryTranslate = ReturnType<typeof useLocale>['t'];
const HISTORY_FILTER_STORAGE_KEY = 'xmsgi-history-filters';

function loadSavedHistoryFilters() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(HISTORY_FILTER_STORAGE_KEY) || 'null') as {
      sourceFilter?: unknown;
      sourceFilterPinned?: unknown;
      statusFilter?: unknown;
    } | null;
    const sourceFilter: HistorySourceFilter = saved?.sourceFilter === 'workspace' || saved?.sourceFilter === 'personal'
      ? saved.sourceFilter
      : 'all';
    const storedStatus = saved?.statusFilter;
    const statusFilter: HistoryStatusFilter = storedStatus === 'sent' || storedStatus === 'drafts' || storedStatus === 'notes'
      ? storedStatus
      : 'scheduled';
    const sourceFilterPinned = saved?.sourceFilterPinned === true
      || (saved?.sourceFilterPinned !== false && (sourceFilter === 'workspace' || sourceFilter === 'personal'));

    return {
      sourceFilter,
      sourceFilterPinned,
      statusFilter: statusFilter === 'notes' ? 'scheduled' : statusFilter,
    };
  } catch {
    return { sourceFilter: 'all' as const, sourceFilterPinned: false, statusFilter: 'scheduled' as const };
  }
}

function toAttachmentUrl(filePath: string) {
  if (/^(?:data:|https?:|file:)/i.test(filePath)) return filePath;
  const normalizedPath = filePath.replace(/\\/g, '/');
  const encodedPath = normalizedPath
    .split('/')
    .map((segment, index) => (index === 0 ? segment : encodeURIComponent(segment)))
    .join('/');
  return `file:///${encodedPath}`;
}

function isImageAttachment(filePath: string) {
  return /^data:image\//i.test(filePath) || /\.(?:avif|gif|jpe?g|png|webp)$/i.test(filePath);
}

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

function getHistoryDayKey(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'unknown';
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function formatHistoryDayLabel(value: string, locale: Locale, t: HistoryTranslate) {
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

function isSavedMessagesRecord(record: HistoryItem) {
  if (record.source !== 'personal') return false;

  const chatName = record.original.kind === 'scheduled' ? record.original.message.chatName : '';
  const normalizedName = chatName.trim().toLocaleLowerCase();
  return normalizedName === 'saved messages' || normalizedName === 'сохранённые сообщения';
}

function getPlannerReminderType(record: HistoryItem): PlannerReminderType | null {
  if (record.original.kind === 'planner-draft') return record.original.reminderType;
  if (record.original.kind === 'saved-planner-draft') return record.original.draft.reminderType;
  return null;
}

function getPlannerReminderTypePresentation(type: PlannerReminderType, t: HistoryTranslate) {
  switch (type) {
    case 'task': return { Icon: CheckCircle2, label: t('quickplanner.reminderType.task') };
    case 'meeting': return { Icon: Clock, label: t('quickplanner.reminderType.meeting') };
    case 'reminder': return { Icon: Bell, label: t('quickplanner.reminderType.reminder') };
    case 'event': return { Icon: CalendarDays, label: t('quickplanner.reminderType.event') };
    case 'idea': return { Icon: Lightbulb, label: t('quickplanner.reminderType.idea') };
  }
}

function matchesHistoryStatus(record: HistoryItem, filter: HistoryStatusFilter) {
  if (record.status === 'failed') return filter === 'scheduled';

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

function getHistoryRecordCategory(record: HistoryItem): HistoryStatusFilter {
  if (record.status === 'failed') return 'scheduled';
  if (isSavedMessagesRecord(record)) return 'notes';
  if (record.status === 'sent') return 'sent';
  if (record.status === 'draft') return 'drafts';
  return 'scheduled';
}

function getVisibleHistoryError(message: string | undefined, t: HistoryTranslate) {
  if (!message) return '';
  if (/^(?:Error invoking remote method|Invalid IPC input:)/i.test(message)) {
    return t('history.statusFailed');
  }
  return message;
}

function getRetryActionLabel(record: HistoryItem, t: HistoryTranslate) {
  if (record.retryAction === 'cancel') return t('history.retryCancelAction');
  if (record.retryAction === 'schedule') return t('history.retrySchedule');
  return t('history.retrySend');
}

function isQueueCancellationCandidate(record: HistoryItem) {
  return record.original.kind === 'scheduled'
    && (record.status === 'scheduled' || (record.status === 'failed' && record.retryAction === 'cancel'))
    && record.original.message.telegramMessageId !== undefined
    && record.original.message.telegramMessageId !== null;
}

function isLocalScheduleFailure(record: HistoryItem) {
  return record.original.kind === 'scheduled'
    && record.status === 'failed'
    && record.retryAction === 'schedule'
    && record.original.message.telegramMessageId == null;
}

function formatHistoryCount(count: number, locale: Locale) {
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

function formatDisplayCount(count: number, locale: Locale) {
  return new Intl.NumberFormat(locale === 'ru' ? 'ru-RU' : 'en-US').format(count);
}

function formatDraftCount(count: number, locale: Locale) {
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

function scrollHistoryRecordIntoView(list: HTMLDivElement, record: HTMLElement) {
  const listBounds = list.getBoundingClientRect();
  const recordBounds = record.getBoundingClientRect();
  const scaleY = list.offsetHeight > 0 && listBounds.height > 0
    ? listBounds.height / list.offsetHeight
    : 1;
  const stickyDateHeading = list.querySelector<HTMLElement>('.history-date-heading');
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

function alignHistoryScroll(list: HTMLDivElement, element: HTMLElement) {
  scrollHistoryRecordIntoView(list, element);

  // Smooth scrolling can be interrupted (native focus scroll, drawer layout),
  // leaving the menu half-hidden. Finish the alignment once scrolling settles.
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

function formatTime(value: string, locale: Locale) {
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

function getHistoryStatusLabel(status: HistoryItem['status'], t: HistoryTranslate) {
  if (status === 'scheduled') return t('history.statusScheduled');
  if (status === 'sending') return t('history.statusSending');
  if (status === 'sent') return t('history.statusSent');
  if (status === 'failed') return t('history.statusFailed');
  if (status === 'unknown') return t('history.statusUnknown');
  if (status === 'cancelled') return t('history.statusCancelled');
  return t('history.statusDraft');
}

function formatAttachmentCount(count: number, locale: Locale) {
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

function getHistoryTimestamp(record: HistoryItem) {
  return record.scheduledAt || record.sentAt || record.updatedAt || '';
}

function getHistoryOrderingTimestamp(record: HistoryItem, status: HistoryStatusFilter) {
  if (status === 'scheduled') return record.updatedAt || record.scheduledAt || '';
  return getHistoryTimestamp(record);
}

function matchesHistoryQuery(record: HistoryItem, query: string, locale: Locale, t: HistoryTranslate) {
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
    formatTime(timestamp, locale),
    formatDateLabel(timestamp, locale, t),
    new Intl.DateTimeFormat(locale === 'ru' ? 'ru-RU' : 'en-US', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date),
    timestamp,
  ].map((value) => normalizeSearchText(value, locale));

  return tokens.every((token) => searchableValues.some((value) => value.includes(token)));
}

function getHistoryCategoryLabel(status: HistoryExportStatus, t: HistoryTranslate) {
  if (status === 'all') return t('history.allPosts');
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

function exportHistoryRecords(
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
  const category = status === 'scheduled' ? 'scheduled' : status === 'sent' ? 'sent' : status === 'notes' ? 'notes' : 'drafts';

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

export function HistoryDrawer({
  isOpen,
  pageMode = false,
  sourceFilterOnOpen,
  sourceFilterOnOpenMode = 'temporary',
  statusFilterOnOpen,
  onClose,
  records,
  onCancel,
  onReschedule,
  onSendNow,
  onDelete,
  onOpenDraft,
  onUseDraft,
  draftDestination = 'studio',
  onClearSent,
  onClearDrafts,
  onCancelQueue,
}: {
  isOpen: boolean;
  pageMode?: boolean;
  sourceFilterOnOpen?: HistorySourceFilter;
  sourceFilterOnOpenMode?: 'initial' | 'temporary';
  statusFilterOnOpen?: Exclude<HistoryStatusFilter, 'notes'>;
  onClose: (restorePreviousView?: boolean) => void;
  records: HistoryItem[];
  onCancel: (record: HistoryItem) => void;
  onReschedule: (record: HistoryItem) => void;
  onSendNow: (record: HistoryItem) => void;
  onDelete: (record: HistoryItem) => void | Promise<boolean>;
  onOpenDraft: (record: HistoryItem) => void;
  onUseDraft?: (record: HistoryItem, destination?: 'planner' | 'studio') => boolean | void | Promise<boolean | void>;
  draftDestination?: 'planner' | 'studio';
  onClearSent: (source: HistoryBulkActionSource) => void;
  onClearDrafts?: (source: HistoryBulkActionSource) => Promise<boolean>;
  onCancelQueue?: (records: HistoryItem[]) => Promise<boolean>;
}) {
  const { locale, t } = useLocale();
  const navigation = useContext(QuickPlannerNavigationContext);
  const [savedFilters] = useState(loadSavedHistoryFilters);
  const [sourceFilter, setSourceFilter] = useState<HistorySourceFilter>(savedFilters.sourceFilter);
  const [sourceFilterPinned, setSourceFilterPinned] = useState(savedFilters.sourceFilterPinned);
  const [statusFilter, setStatusFilter] = useState<HistoryStatusFilter>(savedFilters.statusFilter);
  const autoCategorySignatureRef = useRef('');
  const sourceFilterBeforeOverrideRef = useRef<HistorySourceFilter | null>(null);
  const sourceFilterOverrideChangedRef = useRef(false);
  const initialSourceAppliedRef = useRef(false);
  const statusFilterBeforeOverrideRef = useRef<HistoryStatusFilter | null>(null);
  const statusFilterOverrideChangedRef = useRef(false);
  const [query, setQuery] = useState('');
  const isGlobalSearch = Boolean(query.trim());
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const [isSourceMenuOpen, setIsSourceMenuOpen] = useState(false);
  const [sourceMenuPosition, setSourceMenuPosition] = useState({ top: 0, left: 0 });
  const [selectedRecord, setSelectedRecord] = useState<HistoryItem | null>(null);
  const [draftItems, setDraftItems] = useState<HistoryItem[]>([]);
  const [confirmAction, setConfirmAction] = useState<{ type: 'cancel' | 'delete' | 'send-now'; recordId: string } | null>(null);
  const [bulkDeleteCategory, setBulkDeleteCategory] = useState<'scheduled' | 'sent' | 'drafts' | 'notes' | null>(null);
  const [bulkDeleteRecordId, setBulkDeleteRecordId] = useState<string | null>(null);
  const [bulkDeleteBusy, setBulkDeleteBusy] = useState(false);
  const [bulkDeleteError, setBulkDeleteError] = useState('');
  const [actionMenuOpenId, setActionMenuOpenId] = useState<string | null>(null);
  const [detailActionMenuOpen, setDetailActionMenuOpen] = useState(false);
  const [detailPreviewMode, setDetailPreviewMode] = useState<'details' | 'preview' | 'chat'>('details');
  const [chatPreviewHistory, setChatPreviewHistory] = useState<PreviewChatHistory | null>(null);
  const [chatPreviewLoading, setChatPreviewLoading] = useState(false);
  const [chatPreviewError, setChatPreviewError] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<'copied' | 'failed' | null>(null);
  const [previewImagePath, setPreviewImagePath] = useState<string | null>(null);
  const [previewImagePosition, setPreviewImagePosition] = useState<{ left: number; top: number } | null>(null);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);
  const sourceMenuRef = useRef<HTMLDivElement | null>(null);
  const sourceMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const sourceMenuItemsRef = useRef<HTMLDivElement | null>(null);
  const statusFiltersRef = useRef<HTMLDivElement | null>(null);
  const historyRecordListRef = useRef<HTMLDivElement | null>(null);
  const historySearchInputRef = useRef<HTMLInputElement | null>(null);
  const expandedRecordRef = useRef<HTMLElement | null>(null);
  const detailBackButtonRef = useRef<HTMLButtonElement | null>(null);
  const actionMenuRef = useRef<HTMLDivElement | null>(null);
  const detailActionMenuRef = useRef<HTMLDivElement | null>(null);
  const detailPreviewRef = useRef<HTMLDivElement | null>(null);
  const preExpansionScrollTopRef = useRef<number | null>(null);
  const imageHoverTimerRef = useRef<number | null>(null);
  const chatPreviewRequestIdRef = useRef(0);

  useLayoutEffect(() => {
    if (isOpen && sourceFilterOnOpen && sourceFilterOnOpenMode === 'initial' && !initialSourceAppliedRef.current) {
      initialSourceAppliedRef.current = true;
      sourceFilterBeforeOverrideRef.current = null;
      sourceFilterOverrideChangedRef.current = false;
      setSourceFilter(sourceFilterOnOpen);
      setSourceFilterPinned(true);
      return;
    }

    if (isOpen && sourceFilterOnOpen && sourceFilterOnOpenMode === 'temporary' && !sourceFilterPinned && !sourceFilterOverrideChangedRef.current) {
      if (sourceFilterBeforeOverrideRef.current === null) {
        sourceFilterBeforeOverrideRef.current = sourceFilter;
        sourceFilterOverrideChangedRef.current = false;
      }
      setSourceFilter(sourceFilterOnOpen);
      return;
    }

    if (!isOpen && sourceFilterBeforeOverrideRef.current !== null) {
      const previousSourceFilter = sourceFilterBeforeOverrideRef.current;
      const sourceFilterWasChanged = sourceFilterOverrideChangedRef.current;
      sourceFilterBeforeOverrideRef.current = null;
      sourceFilterOverrideChangedRef.current = false;
      if (!sourceFilterWasChanged) setSourceFilter(previousSourceFilter);
    }
    if (!isOpen) initialSourceAppliedRef.current = false;
  }, [isOpen, sourceFilter, sourceFilterOnOpen, sourceFilterOnOpenMode, sourceFilterPinned]);

  useLayoutEffect(() => {
    if (isOpen && statusFilterOnOpen && !statusFilterOverrideChangedRef.current) {
      if (statusFilterBeforeOverrideRef.current === null) {
        statusFilterBeforeOverrideRef.current = statusFilter;
      }
      if (statusFilter !== statusFilterOnOpen) setStatusFilter(statusFilterOnOpen);
      return;
    }

    if (!isOpen && statusFilterBeforeOverrideRef.current !== null) {
      const previousStatusFilter = statusFilterBeforeOverrideRef.current;
      const statusFilterWasChanged = statusFilterOverrideChangedRef.current;
      statusFilterBeforeOverrideRef.current = null;
      statusFilterOverrideChangedRef.current = false;
      if (!statusFilterWasChanged) setStatusFilter(previousStatusFilter);
    }
  }, [isOpen, statusFilter, statusFilterOnOpen]);

  useLayoutEffect(() => {
    if (!isOpen || !isSourceMenuOpen) return;

    const updateSourceMenuPosition = () => {
      const anchor = sourceMenuButtonRef.current;
      if (!anchor) return;

      const anchorBounds = anchor.getBoundingClientRect();
      const menuBounds = sourceMenuItemsRef.current?.getBoundingClientRect();
      const menuWidth = menuBounds?.width || 160;
      const menuHeight = menuBounds?.height || 140;
      const horizontalPadding = 8;
      const left = Math.max(
        horizontalPadding,
        Math.min(anchorBounds.right - menuWidth, window.innerWidth - menuWidth - horizontalPadding),
      );
      const spaceBelow = window.innerHeight - anchorBounds.bottom;
      const top = spaceBelow >= menuHeight + 8 || spaceBelow >= anchorBounds.top
        ? anchorBounds.bottom + 6
        : Math.max(horizontalPadding, anchorBounds.top - menuHeight - 6);

      setSourceMenuPosition({ top, left });
    };

    updateSourceMenuPosition();
    window.addEventListener('resize', updateSourceMenuPosition);
    window.addEventListener('scroll', updateSourceMenuPosition, true);

    return () => {
      window.removeEventListener('resize', updateSourceMenuPosition);
      window.removeEventListener('scroll', updateSourceMenuPosition, true);
    };
  }, [isOpen, isSourceMenuOpen]);

  useEffect(() => {
    if (!isOpen) setIsSourceMenuOpen(false);
  }, [isOpen]);

  useEffect(() => {
    try {
      const savedSourceFilter = sourceFilterBeforeOverrideRef.current !== null && !sourceFilterOverrideChangedRef.current
        ? sourceFilterBeforeOverrideRef.current
        : sourceFilter;
      const savedStatusFilter = statusFilterBeforeOverrideRef.current !== null && !statusFilterOverrideChangedRef.current
        ? statusFilterBeforeOverrideRef.current
        : statusFilter;
      window.localStorage.setItem(HISTORY_FILTER_STORAGE_KEY, JSON.stringify({
        sourceFilter: savedSourceFilter,
        sourceFilterPinned,
        statusFilter: savedStatusFilter,
      }));
    } catch {
      // Keep history usable when local storage is unavailable.
    }
  }, [sourceFilter, sourceFilterPinned, statusFilter]);

  const historyItems = records;

  const openImagePreview = (target: HTMLElement, filePath: string) => {
    const bounds = target.getBoundingClientRect();
    setPreviewImagePosition({ left: bounds.left + bounds.width / 2, top: bounds.top - 12 });
    if (imageHoverTimerRef.current !== null) window.clearTimeout(imageHoverTimerRef.current);
    imageHoverTimerRef.current = window.setTimeout(() => {
      setPreviewImagePath(filePath);
      imageHoverTimerRef.current = null;
    }, 600);
  };

  const closeImagePreview = () => {
    if (imageHoverTimerRef.current !== null) {
      window.clearTimeout(imageHoverTimerRef.current);
      imageHoverTimerRef.current = null;
    }
    setPreviewImagePath(null);
    setPreviewImagePosition(null);
  };

  useEffect(() => {
    if (!isOpen) closeImagePreview();
    return () => {
      if (imageHoverTimerRef.current !== null) {
        window.clearTimeout(imageHoverTimerRef.current);
        imageHoverTimerRef.current = null;
      }
    };
  }, [isOpen]);

  const toggleExpandedRecord = (record: HistoryItem, isExpanded: boolean) => {
    if (isExpanded) {
      setSelectedRecord(null);
      return;
    }
    preExpansionScrollTopRef.current = historyRecordListRef.current?.scrollTop ?? null;
    setSelectedRecord(record);
  };

  const confirmSendNow = (record: HistoryItem) => {
    setConfirmAction({ type: 'send-now', recordId: record.id });
  };

  const applyHistoryDraft = (record: HistoryItem, destination?: 'planner' | 'studio') => {
    if (!onUseDraft) return;
    const result = onUseDraft(record, destination ?? draftDestination);
    void Promise.resolve(result).then((used) => {
      if (used === false) return;
      onClose(false);
    }).catch((error: unknown) => {
      console.error('Failed to use a draft from Posts.', error);
    });
  };

  const handleConfirmationKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Enter') return;
    if (event.target instanceof HTMLElement && event.target.closest('.history-record-confirmation-action.is-secondary')) return;

    const confirmButton = event.currentTarget.querySelector<HTMLButtonElement>(
      '.history-record-confirmation-action.is-primary:not(:disabled)',
    );
    if (!confirmButton) return;
    event.preventDefault();
    event.stopPropagation();
    confirmButton.click();
  };

  useLayoutEffect(() => {
    if (!isOpen) return;
    const list = historyRecordListRef.current;
    if (!selectedRecord) {
      if (list && preExpansionScrollTopRef.current !== null) {
        list.scrollTop = preExpansionScrollTopRef.current;
      }
      preExpansionScrollTopRef.current = null;
      return;
    }
    const expandedRecord = expandedRecordRef.current;
    if (list && expandedRecord) return alignHistoryScroll(list, expandedRecord);
  }, [isOpen, selectedRecord]);

  useLayoutEffect(() => {
    if (!isOpen || !pageMode) return;
    const list = historyRecordListRef.current;
    if (list) list.scrollTop = 0;
  }, [isOpen, pageMode, query, sourceFilter, statusFilter]);

  useLayoutEffect(() => {
    if (!isOpen || !actionMenuOpenId) return;
    const list = historyRecordListRef.current;
    const actionMenu = actionMenuRef.current;
    if (list && actionMenu) return alignHistoryScroll(list, actionMenu);
  }, [actionMenuOpenId, isOpen]);

  useEffect(() => {
    if (!isOpen || !selectedRecord) return;
    const list = historyRecordListRef.current;
    const expandedRecord = expandedRecordRef.current;
    if (!list || !expandedRecord || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(() => scrollHistoryRecordIntoView(list, expandedRecord));
    observer.observe(list);
    observer.observe(expandedRecord);
    return () => observer.disconnect();
  }, [isOpen, selectedRecord]);

  useEffect(() => {
    if (!isOpen || !pageMode || !selectedRecord || typeof window.matchMedia !== 'function') return;
    if (window.matchMedia('(max-width: 900px)').matches) detailBackButtonRef.current?.focus();
  }, [isOpen, pageMode, selectedRecord]);

  useEffect(() => {
    if (!isOpen) {
      setConfirmAction(null);
      setIsExportMenuOpen(false);
      setIsSourceMenuOpen(false);
      setActionMenuOpenId(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    let latestLoadId = 0;
    const draftStorage = getDraftStorageApi();

    const loadDrafts = async () => {
      const loadId = ++latestLoadId;
      if (!draftStorage) {
        if (active && loadId === latestLoadId) setDraftItems([]);
        return;
      }

      try {
        const result = await draftStorage.load();
        if (active && loadId === latestLoadId) {
          setDraftItems(result.success ? normalizePersistedStudioDrafts(result.store) : []);
        }
      } catch {
        if (active && loadId === latestLoadId) setDraftItems([]);
      }
    };

    const refreshDrafts = () => {
      void loadDrafts();
    };

    void loadDrafts();
    window.addEventListener(SAVED_STUDIO_DRAFTS_UPDATED_EVENT, refreshDrafts);
    return () => {
      active = false;
      window.removeEventListener(SAVED_STUDIO_DRAFTS_UPDATED_EVENT, refreshDrafts);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const focusSearch = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 'f') return;
      event.preventDefault();
      historySearchInputRef.current?.focus();
      historySearchInputRef.current?.select();
    };

    document.addEventListener('keydown', focusSearch);
    return () => document.removeEventListener('keydown', focusSearch);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;

      if (previewImagePath) {
        event.preventDefault();
        closeImagePreview();
      } else if (confirmAction) {
        event.preventDefault();
        setConfirmAction(null);
      } else if (bulkDeleteCategory && !bulkDeleteBusy) {
        event.preventDefault();
        setBulkDeleteCategory(null);
        setBulkDeleteRecordId(null);
        setBulkDeleteError('');
      } else if (isExportMenuOpen) {
        event.preventDefault();
        setIsExportMenuOpen(false);
      } else if (isSourceMenuOpen) {
        event.preventDefault();
        setIsSourceMenuOpen(false);
        sourceMenuButtonRef.current?.focus();
      } else if (detailActionMenuOpen) {
        event.preventDefault();
        setDetailActionMenuOpen(false);
      } else if (actionMenuOpenId) {
        event.preventDefault();
        setActionMenuOpenId(null);
      } else if (selectedRecord) {
        event.preventDefault();
        setSelectedRecord(null);
      } else if (!pageMode && !bulkDeleteBusy) {
        event.preventDefault();
        onClose();
      }
    };

    const previousOverflow = document.body.style.overflow;
    if (!pageMode) document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleEscape);

    return () => {
      if (!pageMode) document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleEscape);
    };
  }, [actionMenuOpenId, bulkDeleteBusy, bulkDeleteCategory, confirmAction, detailActionMenuOpen, isExportMenuOpen, isOpen, isSourceMenuOpen, onClose, pageMode, previewImagePath, selectedRecord]);

  useEffect(() => {
    if (!isOpen || !detailActionMenuOpen) return;

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!detailActionMenuRef.current?.contains(event.target as Node)) setDetailActionMenuOpen(false);
    };

    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeOnOutsideClick);
  }, [detailActionMenuOpen, isOpen]);

  useEffect(() => {
    if (!isOpen || !isExportMenuOpen) return;

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!exportMenuRef.current?.contains(event.target as Node)) setIsExportMenuOpen(false);
    };

    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
    };
  }, [isExportMenuOpen, isOpen]);

  useEffect(() => {
    if (!isOpen || !isSourceMenuOpen) return;

    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!sourceMenuRef.current?.contains(target) && !sourceMenuItemsRef.current?.contains(target)) {
        setIsSourceMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeOnOutsideClick);
  }, [isOpen, isSourceMenuOpen]);

  useEffect(() => {
    if (isSourceMenuOpen) {
      sourceMenuItemsRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    }
  }, [isSourceMenuOpen]);

  const filteredRecords = useMemo(() => {
    const isGlobalSearch = Boolean(query.trim());
    const categoryRecords = [...historyItems, ...draftItems]
      .filter((record) => {
        if (record.status === 'failed') return false;
        if (sourceFilter !== 'all' && record.source !== sourceFilter) return false;
        if (!isGlobalSearch && !matchesHistoryStatus(record, statusFilter)) return false;

        return matchesHistoryQuery(record, query, locale, t);
      });
    const sortedRecords = sortHistoryItems(categoryRecords, isGlobalSearch || statusFilter === 'notes' ? 'sent' : statusFilter);
    if (isGlobalSearch) {
      return sortedRecords.sort((left, right) => (
        (Date.parse(getHistoryTimestamp(right)) || 0) - (Date.parse(getHistoryTimestamp(left)) || 0)
      ));
    }
    if (sourceFilter !== 'all') return sortedRecords;

    return sortedRecords.sort((left, right) => {
      const leftTime = Date.parse(getHistoryOrderingTimestamp(left, statusFilter)) || 0;
      const rightTime = Date.parse(getHistoryOrderingTimestamp(right, statusFilter)) || 0;
      return rightTime - leftTime;
    });
  }, [draftItems, historyItems, locale, query, sourceFilter, statusFilter, t]);

  useEffect(() => {
    if (filteredRecords.length === 0) setIsExportMenuOpen(false);
  }, [filteredRecords.length]);

  useEffect(() => {
    if (selectedRecord && !filteredRecords.some((record) => record.id === selectedRecord.id)) {
      setSelectedRecord(null);
    }
  }, [filteredRecords, selectedRecord]);

  useEffect(() => {
    if (confirmAction && !filteredRecords.some((record) => record.id === confirmAction.recordId)) {
      setConfirmAction(null);
    }
  }, [confirmAction, filteredRecords]);

  const historyCounts = useMemo(() => {
    const counts = {
      total: 0,
      source: { all: 0, workspace: 0, personal: 0 },
      status: { scheduled: 0, sent: 0, drafts: 0, notes: 0 },
    };

    for (const record of [...historyItems, ...draftItems]) {
      if (record.status === 'failed') continue;
      counts.total += 1;

      counts.source.all += 1;
      counts.source[record.source] += 1;

      if (sourceFilter === 'all' || record.source === sourceFilter) {
        if (matchesHistoryStatus(record, 'scheduled')) counts.status.scheduled += 1;
        else if (matchesHistoryStatus(record, 'sent')) counts.status.sent += 1;
        else if (matchesHistoryStatus(record, 'drafts')) counts.status.drafts += 1;
        if (matchesHistoryStatus(record, 'notes')) counts.status.notes += 1;
      }
    }

    return counts;
  }, [draftItems, historyItems, sourceFilter]);
  const visibleStatusFilters: HistoryStatusFilter[] = ['scheduled', 'sent', 'drafts'];

  useEffect(() => {
    if (!pageMode) return;
    const signature = `${sourceFilter}:${historyCounts.status.scheduled}:${historyCounts.status.sent}:${historyCounts.status.drafts}`;
    if (autoCategorySignatureRef.current === signature) return;
    autoCategorySignatureRef.current = signature;
    if (historyCounts.status[statusFilter] > 0) return;

    const nextStatus = (['scheduled', 'sent', 'drafts'] as const)
      .find((status) => historyCounts.status[status] > 0);
    if (nextStatus) setStatusFilter(nextStatus);
  }, [historyCounts, pageMode, sourceFilter, statusFilter]);

  const selectedRecordIndex = selectedRecord
    ? filteredRecords.findIndex((record) => record.id === selectedRecord.id)
    : -1;
  const activeSelectedRecord = selectedRecordIndex >= 0 ? filteredRecords[selectedRecordIndex] : null;
  useEffect(() => {
    setDetailPreviewMode('details');
    setChatPreviewHistory(null);
    setChatPreviewLoading(false);
    setChatPreviewError(false);
    setDetailActionMenuOpen(false);
    setCopyFeedback(null);
    chatPreviewRequestIdRef.current += 1;
  }, [activeSelectedRecord?.id, isOpen]);

  useEffect(() => {
    if (!copyFeedback) return;
    const timeout = window.setTimeout(() => setCopyFeedback(null), 1600);
    return () => window.clearTimeout(timeout);
  }, [copyFeedback]);

  const openSelectedPreview = async () => {
    const record = activeSelectedRecord;
    if (!record) return;
    setDetailPreviewMode('preview');
    setChatPreviewHistory(null);
    setChatPreviewError(false);

    const message = record.original.kind === 'scheduled' ? record.original.message : null;
    if (!message) return;

    const requestId = ++chatPreviewRequestIdRef.current;
    const parsedMessageId = message.telegramMessageId == null ? null : Number(message.telegramMessageId);
    const offsetId = parsedMessageId !== null && Number.isSafeInteger(parsedMessageId) && parsedMessageId > 0
      ? parsedMessageId
      : undefined;
    setChatPreviewLoading(true);
    try {
      const result = await telegramGetChatHistory({
        chatId: message.chatId,
        limit: 12,
        ...(offsetId === undefined ? {} : { offsetId }),
      });
      if (requestId !== chatPreviewRequestIdRef.current) return;
      if (!result.success || !result.history) {
        setChatPreviewError(true);
        return;
      }
      setChatPreviewHistory(result.history);
      setDetailPreviewMode('chat');
    } catch (error) {
      console.error('Failed to load chat context for a Posts preview.', error);
      if (requestId === chatPreviewRequestIdRef.current) setChatPreviewError(true);
    } finally {
      if (requestId === chatPreviewRequestIdRef.current) setChatPreviewLoading(false);
    }
  };

  const copySelectedPost = async () => {
    if (!activeSelectedRecord) return;
    try {
      await navigator.clipboard.writeText(activeSelectedRecord.text);
      setCopyFeedback('copied');
    } catch (error) {
      console.error('Failed to copy post text from Posts.', error);
      setCopyFeedback('failed');
    }
  };

  const openChatPreviewPhoto = (photo: { src: string }) => {
    setPreviewImagePath(photo.src);
    setPreviewImagePosition({ left: window.innerWidth / 2, top: window.innerHeight / 2 });
  };

  const queueCancellableRecords = filteredRecords.filter((record) => (
    isQueueCancellationCandidate(record)
  ));
  const localScheduleFailureRecords = filteredRecords.filter(isLocalScheduleFailure);
  const scheduleCleanupCount = queueCancellableRecords.length + localScheduleFailureRecords.length;
  const scheduleCleanupLabel = queueCancellableRecords.length > 0 && localScheduleFailureRecords.length > 0
    ? t('history.cleanupAndCancel')
    : queueCancellableRecords.length > 0
      ? t('history.cancelCount', { count: formatHistoryCount(queueCancellableRecords.length, locale) })
      : t('history.deleteErrors', { count: localScheduleFailureRecords.length });
  const scheduleCleanupAriaLabel = queueCancellableRecords.length > 0 && localScheduleFailureRecords.length > 0
    ? t('history.cancelAndRemoveErrors')
    : queueCancellableRecords.length > 0
      ? t('history.cancelScheduled')
      : t('history.deleteScheduleErrors');
  const scheduleCleanupTitle = queueCancellableRecords.length > 0 && localScheduleFailureRecords.length > 0
    ? t('history.cancelAndRemoveErrors')
    : queueCancellableRecords.length > 0
      ? t('history.cancelScheduled')
      : t('history.deleteScheduleErrors');
  const visibleRecords = !pageMode && selectedRecordIndex >= 0
    ? filteredRecords.slice(0, selectedRecordIndex + 1)
    : filteredRecords;
  const selectedCategoryLabel = getHistoryCategoryLabel(statusFilter, t);
  const exportMenuScope = selectedRecord
    ? t('history.recordScope', { title: selectedRecord.title })
    : t('history.currentList');
  const exportMenuHeading = selectedRecord
    ? t('history.exporting', { scope: selectedRecord.title })
    : isGlobalSearch
      ? t('history.exportSearchResults')
      : t('history.exportCategory', { category: selectedCategoryLabel });
  const selectedRecordMatchesDeleteCategory = Boolean(selectedRecordIndex >= 0 && selectedRecord && (
    statusFilter === 'scheduled'
      ? isQueueCancellationCandidate(selectedRecord) || isLocalScheduleFailure(selectedRecord)
      : statusFilter === 'sent'
        ? selectedRecord.status === 'sent'
        : statusFilter === 'notes'
          ? matchesHistoryStatus(selectedRecord, 'notes')
          : selectedRecord.status === 'draft'
  ));
  const canDeleteCurrentCategory = (!isGlobalSearch || selectedRecordMatchesDeleteCategory) && (statusFilter === 'scheduled'
    ? scheduleCleanupCount > 0
    : (statusFilter === 'sent' || statusFilter === 'drafts' || statusFilter === 'notes') && historyCounts.status[statusFilter] > 0);
  const bulkDeleteRecord = bulkDeleteRecordId
    ? filteredRecords.find((record) => record.id === bulkDeleteRecordId) ?? null
    : null;
  const confirmActionRecord = confirmAction
    ? filteredRecords.find((record) => record.id === confirmAction.recordId) ?? null
    : null;
  const confirmActionPrompt = confirmAction && confirmActionRecord
    ? confirmAction.type === 'cancel'
      ? t('history.cancelSchedulePrompt', { title: confirmActionRecord.title })
      : confirmAction.type === 'send-now'
        ? t('history.sendPrompt', {
          action: confirmActionRecord.status === 'failed' ? getRetryActionLabel(confirmActionRecord, t) : t('history.sendAction'),
          title: confirmActionRecord.title,
        })
        : confirmActionRecord.status === 'failed'
          ? t('history.deleteFailedPrompt')
          : confirmActionRecord.status === 'draft'
            ? t('history.deleteDraftPrompt', { title: confirmActionRecord.title })
            : t('history.deleteRecordFromHistory', { title: confirmActionRecord.title })
    : '';
  const bulkDeleteCount = bulkDeleteRecord
    ? 1
    : bulkDeleteCategory === 'scheduled'
      ? scheduleCleanupCount
      : bulkDeleteCategory ? historyCounts.status[bulkDeleteCategory] : 0;
  const bulkDeletePrompt = bulkDeleteRecord
    ? bulkDeleteRecord.status === 'scheduled'
      ? t('history.cancelSchedulePrompt', { title: bulkDeleteRecord.title })
      : isLocalScheduleFailure(bulkDeleteRecord)
        ? t('history.deleteErrorRecordPrompt', { title: bulkDeleteRecord.title })
      : bulkDeleteRecord.status === 'failed' && bulkDeleteRecord.retryAction === 'cancel'
        ? t('history.retryCancelPrompt', { title: bulkDeleteRecord.title })
      : bulkDeleteRecord.status === 'sent'
        ? t('history.deleteRecordFromHistory', { title: bulkDeleteRecord.title })
        : t('history.deleteDraftPrompt', { title: bulkDeleteRecord.title })
    : bulkDeleteCategory === 'notes'
      ? t('history.deleteNotesPrompt', { count: formatHistoryCount(bulkDeleteCount, locale) })
      : bulkDeleteCategory === 'sent'
      ? t('history.deleteSentPrompt', { count: formatHistoryCount(bulkDeleteCount, locale) })
      : bulkDeleteCategory === 'drafts'
        ? t('history.deleteDraftsPrompt', { count: formatDraftCount(bulkDeleteCount, locale) })
        : queueCancellableRecords.length > 0 && localScheduleFailureRecords.length > 0
          ? t('history.cancelAndDeleteErrorsPrompt', {
            cancelCount: formatHistoryCount(queueCancellableRecords.length, locale),
            errorCount: localScheduleFailureRecords.length,
          })
          : queueCancellableRecords.length > 0
            ? t('history.cancelQueuePrompt', { count: formatHistoryCount(queueCancellableRecords.length, locale) })
            : t('history.deleteErrorsPrompt', { count: localScheduleFailureRecords.length });
  const bulkDeleteActionLabel = bulkDeleteRecord
    ? bulkDeleteRecord.status === 'scheduled'
      ? t('history.unscheduleAction')
      : isLocalScheduleFailure(bulkDeleteRecord)
        ? t('history.deleteErrorAction')
      : bulkDeleteRecord.status === 'failed' && bulkDeleteRecord.retryAction === 'cancel'
        ? t('history.retryCancelAction')
      : bulkDeleteRecord.status === 'draft' ? t('history.deleteDraftAction') : t('history.deleteRecordAction')
    : bulkDeleteCategory === 'scheduled'
      ? scheduleCleanupLabel
      : bulkDeleteCategory === 'notes'
        ? t('history.deleteNotesAction', { count: formatHistoryCount(bulkDeleteCount, locale) })
        : t('history.deleteCount', { count: bulkDeleteCategory === 'sent' ? formatHistoryCount(bulkDeleteCount, locale) : formatDraftCount(bulkDeleteCount, locale) });
  const exportRecords = (format: HistoryExportFormat) => {
    const recordsToExport = selectedRecord ? [selectedRecord] : filteredRecords;
    const exportStatus: HistoryExportStatus = selectedRecord
      ? selectedRecord.status === 'draft'
        ? 'drafts'
        : selectedRecord.status === 'sent'
          ? isSavedMessagesRecord(selectedRecord) ? 'notes' : 'sent'
          : 'scheduled'
      : isGlobalSearch ? 'all' : statusFilter;
    exportHistoryRecords(
      recordsToExport,
      exportStatus,
      selectedRecord?.source ?? sourceFilter,
      query,
      format,
      locale,
      t,
      selectedRecord?.title,
    );
    setIsExportMenuOpen(false);
  };
  const confirmCategoryDelete = async () => {
    if (!bulkDeleteCategory) return;
    setBulkDeleteBusy(true);
    setBulkDeleteError('');

    try {
      if (bulkDeleteRecord) {
        if (bulkDeleteCategory === 'notes'
          && bulkDeleteRecord.original.kind === 'scheduled'
          && bulkDeleteRecord.status === 'scheduled') {
          if (isQueueCancellationCandidate(bulkDeleteRecord)) {
            if (!onCancelQueue || !await onCancelQueue([bulkDeleteRecord])) {
              setBulkDeleteError(t('history.cancelFailed'));
              return;
            }
          } else {
            onCancel(bulkDeleteRecord);
          }
          setBulkDeleteRecordId(null);
          setBulkDeleteCategory(null);
          return;
        }

        if (bulkDeleteCategory === 'scheduled') {
          if (isLocalScheduleFailure(bulkDeleteRecord)) {
            await onDelete(bulkDeleteRecord);
            setSelectedRecord(null);
            setBulkDeleteRecordId(null);
            setBulkDeleteCategory(null);
            return;
          }
          if (!onCancelQueue || !await onCancelQueue([bulkDeleteRecord])) {
            setBulkDeleteError(t('history.cancelFailed'));
            return;
          }
          setSelectedRecord(null);
          setBulkDeleteRecordId(null);
          setBulkDeleteCategory(null);
          return;
        }

        const deletionResult = await onDelete(bulkDeleteRecord);
        if (bulkDeleteRecord.status === 'draft' && deletionResult !== true) {
          setBulkDeleteError(t('history.deleteDraftFailed'));
          return;
        }
        if (bulkDeleteCategory === 'notes'
          && bulkDeleteRecord.status === 'sent'
          && bulkDeleteRecord.original.kind === 'scheduled'
          && isSavedMessagesRecord(bulkDeleteRecord)
          && (bulkDeleteRecord.original.message.telegramMessageId != null
            || (bulkDeleteRecord.original.message.telegramMessageIds ?? []).some((id) => id != null))
          && deletionResult !== true) {
          setBulkDeleteError(t('history.deleteNoteFailed'));
          return;
        }
        if (bulkDeleteRecord.status === 'draft') {
          setDraftItems((current) => current.filter((record) => record.id !== bulkDeleteRecord.id));
        }
        setSelectedRecord(null);
        setBulkDeleteRecordId(null);
        setBulkDeleteCategory(null);
        return;
      }

      if (bulkDeleteCategory === 'scheduled') {
        for (const record of localScheduleFailureRecords) {
          await onDelete(record);
        }

        if (queueCancellableRecords.length > 0 && (!onCancelQueue || !await onCancelQueue(queueCancellableRecords))) {
          setBulkDeleteError(t(localScheduleFailureRecords.length > 0
            ? 'history.cancelPartialWithErrors'
            : 'history.cancelPartial'));
          return;
        }
        setBulkDeleteCategory(null);
        setBulkDeleteRecordId(null);
        return;
      }

      if (bulkDeleteCategory === 'sent') {
        onClearSent(sourceFilter);
        setBulkDeleteRecordId(null);
        setBulkDeleteCategory(null);
        return;
      }

      if (bulkDeleteCategory === 'notes') {
        const noteRecords = historyItems.filter((record) => matchesHistoryStatus(record, 'notes'));
        const failedRecords: HistoryItem[] = [];

        for (const record of noteRecords) {
          try {
            if (record.original.kind === 'scheduled' && record.status === 'scheduled') {
              if (isQueueCancellationCandidate(record)) {
                if (!onCancelQueue || !await onCancelQueue([record])) failedRecords.push(record);
              } else {
                onCancel(record);
              }
              continue;
            }

            const deletionResult = await onDelete(record);
            const requiresTelegramDelete = record.status === 'sent'
              && record.original.kind === 'scheduled'
              && isSavedMessagesRecord(record)
              && (record.original.message.telegramMessageId != null
                || (record.original.message.telegramMessageIds ?? []).some((id) => id != null));
            const succeeded = requiresTelegramDelete
              ? deletionResult === true
              : deletionResult !== false;
            if (!succeeded) failedRecords.push(record);
          } catch {
            failedRecords.push(record);
          }
        }

        setSelectedRecord(null);
        setBulkDeleteRecordId(null);
        if (failedRecords.length > 0) {
          setBulkDeleteError(t('history.deleteFailedCount', { count: formatHistoryCount(failedRecords.length, locale) }));
          return;
        }

        setBulkDeleteCategory(null);
        return;
      }

      if (!onClearDrafts || !await onClearDrafts(sourceFilter)) {
        setBulkDeleteError(t('history.deleteDraftsFailed'));
        return;
      }

      if (sourceFilter !== 'personal') setDraftItems([]);
      setSelectedRecord(null);
      setBulkDeleteRecordId(null);
      setBulkDeleteCategory(null);
    } catch (error) {
      setBulkDeleteError(error instanceof Error ? error.message : t('history.deleteCategoryFailed'));
    } finally {
      setBulkDeleteBusy(false);
    }
  };

  useEffect(() => {
    if (bulkDeleteCategory && ((Boolean(query.trim()) && bulkDeleteRecordId === null)
      || (statusFilter !== bulkDeleteCategory || historyCounts.status[bulkDeleteCategory] === 0)
      || (bulkDeleteRecordId !== null && bulkDeleteRecord?.id !== bulkDeleteRecordId))) {
      setBulkDeleteCategory(null);
      setBulkDeleteRecordId(null);
      setBulkDeleteError('');
    }
  }, [bulkDeleteCategory, bulkDeleteRecord?.id, bulkDeleteRecordId, historyCounts.status, query, statusFilter]);

  const globalSearchTotal = historyCounts.status.scheduled + historyCounts.status.sent + historyCounts.status.drafts;
  const historyResultCountLabel = t(isGlobalSearch ? 'history.results' : 'history.showingResults', {
    shown: formatDisplayCount(filteredRecords.length, locale),
    total: formatDisplayCount(isGlobalSearch ? globalSearchTotal : historyCounts.status[statusFilter], locale),
  });
  const historySearchControl = (
    <div className="history-search-dock">
      <div className="history-search" role="search">
        <Search size={18} strokeWidth={1.7} aria-hidden="true" />
        <div className="history-search-entry">
          <input
            ref={historySearchInputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('history.searchPlaceholderHint')}
            aria-label={t('history.searchPlaceholder')}
            title={t('history.searchHelp')}
          />
          <button
            type="button"
            className={`history-search-clear${query.length > 0 ? '' : ' is-reserved'}`}
            onClick={() => setQuery('')}
            disabled={query.length === 0}
            aria-label={t('history.clearSearch')}
          >
            <X size={15} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </div>
        <div
          className="history-result-count"
          role="status"
          aria-live="polite"
          aria-label={historyResultCountLabel}
          title={historyResultCountLabel}
        >
          {historyResultCountLabel}
        </div>
      </div>
    </div>
  );
  const historyStatusFilters = (
    <div className="history-status-filters" ref={statusFiltersRef} role="tablist" aria-label={t('history.statuses')}>
      {visibleStatusFilters.map((item) => {
        const labelKey = item === 'scheduled'
          ? 'history.categoryScheduled'
          : item === 'sent'
            ? 'history.categorySent'
            : item === 'notes'
              ? 'history.categoryNotes'
              : 'history.categoryDrafts';
        const compactLabelKey = item === 'scheduled'
          ? 'history.categoryScheduledCompact'
          : item === 'sent'
            ? 'history.categorySentCompact'
            : item === 'notes'
              ? 'history.categoryNotesCompact'
              : 'history.categoryDraftsCompact';

        return (
          <button
            key={item}
            type="button"
            data-history-filter={item}
            tabIndex={statusFilter === item ? 0 : -1}
            onClick={() => {
              if (statusFilter !== item) {
                if (statusFilterBeforeOverrideRef.current !== null) statusFilterOverrideChangedRef.current = true;
                setStatusFilter(item);
              }
              setBulkDeleteCategory(null);
              setBulkDeleteRecordId(null);
              setBulkDeleteError('');
            }}
            onKeyDown={(event) => {
              const tabs = statusFiltersRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
              if (!tabs?.length) return;
              const currentIndex = Array.from(tabs).indexOf(event.currentTarget);
              let nextIndex: number;

              if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length;
              else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
              else if (event.key === 'Home') nextIndex = 0;
              else if (event.key === 'End') nextIndex = tabs.length - 1;
              else return;

              event.preventDefault();
              const nextTab = tabs[nextIndex];
              nextTab.focus();
              nextTab.click();
            }}
            className={`history-status-tab${statusFilter === item ? ' is-active' : ''}`}
            role="tab"
            aria-selected={statusFilter === item}
            aria-label={t(labelKey)}
            title={t(labelKey)}
          >
            <span className="history-status-label">{t(labelKey)}</span>
            <span className="history-status-label-compact">{t(compactLabelKey)}</span>
            <span className="history-filter-count" aria-hidden="true">{formatDisplayCount(historyCounts.status[item], locale)}</span>
          </button>
        );
      })}
    </div>
  );
  const sourceLabels: Record<HistorySourceFilter, string> = {
    all: t('history.sourceAll'),
    workspace: t('history.sourceStudio'),
    personal: t('history.sourcePersonal'),
  };
  const historySourceFilters = (
    <div className="history-source-filters" role="group" aria-label={t('history.sources')}>
      {(['all', 'workspace', 'personal'] as const).map((item) => (
        <button
          key={item}
          type="button"
          data-history-filter={item}
          onClick={() => {
            setSourceFilterPinned(true);
            if (sourceFilterBeforeOverrideRef.current !== null) sourceFilterOverrideChangedRef.current = true;
            if (sourceFilter !== item) setSourceFilter(item);
            if (item !== 'personal' && statusFilter === 'notes') setStatusFilter('scheduled');
            setBulkDeleteCategory(null);
            setBulkDeleteRecordId(null);
            setBulkDeleteError('');
          }}
          className={`history-filter${sourceFilter === item ? ' is-active' : ''}`}
          aria-pressed={sourceFilter === item}
          aria-label={sourceLabels[item]}
        >
          <span>{sourceLabels[item]}</span>
          <span className="history-filter-count" aria-hidden="true">{formatDisplayCount(historyCounts.source[item], locale)}</span>
        </button>
      ))}
    </div>
  );
  const historySourceSelect = (
    <div className="history-source-filters" ref={sourceMenuRef} role="group" aria-label={t('history.sources')}>
      <button
        ref={sourceMenuButtonRef}
        type="button"
        className="history-source-select"
        onClick={() => setIsSourceMenuOpen((open) => !open)}
        aria-haspopup="menu"
        aria-expanded={isSourceMenuOpen}
        aria-label={`${t('history.sourceCaption')}: ${sourceLabels[sourceFilter]} ${formatDisplayCount(historyCounts.source[sourceFilter], locale)}`}
      >
        <span>{sourceLabels[sourceFilter]}</span>
        <span className="history-source-select-count" aria-hidden="true">{formatDisplayCount(historyCounts.source[sourceFilter], locale)}</span>
        <ChevronDown size={14} strokeWidth={1.8} aria-hidden="true" />
      </button>
    </div>
  );
  const historySourceMenu = isSourceMenuOpen && createPortal(
    <div
      className="history-source-menu"
      ref={sourceMenuItemsRef}
      role="menu"
      aria-label={t('history.sources')}
      style={{ top: sourceMenuPosition.top, left: sourceMenuPosition.left }}
    >
      {(['all', 'workspace', 'personal'] as const).map((item) => (
        <button
          key={item}
          type="button"
          role="menuitemradio"
          data-history-filter={item}
          aria-checked={sourceFilter === item}
          className="history-source-option"
          onClick={() => {
            setSourceFilterPinned(true);
            if (sourceFilterBeforeOverrideRef.current !== null) sourceFilterOverrideChangedRef.current = true;
            if (sourceFilter !== item) setSourceFilter(item);
            if (item !== 'personal' && statusFilter === 'notes') setStatusFilter('scheduled');
            setBulkDeleteCategory(null);
            setBulkDeleteRecordId(null);
            setBulkDeleteError('');
            setIsSourceMenuOpen(false);
            sourceMenuButtonRef.current?.focus();
          }}
          onKeyDown={(event) => {
            const options = sourceMenuItemsRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]');
            if (!options?.length) return;
            const currentIndex = Array.from(options).indexOf(event.currentTarget);
            let nextIndex: number;
            if (event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % options.length;
            else if (event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + options.length) % options.length;
            else if (event.key === 'Home') nextIndex = 0;
            else if (event.key === 'End') nextIndex = options.length - 1;
            else return;
            event.preventDefault();
            options[nextIndex].focus();
          }}
        >
          <span>{sourceLabels[item]}</span>
          <span className="history-filter-count" aria-hidden="true">{formatDisplayCount(historyCounts.source[item], locale)}</span>
        </button>
      ))}
    </div>,
    document.body,
  );

  if (!isOpen) return null;

  return (
    <>
      {!pageMode && (
        <div
          className="history-drawer-backdrop"
          aria-hidden="true"
          onClick={() => onClose()}
        />
      )}

      <aside
        className={`history-drawer${pageMode ? ' is-page' : ''}`}
        role={pageMode ? 'region' : 'dialog'}
        aria-modal={pageMode ? undefined : true}
        aria-label={t('history.title')}
      >
        {!pageMode && (
          <header className="history-drawer-header">
            <div className="history-drawer-heading">
              <span className="history-drawer-header-icon" aria-hidden="true">
                <Send size={20} strokeWidth={1.8} />
              </span>
              <h2 aria-label={t('history.title')}>{t('history.title')}</h2>
            </div>
            <button
              type="button"
              onClick={() => onClose()}
              aria-label={t('history.close')}
              className="history-drawer-close"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </header>
        )}

        <div className={`history-drawer-controls${pageMode ? ' is-page-controls' : ''}`}>
          {pageMode ? (
            <>
              <button
                type="button"
                onClick={() => onClose()}
                aria-label={t('history.close')}
                className="history-page-controls-close history-drawer-close"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </>
          ) : historySourceFilters}
        </div>

        <div className={`history-content${pageMode ? ' is-page' : ''}`} data-has-selection={Boolean(activeSelectedRecord)}>
        <div className="history-list-pane">
        {pageMode && (
          <div className="history-list-status-section">
            <div className="history-list-status-heading">
              <span className="history-page-filter-label">{t('history.statusCaption')}</span>
              {historyStatusFilters}
            </div>
            <div className="history-list-source-row">
              <div className="history-page-filter-section is-source-section">
                <span className="history-list-source-label">{t('history.sourceCaption')}</span>
                {historySourceSelect}
              </div>
            </div>
          </div>
        )}
        <div className="history-record-list" ref={historyRecordListRef}>
          {filteredRecords.length === 0 ? (
            <div className="history-empty" role="status">
              {pageMode ? (
                <div className="history-empty-art" aria-hidden="true">
                  <span className="history-empty-art-orbit history-empty-art-orbit--outer" />
                  <span className="history-empty-art-orbit history-empty-art-orbit--inner" />
                  <span className="history-empty-art-spark history-empty-art-spark--left" />
                  <span className="history-empty-art-spark history-empty-art-spark--right" />
                  <span className="history-empty-art-icon">
                    <Search size={26} strokeWidth={1.8} />
                  </span>
                </div>
              ) : (
                <Search size={21} strokeWidth={1.5} aria-hidden="true" />
              )}
              <strong>{query ? t('history.noResults') : t('history.emptyCategory')}</strong>
              <span>{query
                ? t('history.changeSearch')
                : sourceFilter === 'personal' && statusFilter === 'notes'
                  ? t('history.appNotesHint')
                  : sourceFilter === 'personal'
                  ? t('history.personalEmpty')
                  : t('history.generalEmpty')}</span>
              {query && <button type="button" onClick={() => setQuery('')}>{t('history.resetSearch')}</button>}
              {pageMode && !query.trim() && statusFilter !== 'sent' && (
                <div className="history-empty-create-actions">
                  {sourceFilter !== 'personal' && statusFilter !== 'notes' && (
                    <button type="button" onClick={navigation.openStudio}>
                      <Plus size={14} aria-hidden="true" />
                      {t('history.createInStudio')}
                    </button>
                  )}
                  {sourceFilter !== 'workspace' && (
                    <button type="button" onClick={navigation.openQuickPlan}>
                      <Plus size={14} aria-hidden="true" />
                      {t('history.createInPlanner')}
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : (
            visibleRecords.map((record, index) => {
              const isSelected = activeSelectedRecord?.id === record.id;
              const isExpanded = !pageMode && selectedRecord?.id === record.id;
              const timestamp = getHistoryTimestamp(record);
              const channelDetail = [record.channelLabel, record.channelName]
                .find((value) => value.trim() && value.trim() !== record.title.trim());
              const startsNewDay = index === 0
                || getHistoryDayKey(getHistoryTimestamp(visibleRecords[index - 1])) !== getHistoryDayKey(timestamp);
              const entities = record.entities;
              const scheduleMessage = record.original.kind === 'scheduled' ? record.original.message : null;
              const replyMarkup = scheduleMessage?.replyMarkup;
              const canReschedule = record.source === 'workspace' && record.status === 'scheduled' && scheduleMessage;
              const primaryAction = record.status === 'failed'
                ? { label: getRetryActionLabel(record, t), handler: () => confirmSendNow(record), type: 'send-now' }
                : record.status === 'scheduled'
                  ? canReschedule
                    ? { label: t('history.edit'), handler: () => { onReschedule(record); onClose(); }, type: 'reschedule' }
                    : record.source === 'personal'
                      ? null
                      : { label: t('history.sendNow'), handler: () => confirmSendNow(record), type: 'send-now' }
                  : record.status === 'draft'
                      ? { label: t('history.useDraft'), handler: () => applyHistoryDraft(record), type: 'use-draft' }
                    : null;
              const secondaryActions = [
                ...(record.status === 'draft'
                  ? [
                    { label: t('history.delete'), handler: () => {
                      setBulkDeleteError('');
                      setBulkDeleteCategory('drafts');
                      setBulkDeleteRecordId(record.id);
                    }, type: 'delete' },
                  ]
                  : []),
                ...(record.status === 'scheduled' && scheduleMessage
                  ? [
                    ...(canReschedule || record.source === 'personal'
                      ? [{ label: t('history.sendNow'), handler: () => confirmSendNow(record), type: 'send-now' }]
                      : []),
                    { label: t('history.cancel'), handler: () => setConfirmAction({ type: 'cancel', recordId: record.id }), type: 'cancel' },
                  ]
                  : []),
                ...((record.status === 'sent' || record.status === 'failed') && scheduleMessage
                  ? [{ label: t('history.delete'), handler: () => {
                    setConfirmAction({ type: 'delete', recordId: record.id });
                  }, type: 'delete' }]
                  : []),
              ];
              const reminderType = getPlannerReminderType(record);
              const reminderTypePresentation = reminderType ? getPlannerReminderTypePresentation(reminderType, t) : null;

              return (
              <Fragment key={record.id}>
              {startsNewDay && (
                <h3 className="history-date-heading" aria-label={formatHistoryDayLabel(timestamp, locale, t)}>
                  {formatHistoryDayLabel(timestamp, locale, t)}
                </h3>
              )}
              <article
                ref={isExpanded ? expandedRecordRef : undefined}
                className={`history-record${isExpanded ? ' is-expanded' : ''}${isSelected ? ' is-selected' : ''}${record.status === 'draft' ? ' is-draft' : ''}`}
                data-draft-color={record.status === 'draft' ? record.draftColor ?? 'gray' : undefined}
              >
                <button
                  type="button"
                  className="history-record-open"
                  data-history-record-id={pageMode ? record.id : undefined}
                  onClick={() => pageMode
                    ? setSelectedRecord((current) => current?.id === record.id ? null : record)
                    : toggleExpandedRecord(record, isExpanded)}
                  aria-label={t('history.expandRecord', { action: t(isExpanded ? 'history.collapse' : 'history.open'), title: record.title })}
                  aria-expanded={!pageMode ? isExpanded : undefined}
                  aria-pressed={pageMode ? isSelected : undefined}
                >
                  <span className="history-record-meta">
                    <span className="history-record-source-group">
                      <span className={`history-record-source is-${record.source === 'workspace' ? 'studio' : 'personal'}`}>
                        {record.source === 'workspace' ? t('history.sourceStudio') : t('history.sourcePersonal')}
                      </span>
                      {record.status === 'draft' && (
                        <span
                          className="history-record-draft-dot"
                          data-color={record.draftColor ?? 'gray'}
                          aria-label={t('history.draftColor', { color: record.draftColor ?? 'gray' })}
                          title={t('history.color', { color: record.draftColor ?? 'gray' })}
                        />
                      )}
                    </span>
                    {!isExpanded && (
                      <span className="history-record-date">
                        {getHistoryStatusLabel(record.status, t)} · {formatDateLabel(timestamp, locale, t)}
                      </span>
                    )}
                    {record.attachments.length > 0 ? (
                      <span className="history-record-attachments" aria-label={formatAttachmentCount(record.attachments.length, locale)} title={formatAttachmentCount(record.attachments.length, locale)}>
                        <span className="history-record-attachment-preview" aria-hidden="true">
                          {record.attachments.slice(0, 2).map((attachment) => (
                            isImageAttachment(attachment)
                              ? (
                                <span className="history-record-attachment-image" key={attachment}>
                                  <img
                                    src={toAttachmentUrl(attachment)}
                                    alt=""
                                    onPointerEnter={(event) => openImagePreview(event.currentTarget, attachment)}
                                    onPointerLeave={closeImagePreview}
                                    onError={(event) => event.currentTarget.parentElement?.classList.add('is-unavailable')}
                                  />
                                  <span className="history-record-attachment-image-fallback"><Paperclip size={12} strokeWidth={1.8} /></span>
                                </span>
                              )
                              : <span className="history-record-attachment-file" key={attachment}><Paperclip size={12} strokeWidth={1.8} /></span>
                          ))}
                        </span>
                        <span className="history-record-attachment-count">{formatDisplayCount(record.attachments.length, locale)}</span>
                      </span>
                    ) : (
                      <span className="history-record-attachments is-empty" aria-hidden="true" />
                    )}
                  </span>

                  <span className="history-record-heading">
                    <span className="history-record-heading-title">
                      <strong>{record.title}</strong>
                      {reminderType && reminderTypePresentation && (
                        <span
                          className="history-record-reminder-type"
                          data-reminder-type={reminderType}
                          aria-label={reminderTypePresentation.label}
                          title={reminderTypePresentation.label}
                        >
                          <reminderTypePresentation.Icon size={14} strokeWidth={1.9} aria-hidden="true" />
                        </span>
                      )}
                    </span>
                    {!isExpanded && <time dateTime={timestamp}>{formatTime(timestamp, locale)}</time>}
                  </span>

                  {channelDetail && <span className="history-record-chat">{channelDetail}</span>}
                  {!isExpanded && <span className="history-record-text">{record.text}</span>}
                  {!isExpanded && getVisibleHistoryError(record.lastError, t) && <span className="history-record-error-preview">{getVisibleHistoryError(record.lastError, t)}</span>}
                </button>
                {isExpanded && (
                  <div
                    className="history-post-expanded"
                    aria-label={t('history.fullContent', { title: record.title })}
                    onClick={(event) => {
                      if (event.target !== event.currentTarget) return;
                      const bubble = event.currentTarget.querySelector('.history-post-bubble');
                      const bubbleLeft = bubble?.getBoundingClientRect().left
                        ?? event.currentTarget.getBoundingClientRect().left + 56;
                      if (event.clientX < bubbleLeft) setSelectedRecord(null);
                    }}
                  >
                    <div className="history-post-time-row">
                      <time dateTime={timestamp}>{formatTime(timestamp, locale)}</time>
                      <span>{getHistoryStatusLabel(record.status, t)}</span>
                    </div>
                    {getVisibleHistoryError(record.lastError, t) && <p className="history-record-error" role="alert">{getVisibleHistoryError(record.lastError, t)}</p>}
                    <div className="history-post-bubble">
                      {Boolean(record.attachments.length) && (
                        <div className="history-post-attachments" aria-label={t('history.attachmentsLabel')}>
                          {record.attachments.map((attachment) => (
                            isImageAttachment(attachment) ? (
                              <img
                                key={attachment}
                                src={toAttachmentUrl(attachment)}
                                alt={getAttachmentName(attachment, t)}
                                onPointerEnter={(event) => openImagePreview(event.currentTarget, attachment)}
                                onPointerLeave={closeImagePreview}
                                onLoad={() => {
                                  const list = historyRecordListRef.current;
                                  const expandedRecord = expandedRecordRef.current;
                                  if (list && expandedRecord) scrollHistoryRecordIntoView(list, expandedRecord);
                                }}
                              />
                            ) : (
                              <a key={attachment} href={toAttachmentUrl(attachment)} download={getAttachmentName(attachment, t)}>
                                <FileText size={17} strokeWidth={1.7} aria-hidden="true" />
                                <span>{getAttachmentName(attachment, t)}</span>
                              </a>
                            )
                          ))}
                        </div>
                      )}
                      <div
                        className="history-post-text"
                        dangerouslySetInnerHTML={{
                          __html: richTextToHtml(record.text, entities),
                        }}
                      />
                      <InlineKeyboardPreview markup={replyMarkup} />
                    </div>
                    {(record.silent || record.effect) && (
                      <div className="history-post-options">
                        {record.silent && <span>{t('history.silent')}</span>}
                        {record.effect && <span>{t('history.effect', { effect: record.effect })}</span>}
                      </div>
                    )}
                  </div>
                )}
                {!pageMode && <div className="history-record-actions">
                  <div className="history-record-leading-actions">
                    {primaryAction && (
                      <div className="history-record-primary-wrap">
                        <button
                          type="button"
                          className="history-record-action is-primary"
                          onClick={primaryAction.handler}
                          aria-label={primaryAction.type === 'reschedule'
                            ? t('history.showRecord', { action: t('history.edit'), title: record.title })
                            : primaryAction.type === 'open-draft'
                              ? t('history.editDraftTitle', { title: record.title })
                              : primaryAction.type === 'use-draft'
                                ? t('history.useDraftTitle', { title: record.title })
                                : primaryAction.label}
                        >
                          <span>{primaryAction.label}</span>
                        </button>
                      </div>
                    )}
                    {secondaryActions.length > 0 && (
                      <div className="history-record-more">
                        <button
                          type="button"
                          className="history-record-action is-more"
                          onClick={() => setActionMenuOpenId((current) => current === record.id ? null : record.id)}
                          aria-label={t('history.more')}
                          title={t('history.more')}
                          aria-expanded={actionMenuOpenId === record.id}
                        >
                          <Ellipsis size={19} strokeWidth={2} aria-hidden="true" />
                        </button>
                        {actionMenuOpenId === record.id && (
                          <div ref={actionMenuRef} className="history-record-action-menu" role="menu" aria-label={t('history.moreActions', { title: record.title })}>
                            {secondaryActions.map((action) => (
                              <button
                                key={action.type}
                                type="button"
                                role="menuitem"
                                className={`history-record-action-menu-item${action.type === 'cancel' || action.type === 'delete' ? ' is-danger' : ''}`}
                                onClick={() => {
                                  action.handler();
                                  setActionMenuOpenId(null);
                                }}
                                aria-label={action.type === 'reschedule' ? t('history.showRecord', { action: t('history.edit'), title: record.title }) : action.label}
                              >
                                {action.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  {!pageMode && <button
                    type="button"
                    className="history-record-action is-expand"
                    onClick={() => toggleExpandedRecord(record, isExpanded)}
                    aria-label={t('history.showRecord', { action: t(isExpanded ? 'history.collapse' : 'history.showFull'), title: record.title })}
                    aria-expanded={isExpanded}
                  >
                    {isExpanded
                      ? <Minimize2 size={14} strokeWidth={1.8} aria-hidden="true" />
                      : <Maximize2 size={14} strokeWidth={1.8} aria-hidden="true" />}
                    <span>{t(isExpanded ? 'history.collapse' : 'history.fullSize')}</span>
                  </button>}
                  {record.status === 'sending' && scheduleMessage && (
                    <button type="button" className="history-record-action is-send-now" disabled>
                      <span>{t('history.sending')}</span>
                    </button>
                  )}
                </div>}
              </article>
              </Fragment>
              );
            })
          )}
        </div>
        </div>
        {historySourceMenu}

        {pageMode && (
          <aside
            className="history-detail-panel"
            data-selected={Boolean(activeSelectedRecord)}
            aria-label={activeSelectedRecord
              ? t('history.detailsPanel')
              : t('history.detailEmptyTitle')}
          >
            {activeSelectedRecord ? (() => {
              const timestamp = getHistoryTimestamp(activeSelectedRecord);
              const visibleError = getVisibleHistoryError(activeSelectedRecord.lastError, t);
              const channelDetail = [activeSelectedRecord.channelLabel, activeSelectedRecord.channelName]
                .find((value) => value.trim() && value.trim() !== activeSelectedRecord.title.trim());
              const scheduleMessage = activeSelectedRecord.original.kind === 'scheduled'
                ? activeSelectedRecord.original.message
                : null;
              const canDeleteSentRecord = (activeSelectedRecord.status === 'sent' || activeSelectedRecord.status === 'failed')
                && Boolean(scheduleMessage);

              return (
                <>
                  <div className="history-detail-header">
                    <button
                      type="button"
                      className="history-detail-back"
                      ref={detailBackButtonRef}
                      onClick={() => {
                        const recordId = activeSelectedRecord.id;
                        setSelectedRecord(null);
                        if (typeof window.matchMedia === 'function'
                          && window.matchMedia('(max-width: 900px)').matches) {
                          window.requestAnimationFrame(() => {
                            const recordButtons = historyRecordListRef.current
                              ?.querySelectorAll<HTMLButtonElement>('.history-record-open');
                            const selectedButton = Array.from(recordButtons ?? [])
                              .find((button) => button.dataset.historyRecordId === recordId);
                            selectedButton?.focus();
                          });
                        }
                      }}
                    >
                      <ArrowLeft size={16} aria-hidden="true" />
                      <span>{t('history.backToList')}</span>
                    </button>
                    <div className="history-detail-heading">
                      <span className="history-detail-category">
                        {t('history.detailCategory', {
                          category: getHistoryCategoryLabel(getHistoryRecordCategory(activeSelectedRecord), t),
                        })}
                      </span>
                      <span className={`history-record-source is-${activeSelectedRecord.source === 'workspace' ? 'studio' : 'personal'}`}>
                        {activeSelectedRecord.source === 'workspace' ? t('history.sourceStudio') : t('history.sourcePersonal')}
                      </span>
                      <span className={`history-detail-status is-${activeSelectedRecord.status}`}>
                        {getHistoryStatusLabel(activeSelectedRecord.status, t)}
                      </span>
                    </div>
                    <h2>{activeSelectedRecord.title}</h2>
                    <div className="history-detail-meta">
                      {channelDetail && <span>{channelDetail}</span>}
                      <time dateTime={timestamp}>
                        {new Intl.DateTimeFormat(locale === 'ru' ? 'ru-RU' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(timestamp))}
                      </time>
                    </div>
                  </div>
                  {visibleError && <p className="history-detail-error" role="alert">{visibleError}</p>}
                  <div
                    className={`history-detail-body is-${detailPreviewMode}`}
                    ref={detailPreviewRef}
                    tabIndex={-1}
                  >
                    {detailPreviewMode === 'preview' && (
                      <div className="history-detail-preview-label">
                        <Eye size={14} aria-hidden="true" />
                        <span>{t('studio.livePreview')}</span>
                      </div>
                    )}
                    {detailPreviewMode === 'chat' && chatPreviewHistory && (
                      <div className="history-chat-preview" aria-label={t('history.chatPreview')}>
                        <ChatPreviewHistory
                          groups={groupHistory(chatPreviewHistory.messages)}
                          selectedChatType={chatPreviewHistory.chat.type}
                          onOpenPhoto={openChatPreviewPhoto}
                          viewPhotoLabel={t('history.fullSize')}
                        />
                        {chatPreviewHistory.messages.length === 0 && (
                          <p className="history-chat-preview-empty">{t('history.chatPreviewEmpty')}</p>
                        )}
                      </div>
                    )}
                    {chatPreviewLoading && (
                      <p className="history-chat-preview-status" role="status">{t('history.chatPreviewLoading')}</p>
                    )}
                    {chatPreviewError && (
                      <div className="history-chat-preview-status" role="alert">
                        <span>{t('history.chatPreviewLoadFailed')}</span>
                        <button type="button" onClick={() => void openSelectedPreview()}>
                          {t('history.chatPreviewRetry')}
                        </button>
                      </div>
                    )}
                    <div className={detailPreviewMode === 'chat' ? 'history-chat-preview-current' : undefined}>
                    <div className={detailPreviewMode === 'details' ? 'history-detail-plain-post' : undefined}>
                    <div className="history-post-bubble">
                      {activeSelectedRecord.attachments.length > 0 && (
                        <div className="history-post-attachments" aria-label={t('history.attachmentsLabel')}>
                          {activeSelectedRecord.attachments.map((attachment, attachmentIndex) => {
                            const attachmentName = getAttachmentName(attachment, t);
                            return isImageAttachment(attachment) ? (
                              <img
                                key={`${attachment}-${attachmentIndex}`}
                                src={toAttachmentUrl(attachment)}
                                alt={attachmentName}
                                onPointerEnter={(event) => openImagePreview(event.currentTarget, attachment)}
                                onPointerLeave={closeImagePreview}
                              />
                            ) : (
                              <a
                                key={`${attachment}-${attachmentIndex}`}
                                href={toAttachmentUrl(attachment)}
                                download={attachmentName}
                              >
                                <FileText size={17} strokeWidth={1.7} aria-hidden="true" />
                                <span>{attachmentName}</span>
                              </a>
                            );
                          })}
                        </div>
                      )}
                      {activeSelectedRecord.text && (
                        <div
                          className="history-post-text"
                          {...(detailPreviewMode === 'details'
                            ? { children: activeSelectedRecord.text }
                            : {
                              dangerouslySetInnerHTML: {
                                __html: richTextToHtml(activeSelectedRecord.text, activeSelectedRecord.entities),
                              },
                            })}
                        />
                      )}
                      <InlineKeyboardPreview markup={scheduleMessage?.replyMarkup} />
                      {(activeSelectedRecord.silent || activeSelectedRecord.effect) && (
                        <div className="history-post-options">
                          {activeSelectedRecord.silent && <span>{t('history.silent')}</span>}
                          {activeSelectedRecord.effect && <span>{t('history.effect', { effect: activeSelectedRecord.effect })}</span>}
                        </div>
                      )}
                    </div>
                    </div>
                    </div>
                  </div>
                  <div className="history-detail-actions" aria-label={t('history.actionsPanel')}>
                    <div className="history-detail-toolbar" ref={detailActionMenuRef}>
                      <button
                        type="button"
                        className="history-detail-tool-button is-preview"
                        onClick={() => void openSelectedPreview()}
                        aria-label={t('history.preview')}
                        title={t('history.preview')}
                      >
                        <span className="history-detail-tool-icon">
                          <Eye size={26} strokeWidth={1.8} aria-hidden="true" />
                        </span>
                        <span>{t('history.preview')}</span>
                      </button>
                      {activeSelectedRecord.status !== 'scheduled' && (
                        <button
                          type="button"
                          className={`history-detail-tool-button${copyFeedback === 'failed' ? ' is-error' : ''}`}
                          onClick={() => void copySelectedPost()}
                          disabled={!activeSelectedRecord.text}
                          aria-label={t(copyFeedback === 'copied'
                            ? 'history.copied'
                            : copyFeedback === 'failed'
                              ? 'history.copyFailed'
                              : 'history.copy')}
                          title={t(copyFeedback === 'copied'
                            ? 'history.copied'
                            : copyFeedback === 'failed'
                              ? 'history.copyFailed'
                              : 'history.copy')}
                        >
                          <span className="history-detail-tool-icon">
                            {copyFeedback === 'copied'
                              ? <Check size={23} strokeWidth={2} aria-hidden="true" />
                              : <Copy size={23} strokeWidth={1.8} aria-hidden="true" />}
                          </span>
                          <span>{t(copyFeedback === 'copied'
                            ? 'history.copied'
                            : copyFeedback === 'failed'
                              ? 'history.copyFailed'
                              : 'history.copy')}</span>
                        </button>
                      )}
                      {activeSelectedRecord.status === 'scheduled' && activeSelectedRecord.source === 'workspace' && (
                        <button
                          type="button"
                          className="history-detail-tool-button"
                          onClick={() => {
                            onReschedule(activeSelectedRecord);
                            onClose();
                          }}
                          aria-label={t('history.edit')}
                          title={t('history.edit')}
                        >
                          <span className="history-detail-tool-icon">
                            <CalendarDays size={23} strokeWidth={1.8} aria-hidden="true" />
                          </span>
                          <span>{t('history.edit')}</span>
                        </button>
                      )}
                      {activeSelectedRecord.status === 'scheduled' && scheduleMessage && (
                        <button
                          type="button"
                          className="history-detail-tool-button is-error"
                          onClick={() => setConfirmAction({ type: 'cancel', recordId: activeSelectedRecord.id })}
                          aria-label={t('history.cancel')}
                          title={t('history.cancel')}
                        >
                          <span className="history-detail-tool-icon">
                            <CalendarOff size={23} strokeWidth={1.8} aria-hidden="true" />
                          </span>
                          <span>{t('history.cancel')}</span>
                        </button>
                      )}
                      {activeSelectedRecord.status === 'sent' && onUseDraft && (
                        <button
                          type="button"
                          className="history-detail-tool-button is-use-text"
                          onClick={() => applyHistoryDraft(activeSelectedRecord, 'studio')}
                          disabled={!activeSelectedRecord.text && activeSelectedRecord.attachments.length === 0}
                          aria-label={t('history.useText')}
                          title={t('history.useText')}
                        >
                          <span className="history-detail-tool-icon">
                            <ExternalLink size={23} strokeWidth={1.8} aria-hidden="true" />
                          </span>
                          <span>{t('history.useText')}</span>
                        </button>
                      )}
                      {activeSelectedRecord.status === 'draft' && onUseDraft && (
                        <button
                          type="button"
                          className="history-detail-tool-button is-use-text"
                          onClick={() => applyHistoryDraft(activeSelectedRecord, 'studio')}
                          disabled={!activeSelectedRecord.text && activeSelectedRecord.attachments.length === 0}
                          aria-label={t('history.useText')}
                          title={t('history.useText')}
                        >
                          <span className="history-detail-tool-icon">
                            <ExternalLink size={23} strokeWidth={1.8} aria-hidden="true" />
                          </span>
                          <span>{t('history.useText')}</span>
                        </button>
                      )}
                      <button
                        type="button"
                        className="history-detail-tool-button is-more"
                        onClick={() => setDetailActionMenuOpen((open) => !open)}
                        aria-label={t('history.more')}
                        title={t('history.more')}
                        aria-expanded={detailActionMenuOpen}
                        aria-haspopup="menu"
                      >
                        <span className="history-detail-tool-icon">
                          <Ellipsis size={24} strokeWidth={2} aria-hidden="true" />
                        </span>
                        <span>{t('history.more')}</span>
                      </button>
                      {detailActionMenuOpen && (
                        <div className="history-detail-action-menu" role="menu" aria-label={t('history.actionsPanel')}>
                          {activeSelectedRecord.status === 'failed' && (
                            <button
                              type="button"
                              role="menuitem"
                              className="history-detail-menu-item"
                              onClick={() => {
                                confirmSendNow(activeSelectedRecord);
                                setDetailActionMenuOpen(false);
                              }}
                            >
                              {getRetryActionLabel(activeSelectedRecord, t)}
                            </button>
                          )}
                          {onUseDraft && (
                            <button
                              type="button"
                              role="menuitem"
                              className="history-detail-menu-item"
                              onClick={() => {
                                applyHistoryDraft(activeSelectedRecord, 'planner');
                                setDetailActionMenuOpen(false);
                              }}
                            >
                              {t('history.openInPlanner')}
                            </button>
                          )}
                          {activeSelectedRecord.status === 'draft' && (
                            <>
                              <button
                                type="button"
                                role="menuitem"
                                className="history-detail-menu-item is-danger"
                                onClick={() => {
                                  setBulkDeleteError('');
                                  setBulkDeleteCategory('drafts');
                                  setBulkDeleteRecordId(activeSelectedRecord.id);
                                  setDetailActionMenuOpen(false);
                                }}
                              >
                                {t('history.delete')}
                              </button>
                            </>
                          )}
                          {activeSelectedRecord.status === 'scheduled' && (
                            <>
                              {scheduleMessage && (
                                <>
                                  <button
                                    type="button"
                                    role="menuitem"
                                    className="history-detail-menu-item"
                                    onClick={() => {
                                      confirmSendNow(activeSelectedRecord);
                                      setDetailActionMenuOpen(false);
                                    }}
                                  >
                                    {t('history.sendNow')}
                                  </button>
                                  <button
                                    type="button"
                                    role="menuitem"
                                    className="history-detail-menu-item is-danger"
                                    onClick={() => {
                                      setConfirmAction({ type: 'cancel', recordId: activeSelectedRecord.id });
                                      setDetailActionMenuOpen(false);
                                    }}
                                  >
                                    {t('history.cancel')}
                                  </button>
                                </>
                              )}
                            </>
                          )}
                          {canDeleteSentRecord && (
                            <button
                              type="button"
                              role="menuitem"
                              className="history-detail-menu-item is-danger"
                              onClick={() => {
                                setConfirmAction({ type: 'delete', recordId: activeSelectedRecord.id });
                                setDetailActionMenuOpen(false);
                              }}
                            >
                              {t('history.delete')}
                            </button>
                          )}
                          {activeSelectedRecord.status === 'sending' && (
                            <button type="button" role="menuitem" className="history-detail-menu-item" disabled>
                              {t('history.sending')}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </>
              );
            })() : (
              <div className="history-detail-empty">
                <div className="history-detail-empty-art" aria-hidden="true">
                  <span className="history-detail-empty-art-orbit history-detail-empty-art-orbit--outer" />
                  <span className="history-detail-empty-art-orbit history-detail-empty-art-orbit--inner" />
                  <span className="history-detail-empty-art-spark history-detail-empty-art-spark--left" />
                  <span className="history-detail-empty-art-spark history-detail-empty-art-spark--right" />
                  <span className="history-detail-empty-art-icon">
                    <Send size={28} strokeWidth={1.8} />
                  </span>
                </div>
                <h2>{t('history.detailEmptyTitle')}</h2>
                <p>{t('history.detailEmptyText')}</p>
              </div>
            )}
          </aside>
        )}
        </div>

        <div className="history-drawer-tools">
          {historySearchControl}
          <div className="history-drawer-footer" aria-label={t('history.actionsPanel')}>
            <div className="history-status-row">
            {!pageMode && historyStatusFilters}

            <div className="history-export-control" ref={exportMenuRef}>
              {canDeleteCurrentCategory ? (
                <button
                  type="button"
                  className="history-delete-button"
                  aria-label={selectedRecordMatchesDeleteCategory && selectedRecord
                    ? statusFilter === 'scheduled'
                      ? isLocalScheduleFailure(selectedRecord) ? t('history.deleteErrorTitle', { title: selectedRecord.title }) : t('history.cancelTitle', { title: selectedRecord.title })
                      : t('history.deleteTitle', { title: selectedRecord.title })
                    : statusFilter === 'scheduled'
                      ? scheduleCleanupAriaLabel
                      : statusFilter === 'sent' ? t('history.deleteSent') : statusFilter === 'notes' ? t('history.deleteNotes') : t('history.deleteDrafts')}
                  aria-haspopup="dialog"
                  aria-expanded={Boolean(bulkDeleteCategory)}
                  title={!pageMode
                    ? selectedRecordMatchesDeleteCategory && selectedRecord
                      ? statusFilter === 'scheduled'
                        ? isLocalScheduleFailure(selectedRecord) ? t('history.deleteErrorFromHistoryTitle', { title: selectedRecord.title }) : t('history.cancelTelegramTitle', { title: selectedRecord.title })
                        : t('history.deleteTitle', { title: selectedRecord.title })
                      : statusFilter === 'scheduled'
                        ? scheduleCleanupTitle
                        : statusFilter === 'sent' ? t('history.deleteSent') : statusFilter === 'notes' ? t('history.deleteNotesTitle') : t('history.deleteDrafts')
                    : undefined}
                  onClick={() => {
                    const category = statusFilter;
                    const recordId = selectedRecordMatchesDeleteCategory && selectedRecord
                      ? selectedRecord.id
                      : null;
                    const isSameTarget = bulkDeleteCategory === category && bulkDeleteRecordId === recordId;
                    setIsExportMenuOpen(false);
                    setBulkDeleteError('');
                    setBulkDeleteCategory(isSameTarget ? null : category);
                    setBulkDeleteRecordId(isSameTarget ? null : recordId);
                  }}
                >
                  <Trash2 size={25} strokeWidth={1.8} aria-hidden="true" />
                </button>
              ) : (
                <span className="history-delete-placeholder" aria-hidden="true" />
              )}
              <button
                type="button"
                className="history-export-button"
                onClick={() => {
                  setBulkDeleteCategory(null);
                  setBulkDeleteError('');
                  setIsExportMenuOpen((current) => !current);
                }}
                disabled={filteredRecords.length === 0}
                aria-label={selectedRecord
                  ? t('history.exportRecord', { title: selectedRecord.title })
                  : isGlobalSearch ? t('history.exportSearchResultsAction') : t('history.exportCurrent')}
                aria-haspopup="menu"
                aria-expanded={isExportMenuOpen}
                title={selectedRecord
                  ? t('history.exportRecord', { title: selectedRecord.title })
                  : t(isGlobalSearch ? 'history.exportSearchCount' : 'history.exportCount', { count: formatHistoryCount(filteredRecords.length, locale) })}
              >
                <Download size={24} strokeWidth={1.8} aria-hidden="true" />
                <span>{t('history.export')}</span>
              </button>
              {isExportMenuOpen && (
                <div className="history-export-menu" role="menu" aria-label={t('history.exportMenu')}>
                  <span className="history-export-menu-label">{exportMenuHeading}</span>
                  <button
                    type="button"
                    role="menuitem"
                    className="history-export-option"
                    aria-label={t('history.exportAsTxt', { scope: exportMenuScope })}
                    title={t(selectedRecord ? 'history.saveTxtSingle' : 'history.saveTxtMultiple')}
                    onClick={() => exportRecords('txt')}
                  >
                    <span>{t('history.textFile')}</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="history-export-option"
                    aria-label={t('history.exportAsJson', { scope: exportMenuScope })}
                    title={t(selectedRecord ? 'history.saveJsonSingle' : 'history.saveJsonMultiple')}
                    onClick={() => exportRecords('json')}
                  >
                    <span>{t('history.jsonFile')}</span>
                  </button>
                </div>
              )}
            </div>
            </div>
          </div>
        </div>
        {confirmAction && confirmActionRecord && (
          <div
            className="history-confirmation-backdrop"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setConfirmAction(null);
            }}
          >
            <div
              className="history-confirmation-modal"
              role="alertdialog"
              aria-modal="true"
              onKeyDown={handleConfirmationKeyDown}
              aria-label={confirmAction.type === 'cancel'
                ? t('history.confirmCancel')
                : confirmAction.type === 'send-now' ? t('history.confirmSend') : t('history.confirmDelete')}
            >
              <button
                type="button"
                className="history-confirmation-close"
                aria-label={t('common.close')}
                onClick={() => setConfirmAction(null)}
              >
                <X size={18} strokeWidth={1.8} aria-hidden="true" />
              </button>
              <span className="history-confirmation-icon" aria-hidden="true">
                {confirmAction.type === 'cancel'
                  ? <CalendarOff size={24} strokeWidth={1.8} />
                  : confirmAction.type === 'send-now'
                    ? <Send size={24} strokeWidth={1.8} />
                    : <Trash2 size={24} strokeWidth={1.8} />}
              </span>
              <h2 className="history-confirmation-title">{confirmActionPrompt}</h2>
              <div className="history-record-confirmation-actions">
                <button
                  type="button"
                  className="history-record-confirmation-action is-primary"
                  autoFocus={confirmAction.type === 'delete'}
                  onClick={() => {
                    if (confirmAction.type === 'cancel') {
                      onCancel(confirmActionRecord);
                    } else if (confirmAction.type === 'send-now') {
                      onSendNow(confirmActionRecord);
                    } else {
                      onDelete(confirmActionRecord);
                    }
                    setConfirmAction(null);
                    if (selectedRecord?.id === confirmActionRecord.id) setSelectedRecord(null);
                  }}
                >
                  {confirmAction.type === 'cancel'
                    ? t('history.cancelAction')
                    : confirmAction.type === 'send-now'
                      ? t('history.sendNow')
                      : confirmActionRecord.status === 'draft' ? t('history.deleteDraftAction') : t('history.deleteRecordAction')}
                </button>
                <button
                  type="button"
                  className="history-record-confirmation-action is-secondary"
                  autoFocus={confirmAction.type !== 'delete'}
                  onClick={() => setConfirmAction(null)}
                >
                  {t('common.cancel')}
                </button>
              </div>
            </div>
          </div>
        )}
        {bulkDeleteCategory && (
          <div
            className="history-confirmation-backdrop"
            onMouseDown={(event) => {
              if (event.target !== event.currentTarget || bulkDeleteBusy) return;
              setBulkDeleteCategory(null);
              setBulkDeleteRecordId(null);
              setBulkDeleteError('');
            }}
          >
            <div
              className="history-confirmation-modal"
              role="alertdialog"
              aria-modal="true"
              onKeyDown={handleConfirmationKeyDown}
              aria-label={bulkDeleteCategory === 'scheduled'
                  ? bulkDeleteRecord
                  ? isLocalScheduleFailure(bulkDeleteRecord) ? t('history.confirmDeleteScheduleError') : t('history.confirmCancel')
                  : localScheduleFailureRecords.length > 0 && queueCancellableRecords.length > 0
                    ? t('history.confirmCleanup')
                    : localScheduleFailureRecords.length > 0 ? t('history.confirmDeleteErrors') : t('history.confirmCancelQueue')
                : bulkDeleteCategory === 'notes' && !bulkDeleteRecord
                  ? t('history.confirmDeleteNotes')
                  : bulkDeleteRecord ? t('history.confirmDeleteRecord') : t('history.confirmDeleteCategory')}
            >
              <button
                type="button"
                className="history-confirmation-close"
                aria-label={t('common.close')}
                onClick={() => {
                  if (bulkDeleteBusy) return;
                  setBulkDeleteCategory(null);
                  setBulkDeleteRecordId(null);
                  setBulkDeleteError('');
                }}
              >
                <X size={18} strokeWidth={1.8} aria-hidden="true" />
              </button>
              <span className="history-confirmation-icon" aria-hidden="true">
                <Trash2 size={24} strokeWidth={1.8} />
              </span>
              <h2 className="history-confirmation-title">{bulkDeletePrompt}</h2>
              {bulkDeleteError && <p className="history-bulk-delete-error" role="alert">{bulkDeleteError}</p>}
              <div className="history-record-confirmation-actions">
                <button
                  type="button"
                  className="history-record-confirmation-action is-primary"
                  autoFocus
                  onClick={() => void confirmCategoryDelete()}
                  disabled={bulkDeleteBusy}
                >
                  {bulkDeleteBusy
                    ? bulkDeleteCategory === 'scheduled' ? t('history.cancelling') : t('history.deleting')
                    : bulkDeleteActionLabel}
                </button>
                <button
                  type="button"
                  className="history-record-confirmation-action is-secondary"
                  onClick={() => {
                    setBulkDeleteCategory(null);
                    setBulkDeleteRecordId(null);
                    setBulkDeleteError('');
                  }}
                  disabled={bulkDeleteBusy}
                >
                  {t('common.cancel')}
                </button>
              </div>
            </div>
          </div>
        )}
        {previewImagePath && previewImagePosition && createPortal(
          <div
            className="message-attachment-preview"
            style={{ left: `${previewImagePosition.left}px`, top: `${previewImagePosition.top}px` }}
            aria-label={t('history.increasedImage', { name: getAttachmentName(previewImagePath, t) })}
          >
            <img
              src={toAttachmentUrl(previewImagePath)}
              alt={getAttachmentName(previewImagePath, t)}
              draggable={false}
            />
          </div>,
          document.body,
        )}
      </aside>
    </>
  );
}
