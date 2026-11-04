import { useEffect, useMemo, useState } from 'react';
import { createStudioSchedulerRuntime } from '@shared/bridge';
import type { StudioSchedulerActions } from '@shared/bridge';
import { ConfirmDialogSurface } from '../../src/components/ConfirmDialog';
import { useLocale } from '../../src/lib/i18n';
import type { ColorTheme } from '../../src/lib/colorTheme';
import { TestbenchNavigation } from '../shared/TestbenchNavigation';
import { applyTestbenchColorTheme, readTestbenchColorTheme } from '../shared/testbenchTheme';
import StudioApp from '../../src/studio/App';
import type { Chat } from '../../src/studio/types';
import './main.css';
import '../../src/index.css';
import '../../src/styles/colorThemes.css';
import '../../src/studio/pages/WorkspacePage.css';

const botFatherChat: Chat = {
  id: 'botfather',
  name: 'BotFather',
  username: 'BotFather',
  type: 'private',
};

type ErrorVariant =
  | 'none'
  | 'send-error'
  | 'draft-error'
  | 'attachment-error'
  | 'text-error'
  | 'chat-error'
  | 'history-error'
  | 'preview-error'
  | 'connection-error'
  | 'provider-error'
  | 'warning'
  | 'mass-warning'
  | 'progress'
  | 'success'
  | 'action-retry-error'
  | 'action-dismiss-warning';
type ConfirmationVariant = 'none' | 'delete-draft' | 'discard-changes';

