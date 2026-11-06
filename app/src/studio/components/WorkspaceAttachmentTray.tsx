import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, MutableRefObject, PointerEvent } from 'react';
import { AlertTriangle, ImagePlus } from 'lucide-react';
import { useLocale } from '@studio/lib/i18n';
import {
  formatAttachmentSize,
  getAttachmentPreviewUrl,
  getAttachmentDisplayItems,
  isImageAttachment,
  MAX_PHOTOS_PER_ALBUM,
  type WorkspaceAttachment,
} from '../lib/workspaceAttachments';

type WorkspaceAttachmentTrayProps = {
  attachments: WorkspaceAttachment[];
  attachmentItemsRef: MutableRefObject<HTMLDivElement | null>;
  onAddPhotosToAlbum: (albumId: string, position: number) => void;
  onRemoveAttachment: (attachmentId: string) => void;
  onRemoveAlbum: (albumId: string) => void;
  onSchedulePreview: (image: HTMLImageElement, name: string, src: string) => void;
  onShowPreview: (image: HTMLImageElement, name: string, src: string) => void;
  onHidePreview: () => void;
};

export function WorkspaceAttachmentTray({
  attachments,
  attachmentItemsRef,
  onAddPhotosToAlbum,
  onRemoveAttachment,
  onRemoveAlbum,
  onSchedulePreview,
  onShowPreview,
  onHidePreview,
}: WorkspaceAttachmentTrayProps) {
  const { t } = useLocale();
  const scrollbarRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ pointerX: number; scrollLeft: number } | null>(null);
  const [scrollMetrics, setScrollMetrics] = useState({ clientWidth: 0, scrollLeft: 0, scrollWidth: 0, trackWidth: 0 });
  const hasOverflow = scrollMetrics.scrollWidth > scrollMetrics.clientWidth + 1;
  const maxScroll = Math.max(0, scrollMetrics.scrollWidth - scrollMetrics.clientWidth);
  const thumbWidth = hasOverflow
    ? Math.max(28, scrollMetrics.trackWidth * scrollMetrics.clientWidth / scrollMetrics.scrollWidth)
    : scrollMetrics.trackWidth;
  const thumbLeft = maxScroll > 0
    ? (scrollMetrics.trackWidth - thumbWidth) * scrollMetrics.scrollLeft / maxScroll
    : 0;

  const updateScrollMetrics = useCallback(() => {
    const items = attachmentItemsRef.current;
    const track = scrollbarRef.current;
    if (!items || !track) return;
    setScrollMetrics({
      clientWidth: items.clientWidth,
      scrollLeft: items.scrollLeft,
      scrollWidth: items.scrollWidth,
      trackWidth: track.clientWidth,
    });
  }, [attachmentItemsRef]);

  useLayoutEffect(() => {
    updateScrollMetrics();
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(updateScrollMetrics);
    if (attachmentItemsRef.current) resizeObserver?.observe(attachmentItemsRef.current);
    if (scrollbarRef.current) resizeObserver?.observe(scrollbarRef.current);
    return () => resizeObserver?.disconnect();
  }, [attachments, attachmentItemsRef, updateScrollMetrics]);

  const handleScrollbarPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!hasOverflow) return;
    const track = event.currentTarget;
    const bounds = track.getBoundingClientRect();
    const pointerX = event.clientX - bounds.left;
    const thumb = track.querySelector<HTMLElement>('.workspace-page-attachment-scrollbar-thumb');
    const items = attachmentItemsRef.current;
    if (!items) return;

    if (thumb?.contains(event.target as Node)) {
      dragRef.current = { pointerX: event.clientX, scrollLeft: items.scrollLeft };
      track.setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }

    const travel = Math.max(0, bounds.width - thumbWidth);
    items.scrollLeft = travel > 0
      ? Math.max(0, Math.min(maxScroll, (pointerX - thumbWidth / 2) / travel * maxScroll))
      : 0;
  };

  const handleScrollbarPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current || !attachmentItemsRef.current) return;
    const travel = Math.max(0, event.currentTarget.clientWidth - thumbWidth);
    if (travel === 0) return;
    attachmentItemsRef.current.scrollLeft = Math.max(
      0,
      Math.min(maxScroll, dragRef.current.scrollLeft + (event.clientX - dragRef.current.pointerX) * maxScroll / travel),
    );
  };

  const handleScrollbarKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = attachmentItemsRef.current;
    if (!items || !hasOverflow) return;
    const step = Math.max(80, items.clientWidth * 0.6);
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      items.scrollLeft += event.key === 'ArrowLeft' ? -step : step;
    } else if (event.key === 'Home') {
      items.scrollLeft = 0;
    } else if (event.key === 'End') {
      items.scrollLeft = maxScroll;
    } else {
      return;
    }
    event.preventDefault();
  };

  return (
    <div
      className={`workspace-page-attachment-tray ${attachments.length === 0 ? 'is-empty' : ''}`}
      aria-label={t('studio.attachedFiles')}
      aria-hidden={attachments.length === 0}
    >
      <div
        ref={scrollbarRef}
        className={`workspace-page-attachment-scrollbar${hasOverflow ? ' is-visible' : ''}`}
        role={hasOverflow ? 'scrollbar' : undefined}
        tabIndex={hasOverflow ? 0 : undefined}
        aria-label={t('studio.attachedFiles')}
        aria-controls="workspace-page-attachment-items"
        aria-orientation="horizontal"
        aria-valuemin={0}
        aria-valuemax={maxScroll}
        aria-valuenow={Math.min(maxScroll, scrollMetrics.scrollLeft)}
        onPointerDown={handleScrollbarPointerDown}
        onPointerMove={handleScrollbarPointerMove}
        onPointerUp={() => { dragRef.current = null; }}
        onPointerCancel={() => { dragRef.current = null; }}
        onKeyDown={handleScrollbarKeyDown}
      >
        <div
          className="workspace-page-attachment-scrollbar-thumb"
          style={{ left: `${thumbLeft}px`, width: `${thumbWidth}px` }}
        />
      </div>
      <div
        id="workspace-page-attachment-items"
        className="workspace-page-media-items"
        ref={attachmentItemsRef}
        onScroll={updateScrollMetrics}
      >
        {getAttachmentDisplayItems(attachments).map((item) => {
          if (item.kind === 'album') {
            return (
              <div
                key={`album-${item.albumId}`}
                className="workspace-page-attachment-card workspace-page-photo-album-card"
                data-album-id={item.albumId}
                data-position={item.position}
                role="group"
                aria-label={`${t('studio.photoAlbum')} · ${t('studio.photoAlbumCount', { count: item.attachments.length })}`}
              >
                <div className="workspace-page-photo-album-preview">
                  {item.attachments.slice(0, 4).map((file) => (
                    file.unavailable ? (
                      <span key={file.id}><AlertTriangle size={10} aria-hidden="true" /></span>
                    ) : (
                      <img
                        key={file.id}
                        src={getAttachmentPreviewUrl(file.path, file.previewUrl)}
                        alt=""
                        tabIndex={0}
                        aria-label={t('studio.previewFile', { name: file.name })}
                        onMouseEnter={(event) => onSchedulePreview(
                          event.currentTarget,
                          file.name,
                          getAttachmentPreviewUrl(file.path, file.previewUrl),
                        )}
                        onMouseLeave={onHidePreview}
                        onFocus={(event) => onShowPreview(
                          event.currentTarget,
                          file.name,
                          getAttachmentPreviewUrl(file.path, file.previewUrl),
                        )}
                        onBlur={onHidePreview}
                      />
                    )
                  ))}
                  {item.attachments.length > 4 && (
                    <span className="workspace-page-photo-album-preview-more">+{item.attachments.length - 4}</span>
                  )}
                </div>
                <span className="workspace-page-attachment-copy">
                  <span className="workspace-page-attachment-name">{t('studio.photoAlbum')}</span>
                  <span className="workspace-page-attachment-metadata">
                    {t('studio.photoAlbumCount', { count: item.attachments.length })}
                  </span>
                </span>
                <button
                  type="button"
                  className="workspace-page-photo-album-add"
                  disabled={item.attachments.length >= MAX_PHOTOS_PER_ALBUM}
                  onClick={() => onAddPhotosToAlbum(item.albumId, item.position)}
                  aria-label={t('studio.addPhotosToAlbum')}
                  title={t('studio.addPhotosToAlbum')}
                >
                  <ImagePlus size={13} strokeWidth={1.8} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="workspace-page-attachment-remove"
                  onClick={() => onRemoveAlbum(item.albumId)}
                  aria-label={t('studio.removePhotoAlbum')}
                  title={t('studio.removePhotoAlbum')}
                >
                  ×
                </button>
              </div>
            );
          }

          const file = item.attachment;
          return (
            <div
              key={file.id}
              className={`workspace-page-attachment-card ${file.unavailable ? 'is-unavailable' : ''}`}
              data-position={file.position}
              title={file.unavailable || !isImageAttachment(file)
                ? `${file.name} · ${file.mimeType} · ${formatAttachmentSize(file.size)}${file.unavailable ? ` · ${t('studio.historyAttachmentUnavailable', { name: file.name })}` : ''}`
                : undefined}
              aria-label={file.unavailable ? t('studio.historyAttachmentUnavailable', { name: file.name }) : undefined}
            >
              {file.unavailable ? (
                <div className="workspace-page-attachment-file-mark is-unavailable">
                  <AlertTriangle size={15} aria-hidden="true" />
                </div>
              ) : isImageAttachment(file) ? (
                <img
                  src={getAttachmentPreviewUrl(file.path, file.previewUrl)}
                  alt=""
                  className="workspace-page-attachment-thumbnail"
                  tabIndex={0}
                  aria-label={t('studio.previewFile', { name: file.name })}
                  onMouseEnter={(event) => onSchedulePreview(event.currentTarget, file.name, getAttachmentPreviewUrl(file.path, file.previewUrl))}
                  onMouseLeave={onHidePreview}
                  onFocus={(event) => onShowPreview(event.currentTarget, file.name, getAttachmentPreviewUrl(file.path, file.previewUrl))}
                  onBlur={onHidePreview}
                />
              ) : (
                <div className="workspace-page-attachment-file-mark">
                  {file.name.split('.').pop()?.slice(0, 4).toUpperCase() || 'FILE'}
                </div>
              )}
              <span className="workspace-page-attachment-copy">
                <span className="workspace-page-attachment-name">{file.name}</span>
                <span className="workspace-page-attachment-metadata">
                  {file.mimeType} · {formatAttachmentSize(file.size)}
                </span>
              </span>
              <button
                type="button"
                className="workspace-page-attachment-remove"
                onClick={() => onRemoveAttachment(file.id)}
                aria-label={t('composer.removeAttachment', { name: file.name })}
                title={t('composer.removeAttachment', { name: file.name })}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
