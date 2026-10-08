import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Ellipsis, FileText, Maximize2, Minimize2, Paperclip, Search, Trash2, X } from 'lucide-react';
import { InlineKeyboardPreview } from '@/components/InlineKeyboardPreview';
import { richTextToHtml } from '@/lib/richText';
import { useLocale, type Locale } from '@/lib/i18n';
import type { PersistedDraftStore } from '$studio';
import { normalizePersistedStudioDrafts, sortHistoryItems } from './historyModel';
import type { HistoryItem } from './historyModel';

type HistorySourceFilter = 'all' | 'workspace' | 'personal';
type HistoryBulkActionSource = HistorySourceFilter;
type HistoryStatusFilter = 'scheduled' | 'sent' | 'drafts' | 'notes';
type HistoryExportFormat = 'txt' | 'json';
type HistoryTranslate = ReturnType<typeof useLocale>['t'];
const HISTORY_FILTER_STORAGE_KEY = 'xmsgi-history-filters';

function loadSavedHistoryFilters() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(HISTORY_FILTER_STORAGE_KEY) || 'null') as {
      sourceFilter?: unknown;
      statusFilter?: unknown;
    } | null;
    const sourceFilter: HistorySourceFilter = saved?.sourceFilter === 'workspace' || saved?.sourceFilter === 'personal'
      ? saved.sourceFilter
      : 'all';
    const storedStatus = saved?.statusFilter;
    const statusFilter: HistoryStatusFilter = storedStatus === 'sent' || storedStatus === 'drafts' || storedStatus === 'notes'
      ? storedStatus
      : 'scheduled';

    return {
      sourceFilter,
      statusFilter: sourceFilter === 'personal' && statusFilter === 'drafts'
        || sourceFilter !== 'personal' && statusFilter === 'notes'
        ? 'scheduled'
        : statusFilter,
    };
  } catch {
    return { sourceFilter: 'all' as const, statusFilter: 'scheduled' as const };
  }
}

type HistoryDraftStorageApi = {
  load: () => Promise<{ success: boolean; store?: PersistedDraftStore }>;
};

type HistoryWindow = Window & { draftStorage?: HistoryDraftStorageApi };

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

