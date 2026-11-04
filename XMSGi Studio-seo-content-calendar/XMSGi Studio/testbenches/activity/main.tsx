import { useEffect, useState } from 'react';
import type { ScheduledMessage } from '@/types';
import { useLocale } from '@/lib/i18n';
import type { ColorTheme } from '@/lib/colorTheme';
import { QuickPlannerActivity } from '@/components/QuickPlannerActivity';
import { TestbenchNavigation } from '../shared/TestbenchNavigation';
import { applyTestbenchColorTheme, readTestbenchColorTheme } from '../shared/testbenchTheme';
import './main.css';
import '../../src/index.css';
import '../../src/styles/colorThemes.css';

type ActivityScenario = 'sent' | 'empty' | 'loading' | 'error';

function createDemoSentMessages(): ScheduledMessage[] {
  const now = new Date();
  const dailyCounts = [
    2, 1, 4, 0, 3, 2, 1, 5, 3, 1,
    2, 4, 6, 2, 3, 1, 4, 2, 7, 3,
    1, 5, 8, 4, 6, 2, 9, 100, 3, 2,
  ];

  return dailyCounts.flatMap((count, dayOffset) => Array.from({ length: count }, (_, index) => {
    const sentAt = new Date(now);
    sentAt.setDate(now.getDate() - (dailyCounts.length - dayOffset - 1));
    sentAt.setHours(11, 15 + index, 0, 0);
    if (dayOffset === dailyCounts.length - 1 && sentAt > now) {
      sentAt.setTime(now.getTime() - (count - index) * 60_000);
    }

    return {
      id: `activity-demo-${dayOffset}-${index}`,
      chatId: 'activity-demo-channel',
      chatName: 'XMSGi Updates',
      text: `Demo message ${index + 1}`,
      when: sentAt.toISOString(),
      createdAt: sentAt.toISOString(),
      sentAt: sentAt.toISOString(),
      status: 'sent' as const,
    };
  }));
}

export function ActivityTestbench() {
  const { locale, setLocale } = useLocale();
  const [theme, setTheme] = useState<ColorTheme>(readTestbenchColorTheme);
  const [scenario, setScenario] = useState<ActivityScenario>('sent');
  const [connectionSpinnerVisible, setConnectionSpinnerVisible] = useState(false);
  const isRussian = locale === 'ru';

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const changeTheme = (nextTheme: ColorTheme) => {
    setTheme(nextTheme);
    applyTestbenchColorTheme(nextTheme, { animate: true });
  };

  const scenarios = [
    { value: 'sent', label: isRussian ? 'Отправленные сообщения' : 'Sent messages' },
    { value: 'empty', label: isRussian ? 'Нет активности' : 'No activity' },
    { value: 'loading', label: isRussian ? 'Загрузка истории' : 'Loading history' },
    { value: 'error', label: isRussian ? 'Ошибка истории' : 'History error' },
  ];
  const sent = scenario === 'sent' ? createDemoSentMessages() : [];

  return (
    <div className="activity-testbench">
      <TestbenchNavigation
        locale={locale}
        setLocale={setLocale}
        theme={theme}
        onThemeChange={changeTheme}
        scenarioLabel={isRussian ? 'Сценарий активности' : 'Activity scenario'}
        scenario={scenario}
        scenarioOptions={scenarios}
        onScenarioChange={(value) => {
          setScenario(value as ActivityScenario);
          setConnectionSpinnerVisible(false);
        }}
        onReset={() => {
          setScenario('sent');
          setConnectionSpinnerVisible(false);
        }}
        resetLabel={isRussian ? 'Сбросить' : 'Reset'}
        currentPage="activity"
        connectionSpinnerVisible={connectionSpinnerVisible}
        onConnectionSpinnerToggle={() => setConnectionSpinnerVisible((visible) => !visible)}
      />
      <main className="activity-testbench-main">
        <h1>{isRussian ? 'Активность Planner' : 'Planner Activity'}</h1>
        <div className="activity-testbench-preview">
          <QuickPlannerActivity
            sent={sent}
            historyReady={scenario !== 'loading'}
            historyError={scenario === 'error'}
          />
          <section
            className="activity-testbench-upcoming-reserved"
            aria-labelledby="activity-testbench-upcoming-heading"
          >
            <h2 id="activity-testbench-upcoming-heading">
              {isRussian ? 'Предстоящие' : 'Upcoming'}
            </h2>
          </section>
        </div>
      </main>
      {connectionSpinnerVisible && (
        <div className="connection-spinner show" role="status" aria-live="polite">
          <div className="connection-status-card">
            <div className="connection-spinner-ring" aria-hidden="true" />
            <span>{isRussian ? 'Проверяем подключение…' : 'Checking your connection…'}</span>
          </div>
        </div>
      )}
    </div>
  );
}
