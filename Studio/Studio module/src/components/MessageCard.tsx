import type { ScheduledMessage } from '@/types';
import { formatDateTime } from '@/lib/utils';
import { richTextToHtml } from '@/lib/richText';

function toFileUrl(filePath: string) {
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

interface Props {
  message: ScheduledMessage;
  isLast: boolean;
  onCancel: (msg: ScheduledMessage) => void;
  onReschedule: (msg: ScheduledMessage) => void;
  onSendNow: (msg: ScheduledMessage) => void;
  onDelete: (msg: ScheduledMessage) => void;
  showDelete: boolean;
  showCancel: boolean;
  showSendNow: boolean;
  railColor?: string;
  isCanceling?: boolean;
  isSending?: boolean;
  isRevealing?: boolean;
  showCreatedMeta?: boolean;
}

export function MessageCard({
  message,
  isLast,
  onCancel,
  onReschedule,
  onSendNow,
  onDelete,
  showDelete,
  showCancel,
  showSendNow,
  railColor,
  isCanceling,
  isSending,
  isRevealing,
  showCreatedMeta,
}: Props) {
  const createdLabel = new Date(message.createdAt).toLocaleString([], {
    dateStyle: 'short',
    timeStyle: 'short',
  }).replace(/\s*р\.\s*$/, '');

  return (
    <div
        className={`message-row ${
          isRevealing ? 'is-revealing' : ''
        } ${message.status} ${showCreatedMeta ? 'archive-row' : ''} ${isLast ? 'is-last' : ''}`}
      >
      <div className="message-rail" aria-hidden="true">
        <div
          className="message-rail-dot"
          style={
            railColor
              ? { borderColor: railColor }
              : undefined
          }
        />

      </div>

      <div className="message-body">
        <div className="message-header">
          <div className="message-chat">
            {message.chatName}
          </div>

          <div
            className={`message-status ${message.status}`}
          >
            {isCanceling
              ? 'Unscheduling…'
              : isSending
                ? 'Sending…'
                : message.status === 'sent'
                  ? 'Sent'
                  : message.status === 'failed'
                    ? 'Failed'
                    : message.status === 'confirmed'
                      ? 'Confirmed'
                      : message.status === 'pending'
                        ? 'Pending'
                        : 'Scheduled'}
          </div>
        </div>

        <div className="message-meta-row">
          <div className="message-meta">
            {formatDateTime(message.when)}
          </div>

          {showCreatedMeta && (
            <div className="message-created-meta">
              <span className="message-created-rail" />
              <span>{createdLabel}</span>
            </div>
          )}
        </div>

        <div className="message-post-preview">
          {message.attachments && message.attachments.length > 0 && (
            <div className="message-attachments" aria-label="Attachments">
              {message.attachments.map((attachment) => (
                isImageAttachment(attachment) ? (
                  <img
                    key={attachment}
                    className="message-attachment-image"
                    src={toFileUrl(attachment)}
                    alt=""
                    loading="lazy"
                  />
                ) : (
                  <div className="message-attachment-file" key={attachment}>
                    <span aria-hidden="true">FILE</span>
                    <strong>{attachment.split(/[\\/]/).pop() || attachment}</strong>
                  </div>
                )
              ))}
            </div>
          )}

          <div
            className="message-preview"
            dangerouslySetInnerHTML={{ __html: richTextToHtml(message.text, message.entities ?? []) }}
          />
        </div>
      </div>

      <div className="message-actions">
        {showCancel && (
          <button
            className="msg-btn cancel"
            onClick={() => onCancel(message)}
            title="Cancel this scheduled message"
          >
            Cancel
          </button>
        )}

        {showCancel && (
          <button
            className="msg-btn reschedule"
            onClick={() => onReschedule(message)}
            title="Edit and schedule this message again"
          >
            Reschedule
          </button>
        )}

        {showSendNow && (
          <button
            className="msg-btn send-now"
            onClick={() => onSendNow(message)}
            title="Send this message immediately"
          >
            Send now
          </button>
        )}

        {showDelete && (
          <button
            className="msg-btn delete"
            onClick={() => onDelete(message)}
            title="Remove this message from the list"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}