function matchesHistoryStatus(record: HistoryItem, filter: HistoryStatusFilter) {
  if (record.status === 'failed') return false;

  if (filter === 'notes') return isSavedMessagesRecord(record);

  if (filter === 'scheduled') {
    return record.status === 'scheduled'
      || record.status === 'sending'
      || record.status === 'cancelled';
  }
  if (filter === 'sent') return record.status === 'sent';
  return record.status === 'draft';
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
  const stickyDateHeading = list.querySelector<HTMLElement>('.history-date-heading');
  const stickyDateHeight = stickyDateHeading?.getBoundingClientRect().height ?? 0;
  const visibleTop = listBounds.top + list.clientTop + stickyDateHeight;
  const visibleBottom = listBounds.top + list.clientTop + list.clientHeight;
  const recordHeight = recordBounds.height;
  let nextScrollTop = list.scrollTop;

  if (recordHeight >= list.clientHeight) {
    nextScrollTop += recordBounds.bottom - visibleBottom;
  } else if (recordBounds.top < visibleTop) {
    nextScrollTop += recordBounds.top - visibleTop;
  } else if (recordBounds.bottom > visibleBottom) {
    nextScrollTop += recordBounds.bottom - visibleBottom;
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
  const searchableValues = [
    record.title,
    record.text,
    record.channelName,
    record.channelLabel,
    record.source === 'workspace' ? t('history.sourceStudio') : t('history.sourcePersonal'),
    getHistoryStatusLabel(record.status, t),
    formatTime(timestamp, locale),
    formatDateLabel(timestamp, locale, t),
    new Intl.DateTimeFormat(locale === 'ru' ? 'ru-RU' : 'en-US', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date),
    timestamp,
  ].map((value) => normalizeSearchText(value, locale));

  return tokens.every((token) => searchableValues.some((value) => value.includes(token)));
}

function getHistoryCategoryLabel(status: HistoryStatusFilter, t: HistoryTranslate) {
  if (status === 'scheduled') return t('history.categoryScheduled');
  if (status === 'sent') return t('history.categorySent');
  if (status === 'notes') return t('history.categoryNotes');
  return t('history.categoryDrafts');
}

function formatExportText(records: HistoryItem[], status: HistoryStatusFilter, source: HistorySourceFilter, locale: Locale, t: HistoryTranslate) {
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
  status: HistoryStatusFilter,
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
  onClose,
  records,
  onCancel,
  onReschedule,
  onSendNow,
  onDelete,
  onOpenDraft,
  onUseDraft,
  onClearSent,
  onClearDrafts,
  onCancelQueue,
}: {
  isOpen: boolean;
  onClose: () => void;
  records: HistoryItem[];
  onCancel: (record: HistoryItem) => void;
  onReschedule: (record: HistoryItem) => void;
  onSendNow: (record: HistoryItem) => void;
  onDelete: (record: HistoryItem) => void | Promise<boolean>;
  onOpenDraft: (record: HistoryItem) => void;
  onUseDraft?: (record: HistoryItem) => void;
  onClearSent: (source: HistoryBulkActionSource) => void;
  onClearDrafts?: () => Promise<boolean>;
  onCancelQueue?: (records: HistoryItem[]) => Promise<boolean>;
}) {
  const { locale, t } = useLocale();
  const [savedFilters] = useState(loadSavedHistoryFilters);
  const [sourceFilter, setSourceFilter] = useState<HistorySourceFilter>(savedFilters.sourceFilter);
  const [statusFilter, setStatusFilter] = useState<HistoryStatusFilter>(savedFilters.statusFilter);
  const [query, setQuery] = useState('');
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<HistoryItem | null>(null);
  const [draftItems, setDraftItems] = useState<HistoryItem[]>([]);
  const [confirmAction, setConfirmAction] = useState<{ type: 'cancel' | 'delete' | 'send-now'; recordId: string } | null>(null);
  const [bulkDeleteCategory, setBulkDeleteCategory] = useState<'scheduled' | 'sent' | 'drafts' | 'notes' | null>(null);
  const [bulkDeleteRecordId, setBulkDeleteRecordId] = useState<string | null>(null);
  const [bulkDeleteBusy, setBulkDeleteBusy] = useState(false);
  const [bulkDeleteError, setBulkDeleteError] = useState('');
  const [actionMenuOpenId, setActionMenuOpenId] = useState<string | null>(null);
  const [previewImagePath, setPreviewImagePath] = useState<string | null>(null);
  const [previewImagePosition, setPreviewImagePosition] = useState<{ left: number; top: number } | null>(null);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);
  const historyRecordListRef = useRef<HTMLDivElement | null>(null);
  const expandedRecordRef = useRef<HTMLElement | null>(null);
  const actionMenuRef = useRef<HTMLDivElement | null>(null);
  const preExpansionScrollTopRef = useRef<number | null>(null);
  const imageHoverTimerRef = useRef<number | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(HISTORY_FILTER_STORAGE_KEY, JSON.stringify({ sourceFilter, statusFilter }));
    } catch {
      // Keep history usable when local storage is unavailable.
    }
  }, [sourceFilter, statusFilter]);

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
    if (list && expandedRecord) scrollHistoryRecordIntoView(list, expandedRecord);
  }, [isOpen, selectedRecord]);

  useLayoutEffect(() => {
    if (!isOpen || !actionMenuOpenId) return;
    const list = historyRecordListRef.current;
    const actionMenu = actionMenuRef.current;
    if (list && actionMenu) scrollHistoryRecordIntoView(list, actionMenu);
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
    if (!isOpen) setConfirmAction(null);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    const draftStorage = (window as HistoryWindow).draftStorage;

    const loadDrafts = async () => {
      if (!draftStorage) {
        setDraftItems([]);
        return;
      }

      try {
        const result = await draftStorage.load();
        if (active) setDraftItems(result.success ? normalizePersistedStudioDrafts(result.store) : []);
      } catch {
        if (active) setDraftItems([]);
      }
    };

    void loadDrafts();
    return () => {
      active = false;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();

      if (previewImagePath) {
        closeImagePreview();
      } else if (confirmAction) {
        setConfirmAction(null);
      } else if (bulkDeleteCategory && !bulkDeleteBusy) {
        setBulkDeleteCategory(null);
        setBulkDeleteRecordId(null);
        setBulkDeleteError('');
      } else if (isExportMenuOpen) {
        setIsExportMenuOpen(false);
      } else if (actionMenuOpenId) {
        setActionMenuOpenId(null);
      } else if (selectedRecord) {
        setSelectedRecord(null);
      } else if (!bulkDeleteBusy) {
        onClose();
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleEscape);
    };
  }, [actionMenuOpenId, bulkDeleteBusy, bulkDeleteCategory, confirmAction, isExportMenuOpen, isOpen, onClose, previewImagePath, selectedRecord]);

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

  const filteredRecords = useMemo(() => {
    const categoryRecords = [...historyItems, ...draftItems]
      .filter((record) => {
        if (sourceFilter !== 'all' && record.source !== sourceFilter) return false;
        if (!matchesHistoryStatus(record, statusFilter)) return false;

        return matchesHistoryQuery(record, query, locale, t);
      });
    const sortedRecords = sortHistoryItems(categoryRecords, statusFilter === 'notes' ? 'sent' : statusFilter);
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

      if (matchesHistoryStatus(record, statusFilter)) {
        counts.source.all += 1;
        counts.source[record.source] += 1;
      }

      if (sourceFilter === 'all' || record.source === sourceFilter) {
        if (matchesHistoryStatus(record, 'scheduled')) counts.status.scheduled += 1;
        else if (matchesHistoryStatus(record, 'sent')) counts.status.sent += 1;
        else if (matchesHistoryStatus(record, 'drafts')) counts.status.drafts += 1;
        if (matchesHistoryStatus(record, 'notes')) counts.status.notes += 1;
      }
    }

    return counts;
  }, [draftItems, historyItems, sourceFilter, statusFilter]);
  const visibleStatusFilters: HistoryStatusFilter[] = sourceFilter === 'personal'
    ? ['scheduled', 'sent', 'notes']
    : ['scheduled', 'sent', 'drafts'];

  const selectedRecordIndex = selectedRecord
    ? filteredRecords.findIndex((record) => record.id === selectedRecord.id)
    : -1;
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
  const visibleRecords = selectedRecordIndex >= 0
    ? filteredRecords.slice(0, selectedRecordIndex + 1)
    : filteredRecords;
  const selectedCategoryLabel = getHistoryCategoryLabel(statusFilter, t);
  const exportMenuScope = selectedRecord
    ? t('history.recordScope', { title: selectedRecord.title })
    : t('history.currentList');
  const exportMenuHeading = selectedRecord
    ? t('history.exporting', { scope: selectedRecord.title })
    : t('history.exportCategory', { category: selectedCategoryLabel });
  const canDeleteCurrentCategory = statusFilter === 'scheduled'
    ? scheduleCleanupCount > 0
    : (statusFilter === 'sent' || statusFilter === 'drafts' || statusFilter === 'notes') && historyCounts.status[statusFilter] > 0;
  const selectedRecordMatchesDeleteCategory = Boolean(selectedRecordIndex >= 0 && selectedRecord && (
    statusFilter === 'scheduled'
      ? isQueueCancellationCandidate(selectedRecord) || isLocalScheduleFailure(selectedRecord)
      : statusFilter === 'sent'
        ? selectedRecord.status === 'sent'
        : statusFilter === 'notes'
          ? matchesHistoryStatus(selectedRecord, 'notes')
          : selectedRecord.status === 'draft'
  ));
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
          action: t(confirmActionRecord.status === 'failed' ? 'history.retrySendAction' : 'history.sendAction'),
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
    exportHistoryRecords(
      recordsToExport,
      statusFilter,
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

      if (!onClearDrafts || !await onClearDrafts()) {
        setBulkDeleteError(t('history.deleteDraftsFailed'));
        return;
      }

      setDraftItems([]);
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
    if (bulkDeleteCategory && ((statusFilter !== bulkDeleteCategory || historyCounts.status[bulkDeleteCategory] === 0)
      || (bulkDeleteRecordId !== null && bulkDeleteRecord?.id !== bulkDeleteRecordId))) {
      setBulkDeleteCategory(null);
      setBulkDeleteRecordId(null);
      setBulkDeleteError('');
    }
  }, [bulkDeleteCategory, bulkDeleteRecord?.id, bulkDeleteRecordId, historyCounts.status, statusFilter]);

  if (!isOpen) return null;

  return (
    <>
      <div
        className="history-drawer-backdrop"
        aria-hidden="true"
        onClick={onClose}
      />

      <aside
        className="history-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={t('history.title')}
      >
        <header className="history-drawer-header">
          <h2 aria-label={t('history.title')}>{t('history.title')} <span aria-hidden="true">{historyCounts.total}</span></h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('history.close')}
            className="history-drawer-close"
          >
            <X size={20} strokeWidth={1.7} />
          </button>
        </header>

        <div className="history-drawer-controls">
          <div className="history-source-filters" role="group" aria-label={t('history.sources')}>
            {(['all', 'workspace', 'personal'] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => {
                  setSourceFilter(item);
                  if (item === 'personal' && statusFilter === 'drafts'
                    || item !== 'personal' && statusFilter === 'notes') setStatusFilter('scheduled');
                  setBulkDeleteCategory(null);
                  setBulkDeleteRecordId(null);
                  setBulkDeleteError('');
                }}
                className={`history-filter${sourceFilter === item ? ' is-active' : ''}`}
                aria-pressed={sourceFilter === item}
                aria-label={item === 'all' ? t('history.sourceAll') : item === 'workspace' ? t('history.sourceStudio') : t('history.sourcePersonal')}
              >
                <span>{item === 'all' ? t('history.sourceAll') : item === 'workspace' ? t('history.sourceStudio') : t('history.sourcePersonal')}</span>
                <span className="history-filter-count" aria-hidden="true">{historyCounts.source[item]}</span>
              </button>
            ))}
          </div>

        </div>

        <div className="history-record-list" ref={historyRecordListRef}>
          {filteredRecords.length === 0 ? (
            <div className="history-empty" role="status">
              <Search size={21} strokeWidth={1.5} aria-hidden="true" />
              <strong>{query ? t('history.noResults') : t('history.emptyCategory')}</strong>
              <span>{query
                ? t('history.changeSearch')
                : sourceFilter === 'personal' && statusFilter === 'notes'
                  ? t('history.appNotesHint')
                  : sourceFilter === 'personal'
                  ? t('history.personalEmpty')
                  : t('history.generalEmpty')}</span>
              {query && <button type="button" onClick={() => setQuery('')}>{t('history.resetSearch')}</button>}
            </div>
          ) : (
            visibleRecords.map((record, index) => {
              const isExpanded = selectedRecord?.id === record.id;
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
                ? { label: t('history.retrySend'), handler: () => confirmSendNow(record), type: 'send-now' }
                : record.status === 'scheduled'
                  ? canReschedule
                    ? { label: t('history.edit'), handler: () => { onReschedule(record); onClose(); }, type: 'reschedule' }
                    : record.source === 'personal'
                      ? null
                      : { label: t('history.sendNow'), handler: () => confirmSendNow(record), type: 'send-now' }
                  : record.status === 'draft'
                      ? { label: t('history.useDraft'), handler: () => { onUseDraft?.(record); onClose(); }, type: 'use-draft' }
                    : null;
              const secondaryActions = [
                ...(record.status === 'draft'
                  ? [
                    { label: t('history.editDraft'), handler: () => { onOpenDraft(record); onClose(); }, type: 'open-draft' },
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

              return (
              <Fragment key={record.id}>
              {startsNewDay && (
                <h3 className="history-date-heading" aria-label={formatHistoryDayLabel(timestamp, locale, t)}>
                  {formatHistoryDayLabel(timestamp, locale, t)}
                </h3>
              )}
              <article
                ref={isExpanded ? expandedRecordRef : undefined}
                className={`history-record${isExpanded ? ' is-expanded' : ''}${record.status === 'draft' ? ' is-draft' : ''}`}
                data-draft-color={record.status === 'draft' ? record.draftColor ?? 'gray' : undefined}
              >
                <button
                  type="button"
                  className="history-record-open"
                  onClick={() => toggleExpandedRecord(record, isExpanded)}
                  aria-label={t('history.expandRecord', { action: t(isExpanded ? 'history.collapse' : 'history.open'), title: record.title })}
                  aria-expanded={isExpanded}
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
                        <span className="history-record-attachment-count">{record.attachments.length}</span>
                      </span>
                    ) : (
                      <span className="history-record-attachments is-empty" aria-hidden="true" />
                    )}
                  </span>

                  <span className="history-record-heading">
                    <strong>{record.title}</strong>
                    {!isExpanded && <time dateTime={timestamp}>{formatTime(timestamp, locale)}</time>}
                  </span>

                  {channelDetail && <span className="history-record-chat">{channelDetail}</span>}
                  {!isExpanded && <span className="history-record-text">{record.text}</span>}
                  {!isExpanded && record.lastError && <span className="history-record-error-preview">{record.lastError}</span>}
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
                    {record.lastError && <p className="history-record-error" role="alert">{record.lastError}</p>}
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
                <div className="history-record-actions">
                  <div className="history-record-leading-actions">
                    {primaryAction && (
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
                  <button
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
                  </button>
                  {record.status === 'sending' && scheduleMessage && (
                    <button type="button" className="history-record-action is-send-now" disabled>
                      <span>{t('history.sending')}</span>
                    </button>
                  )}
                </div>
              </article>
              </Fragment>
              );
            })
          )}
        </div>

        <div className="history-drawer-tools">
          <div className="history-search-dock">
          <div className="history-search" role="search">
            <Search size={18} strokeWidth={1.7} aria-hidden="true" />
            <div className="history-search-entry">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('history.searchPlaceholder')}
                aria-label={t('history.searchPlaceholder')}
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
              aria-label={t('history.results', { shown: filteredRecords.length, total: historyCounts.total })}
              title={t('history.results', { shown: filteredRecords.length, total: historyCounts.total })}
            >
              {t('history.results', { shown: filteredRecords.length, total: historyCounts.total })}
            </div>
          </div>
          </div>

          <div className="history-drawer-footer" aria-label={t('history.actionsPanel')}>
            <div className="history-status-row">
            <div className="history-status-filters" role="tablist" aria-label={t('history.statuses')}>
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
                    onClick={() => {
                      setStatusFilter(item);
                      setBulkDeleteCategory(null);
                      setBulkDeleteRecordId(null);
                      setBulkDeleteError('');
                    }}
                    className={`history-status-tab${statusFilter === item ? ' is-active' : ''}`}
                    role="tab"
                    aria-selected={statusFilter === item}
                    aria-label={t(labelKey)}
                    title={t(labelKey)}
                  >
                    <span className="history-status-label">{t(labelKey)}</span>
                    <span className="history-status-label-compact">{t(compactLabelKey)}</span>
                    <span className="history-filter-count" aria-hidden="true">{historyCounts.status[item]}</span>
                  </button>
                );
              })}
            </div>

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
                  title={selectedRecordMatchesDeleteCategory && selectedRecord
                    ? statusFilter === 'scheduled'
                      ? isLocalScheduleFailure(selectedRecord) ? t('history.deleteErrorFromHistoryTitle', { title: selectedRecord.title }) : t('history.cancelTelegramTitle', { title: selectedRecord.title })
                      : t('history.deleteTitle', { title: selectedRecord.title })
                    : statusFilter === 'scheduled'
                      ? scheduleCleanupTitle
                      : statusFilter === 'sent' ? t('history.deleteSent') : statusFilter === 'notes' ? t('history.deleteNotesTitle') : t('history.deleteDrafts')}
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
                  <Trash2 size={16} strokeWidth={1.8} aria-hidden="true" />
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
                aria-label={selectedRecord ? t('history.exportRecord', { title: selectedRecord.title }) : t('history.exportCurrent')}
                aria-haspopup="menu"
                aria-expanded={isExportMenuOpen}
                title={selectedRecord ? t('history.exportRecord', { title: selectedRecord.title }) : t('history.exportCount', { count: formatHistoryCount(filteredRecords.length, locale) })}
              >
                <Download size={15} strokeWidth={1.8} aria-hidden="true" />
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
              aria-label={confirmAction.type === 'cancel'
                ? t('history.confirmCancel')
                : confirmAction.type === 'send-now' ? t('history.confirmSend') : t('history.confirmDelete')}
            >
              <p>{confirmActionPrompt}</p>
              <div className="history-record-confirmation-actions">
                <button
                  type="button"
                  className="history-record-confirmation-action is-secondary"
                  autoFocus
                  onClick={() => setConfirmAction(null)}
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="button"
                  className="history-record-confirmation-action is-primary"
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
              <p>{bulkDeletePrompt}</p>
              {bulkDeleteError && <p className="history-bulk-delete-error" role="alert">{bulkDeleteError}</p>}
              <div className="history-record-confirmation-actions">
                <button
                  type="button"
                  className="history-record-confirmation-action is-secondary"
                  autoFocus
                  onClick={() => {
                    setBulkDeleteCategory(null);
                    setBulkDeleteRecordId(null);
                    setBulkDeleteError('');
                  }}
                  disabled={bulkDeleteBusy}
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="button"
                  className="history-record-confirmation-action is-primary"
                  onClick={() => void confirmCategoryDelete()}
                  disabled={bulkDeleteBusy}
                >
                  {bulkDeleteBusy
                    ? bulkDeleteCategory === 'scheduled' ? t('history.cancelling') : t('history.deleting')
                    : bulkDeleteActionLabel}
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
