import type { MutableRefObject } from 'react';
import { AlertTriangle, ImagePlus } from 'lucide-react';
import { useLocale } from '@studio/lib/i18n';
import {
  formatAttachmentSize,
  getAttachmentDisplayItems,
  isImageAttachment,
  MAX_PHOTOS_PER_ALBUM,
  toFileUrl,
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

  return (
    <div
      className={`workspace-page-attachment-tray ${attachments.length === 0 ? 'is-empty' : ''}`}
      aria-label={t('studio.attachedFiles')}
      aria-hidden={attachments.length === 0}
    >
      <div className="workspace-page-media-items" ref={attachmentItemsRef}>
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
                        src={file.previewUrl || toFileUrl(file.path)}
                        alt=""
                        tabIndex={0}
                        aria-label={t('studio.previewFile', { name: file.name })}
                        onMouseEnter={(event) => onSchedulePreview(
                          event.currentTarget,
                          file.name,
                          file.previewUrl || toFileUrl(file.path),
                        )}
                        onMouseLeave={onHidePreview}
                        onFocus={(event) => onShowPreview(
                          event.currentTarget,
                          file.name,
                          file.previewUrl || toFileUrl(file.path),
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
                  src={file.previewUrl || toFileUrl(file.path)}
                  alt=""
                  className="workspace-page-attachment-thumbnail"
                  tabIndex={0}
                  aria-label={t('studio.previewFile', { name: file.name })}
                  onMouseEnter={(event) => onSchedulePreview(event.currentTarget, file.name, file.previewUrl || toFileUrl(file.path))}
                  onMouseLeave={onHidePreview}
                  onFocus={(event) => onShowPreview(event.currentTarget, file.name, file.previewUrl || toFileUrl(file.path))}
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
