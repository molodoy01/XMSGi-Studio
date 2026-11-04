import { useEffect, useState } from 'react';
import type { Chat } from '@/types';
import { useLocale } from '@/lib/i18n';
import type { ColorTheme } from '@/lib/colorTheme';
import { QuickPlanner } from '@/components/QuickPlanner';
import type { QuickPlannerActionFeedback } from '@/components/QuickPlanner';
import { QuickPlannerNavigationContext } from '@/workspace/QuickPlannerNavigationContext';
import { flushPlannerDraftWrite, writePlannerDraft } from '@/lib/plannerDraft';
import { navigateTestbenchPage, TestbenchNavigation } from '../shared/TestbenchNavigation';
import { applyTestbenchColorTheme, readTestbenchColorTheme } from '../shared/testbenchTheme';
import './main.css';
import '../../src/index.css';
import '../../src/styles/colorThemes.css';

const demoChats: Chat[] = [
  { id: 'planner-demo-channel', name: 'XMSGi Updates', username: 'xmsgi_updates', type: 'channel' },
  { id: 'planner-demo-group', name: 'Studio team', type: 'group' },
  { id: 'planner-demo-private', name: 'Saved Messages', type: 'private' },
];

type FeedbackCategory = 'warning' | 'approval' | 'error';
type FeedbackExample = {
  value: string;
  tone: QuickPlannerActionFeedback['tone'];
  labelEn: string;
  labelRu: string;
  messageEn: string;
  messageRu: string;
  actions?: Array<'retry' | 'dismiss'>;
};

const feedbackExamples: Record<FeedbackCategory, FeedbackExample[]> = {
  warning: [
    {
      value: 'empty-message',
      tone: 'warning',
      labelEn: 'Empty message · short',
      labelRu: 'Пустое сообщение · короткое',
      messageEn: 'Write a message.',
      messageRu: 'Введите текст.',
    },
    {
      value: 'chat-required',
      tone: 'warning',
      labelEn: 'Chat required · medium',
      labelRu: 'Нужен чат · среднее',
      messageEn: 'Select a chat before sending.',
      messageRu: 'Сначала выберите чат.',
    },
    {
      value: 'schedule-too-soon',
      tone: 'warning',
      labelEn: 'Schedule time · medium',
      labelRu: 'Время отправки · среднее',
      messageEn: 'Choose a time at least one minute from now.',
      messageRu: 'Выберите время минимум через минуту.',
    },
    {
      value: 'attachment-limit',
      tone: 'warning',
      labelEn: 'Attachment limit · medium',
      labelRu: 'Лимит вложений · среднее',
      messageEn: 'Max 10 files. Remove one to add another.',
      messageRu: 'Лимит — 10 файлов. Удалите одно.',
    },
    {
      value: 'attachment-unavailable',
      tone: 'warning',
      labelEn: 'Unavailable attachment · medium',
      labelRu: 'Недоступное вложение · среднее',
      messageEn: 'File unavailable. Check access and try again.',
      messageRu: 'Файл недоступен. Проверьте доступ.',
      actions: ['dismiss'],
    },
  ],
  approval: [
    {
      value: 'message-sent',
      tone: 'success',
      labelEn: 'Message sent · short',
      labelRu: 'Сообщение отправлено · короткое',
      messageEn: 'Message sent.',
      messageRu: 'Сообщение отправлено.',
    },
    {
      value: 'draft-saved',
      tone: 'success',
      labelEn: 'Draft saved · medium',
      labelRu: 'Черновик сохранён · среднее',
      messageEn: 'Draft saved to your Posts.',
      messageRu: 'Черновик сохранён в публикациях.',
    },
    {
      value: 'message-scheduled',
      tone: 'success',
      labelEn: 'Message scheduled · short',
      labelRu: 'Сообщение запланировано · короткое',
      messageEn: 'Message scheduled.',
      messageRu: 'Сообщение запланировано.',
      actions: ['dismiss'],
    },
    {
      value: 'attachment-added',
      tone: 'success',
      labelEn: 'Attachment added · short',
      labelRu: 'Вложение добавлено · короткое',
      messageEn: 'Attachment added to the message.',
      messageRu: 'Вложение добавлено к сообщению.',
    },
    {
      value: 'message-scheduled-details',
      tone: 'success',
      labelEn: 'Schedule confirmed · medium',
      labelRu: 'Планирование подтверждено · среднее',
      messageEn: 'Scheduled. Edit the post anytime in Posts.',
      messageRu: 'Запланировано. Изменить можно в публикациях.',
    },
  ],
  error: [
    {
      value: 'send-error',
      tone: 'error',
      labelEn: 'Send failed · short',
      labelRu: 'Ошибка отправки · короткое',
      messageEn: 'Message could not be sent.',
      messageRu: 'Не удалось отправить сообщение.',
      actions: ['retry', 'dismiss'],
    },
    {
      value: 'schedule-error',
      tone: 'error',
      labelEn: 'Schedule failed · medium',
      labelRu: 'Ошибка планирования · среднее',
      messageEn: 'Could not schedule. Try again.',
      messageRu: 'Не удалось запланировать. Повторите.',
    },
    {
      value: 'draft-error',
      tone: 'error',
      labelEn: 'Draft save failed · medium',
      labelRu: 'Черновик не сохранён · среднее',
      messageEn: 'Draft not saved. Text remains in the editor.',
      messageRu: 'Черновик не сохранён. Текст остался.',
    },
    {
      value: 'connection-error',
      tone: 'error',
      labelEn: 'Telegram unavailable · medium',
      labelRu: 'Telegram недоступен · среднее',
      messageEn: 'Telegram offline. Check your connection.',
      messageRu: 'Нет связи с Telegram. Проверьте интернет.',
    },
    {
      value: 'rate-limit-error',
      tone: 'error',
      labelEn: 'Telegram rate limit · medium',
      labelRu: 'Ограничение Telegram · среднее',
      messageEn: 'Telegram limit reached. Try again later.',
      messageRu: 'Лимит Telegram. Попробуйте позже.',
    },
  ],
};

