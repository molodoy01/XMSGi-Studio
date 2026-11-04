import { LayoutGrid, List, Moon, RotateCcw, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ColorTheme } from '@/lib/colorTheme';
import { TestbenchPageSelector } from '../shared/TestbenchNavigation';
import { applyTestbenchColorTheme, readTestbenchColorTheme } from '../shared/testbenchTheme';
import { useLocale } from '@/lib/i18n';
import { LoginPage } from '../../src/pages/LoginPage';
import './LoginTestbench.css';
import './LoginTestbenchGallery.css';

type Scenario = 'initial' | 'phone-error' | 'long-error' | 'renderer-error' | 'code' | 'code-error' | 'password' | 'password-error' | 'saved-account' | 'loading' | 'opening-studio' | 'offline';

const scenarios: { value: Scenario; label: string }[] = [
  { value: 'initial', label: 'Initial sign-in' },
  { value: 'phone-error', label: 'Phone validation error' },
  { value: 'long-error', label: 'Long server error' },
  { value: 'renderer-error', label: 'Untrusted renderer' },
  { value: 'code', label: 'Code entry' },
  { value: 'code-error', label: 'Code error' },
  { value: 'password', label: 'Two-step verification' },
  { value: 'password-error', label: 'Password error' },
  { value: 'saved-account', label: 'Saved account' },
  { value: 'loading', label: 'Connecting' },
  { value: 'opening-studio', label: 'Opening Studio' },
  { value: 'offline', label: 'No internet' },
];

const longServerError = 'Telegram could not complete sign-in because the authorization server returned an unexpected response. Check your connection, make sure the phone number and account details are correct, then try again. If this continues, wait a few minutes before requesting another code or contact support with the time of the failed attempt.';

function getScenarioError(scenario: Scenario, t: ReturnType<typeof useLocale>['t']) {
  if (scenario === 'phone-error') return t('auth.invalidPhone');
  if (scenario === 'long-error') return longServerError;
  if (scenario === 'renderer-error') return "Error invoking remote method 'telegram-auth-state': Error: Untrusted renderer.";
  if (scenario === 'code-error') return t('auth.expiredCode');
  if (scenario === 'password-error') return t('auth.invalidPassword');
  return '';
}

function ScenarioPreview({
  scenario,
  label,
  t,
}: {
  scenario: Scenario;
  label: string;
  t: ReturnType<typeof useLocale>['t'];
}) {
  const error = getScenarioError(scenario, t);
  const isOffline = scenario === 'offline';
  const isConnecting = scenario === 'loading';
  const isOpeningStudio = scenario === 'opening-studio';
  const authStep = scenario === 'code' || scenario === 'code-error'
    ? 'code'
    : scenario === 'password' || scenario === 'password-error'
      ? 'password'
      : 'phone';

  return (
    <article className={`login-testbench-preview is-${scenario}`} aria-label={label}>
      <header className="login-testbench-preview-heading">
        <span className="login-testbench-preview-index">{String(scenarios.findIndex((item) => item.value === scenario) + 1).padStart(2, '0')}</span>
        <div>
          <h2>{label}</h2>
          <span>{isOffline ? 'NETWORK' : isConnecting ? 'CONNECTING' : isOpeningStudio ? 'OPENING STUDIO' : scenario === 'saved-account' ? 'RETURNING ACCOUNT' : scenario === 'initial' ? 'READY' : authStep.toUpperCase()}</span>
        </div>
      </header>

      {scenario === 'initial' && (
        <div className="login-testbench-preview-method">
          <span>{t('auth.continue')}</span>
          <span aria-hidden="true">→</span>
          <strong>{t('auth.telegram')}</strong>
        </div>
      )}

      {scenario === 'saved-account' && (
        <div className="login-testbench-preview-saved">
          <span>{t('auth.welcomeBack')}</span>
          <strong>Alex Example</strong>
        </div>
      )}

      {(isConnecting || isOpeningStudio) && (
        <p className="login-testbench-preview-connection" role="status">
          {t(isOpeningStudio ? 'auth.openingStudio' : 'auth.checkingConnection')}
        </p>
      )}

      {(isOffline || error) && (
        <div className="login-error-slot">
          <p className={`login-error${isOffline ? ' is-warning' : ''}`} role={isOffline ? 'status' : 'alert'}>
            {!isOffline && <span className="login-error-mark" aria-hidden="true">!</span>}
            <span>{isOffline ? t('auth.noInternet') : error}</span>
          </p>
        </div>
      )}

      {scenario !== 'initial' && scenario !== 'saved-account' && !isConnecting && !isOpeningStudio && !isOffline && (
        <div className="login-testbench-preview-fields">
          {authStep === 'phone' ? (
            <div className="login-testbench-preview-field">
              <span>{t('auth.phone')}</span>
              <strong>{scenario === 'phone-error' ? '+123' : t('auth.phonePlaceholder')}</strong>
            </div>
          ) : (
            <div className="login-testbench-preview-field">
              <span>{t('auth.loginCode')}</span>
              <strong>12345</strong>
            </div>
          )}
          {authStep === 'password' && (
            <div className="login-testbench-preview-field">
              <span>{t('auth.twoFactorPassword')}</span>
              <strong>••••••••</strong>
            </div>
          )}
          <div className="login-testbench-preview-submit">
            {authStep === 'phone' ? t('auth.signIn') : authStep === 'password' ? t('auth.verifyConnect') : t('auth.verifyCode')}
          </div>
        </div>
      )}
    </article>
  );
}

