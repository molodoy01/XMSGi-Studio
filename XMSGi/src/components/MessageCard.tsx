import type { MessageOption, ScheduledMessage } from '@/types';
import { formatDateTime } from '@/lib/utils';
import { richTextToHtml } from '@/lib/richText';
import { useLocale } from '@/lib/i18n';

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
  selectedMessageOption?: MessageOption | null;
}

export function MessageCard({
  message,
  isLast,
  onSendNow,
  onDelete,
  showDelete,
  showSendNow,
  railColor,
  isCanceling,
  isSending,
  isRevealing,
  showCreatedMeta,
  selectedMessageOption = null,
}: Props) {
  const { t } = useLocale();
  const createdLabel = new Date(message.createdAt).toLocaleString([], {
    dateStyle: 'short',
    timeStyle: 'short',
  }).replace(/\s*р\.\s*$/, '');

  const messageOption: MessageOption | null = message.effect
    ? 'effect'
    : message.silent
      ? 'silent'
      : selectedMessageOption ?? null;

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
              ? t('schedule.unscheduling')
              : isSending
                ? t('schedule.sending')
                : message.status === 'sent'
                  ? t('schedule.sent')
                  : message.status === 'confirmed'
                    ? t('schedule.confirmed')
                    : message.status === 'pending'
                      ? t('schedule.pending')
                        : t('schedule.scheduled')}
          </div>
        </div>

        <div className="message-meta-row">
          <div className="message-meta">
            {formatDateTime(message.when)}
              {messageOption && (
                <span className="message-history-option-icon" aria-label={t('schedule.selectedOption')}>
                  {messageOption === 'silent' ? '🔕' : '✨'}
                </span>
              )}
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
            <div className="message-attachments" aria-label={t('schedule.attachments')}>
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
        {showSendNow && (
          <button
            className="msg-btn send-now"
            onClick={() => onSendNow(message)}
            title={t('schedule.sendNowTitle')}
          >
            {t('composer.sendNow')}
          </button>
        )}

        {showDelete && (
          <button
            className="msg-btn delete"
            onClick={() => onDelete(message)}
            title={t('schedule.deleteTitle')}
          >
            {t('common.remove')}
          </button>
        )}
      </div>
    </div>
  );
}
