import { useLocale } from '@studio/lib/i18n';
import { ConfirmDialogSurface } from '@/components/ConfirmDialog';

interface Props {
  show: boolean;
  chatName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ChatRemoveModal({
  show,
  chatName,
  onConfirm,
  onCancel,
}: Props) {
  const { t } = useLocale();
  if (!show) return null;
  return (
    <ConfirmDialogSurface
      title={t('chatRemove.title')}
      message={t('chatRemove.message', { name: chatName })}
      confirmLabel={t('common.remove')}
      cancelLabel={t('common.cancel')}
      destructive
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}