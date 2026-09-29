import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Download, FileText, Maximize2, Minimize2, Search, Trash2, X } from 'lucide-react';
import type { ScheduledMessage } from '@/types';
import { richTextToHtml } from '@/lib/richText';
import type { PersistedDraftStore } from '../../../Studio/Studio module/src/types';
import { normalizePersistedStudioDrafts, normalizeSavedDraft, sortHistoryItems } from './historyModel';
import type { HistoryItem } from './historyModel';

type HistorySourceFilter = 'all' | 'workspace' | 'personal';
type HistoryBulkActionSource = Exclude<HistorySourceFilter, 'all'>;
type HistoryStatusFilter = 'scheduled' | 'sent' | 'drafts';
type HistoryExportScope = 'upcoming' | 'completed';
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
  if (status === 'failed' || status === 'cancelled') return 'Ошибка';
  if (status === 'draft') return 'Черновик';
  return 'Черновик';
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

function formatExportStatus(status: ScheduledMessage['status']) {
  if (status === 'confirmed') return 'Подтверждено';
  if (status === 'scheduled') return 'Запланировано';
  if (status === 'pending') return 'Ожидает подтверждения';
  return 'Отправлено';
}

function getExportMessage(record: HistoryItem, scope: HistoryExportScope) {
  if (record.original.kind !== 'scheduled') return null;
  if (scope === 'upcoming' && record.status !== 'scheduled') return null;
  if (scope === 'completed' && record.status !== 'sent') return null;
  return record.original.message;
}

function formatExportText(records: HistoryItem[], scope: HistoryExportScope) {
  const selectedRecords = records.flatMap((record) => {
    const message = getExportMessage(record, scope);
    return message ? [{ record, message }] : [];
  });
  const exportedAt = new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date());
  const entries = selectedRecords.map(({ record, message }, index) => {
    const scheduledAt = new Intl.DateTimeFormat('ru-RU', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(message.when));
    const chat = record.channelName;
    const lines = [
      `${index + 1}. ${message.chatName}`,
      `Источник: ${record.source === 'workspace' ? 'Studio' : 'Личное'}`,
      `Чат: ${record.channelLabel ? `${message.chatName} (${record.channelLabel})` : chat}`,
      `Дата и время: ${scheduledAt}`,
      `Статус: ${formatExportStatus(message.status)}`,
      '',
      'Текст:',
      message.text || '—',
    ];

    if (message.attachments?.length) {
      lines.push('', 'Вложения:', ...message.attachments.map((attachment) => `- ${attachment.split(/[\\/]/).pop() || attachment}`));
    }

    if (message.silent) lines.push('', 'Отправка без звука');
    if (message.effect) lines.push(`Эффект: ${message.effect}`);

    return lines.join('\n');
  });

  return [
    `XMSGi — ${scope === 'upcoming' ? 'Запланированные' : 'Завершённые'} сообщения`,
    `Экспортировано: ${exportedAt}`,
    `Всего: ${selectedRecords.length}`,
    '',
    entries.join('\n\n----------------------------------------\n\n'),
    '',
  ].join('\n');
}

