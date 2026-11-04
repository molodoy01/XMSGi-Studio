import { Moon, RotateCcw, Sun } from 'lucide-react';
import type { Locale } from '@shared/i18n';
import type { ColorTheme } from '@/lib/colorTheme';
import './TestbenchNavigation.css';

export type TestbenchScenarioOption = {
  value: string;
  label: string;
};

export type TestbenchPageId = 'login' | 'studio' | 'planner' | 'activity' | 'settings';

const testbenchPages = [
  { id: 'login', path: '/testbenches/login/', labelEn: 'Login', labelRu: 'Вход' },
  { id: 'studio', path: '/testbenches/studio-editor/', labelEn: 'Studio', labelRu: 'Studio' },
  { id: 'planner', path: '/testbenches/planner/', labelEn: 'Planner', labelRu: 'Planner' },
  { id: 'activity', path: '/testbenches/activity/', labelEn: 'Activity', labelRu: 'Activity' },
  { id: 'settings', path: '/testbenches/settings/', labelEn: 'Settings', labelRu: 'Настройки' },
  { id: 'all', path: '/testbenches/', labelEn: 'All pages', labelRu: 'Все стенды' },
] as const;

export function TestbenchPageSelector({
  locale,
  currentPage,
}: {
  locale: Locale;
  currentPage: TestbenchPageId | 'all';
}) {
  const isRussian = locale === 'ru';
  const selectedPage = testbenchPages.find(({ id }) => id === currentPage);

  return (
    <label className="testbench-navigation-pages">
      <span>{isRussian ? 'Раздел' : 'Page'}</span>
      <select
        aria-label={isRussian ? 'Разделы стенда' : 'Testbench pages'}
        value={selectedPage?.path ?? testbenchPages[testbenchPages.length - 1].path}
        onChange={(event) => navigateTestbenchPage(event.currentTarget.value)}
      >
        {testbenchPages.map(({ id, path, labelEn, labelRu }) => (
          <option key={id} value={path}>{isRussian ? labelRu : labelEn}</option>
        ))}
      </select>
    </label>
  );
}

export function navigateTestbenchPage(path: string) {
  const targetUrl = new URL(path, window.location.href);
  window.history.pushState({}, '', targetUrl);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

type TestbenchNavigationProps = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  theme: ColorTheme;
  onThemeChange: (theme: ColorTheme) => void;
  scenarioLabel: string;
  scenario: string;
  scenarioOptions: TestbenchScenarioOption[];
  onScenarioChange: (scenario: string) => void;
  confirmationLabel?: string;
  confirmationScenario?: string;
  confirmationOptions?: TestbenchScenarioOption[];
  onConfirmationScenarioChange?: (scenario: string) => void;
  onReset: () => void;
  resetLabel: string;
  currentPage: 'studio' | 'planner' | 'activity';
  connectionSpinnerVisible?: boolean;
  onConnectionSpinnerToggle?: () => void;
};

export function TestbenchNavigation({
  locale,
  setLocale,
  theme,
  onThemeChange,
  scenarioLabel,
  scenario,
  scenarioOptions,
  onScenarioChange,
  confirmationLabel,
  confirmationScenario,
  confirmationOptions,
  onConfirmationScenarioChange,
  onReset,
  resetLabel,
  currentPage,
  connectionSpinnerVisible,
  onConnectionSpinnerToggle,
}: TestbenchNavigationProps) {
  const isRussian = locale === 'ru';

  return (
    <nav className="testbench-navigation" aria-label={isRussian ? 'Настройки стенда' : 'Stand controls'}>
      <label className="testbench-navigation-scenario">
        <span>{scenarioLabel}</span>
        <select
          aria-label={scenarioLabel}
          value={scenario}
          onChange={(event) => onScenarioChange(event.target.value)}
        >
          {scenarioOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>
      {confirmationLabel && confirmationScenario !== undefined && confirmationOptions && onConfirmationScenarioChange && (
        <label className="testbench-navigation-scenario">
          <span>{confirmationLabel}</span>
          <select
            aria-label={confirmationLabel}
            value={confirmationScenario}
            onChange={(event) => onConfirmationScenarioChange(event.target.value)}
          >
            {confirmationOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
      )}
      <div className="testbench-navigation-themes" role="group" aria-label={isRussian ? 'Тема стенда' : 'Stand theme'}>
        <button
          type="button"
          aria-label={isRussian ? 'Светлая тема' : 'Light theme'}
          aria-pressed={theme === 'light'}
          onClick={() => onThemeChange('light')}
        >
          <Sun size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label={isRussian ? 'Тёмная тема' : 'Dark theme'}
          aria-pressed={theme === 'dark'}
          onClick={() => onThemeChange('dark')}
        >
          <Moon size={16} aria-hidden="true" />
        </button>
      </div>
      <div className="testbench-navigation-languages" role="group" aria-label={isRussian ? 'Язык' : 'Language'}>
        <button type="button" aria-pressed={locale === 'en'} onClick={() => setLocale('en')}>EN</button>
        <button type="button" aria-pressed={locale === 'ru'} onClick={() => setLocale('ru')}>RU</button>
      </div>
      <button
        type="button"
        className="testbench-navigation-reset"
        onClick={onReset}
        aria-label={resetLabel}
        title={resetLabel}
      >
        <RotateCcw size={15} aria-hidden="true" />
        <span>{resetLabel}</span>
      </button>
      {onConnectionSpinnerToggle && (
        <button
          type="button"
          className="testbench-navigation-connection"
          aria-pressed={connectionSpinnerVisible}
          onClick={onConnectionSpinnerToggle}
        >
          {isRussian
            ? (connectionSpinnerVisible ? 'Скрыть подключение' : 'Проверить связь')
            : (connectionSpinnerVisible ? 'Hide connection' : 'Check connection')}
        </button>
      )}
      <TestbenchPageSelector locale={locale} currentPage={currentPage} />
    </nav>
  );
}
