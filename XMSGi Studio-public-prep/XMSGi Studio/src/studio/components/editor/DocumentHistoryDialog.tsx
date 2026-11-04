import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Copy, History, RotateCcw, X } from 'lucide-react';
import type { PersistedWorkspaceDocumentHistories, PersistedWorkspaceDocumentVersion } from '@shared/types';
import type { DraftAttachment } from '@studio/domain/types';
import { useLocale } from '@studio/lib/i18n';

interface Props {
  accentChannels: string;
  histories: PersistedWorkspaceDocumentHistories;
  selectedDocumentId: string | null;
  selectedVersionId: string | null;
  restoring: boolean;
  restoreError: string;
  onClose: () => void;
  onSelectDocument: (documentId: string) => void;
  onSelect: (versionId: string) => void;
  onRestore: (version: PersistedWorkspaceDocumentVersion) => void;
  onOpenCopy: (version: PersistedWorkspaceDocumentVersion) => void;
}

function getVersionText(version: PersistedWorkspaceDocumentVersion): string {
  return typeof version.snapshot.body === 'string' ? version.snapshot.body : '';
}

function getVersionSummary(version: PersistedWorkspaceDocumentVersion, emptyLabel: string): string {
  return getVersionText(version).split(/\r?\n/).find((line) => line.trim())?.trim() || emptyLabel;
}

function getVersionAttachments(version: PersistedWorkspaceDocumentVersion): DraftAttachment[] {
  if (!Array.isArray(version.snapshot.attachments)) return [];
  return version.snapshot.attachments.filter((attachment): attachment is DraftAttachment => (
    Boolean(attachment && typeof attachment === 'object' && typeof attachment.name === 'string')
  ));
}