export function StudioEditorTestbench() {
  const { locale, setLocale, t } = useLocale();
  const [theme, setTheme] = useState<ColorTheme>(readTestbenchColorTheme);
  const [errorVariant, setErrorVariant] = useState<ErrorVariant>('none');
  const [confirmationVariant, setConfirmationVariant] = useState<ConfirmationVariant>('none');
  const [selectedChat, setSelectedChat] = useState<Chat | null>(botFatherChat);
  const [actionFeedbackDismissed, setActionFeedbackDismissed] = useState(false);
  const [actionFeedbackRevision, setActionFeedbackRevision] = useState(0);
  const isRussian = locale === 'ru';
  const errorOptions: Array<{ value: ErrorVariant; label: string }> = [
    { value: 'none', label: isRussian ? 'Без уведомления' : 'No notification' },
    { value: 'send-error', label: isRussian ? 'Ошибка отправки' : 'Send failure' },
    { value: 'draft-error', label: isRussian ? 'Ошибка черновика' : 'Draft storage failure' },
    { value: 'attachment-error', label: isRussian ? 'Ошибка вложения' : 'Attachment failure' },
    { value: 'text-error', label: isRussian ? 'Ошибка импорта' : 'Text import failure' },
    { value: 'chat-error', label: isRussian ? 'Чат не найден' : 'Chat not found' },
    { value: 'history-error', label: isRussian ? 'Ошибка истории' : 'History failure' },
    { value: 'preview-error', label: isRussian ? 'История чата недоступна' : 'Chat history unavailable' },
    { value: 'connection-error', label: isRussian ? 'Нет связи с Telegram' : 'Telegram connection failure' },
    { value: 'provider-error', label: isRussian ? 'Ограничение Telegram' : 'Telegram rate limit' },
    { value: 'warning', label: isRussian ? 'Предупреждение расписания' : 'Schedule warning' },
    { value: 'mass-warning', label: isRussian ? 'Массовое планирование' : 'Mass scheduling warning' },
    { value: 'progress', label: isRussian ? 'Отправка' : 'Sending' },
    { value: 'success', label: isRussian ? 'Успешная отправка' : 'Send success' },
    { value: 'action-retry-error', label: isRussian ? 'Ошибка с повтором и закрытием' : 'Error with retry and dismiss' },
    { value: 'action-dismiss-warning', label: isRussian ? 'Предупреждение с закрытием' : 'Dismissible warning' },
  ];
  const errorMessage = {
    'send-error': t('studio.sendFailed'),
    'draft-error': t('studio.draftsCouldNotSave'),
    'attachment-error': t('studio.fixAttachment'),
    'text-error': t('studio.textFileReadFailed'),
    'chat-error': t('studio.addChatFailed'),
    'history-error': t('studio.historyCouldNotSave'),
    'preview-error': t('studio.previewHistoryFailed'),
    'connection-error': t('studio.connectionFailed'),
    'provider-error': isRussian
      ? 'Telegram: FLOOD_WAIT_60. Повторите через 60 секунд.'
      : 'Telegram: FLOOD_WAIT_60. Retry in 60 seconds.',
    warning: t('studio.futureDateTime'),
    'mass-warning': t('schedule.massWarningMessage', { count: 12 }),
    progress: '',
    success: t('studio.messageSent'),
    'action-retry-error': '',
    'action-dismiss-warning': '',
    none: '',
  }[errorVariant];
  const confirmationOptions: Array<{ value: ConfirmationVariant; label: string }> = [
    { value: 'none', label: isRussian ? 'Без подтверждения' : 'No confirmation' },
    { value: 'delete-draft', label: isRussian ? 'Удаление черновика' : 'Delete draft' },
    { value: 'discard-changes', label: isRussian ? 'Несохранённые изменения' : 'Unsaved changes' },
  ];
  const scheduler = useMemo(() => {
    const actions: StudioSchedulerActions = {
      upcoming: [],
      sent: [],
      scheduling: false,
      successPulse: false,
      lastAction: null,
      revealingId: null,
      cancelingIds: new Set(),
      sendingIds: new Set(),
      publishingDraft: errorVariant === 'progress',
      handleSchedule: async () => false,
      handleSendDraftNow: async () => false,
      handleSendNow: () => undefined,
      handleDeleteMessage: () => undefined,
      handleClearSent: () => undefined,
      handleCancelMessage: async () => false,
      handleCancelMessages: async () => false,
    };
    return createStudioSchedulerRuntime(actions, (message, type) => {
      setErrorVariant(type === 'success' ? 'success' : type === 'warning' ? 'warning' : 'error');
      setErrorMessage(message);
    });
  }, [errorMessage, errorVariant, t]);
  const actionFeedback = errorVariant === 'action-retry-error'
        ? {
          kind: 'error' as const,
          message: isRussian
            ? 'Не удалось отправить сообщение. Проверьте подключение к Telegram и повторите попытку. Текст останется в редакторе.'
            : 'Could not send the message. Check your Telegram connection and try again. Your text will remain in the editor.',
        }
        : errorVariant === 'action-dismiss-warning'
          ? {
            kind: 'warning' as const,
            message: isRussian
              ? 'Для повторного планирования проверьте выбранные дату, время и чат.'
              : 'Check the selected date, time, and chat before trying to schedule again.',
          }
          : null;

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const changeTheme = (nextTheme: ColorTheme) => {
    setTheme(nextTheme);
    applyTestbenchColorTheme(nextTheme, { animate: true });
  };

  return (
    <div className="product-shell studio-shell studio-editor-stand">
      <TestbenchNavigation
        locale={locale}
        setLocale={setLocale}
        theme={theme}
        onThemeChange={changeTheme}
        scenarioLabel={isRussian ? 'Сценарий уведомления' : 'Status scenario'}
        scenario={errorVariant}
        scenarioOptions={errorOptions}
        onScenarioChange={(value) => {
          setErrorVariant(value as ErrorVariant);
          setActionFeedbackDismissed(false);
          setActionFeedbackRevision(0);
        }}
        confirmationLabel={isRussian ? 'Сценарий подтверждения' : 'Confirmation scenario'}
        confirmationScenario={confirmationVariant}
        confirmationOptions={confirmationOptions}
        onConfirmationScenarioChange={(value) => setConfirmationVariant(value as ConfirmationVariant)}
        onReset={() => {
          setErrorVariant('none');
          setConfirmationVariant('none');
          setActionFeedbackDismissed(false);
          setActionFeedbackRevision(0);
        }}
        resetLabel={isRussian ? 'Сбросить' : 'Reset'}
        currentPage="studio"
      />
      <StudioApp
        connected
        chats={[botFatherChat]}
        selectedChat={selectedChat}
        onSelectChat={setSelectedChat}
        scheduler={scheduler}
      />
      {actionFeedback && !actionFeedbackDismissed && (
        <div
          key={actionFeedbackRevision}
          className={`workspace-page-publish-transient-feedback studio-editor-testbench-feedback is-${actionFeedback.kind} has-detail`}
          role={actionFeedback.kind === 'error' ? 'alert' : 'status'}
          aria-live={actionFeedback.kind === 'error' ? 'assertive' : 'polite'}
        >
          <span className="workspace-page-publish-transient-feedback-status">{actionFeedback.message}</span>
          {errorVariant === 'action-retry-error' && (
            <button
              type="button"
              className="workspace-page-send-retry"
              onClick={() => setActionFeedbackRevision((revision) => revision + 1)}
            >
              {isRussian ? 'Повторить' : 'Retry'}
            </button>
          )}
          <button
            type="button"
            className="workspace-page-publish-status-dismiss"
            aria-label={isRussian ? 'Закрыть уведомление' : 'Dismiss notification'}
            onClick={() => setActionFeedbackDismissed(true)}
          >
            ×
          </button>
        </div>
      )}
      {confirmationVariant !== 'none' && (
        <ConfirmDialogSurface
          title={confirmationVariant === 'delete-draft'
            ? (isRussian ? 'Удалить черновик?' : 'Delete this draft?')
            : (isRussian ? 'Отменить изменения?' : 'Discard your changes?')}
          message={confirmationVariant === 'delete-draft'
            ? (isRussian ? 'Черновик будет удалён без возможности восстановления.' : 'This draft will be permanently deleted.')
            : (isRussian ? 'Все несохранённые изменения будут потеряны.' : 'All unsaved changes will be lost.')}
          confirmLabel={confirmationVariant === 'delete-draft'
            ? (isRussian ? 'Удалить' : 'Delete')
            : (isRussian ? 'Отменить изменения' : 'Discard changes')}
          cancelLabel={isRussian ? 'Остаться' : 'Keep editing'}
          destructive={confirmationVariant === 'delete-draft'}
          onCancel={() => setConfirmationVariant('none')}
          onConfirm={() => setConfirmationVariant('none')}
        />
      )}
    </div>
  );
}
