import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, FileText, Maximize2, Minimize2, Paperclip, Search, Trash2, X } from 'lucide-react';
import { InlineKeyboardPreview } from '@/components/InlineKeyboardPreview';
import { richTextToHtml } from '@/lib/richText';
import type { PersistedDraftStore } from '../../../Studio/Studio module/src/types';
import { normalizePersistedStudioDrafts, normalizeSavedDraft, sortHistoryItems } from './historyModel';
import type { HistoryItem } from './historyModel';

type HistorySourceFilter = 'all' | 'workspace' | 'personal';
type HistoryBulkActionSource = HistorySourceFilter;
type HistoryStatusFilter = 'scheduled' | 'sent' | 'drafts';
type HistoryExportFormat = 'txt' | 'json';
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
    const statusFilter: HistoryStatusFilter = storedStatus === 'sent' || storedStatus === 'drafts'
      ? storedStatus
      : 'scheduled';

    return {
      sourceFilter,
      statusFilter: sourceFilter === 'personal' && statusFilter === 'drafts' ? 'scheduled' : statusFilter,
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
  return /\.(?:avif|gif|jpe?g|png|webp)$/i.test(filePath);
}

function getAttachmentName(filePath: string) {
  return filePath.split(/[\\/]/).pop() || filePath;
}

function formatDateLabel(value: string) {
  const date = new Date(value);
  const today = new Date();
  const daysDiff = Math.round((new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 86400000);

  if (daysDiff === 0) return 'Сегодня';
  if (daysDiff === 1) return 'Завтра';
  if (daysDiff === -1) return 'Вчера';

  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
  }).format(date);
}

function getHistoryDayKey(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'unknown';
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function formatHistoryDayLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Без даты';

  const today = new Date();
  const todayKey = getHistoryDayKey(today.toISOString());
  const dateKey = getHistoryDayKey(value);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  if (dateKey === todayKey) return 'Сегодня';
  if (dateKey === getHistoryDayKey(yesterday.toISOString())) return 'Вчера';

  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    ...(date.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' as const }),
  }).format(date);
}

