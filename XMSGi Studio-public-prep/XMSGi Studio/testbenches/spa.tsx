import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfirmDialogProvider } from '../src/components/ConfirmDialog';
import { LocaleProvider, useLocale } from '../src/lib/i18n';
import { applyTestbenchColorTheme, readTestbenchColorTheme } from './shared/testbenchTheme';
import { TestbenchPageSelector, navigateTestbenchPage, type TestbenchPageId } from './shared/TestbenchNavigation';
import { ActivityTestbench } from './activity/main';
import { LoginTestbench } from './login/main';
import { PlannerTestbench } from './planner/main';
import { SettingsTestbench } from './settings/main';
import { StudioEditorTestbench } from './studio-editor/main';
import './index.css';
import './shared/TestbenchNavigation.css';

applyTestbenchColorTheme(readTestbenchColorTheme());

type TestbenchRoute = TestbenchPageId | 'all';

const pages: Array<{
  id: Exclude<TestbenchRoute, 'all'>;
  path: string;
  titleEn: string;
  titleRu: string;
  descriptionEn: string;
  descriptionRu: string;
}> = [
  {
    id: 'login',
    path: '/testbenches/login/',
    titleEn: 'Login screen',
    titleRu: 'Вход',
    descriptionEn: 'Authentication states, language, and theme',
    descriptionRu: 'Сценарии входа, язык и тема',
  },
  {
    id: 'studio',
    path: '/testbenches/studio-editor/',
    titleEn: 'Studio editor',
    titleRu: 'Редактор Studio',
    descriptionEn: 'Workspace editor and save-error states',
    descriptionRu: 'Редактор рабочей области и ошибки сохранения',
  },
  {
    id: 'planner',
    path: '/testbenches/planner/',
    titleEn: 'Planner',
    titleRu: 'Планировщик',
    descriptionEn: 'Compose, schedule, and draft page',
    descriptionRu: 'Создание, планирование и черновики',
  },
  {
    id: 'activity',
    path: '/testbenches/activity/',
    titleEn: 'Activity',
    titleRu: 'Активность',
    descriptionEn: 'Standalone activity chart and history states',
    descriptionRu: 'График активности и состояния истории',
  },
  {
    id: 'settings',
    path: '/testbenches/settings/',
    titleEn: 'Settings',
    titleRu: 'Настройки',
    descriptionEn: 'Application preferences and Telegram account settings',
    descriptionRu: 'Настройки приложения и аккаунта Telegram',
  },
];

function getRoute(pathname: string): TestbenchRoute {
  return pages.find(({ path }) => pathname.endsWith(path))?.id ?? 'all';
}

function TestbenchHub() {
  const { locale } = useLocale();
  const isRussian = locale === 'ru';

  return (
    <main className="testbench-hub">
      <nav className="testbench-hub-navigation" aria-label={isRussian ? 'Навигация по стендам' : 'Testbench navigation'}>
        <TestbenchPageSelector locale={locale} currentPage="all" />
      </nav>
      <header>
        <p>XMSGi STUDIO / TESTBENCHES</p>
        <h1>{isRussian ? 'Выберите стенд' : 'Choose a page to preview'}</h1>
      </header>
      <nav className="testbench-hub-pages" aria-label={isRussian ? 'Доступные стенды' : 'Available testbenches'}>
        {pages.map((page, index) => (
          <a
            href={page.path}
            key={page.id}
            onClick={(event) => {
              event.preventDefault();
              navigateTestbenchPage(page.path);
            }}
          >
            <span>{String(index + 1).padStart(2, '0')}</span>
            <strong>{isRussian ? page.titleRu : page.titleEn}</strong>
            <small>{isRussian ? page.descriptionRu : page.descriptionEn}</small>
          </a>
        ))}
      </nav>
    </main>
  );
}

function ActiveTestbench({ route }: { route: TestbenchRoute }) {
  switch (route) {
    case 'login':
      return <LoginTestbench />;
    case 'studio':
      return (
        <ConfirmDialogProvider>
          <StudioEditorTestbench />
        </ConfirmDialogProvider>
      );
    case 'planner':
      return <PlannerTestbench />;
    case 'activity':
      return <ActivityTestbench />;
    case 'settings':
      return <SettingsTestbench />;
    default:
      return <TestbenchHub />;
  }
}

function TestbenchApp() {
  const [route, setRoute] = useState<TestbenchRoute>(() => getRoute(window.location.pathname));

  useEffect(() => {
    const syncRoute = () => setRoute(getRoute(window.location.pathname));
    window.addEventListener('popstate', syncRoute);
    return () => window.removeEventListener('popstate', syncRoute);
  }, []);

  useEffect(() => {
    const activePage = pages.find(({ id }) => id === route);
    document.title = activePage
      ? `XMSGi ${activePage.titleEn} Testbench`
      : 'XMSGi Testbenches';
  }, [route]);

  return <ActiveTestbench route={route} />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LocaleProvider>
      <TestbenchApp />
    </LocaleProvider>
  </StrictMode>,
);
