import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, FileText, Maximize2, Minimize2, Search, Trash2, X } from 'lucide-react';
import type { ScheduledMessage } from '@/types';
import { richTextToHtml } from '@/lib/richText';

type HistorySourceFilter = 'all' | 'studio' | 'personal';
type HistoryStatusFilter = 'upcoming' | 'completed';
type HistoryExportScope = 'upcoming' | 'completed';
type HistoryExportFormat = 'txt' | 'json';

export type HistoryDrawerRecord = {
  source: 'studio' | 'personal';
  status: 'upcoming' | 'completed';
  chatLabel: string;
  message: ScheduledMessage;
};

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

function matchesHistoryQuery(record: HistoryDrawerRecord, query: string) {
  const tokens = normalizeSearchText(query).split(' ').filter(Boolean);
  if (tokens.length === 0) return true;

  const date = new Date(record.message.when);
  const searchableValues = [
    record.message.chatName,
    record.message.text,
    record.chatLabel,
    record.source === 'studio' ? 'Studio' : 'Личное',
    formatTime(record.message.when),
    formatDateLabel(record.message.when),
    new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date),
    record.message.when,
  ].map(normalizeSearchText);

  return tokens.every((token) => searchableValues.some((value) => value.includes(token)));
}

function formatExportStatus(status: ScheduledMessage['status']) {
  if (status === 'confirmed') return 'Подтверждено';
  if (status === 'scheduled') return 'Запланировано';
  if (status === 'pending') return 'Ожидает подтверждения';
  return 'Отправлено';
}

