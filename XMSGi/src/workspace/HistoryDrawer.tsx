import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  if (filter === 'scheduled') {
    return record.status === 'scheduled'
      || record.status === 'sending'
      || record.status === 'failed'
      || record.status === 'cancelled';
  }
  if (filter === 'sent') return record.status === 'sent';
  return record.status === 'draft';
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

function scrollHistoryRecordIntoView(list: HTMLDivElement, record: HTMLElement) {
  const listBounds = list.getBoundingClientRect();
  const recordBounds = record.getBoundingClientRect();
  const stickyDateHeading = list.querySelector<HTMLElement>('.history-date-heading');
  const stickyDateHeight = stickyDateHeading?.getBoundingClientRect().height ?? 0;
  const visibleTop = listBounds.top + list.clientTop + stickyDateHeight;
  const visibleBottom = listBounds.top + list.clientTop + list.clientHeight;
  const recordHeight = recordBounds.height;
  let nextScrollTop = list.scrollTop;

  if (recordHeight >= list.clientHeight || recordBounds.top < visibleTop) {
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
  link.download = `xmsgi-${category}-${date}.${format}`;
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
  onClearSent,
}: {
  isOpen: boolean;
  onClose: () => void;
  records: HistoryItem[];
  onCancel: (record: HistoryItem) => void;
  onReschedule: (record: HistoryItem) => void;
  onSendNow: (record: HistoryItem) => void;
  onDelete: (record: HistoryItem) => void;
  onOpenDraft: (record: HistoryItem) => void;
  onClearSent: (source: HistoryBulkActionSource) => void;
}) {
  const [sourceFilter, setSourceFilter] = useState<HistorySourceFilter>('all');
  const [statusFilter, setStatusFilter] = useState<HistoryStatusFilter>('scheduled');
  const [query, setQuery] = useState('');
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<HistoryItem | null>(null);
  const [draftItems, setDraftItems] = useState<HistoryItem[]>([]);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);
  const historyRecordListRef = useRef<HTMLDivElement | null>(null);
  const expandedRecordRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (!isOpen || !selectedRecord) return;
    const list = historyRecordListRef.current;
    const expandedRecord = expandedRecordRef.current;
    if (list && expandedRecord) scrollHistoryRecordIntoView(list, expandedRecord);
  }, [isOpen, selectedRecord]);

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
      if (event.key === 'Escape') {
        if (selectedRecord) setSelectedRecord(null);
        else onClose();
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, onClose, selectedRecord]);

  useEffect(() => {
    if (!isOpen || !isExportMenuOpen) return;

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!exportMenuRef.current?.contains(event.target as Node)) setIsExportMenuOpen(false);
    };

    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeOnOutsideClick);
  }, [isExportMenuOpen, isOpen]);

  const filteredRecords = useMemo(() => {
    const categoryRecords = [...records, ...draftItems]
      .filter((record) => {
        if (sourceFilter !== 'all' && record.source !== sourceFilter) return false;
        if (!matchesHistoryStatus(record, statusFilter)) return false;

        return matchesHistoryQuery(record, query);
      });
    return sortHistoryItems(categoryRecords, statusFilter);
  }, [draftItems, query, records, sourceFilter, statusFilter]);

  useEffect(() => {
    if (filteredRecords.length === 0) setIsExportMenuOpen(false);
  }, [filteredRecords.length]);

  useEffect(() => {
    if (selectedRecord && !filteredRecords.some((record) => record.id === selectedRecord.id)) {
      setSelectedRecord(null);
    }
  }, [filteredRecords, selectedRecord]);

  const historyCounts = useMemo(() => {
    const counts = {
      total: records.length + draftItems.length,
      source: { all: 0, workspace: 0, personal: 0 },
      status: { scheduled: 0, sent: 0, drafts: 0 },
    };

    for (const record of [...records, ...draftItems]) {
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

  const selectedRecordIndex = selectedRecord
    ? filteredRecords.findIndex((record) => record.id === selectedRecord.id)
    : -1;
  const visibleRecords = selectedRecordIndex >= 0
    ? filteredRecords.slice(0, selectedRecordIndex + 1)
    : filteredRecords;
  const selectedSource = sourceFilter === 'all' ? null : sourceFilter;
  const hasSentInSelectedSource = sourceFilter === 'all'
    ? filteredRecords.some((record) => record.status === 'sent')
    : filteredRecords.some((record) => record.source === sourceFilter && record.status === 'sent');
  const hasUpcomingInSelectedSource = selectedSource !== null && records.some((record) =>
    record.source === selectedSource && record.original.kind === 'scheduled' && record.status !== 'sent',
  );
  const selectedCategoryLabel = getHistoryCategoryLabel(statusFilter);

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
        aria-label="История"
      >
        <header className="history-drawer-header">
          <h2 aria-label="История">История <span aria-hidden="true">{historyCounts.total}</span></h2>
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
                onClick={() => setSourceFilter(item)}
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
              <span>{query ? 'Измените запрос или очистите поиск.' : 'Здесь появятся ваши сообщения и черновики.'}</span>
              {query && <button type="button" onClick={() => setQuery('')}>Сбросить запрос</button>}
            </div>
          ) : (
            visibleRecords.map((record, index) => {
              const isExpanded = selectedRecord?.id === record.id;
              const timestamp = getHistoryTimestamp(record);
              const startsNewDay = index === 0
                || getHistoryDayKey(getHistoryTimestamp(visibleRecords[index - 1])) !== getHistoryDayKey(timestamp);
              const entities = record.entities;
              const scheduleMessage = record.original.kind === 'scheduled' ? record.original.message : null;

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
                  onClick={() => setSelectedRecord(isExpanded ? null : record)}
                  aria-label={`${isExpanded ? 'Свернуть' : 'Открыть'} публикацию: ${record.title}`}
                  aria-expanded={isExpanded}
                >
                  <span className="history-record-meta">
                    <span className={`history-record-source is-${record.source === 'workspace' ? 'studio' : 'personal'}`}>
                      {record.source === 'workspace' ? 'Studio' : 'Личное'}
                    </span>
                    {!isExpanded && <span className="history-record-date">{getHistoryStatusLabel(record.status)} · {formatDateLabel(timestamp)}</span>}
                    {record.attachments.length > 0 && (
                      <span className="history-record-attachments" aria-label={formatAttachmentCount(record.attachments.length)} title={formatAttachmentCount(record.attachments.length)}>
                        <Paperclip size={12} strokeWidth={1.8} aria-hidden="true" />
                        {record.attachments.length}
                      </span>
                    )}
                    {record.status === 'draft' && (
                      <span
                        className="history-record-draft-dot"
                        data-color={record.draftColor ?? 'gray'}
                        aria-label={`Цвет черновика: ${record.draftColor ?? 'gray'}`}
                        title={`Цвет: ${record.draftColor ?? 'gray'}`}
                      />
                    )}
                  </span>

                  <span className="history-record-heading">
                    <strong>{record.title}</strong>
                    {!isExpanded && <time dateTime={timestamp}>{formatTime(timestamp)}</time>}
                  </span>

                  {(record.channelLabel || record.channelName) && <span className="history-record-chat">{record.channelLabel || record.channelName}</span>}
                  {!isExpanded && <span className="history-record-text">{record.text}</span>}
                  {!isExpanded && record.lastError && <span className="history-record-error-preview">{record.lastError}</span>}
                </button>
                {isExpanded && (
                  <div className="history-post-expanded" aria-label={`Полное содержимое записи: ${record.title}`}>
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
                    onClick={() => {
                      if (isExpanded) {
                        setSelectedRecord(null);
                        return;
                      }
                      setSelectedRecord(record);
                    }}
                    aria-label={`${isExpanded ? 'Свернуть' : 'Открыть полностью'}: ${record.title}`}
                    aria-expanded={isExpanded}
                  >
                    {isExpanded
                      ? <Minimize2 size={14} strokeWidth={1.8} aria-hidden="true" />
                      : <Maximize2 size={14} strokeWidth={1.8} aria-hidden="true" />}
                    <span>{isExpanded ? 'Свернуть' : 'Открыть полностью'}</span>
                  </button>
                  {(record.status === 'scheduled' || record.status === 'failed') && scheduleMessage && (
                    <button
                      type="button"
                      className="history-record-action is-send-now"
                      onClick={() => onSendNow(record)}
                    >
                      <span>{record.status === 'failed' ? 'Повторить' : 'Отправить сейчас'}</span>
                    </button>
                  )}
                  {record.source === 'workspace' && record.status === 'scheduled' && scheduleMessage && (
                    <button
                      type="button"
                      className="history-record-action is-reschedule"
                      onClick={() => {
                        onReschedule(record);
                        onClose();
                      }}
                      aria-label={`Перепланировать: ${record.title}`}
                    >
                      <span>Перепланировать</span>
                    </button>
                  )}
                  {record.status === 'sending' && scheduleMessage && (
                    <button type="button" className="history-record-action is-send-now" disabled>
                      <span>Отправляется…</span>
                    </button>
                  )}
                  {record.status === 'scheduled' && scheduleMessage && (
                    <button
                      type="button"
                      className="history-record-action is-cancel"
                      onClick={() => {
                        onCancel(record);
                        if (isExpanded) setSelectedRecord(null);
                      }}
                    >
                      <X size={14} strokeWidth={1.8} aria-hidden="true" />
                      <span>Отменить</span>
                    </button>
                  )}
                  {record.status === 'sent' && scheduleMessage && (
                    <button
                      type="button"
                      className="history-record-action is-delete"
                      onClick={() => {
                        onDelete(record);
                        if (isExpanded) setSelectedRecord(null);
                      }}
                      aria-label={`Удалить: ${record.title}`}
                    >
                      <Trash2 size={14} strokeWidth={1.8} aria-hidden="true" />
                      <span>Удалить</span>
                    </button>
                  )}
                  {record.status === 'draft' && (
                    <button
                      type="button"
                      className="history-record-action is-expand"
                      onClick={() => {
                        onOpenDraft(record);
                        onClose();
                      }}
                      aria-label={`Открыть черновик: ${record.title}`}
                    >
                      <span>Открыть</span>
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
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Поиск по истории"
              aria-label="Поиск по истории"
            />
            <button
              type="button"
              className={`history-search-clear${query ? '' : ' is-reserved'}`}
              onClick={() => setQuery('')}
              disabled={!query}
              aria-label="Очистить поиск"
            >
              <X size={15} strokeWidth={1.8} aria-hidden="true" />
            </button>
            <div className="history-result-count" role="status" aria-live="polite">
              {query.trim()
                ? `Найдено ${filteredRecords.length} из ${historyCounts.status[statusFilter]}`
                : formatHistoryCount(filteredRecords.length)}
            </div>
          </div>
          </div>

          <div className="history-drawer-footer" aria-label="Панель действий истории">
            <div className="history-status-row">
            <div className="history-status-filters" role="tablist" aria-label="Статус записей">
              {(['scheduled', 'sent', 'drafts'] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setStatusFilter(item)}
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

            <div className="history-bulk-actions">
              {statusFilter === 'sent' && (
                <button
                  type="button"
                  className="clear-history"
                  disabled={!hasSentInSelectedSource}
                  onClick={() => { onClearSent(sourceFilter === 'all' ? 'all' : selectedSource ?? 'all'); }}
                  title="Очистить историю отправленных сообщений"
                >
                  Очистить отправленные
                </button>
              )}
            </div>

            <div className="history-export-control" ref={exportMenuRef}>
              <button
                type="button"
                className="history-export-button"
                onClick={() => setIsExportMenuOpen((current) => !current)}
                disabled={filteredRecords.length === 0}
                aria-label="Экспортировать текущую категорию"
                aria-haspopup="menu"
                aria-expanded={isExportMenuOpen}
                title={`Экспортировать ${formatHistoryCount(filteredRecords.length)} из выбранной категории`}
              >
                <Download size={15} strokeWidth={1.8} aria-hidden="true" />
                <span>Экспорт</span>
              </button>
              {isExportMenuOpen && (
                <div className="history-export-menu" role="menu" aria-label="Формат экспорта">
                  <span className="history-export-menu-label">Текущая категория: {selectedCategoryLabel}</span>
                  <button
                    type="button"
                    role="menuitem"
                    className="history-export-option"
                    aria-label="Экспортировать текущий список как TXT (.txt)"
                    title="Лучше для чтения, печати и отправки человеку."
                    onClick={() => { exportHistoryRecords(filteredRecords, statusFilter, sourceFilter, query, 'txt'); setIsExportMenuOpen(false); }}
                  >
                    <span>Текстовый файл (.txt)</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="history-export-option"
                    aria-label="Экспортировать текущий список как JSON (.json)"
                    title="Лучше для резервной копии и переноса данных."
                    onClick={() => { exportHistoryRecords(filteredRecords, statusFilter, sourceFilter, query, 'json'); setIsExportMenuOpen(false); }}
                  >
                    <span>Резервная копия (.json)</span>
                  </button>
                </div>
              )}
            </div>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
