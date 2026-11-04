import { memo } from 'react';
import type { PreviewChatHistory } from '@studio/types';
import { InlineKeyboardPreview } from '@studio/components/InlineKeyboardPreview';
import { richTextToHtml } from '@studio/lib/richText';
import type { HistoryGroup } from './chatPreviewHistoryUtils';
import './ChatPreviewStand.css';

export type ChatPreviewHistoryProps = {
  groups: HistoryGroup[];
  selectedChatType?: string;
  onOpenPhoto: (photo: { src: string; name: string }) => void;
  viewPhotoLabel: string;
};

function formatDuration(duration?: number) {
  if (!duration || duration < 1) return '';
  const minutes = Math.floor(duration / 60);
  const seconds = Math.floor(duration % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function renderHistoryMedia(
  message: PreviewChatHistory['messages'][number],
  onOpenPhoto: (photo: { src: string; name: string }) => void,
  viewPhotoLabel: string,
) {
  const media = message.media;
  if (!media) return null;

  if (media.kind === 'photo' || media.kind === 'video') {
    const src = media.dataUrl || media.thumbnailDataUrl;
    if (!src) {
      return (
        <div className="chat-preview-media-placeholder">
          {media.kind === 'video' ? 'Video preview unavailable' : 'Photo preview unavailable'}
        </div>
      );
    }

    const frameContent = (
      <>
        <img loading="lazy" src={src} alt={media.name || 'Telegram media'} />
        {media.kind === 'video' && <span className="chat-preview-play">▶</span>}
        {media.kind === 'video' && media.duration && (
          <span className="chat-preview-duration">{formatDuration(media.duration)}</span>
        )}
      </>
    );

    return media.kind === 'photo' ? (
      <button
        type="button"
        className="chat-preview-history-media-frame chat-preview-history-photo-trigger"
        onClick={() => onOpenPhoto({ src, name: media.name || '' })}
        aria-label={viewPhotoLabel}
        title={viewPhotoLabel}
      >
        {frameContent}
      </button>
    ) : (
      <div className="chat-preview-history-media-frame">{frameContent}</div>
    );
  }

  if (media.kind === 'audio') {
    return (
      <div className="chat-preview-audio">
        <strong>{media.name || 'Audio message'}</strong>
        <span>{formatDuration(media.duration) || 'Audio preview unavailable'}</span>
        {media.dataUrl && <audio controls preload="metadata" src={media.dataUrl} />}
      </div>
    );
  }

  return (
    <div className="chat-preview-document">
      <span className="chat-preview-file-icon">FILE</span>
      <span>{media.name || 'Document'}</span>
    </div>
  );
}

export const ChatPreviewHistory = memo(function ChatPreviewHistory({
  groups,
  selectedChatType,
  onOpenPhoto,
  viewPhotoLabel,
}: ChatPreviewHistoryProps) {
  return (
    <>
      {groups.map((group) => {
        const firstMessage = group.messages[0];
        const hasMedia = group.messages.some((message) => message.media);
        return (
          <article className={`chat-preview-history-entry ${firstMessage.outgoing ? 'is-outgoing' : 'is-incoming'} ${hasMedia ? 'has-media' : ''}`} key={group.key}>
            {!firstMessage.outgoing && selectedChatType !== 'private' && firstMessage.senderName && (
              <span className="chat-preview-sender">{firstMessage.senderName}</span>
            )}
            {hasMedia && (
              <div className={`chat-preview-history-grid ${group.messages.length > 1 ? 'is-album' : ''}`}>
                {group.messages.map((message) => (
                  <div key={message.id}>
                    {renderHistoryMedia(message, onOpenPhoto, viewPhotoLabel)}
                  </div>
                ))}
              </div>
            )}
            {group.messages.filter((message) => message.text).map((message) => (
              <div
                className="chat-preview-message"
                key={message.id}
                dangerouslySetInnerHTML={{ __html: richTextToHtml(message.text, message.entities ?? []) }}
              />
            ))}
            <InlineKeyboardPreview markup={group.messages.find((message) => message.replyMarkup)?.replyMarkup} />
            <div className="chat-preview-meta">
              <time>{new Date(firstMessage.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
              {firstMessage.outgoing && <span aria-label="Sent">✓✓</span>}
            </div>
          </article>
        );
      })}
    </>
  );
});