function formatExportText(records: HistoryDrawerRecord[], scope: HistoryExportScope) {
  const selectedRecords = records.filter((record) => record.status === scope);
  const exportedAt = new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date());
  const entries = selectedRecords.map(({ source, chatLabel, message }, index) => {
    const scheduledAt = new Intl.DateTimeFormat('ru-RU', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(message.when));
    const chat = chatLabel ? `${message.chatName} (${chatLabel})` : message.chatName;
    const lines = [
      `${index + 1}. ${message.chatName}`,
      `Источник: ${source === 'studio' ? 'Studio' : 'Личное'}`,
      `Чат: ${chat}`,
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

function exportHistoryRecords(records: HistoryDrawerRecord[], scope: HistoryExportScope, format: HistoryExportFormat) {
  const selectedRecords = records
    .filter((record) => record.status === scope)
    .map(({ source, chatLabel, message }) => ({ source, chatLabel, ...message }));
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
  onDelete,
}: {
  isOpen: boolean;
  onClose: () => void;
  records: HistoryDrawerRecord[];
  onCancel: (record: HistoryDrawerRecord) => void;
  onDelete: (record: HistoryDrawerRecord) => void;
}) {
  const [sourceFilter, setSourceFilter] = useState<HistorySourceFilter>('all');
  const [statusFilter, setStatusFilter] = useState<HistoryStatusFilter>('upcoming');
  const [query, setQuery] = useState('');
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<HistoryDrawerRecord | null>(null);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);

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
    return records
      .filter((record) => {
        if (sourceFilter !== 'all' && record.source !== sourceFilter) return false;
        if (record.status !== statusFilter) return false;

        return matchesHistoryQuery(record, query);
      })
        .sort((left, right) => new Date(left.message.when).getTime() - new Date(right.message.when).getTime());
      }, [query, records, sourceFilter, statusFilter]);

  const selectedRecordIndex = selectedRecord
    ? filteredRecords.findIndex((record) => record.source === selectedRecord.source && record.message.id === selectedRecord.message.id)
    : -1;
  const visibleRecords = selectedRecordIndex >= 0
    ? filteredRecords.slice(0, selectedRecordIndex + 1)
    : filteredRecords;

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
            {(['all', 'studio', 'personal'] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setSourceFilter(item)}
                className={`history-filter${sourceFilter === item ? ' is-active' : ''}`}
                aria-pressed={sourceFilter === item}
              >
                {item === 'all' ? 'Все' : item === 'studio' ? 'Studio' : 'Личное'}
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
              {(['upcoming', 'completed'] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setStatusFilter(item)}
                  className={`history-status-tab${statusFilter === item ? ' is-active' : ''}`}
                  role="tab"
                  aria-selected={statusFilter === item}
                >
                  {item === 'upcoming' ? 'Предстоящие' : 'Завершённые'}
                </button>
              ))}
            </div>
            <div className="history-export-control" ref={exportMenuRef}>
              <button
                type="button"
                className="history-export-button"
                onClick={() => setIsExportMenuOpen((current) => !current)}
                disabled={records.length === 0}
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
                    <button type="button" role="menuitem" aria-label="Запланированные — текстовый файл (.txt)" disabled={!records.some((record) => record.status === 'upcoming')} onClick={() => { exportHistoryRecords(records, 'upcoming', 'txt'); setIsExportMenuOpen(false); }}>
                      Текстовый файл (.txt)
                    </button>
                    <button type="button" role="menuitem" aria-label="Запланированные — резервная копия (.json)" disabled={!records.some((record) => record.status === 'upcoming')} onClick={() => { exportHistoryRecords(records, 'upcoming', 'json'); setIsExportMenuOpen(false); }}>
                      Резервная копия (.json)
                    </button>
                  </div>
                  <div className="history-export-menu-group">
                    <span className="history-export-menu-label">Завершённые</span>
                    <button type="button" role="menuitem" aria-label="Завершённые — текстовый файл (.txt)" disabled={!records.some((record) => record.status === 'completed')} onClick={() => { exportHistoryRecords(records, 'completed', 'txt'); setIsExportMenuOpen(false); }}>
                      Текстовый файл (.txt)
                    </button>
                    <button type="button" role="menuitem" aria-label="Завершённые — резервная копия (.json)" disabled={!records.some((record) => record.status === 'completed')} onClick={() => { exportHistoryRecords(records, 'completed', 'json'); setIsExportMenuOpen(false); }}>
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
              const isExpanded = selectedRecord?.source === record.source && selectedRecord.message.id === record.message.id;

              return (
              <article className={`history-record${isExpanded ? ' is-expanded' : ''}`} key={`${record.source}:${record.message.id}`}>
                <button
                  type="button"
                  className="history-record-open"
                  onClick={() => setSelectedRecord(isExpanded ? null : record)}
                  aria-label={`${isExpanded ? 'Свернуть' : 'Открыть'} публикацию: ${record.message.chatName}`}
                  aria-expanded={isExpanded}
                >
                  <span className="history-record-meta">
                    <span className={`history-record-source is-${record.source}`}>
                      {record.source === 'studio' ? 'Studio' : 'Личное'}
                    </span>
                    <span className="history-record-date">{formatDateLabel(record.message.when)}</span>
                  </span>

                  <span className="history-record-heading">
                    <strong>{record.message.chatName}</strong>
                    <time dateTime={record.message.when}>{formatTime(record.message.when)}</time>
                  </span>

                  {record.chatLabel && <span className="history-record-chat">{record.chatLabel}</span>}
                  {!isExpanded && <span className="history-record-text">{record.message.text}</span>}
                </button>
                {isExpanded && (
                  <div className="history-post-expanded" aria-label="Полный текст запланированного сообщения">
                    <div className="history-post-time-row">
                      <time dateTime={record.message.when}>{formatTime(record.message.when)}</time>
                      <span>{formatExportStatus(record.message.status)}</span>
                    </div>
                    <div
                      className="history-post-text"
                      dangerouslySetInnerHTML={{
                        __html: richTextToHtml(record.message.text, record.message.entities ?? []),
                      }}
                    />
                    {Boolean(record.message.attachments?.length) && (
                      <div className="history-post-attachments" aria-label="Вложения">
                        {record.message.attachments?.map((attachment) => (
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
                    {(record.message.silent || record.message.effect) && (
                      <div className="history-post-options">
                        {record.message.silent && <span>Без звука</span>}
                        {record.message.effect && <span>Эффект: {record.message.effect}</span>}
                      </div>
                    )}
                  </div>
                )}
                <div className="history-record-actions">
                  <button
                    type="button"
                    className="history-record-action is-expand"
                    onClick={() => setSelectedRecord(isExpanded ? null : record)}
                    aria-label={`${isExpanded ? 'Свернуть' : 'Открыть полностью'}: ${record.message.chatName}`}
                    aria-expanded={isExpanded}
                  >
                    {isExpanded
                      ? <Minimize2 size={14} strokeWidth={1.8} aria-hidden="true" />
                      : <Maximize2 size={14} strokeWidth={1.8} aria-hidden="true" />}
                    <span>{isExpanded ? 'Свернуть' : 'Открыть полностью'}</span>
                  </button>
                  {record.status === 'upcoming' && (
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
                  <button
                    type="button"
                    className="history-record-action is-delete"
                    onClick={() => {
                      onDelete(record);
                      if (isExpanded) setSelectedRecord(null);
                    }}
                    aria-label={`Удалить: ${record.message.chatName}`}
                  >
                    <Trash2 size={14} strokeWidth={1.8} aria-hidden="true" />
                    <span>Удалить</span>
                  </button>
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
