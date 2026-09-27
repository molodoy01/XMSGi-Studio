interface Props {
  show: boolean;
  chatName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

import { useLocale } from '@/lib/i18n';

export function ChatRemoveModal({
  show,
  chatName,
  onConfirm,
  onCancel,
}: Props) {
  const { t } = useLocale();
  return (
    <div className={`chat-remove-modal ${show ? 'show' : ''}`}>
      <div className="chat-remove-title">{t('chatRemove.title')}</div>

      <div className="chat-remove-message">
        {t('chatRemove.message', { name: chatName })}
      </div>

      <div className="chat-remove-actions">
        <button
          className="chat-remove-cancel"
          onClick={onCancel}
        >
          {t('common.cancel')}
        </button>

        <button
          className="chat-remove-confirm"
          onClick={onConfirm}
        >
          {t('common.remove')}
        </button>
      </div>
    </div>
  );
}