export function LoginTestbench() {
  const { locale, t } = useLocale();
  const [view, setView] = useState<'all' | 'single'>('single');
  const [scenario, setScenario] = useState<Scenario>('initial');
  const [theme, setTheme] = useState<ColorTheme>(readTestbenchColorTheme);
  const [showAuthForm, setShowAuthForm] = useState(false);
  const [authStep, setAuthStep] = useState<'phone' | 'code' | 'password'>('phone');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [phoneCode, setPhoneCode] = useState('');
  const [twoFactorPassword, setTwoFactorPassword] = useState('');
  const [authError, setAuthError] = useState('');

  useEffect(() => {
    window.dispatchEvent(new Event('online'));
  }, []);

  useEffect(() => {
    const localizedError = getScenarioError(scenario, t);
    if (localizedError) setAuthError(localizedError);
  }, [scenario, t]);

  const selectScenario = (nextScenario: Scenario) => {
    setScenario(nextScenario);
    const shouldKeepFormClosed = nextScenario === 'initial' || nextScenario === 'saved-account' || nextScenario === 'loading' || nextScenario === 'opening-studio' || nextScenario === 'offline';
    setShowAuthForm(!shouldKeepFormClosed);
    setAuthStep(nextScenario === 'code' || nextScenario === 'code-error'
      ? 'code'
      : nextScenario === 'password' || nextScenario === 'password-error'
        ? 'password'
        : 'phone');
    setPhoneNumber(nextScenario === 'phone-error' ? '123' : '');
    setPhoneCode(nextScenario === 'code' || nextScenario === 'code-error' ? '12345' : '');
    setTwoFactorPassword(nextScenario === 'password' || nextScenario === 'password-error' ? 'sample-password' : '');
    setAuthError(getScenarioError(nextScenario, t));
    window.dispatchEvent(new Event(nextScenario === 'offline' ? 'offline' : 'online'));
  };

  const resetToInitial = () => selectScenario('initial');
  const changeTheme = (nextTheme: ColorTheme) => {
    setTheme(nextTheme);
    applyTestbenchColorTheme(nextTheme, { animate: true });
  };

  return (
    <>
      <nav className="login-testbench" aria-label="Login testbench controls">
        <label className="login-testbench-scenario">
          <span>Preview state</span>
          <select value={scenario} onChange={(event) => selectScenario(event.target.value as Scenario)}>
            {scenarios.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <div className="login-testbench-view" role="group" aria-label="Preview layout">
          <button type="button" aria-label="All scenarios" aria-pressed={view === 'all'} onClick={() => setView('all')}>
            <LayoutGrid size={16} aria-hidden="true" />
          </button>
          <button type="button" aria-label="Single scenario" aria-pressed={view === 'single'} onClick={() => setView('single')}>
            <List size={16} aria-hidden="true" />
          </button>
        </div>
        <div className="login-testbench-themes" role="group" aria-label="Preview theme">
          <button type="button" aria-label="Light theme" aria-pressed={theme === 'light'} onClick={() => changeTheme('light')}>
            <Sun size={16} aria-hidden="true" />
          </button>
          <button type="button" aria-label="Dark theme" aria-pressed={theme === 'dark'} onClick={() => changeTheme('dark')}>
            <Moon size={16} aria-hidden="true" />
          </button>
        </div>
        <button type="button" className="login-testbench-reset" onClick={resetToInitial}>
          <RotateCcw size={15} aria-hidden="true" />
          <span>Reset sign-in</span>
        </button>
        <TestbenchPageSelector locale={locale} currentPage="login" />
        <a className="login-testbench-exit" href="/">Exit</a>
      </nav>
      {view === 'all' ? (
        <main className="login-testbench-overview">
          <header className="login-testbench-overview-heading">
            <span>LOGIN TESTBENCH / {String(scenarios.length).padStart(2, '0')} STATES</span>
            <h1>All sign-in scenarios</h1>
          </header>
          <div className="login-testbench-grid">
            {scenarios.map((item) => (
              <ScenarioPreview key={item.value} scenario={item.value} label={item.label} t={t} />
            ))}
          </div>
        </main>
      ) : <LoginPage
        connecting={scenario === 'loading' || scenario === 'opening-studio'}
        openingStudio={scenario === 'opening-studio'}
        signedOut={scenario === 'saved-account' || scenario === 'opening-studio'}
        returningUserName="Alex Example"
        returningUserUsername="alex"
        authStep={authStep}
        showAuthForm={showAuthForm}
        phoneNumber={phoneNumber}
        phoneCode={phoneCode}
        twoFactorPassword={twoFactorPassword}
        authBusy={scenario === 'loading' || scenario === 'opening-studio'}
        authError={authError}
        setShowAuthForm={setShowAuthForm}
        setAuthStep={setAuthStep}
        setPhoneNumber={setPhoneNumber}
        setPhoneCode={setPhoneCode}
        setTwoFactorPassword={setTwoFactorPassword}
        setAuthError={setAuthError}
        handleTelegramAuth={async () => {
          if (authStep === 'phone') {
            setAuthStep('code');
            setScenario('code');
          } else if (authStep === 'code') {
            setAuthStep('password');
            setScenario('password');
          } else {
            resetToInitial();
          }
        }}
        handleWelcomeBack={async () => resetToInitial()}
      />}
    </>
  );
}