function matchesHistoryStatus(record: HistoryItem, filter: HistoryStatusFilter) {
  if (record.status === 'failed') return false;

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

function formatHistoryCount(count: number) {
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

function formatDraftCount(count: number) {
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

function formatTime(value: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function normalizeSearchText(value: string) {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('ru-RU')
    .replace(/(\d{1,2})[.:](\d{2})/g, '$1:$2')
    .replace(/[.,/_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getHistoryStatusLabel(status: HistoryItem['status']) {
  if (status === 'scheduled') return 'Запланировано';
  if (status === 'sending') return 'Отправляется';
  if (status === 'sent') return 'Отправлено';
  if (status === 'failed') return 'Ошибка';
  if (status === 'cancelled') return 'Отменено';
  if (status === 'draft') return 'Черновик';
  return 'Черновик';
}

function formatAttachmentCount(count: number) {
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

function matchesHistoryQuery(record: HistoryItem, query: string) {
  const tokens = normalizeSearchText(query).split(' ').filter(Boolean);
  if (tokens.length === 0) return true;

  const timestamp = getHistoryTimestamp(record);
  const date = new Date(timestamp);
  const searchableValues = [
    record.title,
    record.text,
    record.channelName,
    record.channelLabel,
    record.source === 'workspace' ? 'Studio' : 'Личное',
    getHistoryStatusLabel(record.status),
    formatTime(timestamp),
    formatDateLabel(timestamp),
    new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date),
    timestamp,
  ].map(normalizeSearchText);

  return tokens.every((token) => searchableValues.some((value) => value.includes(token)));
}

function getHistoryCategoryLabel(status: HistoryStatusFilter) {
  if (status === 'scheduled') return 'Запланировано';
  if (status === 'sent') return 'Отправлено';
  return 'Черновики';
}

function formatExportText(records: HistoryItem[], status: HistoryStatusFilter, source: HistorySourceFilter) {
  const exportedAt = new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date());
  const entries = records.map((record, index) => {
    const timestamp = getHistoryTimestamp(record);
    const dateTime = timestamp && !Number.isNaN(new Date(timestamp).getTime())
      ? new Intl.DateTimeFormat('ru-RU', {
      dateStyle: 'medium',
      timeStyle: 'short',
      }).format(new Date(timestamp))
      : '—';
    const lines = [
      `${index + 1}. ${record.title}`,
      `Источник: ${record.source === 'workspace' ? 'Studio' : 'Личное'}`,
      ...(record.channelName
        ? [`Чат: ${record.channelLabel ? `${record.channelName} (${record.channelLabel})` : record.channelName}`]
        : []),
      `Дата и время: ${dateTime}`,
      `Статус: ${getHistoryStatusLabel(record.status)}`,
      '',
      'Текст:',
      record.text || '—',
    ];

    if (record.attachments.length) {
      lines.push('', 'Вложения:', ...record.attachments.map((attachment) => `- ${getAttachmentName(attachment)}`));
    }

    if (record.lastError) lines.push('', `Ошибка: ${record.lastError}`);
    if (record.silent) lines.push('', 'Отправка без звука');
    if (record.effect) lines.push(`Эффект: ${record.effect}`);

    return lines.join('\n');
  });

  return [
    `XMSGi — ${getHistoryCategoryLabel(status)}`,
    `Источник: ${source === 'all' ? 'Все' : source === 'workspace' ? 'Studio' : 'Личное'}`,
    `Экспортировано: ${exportedAt}`,
    `Всего: ${records.length}`,
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
  recordTitle?: string,
) {
  const payload = format === 'json'
    ? JSON.stringify({
      exportedAt: new Date().toISOString(),
      filters: { source, status, query: query.trim() },
      records,
    }, null, 2)
    : formatExportText(records, status, source);
  const mimeType = format === 'json' ? 'application/json;charset=utf-8' : 'text/plain;charset=utf-8';
  const blob = new Blob([payload], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const date = new Date().toISOString().slice(0, 10);
  const category = status === 'scheduled' ? 'scheduled' : status === 'sent' ? 'sent' : 'drafts';

  link.href = url;
  const recordName = recordTitle
    ? `-${recordTitle.replace(/[<>:"|?*\u0000-\u001f]/g, '').replace(/\//g, '').replace(/\\/g, '').trim().replace(/\s+/g, '-').replace(/[.]+$/g, '').slice(0, 80) || 'record'}`
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
  const [savedFilters] = useState(loadSavedHistoryFilters);
  const [sourceFilter, setSourceFilter] = useState<HistorySourceFilter>(savedFilters.sourceFilter);
  const [statusFilter, setStatusFilter] = useState<HistoryStatusFilter>(savedFilters.statusFilter);
  const [query, setQuery] = useState('');
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<HistoryItem | null>(null);
  const [draftItems, setDraftItems] = useState<HistoryItem[]>([]);
  const [confirmAction, setConfirmAction] = useState<{ type: 'cancel' | 'delete' | 'send-now'; recordId: string } | null>(null);
  const [bulkDeleteCategory, setBulkDeleteCategory] = useState<'scheduled' | 'sent' | 'drafts' | null>(null);
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
    const categoryRecords = [...records, ...draftItems]
      .filter((record) => {
        if (sourceFilter !== 'all' && record.source !== sourceFilter) return false;
        if (!matchesHistoryStatus(record, statusFilter)) return false;

        return matchesHistoryQuery(record, query);
      });
    const sortedRecords = sortHistoryItems(categoryRecords, statusFilter);
    if (sourceFilter !== 'all') return sortedRecords;

    return sortedRecords.sort((left, right) => {
      const leftTime = Date.parse(getHistoryOrderingTimestamp(left, statusFilter)) || 0;
      const rightTime = Date.parse(getHistoryOrderingTimestamp(right, statusFilter)) || 0;
      return rightTime - leftTime;
    });
  }, [draftItems, query, records, sourceFilter, statusFilter]);

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
      status: { scheduled: 0, sent: 0, drafts: 0 },
    };

    for (const record of [...records, ...draftItems]) {
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
      }
    }

    return counts;
  }, [draftItems, records, sourceFilter, statusFilter]);
  const visibleStatusFilters: HistoryStatusFilter[] = sourceFilter === 'personal'
    ? ['scheduled', 'sent']
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
    ? 'Очистить ошибки и отменить расписания'
    : queueCancellableRecords.length > 0
      ? `Отменить ${formatHistoryCount(queueCancellableRecords.length)}`
      : `Удалить ошибки (${localScheduleFailureRecords.length})`;
  const scheduleCleanupAriaLabel = queueCancellableRecords.length > 0 && localScheduleFailureRecords.length > 0
    ? 'Отменить запланированные публикации и удалить ошибки из истории'
    : queueCancellableRecords.length > 0
      ? 'Отменить запланированные публикации'
      : 'Удалить ошибочные записи из истории';
  const scheduleCleanupTitle = queueCancellableRecords.length > 0 && localScheduleFailureRecords.length > 0
    ? 'Отменить подтверждённые расписания в Telegram и удалить ошибки из истории'
    : queueCancellableRecords.length > 0
      ? 'Отменить запланированные публикации в Telegram'
      : 'Удалить локальные ошибки расписания из истории';
  const visibleRecords = selectedRecordIndex >= 0
    ? filteredRecords.slice(0, selectedRecordIndex + 1)
    : filteredRecords;
  const selectedSource = sourceFilter === 'all' ? null : sourceFilter;
  const hasUpcomingInSelectedSource = selectedSource !== null && records.some((record) =>
    record.source === selectedSource && record.original.kind === 'scheduled' && record.status !== 'sent',
  );
  const selectedCategoryLabel = getHistoryCategoryLabel(statusFilter);
  const exportMenuScope = selectedRecord ? `«${selectedRecord.title}»` : 'текущий список';
  const exportMenuHeading = selectedRecord
    ? `Экспортируется: ${selectedRecord.title}`
    : `Текущая категория: ${selectedCategoryLabel}`;
  const canDeleteCurrentCategory = statusFilter === 'scheduled'
    ? scheduleCleanupCount > 0
    : (statusFilter === 'sent' || statusFilter === 'drafts') && historyCounts.status[statusFilter] > 0;
  const categoryDeleteCount = statusFilter === 'scheduled'
    ? scheduleCleanupCount
    : historyCounts.status[statusFilter];
  const selectedRecordMatchesDeleteCategory = Boolean(selectedRecordIndex >= 0 && selectedRecord && (
    statusFilter === 'scheduled'
      ? isQueueCancellationCandidate(selectedRecord) || isLocalScheduleFailure(selectedRecord)
      : statusFilter === 'sent'
        ? selectedRecord.status === 'sent'
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
      ? `Убрать публикацию «${confirmActionRecord.title}» из расписания Telegram?`
      : confirmAction.type === 'send-now'
        ? `${confirmActionRecord.status === 'failed' ? 'Повторить отправку' : 'Отправить публикацию'} в «${confirmActionRecord.title}» сейчас?`
        : confirmActionRecord.status === 'failed'
          ? 'Удалить ошибочную запись из истории? Публикация может остаться в очереди Telegram.'
          : confirmActionRecord.status === 'draft'
            ? `Удалить черновик «${confirmActionRecord.title}»? Восстановление невозможно.`
            : `Удалить запись «${confirmActionRecord.title}» из истории? Сообщение в Telegram останется.`
    : '';
  const bulkDeleteCount = bulkDeleteRecord
    ? 1
    : bulkDeleteCategory === 'scheduled'
      ? scheduleCleanupCount
      : bulkDeleteCategory ? historyCounts.status[bulkDeleteCategory] : 0;
  const bulkDeletePrompt = bulkDeleteRecord
    ? bulkDeleteRecord.status === 'scheduled'
      ? `Убрать публикацию «${bulkDeleteRecord.title}» из расписания Telegram?`
      : isLocalScheduleFailure(bulkDeleteRecord)
        ? `Удалить ошибку «${bulkDeleteRecord.title}» из истории? Telegram не подтвердил создание публикации.`
      : bulkDeleteRecord.status === 'failed' && bulkDeleteRecord.retryAction === 'cancel'
        ? `Повторить отмену «${bulkDeleteRecord.title}» в Telegram?`
      : bulkDeleteRecord.status === 'sent'
        ? `Удалить «${bulkDeleteRecord.title}» из истории? Сообщение в Telegram останется.`
        : `Удалить черновик «${bulkDeleteRecord.title}»? Восстановление невозможно.`
    : bulkDeleteCategory === 'sent'
      ? `Удалить ${formatHistoryCount(bulkDeleteCount)} из истории? Сообщения в Telegram останутся.`
      : bulkDeleteCategory === 'drafts'
        ? `Удалить ${formatDraftCount(bulkDeleteCount)}? Восстановление невозможно.`
        : queueCancellableRecords.length > 0 && localScheduleFailureRecords.length > 0
          ? `Отменить в Telegram ${formatHistoryCount(queueCancellableRecords.length)} и удалить ошибки (${localScheduleFailureRecords.length}) из истории?`
          : queueCancellableRecords.length > 0
            ? `Снять с расписания ${formatHistoryCount(queueCancellableRecords.length)} в Telegram? Если отмена не подтвердится, публикации останутся в очереди.`
            : `Удалить ошибки (${localScheduleFailureRecords.length}) из истории? Telegram не подтвердил создание публикаций.`;
  const bulkDeleteActionLabel = bulkDeleteRecord
    ? bulkDeleteRecord.status === 'scheduled'
      ? 'Отменить расписание'
      : isLocalScheduleFailure(bulkDeleteRecord)
        ? 'Удалить ошибку'
      : bulkDeleteRecord.status === 'failed' && bulkDeleteRecord.retryAction === 'cancel'
        ? 'Повторить отмену'
      : bulkDeleteRecord.status === 'draft' ? 'Удалить черновик' : 'Удалить запись'
    : bulkDeleteCategory === 'scheduled'
      ? scheduleCleanupLabel
      : `Удалить ${bulkDeleteCategory === 'sent' ? formatHistoryCount(bulkDeleteCount) : formatDraftCount(bulkDeleteCount)}`;
  const exportRecords = (format: HistoryExportFormat) => {
    const recordsToExport = selectedRecord ? [selectedRecord] : filteredRecords;
    exportHistoryRecords(
      recordsToExport,
      statusFilter,
      selectedRecord?.source ?? sourceFilter,
      query,
      format,
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
        if (bulkDeleteCategory === 'scheduled') {
          if (isLocalScheduleFailure(bulkDeleteRecord)) {
            await onDelete(bulkDeleteRecord);
            setSelectedRecord(null);
            setBulkDeleteRecordId(null);
            setBulkDeleteCategory(null);
            return;
          }
          if (!onCancelQueue || !await onCancelQueue([bulkDeleteRecord])) {
            setBulkDeleteError('Не удалось отменить публикацию в Telegram. Запись осталась в очереди.');
            return;
          }
          setSelectedRecord(null);
          setBulkDeleteRecordId(null);
          setBulkDeleteCategory(null);
          return;
        }

        const deletionResult = await onDelete(bulkDeleteRecord);
        if (bulkDeleteRecord.status === 'draft' && deletionResult !== true) {
          setBulkDeleteError('Не удалось удалить черновик. Попробуйте ещё раз.');
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
          setBulkDeleteError(localScheduleFailureRecords.length > 0
            ? 'Ошибки удалены из истории. Не все расписания удалось отменить; оставшиеся публикации сохранены в очереди.'
            : 'Не все публикации удалось отменить. Оставшиеся записи сохранены в очереди.');
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

      if (!onClearDrafts || !await onClearDrafts()) {
        setBulkDeleteError('Не удалось удалить черновики. Попробуйте ещё раз.');
        return;
      }

      setDraftItems([]);
      setSelectedRecord(null);
      setBulkDeleteRecordId(null);
      setBulkDeleteCategory(null);
    } catch (error) {
      setBulkDeleteError(error instanceof Error ? error.message : 'Не удалось удалить выбранную категорию.');
    } finally {
      setBulkDeleteBusy(false);
    }
  };

  useEffect(() => {
    if (bulkDeleteCategory && (statusFilter !== bulkDeleteCategory || historyCounts.status[bulkDeleteCategory] === 0
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
        aria-label="Публикации"
      >
        <header className="history-drawer-header">
          <h2 aria-label="Публикации">Публикации <span aria-hidden="true">{historyCounts.total}</span></h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть историю"
            className="history-drawer-close"
          >
            <X size={20} strokeWidth={1.7} />
          </button>
        </header>

        <div className="history-drawer-controls">
          <div className="history-source-filters" role="group" aria-label="Источник записей">
            {(['all', 'workspace', 'personal'] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => {
                  setSourceFilter(item);
                  if (item === 'personal' && statusFilter === 'drafts') setStatusFilter('scheduled');
                  setBulkDeleteCategory(null);
                  setBulkDeleteRecordId(null);
                  setBulkDeleteError('');
                }}
                className={`history-filter${sourceFilter === item ? ' is-active' : ''}`}
                aria-pressed={sourceFilter === item}
                aria-label={item === 'all' ? 'Все' : item === 'workspace' ? 'Studio' : 'Личное'}
              >
                <span>{item === 'all' ? 'Все' : item === 'workspace' ? 'Studio' : 'Личное'}</span>
                <span className="history-filter-count" aria-hidden="true">{historyCounts.source[item]}</span>
              </button>
            ))}
          </div>

        </div>

        <div className="history-record-list" ref={historyRecordListRef}>
          {filteredRecords.length === 0 ? (
            <div className="history-empty" role="status">
              <Search size={21} strokeWidth={1.5} aria-hidden="true" />
              <strong>{query ? 'Ничего не найдено' : 'В этой категории пока пусто'}</strong>
              <span>{query
                ? 'Измените запрос или очистите поиск.'
                : sourceFilter === 'personal'
                  ? 'Здесь появятся ваши сообщения.'
                  : 'Здесь появятся ваши сообщения и черновики.'}</span>
              {query && <button type="button" onClick={() => setQuery('')}>Сбросить запрос</button>}
            </div>
          ) : (
            visibleRecords.map((record, index) => {
              const isExpanded = selectedRecord?.id === record.id;
              const timestamp = getHistoryTimestamp(record);
              const orderingTimestamp = getHistoryOrderingTimestamp(record, statusFilter);
              const channelDetail = [record.channelLabel, record.channelName]
                .find((value) => value.trim() && value.trim() !== record.title.trim());
              const startsNewDay = index === 0
                || getHistoryDayKey(getHistoryTimestamp(visibleRecords[index - 1])) !== getHistoryDayKey(timestamp);
              const entities = record.entities;
              const scheduleMessage = record.original.kind === 'scheduled' ? record.original.message : null;
              const canReschedule = record.source === 'workspace' && record.status === 'scheduled' && scheduleMessage;
              const primaryAction = record.status === 'failed'
                ? { label: 'Повторить отправку', handler: () => confirmSendNow(record), type: 'send-now' }
                : record.status === 'scheduled'
                  ? canReschedule
                    ? { label: 'Изменить', handler: () => { onReschedule(record); onClose(); }, type: 'reschedule' }
                    : record.source === 'personal'
                      ? null
                      : { label: 'Отправить сейчас', handler: () => confirmSendNow(record), type: 'send-now' }
                  : record.status === 'draft'
                      ? { label: 'Использовать', handler: () => { onUseDraft?.(record); onClose(); }, type: 'use-draft' }
                    : null;
              const secondaryActions = [
                ...(record.status === 'draft'
                  ? [
                    { label: 'Редактировать', handler: () => { onOpenDraft(record); onClose(); }, type: 'open-draft' },
                    { label: 'Удалить', handler: () => {
                      setBulkDeleteError('');
                      setBulkDeleteCategory('drafts');
                      setBulkDeleteRecordId(record.id);
                    }, type: 'delete' },
                  ]
                  : []),
                ...(record.status === 'scheduled' && scheduleMessage
                  ? [
                    ...(canReschedule || record.source === 'personal'
                      ? [{ label: 'Отправить сейчас', handler: () => confirmSendNow(record), type: 'send-now' }]
                      : []),
                    { label: 'Отменить', handler: () => setConfirmAction({ type: 'cancel', recordId: record.id }), type: 'cancel' },
                  ]
                  : []),
                ...((record.status === 'sent' || record.status === 'failed') && scheduleMessage
                  ? [{ label: 'Удалить', handler: () => setConfirmAction({ type: 'delete', recordId: record.id }), type: 'delete' }] 
                  : []),
              ];

              return (
              <Fragment key={record.id}>
              {startsNewDay && (
                <h3 className="history-date-heading" aria-label={formatHistoryDayLabel(timestamp)}>
                  {formatHistoryDayLabel(timestamp)}
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
                  aria-label={`${isExpanded ? 'Свернуть' : 'Открыть'} публикацию: ${record.title}`}
                  aria-expanded={isExpanded}
                >
                  <span className="history-record-meta">
                    <span className="history-record-source-group">
                      <span className={`history-record-source is-${record.source === 'workspace' ? 'studio' : 'personal'}`}>
                        {record.source === 'workspace' ? 'Studio' : 'Личное'}
                      </span>
                      {record.status === 'draft' && (
                        <span
                          className="history-record-draft-dot"
                          data-color={record.draftColor ?? 'gray'}
                          aria-label={`Цвет черновика: ${record.draftColor ?? 'gray'}`}
                          title={`Цвет: ${record.draftColor ?? 'gray'}`}
                        />
                      )}
                    </span>
                    {!isExpanded && (
                      <span className="history-record-date">
                        {getHistoryStatusLabel(record.status)} · {formatDateLabel(timestamp)}
                      </span>
                    )}
                    {record.attachments.length > 0 ? (
                      <span className="history-record-attachments" aria-label={formatAttachmentCount(record.attachments.length)} title={formatAttachmentCount(record.attachments.length)}>
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
                    {!isExpanded && <time dateTime={timestamp}>{formatTime(timestamp)}</time>}
                  </span>

                  {channelDetail && <span className="history-record-chat">{channelDetail}</span>}
                  {!isExpanded && <span className="history-record-text">{record.text}</span>}
                  {!isExpanded && record.lastError && <span className="history-record-error-preview">{record.lastError}</span>}
                </button>
                {isExpanded && (
                  <div
                    className="history-post-expanded"
                    aria-label={`Полное содержимое записи: ${record.title}`}
                    onClick={(event) => {
                      if (event.target !== event.currentTarget) return;
                      const bubble = event.currentTarget.querySelector('.history-post-bubble');
                      const bubbleLeft = bubble?.getBoundingClientRect().left
                        ?? event.currentTarget.getBoundingClientRect().left + 56;
                      if (event.clientX < bubbleLeft) setSelectedRecord(null);
                    }}
                  >
                    <div className="history-post-time-row">
                      <time dateTime={timestamp}>{formatTime(timestamp)}</time>
                      <span>{getHistoryStatusLabel(record.status)}</span>
                    </div>
                    {record.lastError && <p className="history-record-error" role="alert">{record.lastError}</p>}
                    <div className="history-post-bubble">
                      {Boolean(record.attachments.length) && (
                        <div className="history-post-attachments" aria-label="Вложения">
                          {record.attachments.map((attachment) => (
                            isImageAttachment(attachment) ? (
                              <img
                                key={attachment}
                                src={toAttachmentUrl(attachment)}
                                alt={getAttachmentName(attachment)}
                                onPointerEnter={(event) => openImagePreview(event.currentTarget, attachment)}
                                onPointerLeave={closeImagePreview}
                                onLoad={() => {
                                  const list = historyRecordListRef.current;
                                  const expandedRecord = expandedRecordRef.current;
                                  if (list && expandedRecord) scrollHistoryRecordIntoView(list, expandedRecord);
                                }}
                              />
                            ) : (
                              <a key={attachment} href={toAttachmentUrl(attachment)} download={getAttachmentName(attachment)}>
                                <FileText size={17} strokeWidth={1.7} aria-hidden="true" />
                                <span>{getAttachmentName(attachment)}</span>
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
                      <InlineKeyboardPreview markup={scheduleMessage?.replyMarkup} />
                    </div>
                    {(record.silent || record.effect) && (
                      <div className="history-post-options">
                        {record.silent && <span>Без звука</span>}
                        {record.effect && <span>Эффект: {record.effect}</span>}
                      </div>
                    )}
                  </div>
                )}
                <div className="history-record-actions">
                  <button
                    type="button"
                    className="history-record-action is-expand"
                    onClick={() => toggleExpandedRecord(record, isExpanded)}
                    aria-label={`${isExpanded ? 'Свернуть' : 'Показать полностью'}: ${record.title}`}
                    aria-expanded={isExpanded}
                  >
                    {isExpanded
                      ? <Minimize2 size={14} strokeWidth={1.8} aria-hidden="true" />
                      : <Maximize2 size={14} strokeWidth={1.8} aria-hidden="true" />}
                    <span>{isExpanded ? 'Свернуть' : 'Полный размер'}</span>
                  </button>
                  {primaryAction && (
                    <button
                      type="button"
                      className="history-record-action is-primary"
                      onClick={primaryAction.handler}
                      aria-label={primaryAction.type === 'reschedule'
                        ? `Изменить: ${record.title}`
                        : primaryAction.type === 'open-draft'
                          ? `Редактировать черновик: ${record.title}`
                          : primaryAction.type === 'use-draft'
                            ? `Использовать черновик: ${record.title}`
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
                        aria-label="Ещё"
                        aria-expanded={actionMenuOpenId === record.id}
                      >
                        <span>Ещё</span>
                      </button>
                      {actionMenuOpenId === record.id && (
                        <div ref={actionMenuRef} className="history-record-action-menu" role="menu" aria-label={`Дополнительные действия для ${record.title}`}>
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
                              aria-label={action.type === 'reschedule' ? `Изменить: ${record.title}` : action.label}
                            >
                              {action.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  {record.status === 'sending' && scheduleMessage && (
                    <button type="button" className="history-record-action is-send-now" disabled>
                      <span>Отправляется…</span>
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
                placeholder="Поиск по истории"
                aria-label="Поиск по истории"
              />
              <button
                type="button"
                className={`history-search-clear${query.length > 0 ? '' : ' is-reserved'}`}
                onClick={() => setQuery('')}
                disabled={query.length === 0}
                aria-label="Очистить поиск"
              >
                <X size={15} strokeWidth={1.8} aria-hidden="true" />
              </button>
            </div>
            <div
              className="history-result-count"
              role="status"
              aria-live="polite"
              aria-label={`Найдено ${filteredRecords.length} из ${historyCounts.total} записей`}
              title={`Найдено ${filteredRecords.length} из ${historyCounts.total} записей`}
            >
              {`Найдено ${filteredRecords.length} из ${historyCounts.total}`}
            </div>
          </div>
          </div>

          <div className="history-drawer-footer" aria-label="Панель действий истории">
            <div className="history-status-row">
            <div className="history-status-filters" role="tablist" aria-label="Статус записей">
              {visibleStatusFilters.map((item) => (
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
                  aria-label={item === 'scheduled' ? 'Запланировано' : item === 'sent' ? 'Отправлено' : 'Черновики'}
                >
                  <span>{item === 'scheduled'
                    ? 'Запланировано'
                    : item === 'sent'
                      ? 'Отправлено'
                      : 'Черновики'}</span>
                  <span className="history-filter-count" aria-hidden="true">{historyCounts.status[item]}</span>
                </button>
              ))}
            </div>

            <div className="history-export-control" ref={exportMenuRef}>
              {canDeleteCurrentCategory && (
                <button
                  type="button"
                  className="history-delete-button"
                  aria-label={selectedRecordMatchesDeleteCategory && selectedRecord
                    ? statusFilter === 'scheduled'
                      ? isLocalScheduleFailure(selectedRecord) ? `Удалить ошибку ${selectedRecord.title}` : `Отменить ${selectedRecord.title}`
                      : `Удалить ${selectedRecord.title}`
                    : statusFilter === 'scheduled'
                      ? scheduleCleanupAriaLabel
                      : statusFilter === 'sent' ? 'Удалить историю отправленных' : 'Удалить черновики'}
                  aria-haspopup="dialog"
                  aria-expanded={Boolean(bulkDeleteCategory)}
                  title={selectedRecordMatchesDeleteCategory && selectedRecord
                    ? statusFilter === 'scheduled'
                      ? isLocalScheduleFailure(selectedRecord) ? `Удалить ошибку ${selectedRecord.title} из истории` : `Отменить ${selectedRecord.title} в Telegram`
                      : `Удалить ${selectedRecord.title}`
                    : statusFilter === 'scheduled'
                      ? scheduleCleanupTitle
                      : statusFilter === 'sent' ? 'Удалить историю отправленных' : 'Удалить все черновики'}
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
                aria-label={selectedRecord ? `Экспортировать ${selectedRecord.title}` : 'Экспортировать текущую категорию'}
                aria-haspopup="menu"
                aria-expanded={isExportMenuOpen}
                title={selectedRecord ? `Экспортировать ${selectedRecord.title}` : `Экспортировать ${formatHistoryCount(filteredRecords.length)} из выбранной категории`}
              >
                <Download size={15} strokeWidth={1.8} aria-hidden="true" />
                <span>Экспорт</span>
              </button>
              {isExportMenuOpen && (
                <div className="history-export-menu" role="menu" aria-label="Формат экспорта">
                  <span className="history-export-menu-label">{exportMenuHeading}</span>
                  <button
                    type="button"
                    role="menuitem"
                    className="history-export-option"
                    aria-label={`Экспортировать ${exportMenuScope} как TXT (.txt)`}
                    title={selectedRecord ? 'Сохранить это сообщение в текстовый файл.' : 'Лучше для чтения, печати и отправки человеку.'}
                    onClick={() => exportRecords('txt')}
                  >
                    <span>Текстовый файл (.txt)</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="history-export-option"
                    aria-label={`Экспортировать ${exportMenuScope} как JSON (.json)`}
                    title={selectedRecord ? 'Сохранить это сообщение в формате JSON.' : 'Лучше для резервной копии и переноса данных.'}
                    onClick={() => exportRecords('json')}
                  >
                    <span>Резервная копия (.json)</span>
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
                ? 'Подтвердить отмену публикации'
                : confirmAction.type === 'send-now' ? 'Подтвердить отправку' : 'Подтвердить удаление'}
            >
              <p>{confirmActionPrompt}</p>
              <div className="history-record-confirmation-actions">
                <button
                  type="button"
                  className="history-record-confirmation-action is-secondary"
                  autoFocus
                  onClick={() => setConfirmAction(null)}
                >
                  Отмена
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
                    ? 'Отменить публикацию'
                    : confirmAction.type === 'send-now'
                      ? 'Отправить сейчас'
                      : confirmActionRecord.status === 'draft' ? 'Удалить черновик' : 'Удалить запись'}
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
                  ? isLocalScheduleFailure(bulkDeleteRecord) ? 'Подтвердить удаление ошибки расписания' : 'Подтвердить отмену публикации'
                  : localScheduleFailureRecords.length > 0 && queueCancellableRecords.length > 0
                    ? 'Подтвердить очистку расписаний и ошибок'
                    : localScheduleFailureRecords.length > 0 ? 'Подтвердить удаление ошибочных записей' : 'Подтвердить отмену очереди'
                : bulkDeleteRecord ? 'Подтвердить удаление записи' : 'Подтвердить удаление категории'}
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
                  Отмена
                </button>
                <button
                  type="button"
                  className="history-record-confirmation-action is-primary"
                  onClick={() => void confirmCategoryDelete()}
                  disabled={bulkDeleteBusy}
                >
                  {bulkDeleteBusy
                    ? bulkDeleteCategory === 'scheduled' ? 'Отмена…' : 'Удаление…'
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
            aria-label={`Увеличенное фото: ${getAttachmentName(previewImagePath)}`}
          >
            <img
              src={toAttachmentUrl(previewImagePath)}
              alt={getAttachmentName(previewImagePath)}
              draggable={false}
            />
          </div>,
          document.body,
        )}
      </aside>
    </>
  );
}