export function DocumentHistoryDialog({
  accentChannels,
  histories,
  selectedDocumentId,
  selectedVersionId,
  restoring,
  restoreError,
  onClose,
  onSelectDocument,
  onSelect,
  onRestore,
  onOpenCopy,
}: Props) {
  const { locale, t } = useLocale();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const documentPickerRef = useRef<HTMLDivElement | null>(null);
  const documentTriggerRef = useRef<HTMLButtonElement | null>(null);
  const documentOptionRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const onCloseRef = useRef(onClose);
  const [documentMenuOpen, setDocumentMenuOpen] = useState(false);
  const documentMenuOpenRef = useRef(documentMenuOpen);
  onCloseRef.current = onClose;
  documentMenuOpenRef.current = documentMenuOpen;
  const versions = selectedDocumentId ? histories[selectedDocumentId] ?? [] : [];
  const orderedVersions = [...versions].reverse();
  const documentOptions = Object.entries(histories)
    .filter(([, documentVersions]) => documentVersions.length > 0)
    .sort((left, right) => (
      Date.parse(right[1][right[1].length - 1].createdAt)
      - Date.parse(left[1][left[1].length - 1].createdAt)
    ));
  const selectedDocument = documentOptions.find(([documentId]) => documentId === selectedDocumentId)
    ?? documentOptions[0]
    ?? null;
  const selectedVersion = orderedVersions.find((version) => version.id === selectedVersionId)
    ?? orderedVersions[0]
    ?? null;
  const dateLocale = locale === 'ru' ? 'ru-RU' : 'en-US';
  const selectedChat = selectedVersion?.snapshot.selectedChat as { name?: unknown } | null | undefined;
  const selectedChatName = typeof selectedChat?.name === 'string' ? selectedChat.name : '';
  const selectedDate = typeof selectedVersion?.snapshot.date === 'string' ? selectedVersion.snapshot.date : '';
  const selectedTime = typeof selectedVersion?.snapshot.time === 'string' ? selectedVersion.snapshot.time : '';
  const selectedButtons = Array.isArray(selectedVersion?.snapshot.inlineButtons)
    ? selectedVersion.snapshot.inlineButtons.flatMap((row) => Array.isArray(row)
        ? row.flatMap((button) => (button && typeof button === 'object' && typeof button.label === 'string' ? [button.label] : []))
        : [])
    : [];

  const formatTime = (timestamp: string) => new Date(timestamp).toLocaleString(dateLocale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();

    const handleDialogKeys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (documentMenuOpenRef.current) {
          setDocumentMenuOpen(false);
          documentTriggerRef.current?.focus();
        } else {
          onCloseRef.current();
        }
        return;
      }

      if (event.key !== 'Tab') return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not(:disabled):not([tabindex="-1"]), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
      ));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleDialogKeys);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleDialogKeys);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, []);

  useEffect(() => {
    if (!documentMenuOpen) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!documentPickerRef.current?.contains(event.target as Node)) setDocumentMenuOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeOnOutsideClick);
  }, [documentMenuOpen]);

  useEffect(() => {
    if (!documentMenuOpen) return;
    const activeDocumentId = selectedDocumentId ?? documentOptions[0]?.[0];
    if (activeDocumentId) documentOptionRefs.current[activeDocumentId]?.focus();
  }, [documentMenuOpen, documentOptions, histories, selectedDocumentId]);

  const handleDocumentOptionKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = documentOptions.findIndex(([documentId]) => documentId === event.currentTarget.value);
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? documentOptions.length - 1
        : (currentIndex + (event.key === 'ArrowDown' ? 1 : -1) + documentOptions.length) % documentOptions.length;
    const nextDocumentId = documentOptions[nextIndex]?.[0];
    if (nextDocumentId) documentOptionRefs.current[nextDocumentId]?.focus();
  };

  return createPortal(
    <div
      className="workspace-page-version-history-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="workspace-page-version-history-dialog"
        style={{ '--version-history-accent': accentChannels } as CSSProperties}
        role="dialog"
        aria-modal="true"
        aria-labelledby="workspace-version-history-title"
        tabIndex={-1}
      >
        <header className="workspace-page-version-history-header">
          <div className="workspace-page-version-history-heading">
            <span className="workspace-page-version-history-icon" aria-hidden="true">
              <History size={22} strokeWidth={1.8} />
            </span>
            <div>
              <h2 id="workspace-version-history-title">{t('studio.versionHistory')}</h2>
              <p>{t('studio.versionHistoryCount', { count: versions.length })}</p>
            </div>
          </div>
          <button type="button" className="workspace-page-version-history-close" onClick={onClose} aria-label={t('common.close')}>
            <X size={17} aria-hidden="true" />
          </button>
        </header>

        <div className="workspace-page-version-history-content">
          <div className={`workspace-page-version-history-list${documentMenuOpen ? ' is-document-menu-open' : ''}`} aria-label={t('studio.versionHistory')}>
            {selectedDocument && (
              <div className="workspace-page-version-history-document-picker" ref={documentPickerRef}>
                <span className="workspace-page-version-history-picker-label">{t('studio.historyDocument')}</span>
                <button
                  ref={documentTriggerRef}
                  type="button"
                  className="workspace-page-version-history-document-trigger"
                  aria-label={t('studio.historyDocument')}
                  aria-haspopup="listbox"
                  aria-expanded={documentMenuOpen}
                  aria-controls="workspace-version-history-documents"
                  onClick={() => setDocumentMenuOpen((open) => !open)}
                  onKeyDown={(event) => {
                    if (event.key !== 'ArrowDown' && event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    setDocumentMenuOpen(true);
                  }}
                >
                  <span className="workspace-page-version-history-document-copy">
                    <strong>{getVersionSummary(selectedDocument[1][selectedDocument[1].length - 1], t('studio.historyEmptyText'))}</strong>
                    <small>{formatTime(selectedDocument[1][selectedDocument[1].length - 1].createdAt)}</small>
                  </span>
                  <ChevronDown size={16} aria-hidden="true" />
                </button>
                {documentMenuOpen && (
                  <div
                    id="workspace-version-history-documents"
                    className="workspace-page-version-history-document-menu"
                    role="listbox"
                    aria-label={t('studio.historyDocument')}
                  >
                    {documentOptions.map(([documentId, documentVersions]) => {
                      const latest = documentVersions[documentVersions.length - 1];
                      const isSelected = selectedDocument[0] === documentId;
                      return (
                        <button
                          key={documentId}
                          ref={(element) => { documentOptionRefs.current[documentId] = element; }}
                          type="button"
                          role="option"
                          value={documentId}
                          aria-selected={isSelected}
                          className={`workspace-page-version-history-document-option${isSelected ? ' is-selected' : ''}`}
                          onKeyDown={handleDocumentOptionKeyDown}
                          onClick={() => {
                            onSelectDocument(documentId);
                            setDocumentMenuOpen(false);
                            documentTriggerRef.current?.focus();
                          }}
                        >
                          <span>
                            <strong>{getVersionSummary(latest, t('studio.historyEmptyText'))}</strong>
                            <small>{formatTime(latest.createdAt)}</small>
                          </span>
                          {isSelected && <Check size={15} aria-hidden="true" />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            {orderedVersions.length === 0 ? (
              <p className="workspace-page-version-history-empty">{t('studio.noDocumentVersions')}</p>
            ) : orderedVersions.map((version) => {
              const summary = getVersionSummary(version, t('studio.historyEmptyText'));
              const attachmentCount = getVersionAttachments(version).length;
              return (
                <button
                  key={version.id}
                  type="button"
                  className={`workspace-page-version-history-item ${selectedVersion?.id === version.id ? 'is-selected' : ''}`}
                  onClick={() => onSelect(version.id)}
                  aria-pressed={selectedVersion?.id === version.id}
                >
                  <time dateTime={version.createdAt}>{formatTime(version.createdAt)}</time>
                  <span>{summary.slice(0, 84)}</span>
                  {attachmentCount > 0 && <small>{t('studio.historyAttachmentCount', { count: attachmentCount })}</small>}
                </button>
              );
            })}
          </div>

          <article className="workspace-page-version-history-preview" aria-label={t('studio.versionPreview')}>
            {selectedVersion ? (
              <>
                <time dateTime={selectedVersion.createdAt}>{formatTime(selectedVersion.createdAt)}</time>
                <pre>{getVersionText(selectedVersion) || t('studio.historyEmptyText')}</pre>
                {(selectedChatName || selectedDate || selectedTime || selectedButtons.length > 0) && (
                  <dl className="workspace-page-version-history-metadata">
                    {selectedChatName && <div><dt>{t('studio.historyChat')}</dt><dd>{selectedChatName}</dd></div>}
                    {(selectedDate || selectedTime) && <div><dt>{t('studio.historySchedule')}</dt><dd>{[selectedDate, selectedTime].filter(Boolean).join(' ')}</dd></div>}
                    {selectedButtons.length > 0 && <div><dt>{t('studio.historyButtons')}</dt><dd>{selectedButtons.join(', ')}</dd></div>}
                  </dl>
                )}
                {getVersionAttachments(selectedVersion).length > 0 && (
                  <div className="workspace-page-version-history-attachments">
                    <h3>{t('studio.historyAttachments')}</h3>
                    <ul>
                      {getVersionAttachments(selectedVersion).map((attachment) => (
                        <li key={attachment.id || `${attachment.name}-${attachment.position}`}>
                          <span>{attachment.name}</span>
                          {attachment.unavailable && <small>{t('studio.historyAttachmentUnavailable', { name: attachment.name })}</small>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            ) : (
              <p className="workspace-page-version-history-empty">{t('studio.noDocumentVersions')}</p>
            )}
            {restoreError && <p className="workspace-page-version-history-error" role="alert">{restoreError}</p>}
          </article>
        </div>

        <footer className="workspace-page-version-history-footer">
          <button type="button" className="workspace-page-version-history-cancel" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="workspace-page-version-history-copy"
            disabled={!selectedVersion || restoring}
            onClick={() => { if (selectedVersion) onOpenCopy(selectedVersion); }}
          >
            <Copy size={15} aria-hidden="true" />
            <span>{t('studio.openVersionCopy')}</span>
          </button>
          <button
            type="button"
            className="workspace-page-version-history-restore"
            disabled={!selectedVersion || restoring}
            onClick={() => { if (selectedVersion) onRestore(selectedVersion); }}
          >
            <RotateCcw size={15} aria-hidden="true" />
            <span>{t('studio.restoreVersion')}</span>
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}