export function PlannerTestbench() {
  const { locale, setLocale } = useLocale();
  const [theme, setTheme] = useState<ColorTheme>(readTestbenchColorTheme);
  const [feedbackCategory, setFeedbackCategory] = useState<FeedbackCategory>('warning');
  const [feedbackExampleId, setFeedbackExampleId] = useState('empty-message');
  const [feedbackDismissed, setFeedbackDismissed] = useState(false);
  const [feedbackInstance, setFeedbackInstance] = useState(0);
  const [selectedChat, setSelectedChat] = useState<Chat | null>(demoChats[0]);
  const [plannerRevision, setPlannerRevision] = useState(0);
  const isRussian = locale === 'ru';
  const feedbackCategoryOptions: Array<{ value: FeedbackCategory; label: string }> = [
    { value: 'warning', label: isRussian ? 'Предупреждения' : 'Warnings' },
    { value: 'approval', label: isRussian ? 'Статусы одобрения' : 'Approval statuses' },
    { value: 'error', label: isRussian ? 'Ошибки' : 'Errors' },
  ];
  const categoryExamples = feedbackExamples[feedbackCategory];
  const selectedFeedbackExample = categoryExamples.find(({ value }) => value === feedbackExampleId) ?? categoryExamples[0];
  const feedbackExampleOptions = categoryExamples.map(({ value, labelEn, labelRu }) => ({
    value,
    label: isRussian ? labelRu : labelEn,
  }));
  const feedbackPreview: QuickPlannerActionFeedback | null = feedbackDismissed ? null : {
    tone: selectedFeedbackExample.tone,
    message: isRussian ? selectedFeedbackExample.messageRu : selectedFeedbackExample.messageEn,
    instance: feedbackInstance,
    actions: selectedFeedbackExample.actions?.map((id) => ({
      id,
      label: id === 'retry'
        ? (isRussian ? 'Повторить' : 'Retry')
        : (isRussian ? 'Закрыть' : 'Dismiss'),
      onClick: id === 'retry'
        ? () => setFeedbackInstance((instance) => instance + 1)
        : () => setFeedbackDismissed(true),
    })),
  };

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const changeTheme = (nextTheme: ColorTheme) => {
    setTheme(nextTheme);
    applyTestbenchColorTheme(nextTheme, { animate: true });
  };

  const reset = () => {
    writePlannerDraft('');
    flushPlannerDraftWrite();
    setFeedbackCategory('warning');
    setFeedbackExampleId('empty-message');
    setFeedbackDismissed(false);
    setFeedbackInstance(0);
    setSelectedChat(demoChats[0]);
    setPlannerRevision((revision) => revision + 1);
  };

  return (
    <div className="planner-testbench">
      <TestbenchNavigation
        locale={locale}
        setLocale={setLocale}
        theme={theme}
        onThemeChange={changeTheme}
        scenarioLabel={isRussian ? 'Тип уведомления' : 'Notification type'}
        scenario={feedbackCategory}
        scenarioOptions={feedbackCategoryOptions}
        onScenarioChange={(value) => {
          const nextCategory = value as FeedbackCategory;
          setFeedbackCategory(nextCategory);
          setFeedbackExampleId(feedbackExamples[nextCategory][0].value);
          setFeedbackDismissed(false);
          setFeedbackInstance(0);
        }}
        confirmationLabel={isRussian ? 'Пример уведомления' : 'Notification example'}
        confirmationScenario={selectedFeedbackExample.value}
        confirmationOptions={feedbackExampleOptions}
        onConfirmationScenarioChange={(value) => {
          setFeedbackExampleId(value);
          setFeedbackDismissed(false);
          setFeedbackInstance(0);
        }}
        onReset={reset}
        resetLabel={isRussian ? 'Сбросить' : 'Reset'}
        currentPage="planner"
      />
      <div className="planner-testbench-notice" role="note">
        {isRussian
          ? 'Предпросмотр пользовательских уведомлений в Planner. Отправка и планирование отключены.'
          : 'Preview user-facing Planner notifications. Sending and scheduling are disabled.'}
      </div>
      <div className="product-shell planner-shell">
        <QuickPlannerNavigationContext.Provider value={{
          currentSection: 'quick-plan',
          openQuickPlan: () => undefined,
          openStudio: () => navigateTestbenchPage('../studio-editor/'),
          openPosts: () => undefined,
          openSettings: () => undefined,
        }}>
          <QuickPlanner
            key={plannerRevision}
            chats={demoChats}
            selectedChat={selectedChat}
            onSelectChat={setSelectedChat}
            onSendNow={async () => false}
            onSchedule={async () => false}
            onSaveDraft={() => false}
            feedbackPreview={feedbackPreview}
          />
        </QuickPlannerNavigationContext.Provider>
      </div>
    </div>
  );
}