function exportHistoryRecords(records: HistoryItem[], scope: HistoryExportScope, format: HistoryExportFormat) {
  const selectedRecords = records
    .flatMap((record) => {
      const message = getExportMessage(record, scope);
      return message ? [{ source: record.source, ...message }] : [];
    });
  const payload = format === 'json'
    ? JSON.stringify({ exportedAt: new Date().toISOString(), messages: selectedRecords }, null, 2)
    : formatExportText(records, scope);
  const mimeType = format === 'json' ? 'application/json;charset=utf-8' : 'text/plain;charset=utf-8';
  const blob = new Blob([payload], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const date = new Date().toISOString().slice(0, 10);

  link.href = url;
  link.download = `xmsgi-${scope === 'upcoming' ? 'scheduled' : 'completed'}-${date}.${format}`;
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
  onClearAll,
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
  onClearAll: (source: HistoryBulkActionSource) => void;
}) {
  const [sourceFilter, setSourceFilter] = useState<HistorySourceFilter>('all');
  const [statusFilter, setStatusFilter] = useState<HistoryStatusFilter>('scheduled');
  const [query, setQuery] = useState('');
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<HistoryItem | null>(null);
  const [draftItems, setDraftItems] = useState<HistoryItem[]>([]);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);
  const expandedPostRef = useRef<HTMLDivElement | null>(null);
  const scrollExpandedPostToBottomRef = useRef(false);

  useLayoutEffect(() => {
    if (!scrollExpandedPostToBottomRef.current) return;
    scrollExpandedPostToBottomRef.current = false;
    const expandedPost = expandedPostRef.current;
    if (typeof expandedPost?.scrollIntoView === 'function') {
      expandedPost.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [selectedRecord]);

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
        if (statusFilter === 'scheduled'
          && record.status !== 'scheduled'
          && record.status !== 'sending'
          && record.status !== 'failed'
          && record.status !== 'cancelled') return false;
        if (statusFilter === 'sent' && record.status !== 'sent') return false;
        if (statusFilter === 'drafts' && record.status !== 'draft') return false;

        return matchesHistoryQuery(record, query);
      });
    return sortHistoryItems(categoryRecords, statusFilter);
  }, [draftItems, query, records, sourceFilter, statusFilter]);

  const selectedRecordIndex = selectedRecord
    ? filteredRecords.findIndex((record) => record.id === selectedRecord.id)
    : -1;
  const visibleRecords = selectedRecordIndex >= 0
    ? filteredRecords.slice(0, selectedRecordIndex + 1)
    : filteredRecords;
  const selectedSource = sourceFilter === 'all' ? null : sourceFilter;
  const hasSentInSelectedSource = selectedSource !== null && records.some((record) =>
    record.source === selectedSource && record.original.kind === 'scheduled' && record.status === 'sent',
  );
  const hasUpcomingInSelectedSource = selectedSource !== null && records.some((record) =>
    record.source === selectedSource && record.original.kind === 'scheduled' && record.status !== 'sent',
  );

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
          <h2>История</h2>
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
              >
                {item === 'all' ? 'Все' : item === 'workspace' ? 'Studio' : 'Личное'}
              </button>
            ))}
          </div>

          <label className="history-search">
            <Search size={18} strokeWidth={1.7} aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Поиск по истории"
              aria-label="Поиск по истории"
            />
          </label>

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
                >
                  {item === 'scheduled'
                    ? 'Запланировано'
                    : item === 'sent'
                      ? 'Отправлено'
                      : 'Черновики'}
                </button>
              ))}
            </div>
            <div className="history-bulk-actions">
              {statusFilter === 'sent' && (
                <button
                  type="button"
                  className="clear-history"
                  disabled={!selectedSource || !hasSentInSelectedSource}
                  onClick={() => { if (selectedSource) onClearSent(selectedSource); }}
                  title="Очистить историю отправленных сообщений"
                >
                  Очистить отправленные
                </button>
              )}
              {statusFilter === 'scheduled' && (
                <button
                  type="button"
                  className="clear-history"
                  disabled={!selectedSource || !hasUpcomingInSelectedSource}
                  onClick={() => { if (selectedSource) onClearAll(selectedSource); }}
                  title="Отменить все запланированные сообщения"
                >
                  Очистить всё
                </button>
              )}
            </div>
            <div className="history-export-control" ref={exportMenuRef}>
              <button
                type="button"
                className="history-export-button"
                onClick={() => setIsExportMenuOpen((current) => !current)}
                disabled={!records.some((record) => record.original.kind === 'scheduled')}
                aria-label="Экспортировать записи"
                aria-haspopup="menu"
                aria-expanded={isExportMenuOpen}
                title="Экспортировать всю запланированную очередь"
              >
                <Download size={15} strokeWidth={1.8} aria-hidden="true" />
                <span>Экспорт</span>
              </button>
              {isExportMenuOpen && (
                <div className="history-export-menu" role="menu" aria-label="Формат экспорта">
                  <div className="history-export-menu-group">
                    <span className="history-export-menu-label">Запланированные</span>
                    <button type="button" role="menuitem" aria-label="Запланированные — текстовый файл (.txt)" disabled={!records.some((record) => record.status === 'scheduled')} onClick={() => { exportHistoryRecords(records, 'upcoming', 'txt'); setIsExportMenuOpen(false); }}>
                      Текстовый файл (.txt)
                    </button>
                    <button type="button" role="menuitem" aria-label="Запланированные — резервная копия (.json)" disabled={!records.some((record) => record.status === 'scheduled')} onClick={() => { exportHistoryRecords(records, 'upcoming', 'json'); setIsExportMenuOpen(false); }}>
                      Резервная копия (.json)
                    </button>
                  </div>
                  <div className="history-export-menu-group">
                    <span className="history-export-menu-label">Завершённые</span>
                    <button type="button" role="menuitem" aria-label="Завершённые — текстовый файл (.txt)" disabled={!records.some((record) => record.status === 'sent')} onClick={() => { exportHistoryRecords(records, 'completed', 'txt'); setIsExportMenuOpen(false); }}>
                      Текстовый файл (.txt)
                    </button>
                    <button type="button" role="menuitem" aria-label="Завершённые — резервная копия (.json)" disabled={!records.some((record) => record.status === 'sent')} onClick={() => { exportHistoryRecords(records, 'completed', 'json'); setIsExportMenuOpen(false); }}>
                      Резервная копия (.json)
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="history-record-list">
          {filteredRecords.length === 0 ? (
            <div className="history-empty">Ничего не найдено.</div>
          ) : (
            visibleRecords.map((record) => {
              const isExpanded = selectedRecord?.id === record.id;
              const timestamp = getHistoryTimestamp(record);
              const entities = record.entities;
              const scheduleMessage = record.original.kind === 'scheduled' ? record.original.message : null;

              return (
              <article
                className={`history-record${isExpanded ? ' is-expanded' : ''}${record.status === 'draft' ? ' is-draft' : ''}`}
                data-draft-color={record.status === 'draft' ? record.draftColor ?? 'gray' : undefined}
                key={record.id}
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
                    <span className="history-record-date">{getHistoryStatusLabel(record.status)} · {formatDateLabel(timestamp)}</span>
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
                    <time dateTime={timestamp}>{formatTime(timestamp)}</time>
                  </span>

                  {(record.channelLabel || record.channelName) && <span className="history-record-chat">{record.channelLabel || record.channelName}</span>}
                  {!isExpanded && <span className="history-record-text">{record.text}</span>}
                </button>
                {isExpanded && (
                  <div className="history-post-expanded" aria-label="Полный текст запланированного сообщения">
                    <div className="history-post-time-row">
                      <time dateTime={timestamp}>{formatTime(timestamp)}</time>
                      <span>{getHistoryStatusLabel(record.status)}</span>
                    </div>
                    {record.lastError && <p className="history-record-error" role="alert">{record.lastError}</p>}
                    <div
                      ref={expandedPostRef}
                      className="history-post-text"
                      dangerouslySetInnerHTML={{
                        __html: richTextToHtml(record.text, entities),
                      }}
                    />
                    {Boolean(record.attachments.length) && (
                      <div className="history-post-attachments" aria-label="Вложения">
                        {record.attachments.map((attachment) => (
                          isImageAttachment(attachment) ? (
                            <img key={attachment} src={toAttachmentUrl(attachment)} alt={getAttachmentName(attachment)} />
                          ) : (
                            <a key={attachment} href={toAttachmentUrl(attachment)} download={getAttachmentName(attachment)}>
                              <FileText size={17} strokeWidth={1.7} aria-hidden="true" />
                              <span>{getAttachmentName(attachment)}</span>
                            </a>
                          )
                        ))}
                      </div>
                    )}
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
                      scrollExpandedPostToBottomRef.current = true;
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
              );
            })
          )}
        </div>
      </aside>
    </>
  );
}
