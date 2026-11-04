import { ArrowRight, ArrowUpRight, Moon, Sun } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { applyColorTheme, readColorTheme, type ColorTheme } from '@/lib/colorTheme';
import { useLocale } from '@/lib/i18n';
import './LoginPage.css';

type AuthStep = 'phone' | 'code' | 'password';

type LoginPageProps = {
  connecting: boolean;
  openingStudio?: boolean;
  signedOut: boolean;
  returningUserName: string;
  returningUserUsername: string;
  authStep: AuthStep;
  showAuthForm: boolean;
  phoneNumber: string;
  phoneCode: string;
  twoFactorPassword: string;
  authBusy: boolean;
  authError: string;
  authNotice: boolean;
  setShowAuthForm: React.Dispatch<React.SetStateAction<boolean>>;
  setAuthStep: React.Dispatch<React.SetStateAction<AuthStep>>;
  setPhoneNumber: React.Dispatch<React.SetStateAction<string>>;
  setPhoneCode: React.Dispatch<React.SetStateAction<string>>;
  setTwoFactorPassword: React.Dispatch<React.SetStateAction<string>>;
  setAuthError: React.Dispatch<React.SetStateAction<string>>;
  handleTelegramAuth: () => Promise<void>;
  handleWelcomeBack: () => Promise<void>;
};

export function LoginPage({
  connecting,
  openingStudio = false,
  signedOut,
  returningUserName,
  returningUserUsername,
  authStep,
  showAuthForm,
  phoneNumber,
  phoneCode,
  twoFactorPassword,
  authBusy,
  authError,
  authNotice,
  setShowAuthForm,
  setAuthStep,
  setPhoneNumber,
  setPhoneCode,
  setTwoFactorPassword,
  setAuthError,
  handleTelegramAuth,
  handleWelcomeBack,
}: LoginPageProps) {
  const { locale, t } = useLocale();
  const [colorTheme, setColorTheme] = useState(readColorTheme);
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const returningUserLabel = returningUserName || (returningUserUsername ? `@${returningUserUsername}` : t('auth.returningUser'));
  const returningUserActionLabel = t('auth.returnToApp', { name: returningUserLabel });
  const loginLayoutRef = useRef<HTMLElement>(null);
  const loginFormRef = useRef<HTMLFormElement>(null);
  const loginStudioRef = useRef<HTMLSpanElement>(null);
  const loginPanelRef = useRef<HTMLElement>(null);
  const loginErrorSlotRef = useRef<HTMLDivElement>(null);
  const loginPhoneRef = useRef<HTMLInputElement>(null);
  const loginCodeRef = useRef<HTMLInputElement>(null);
  const loginPasswordRef = useRef<HTMLInputElement>(null);
  const isConnectionWarning = !authError && !isOnline;
  const visibleAuthMessage = authError || (isConnectionWarning ? t('auth.noInternet') : '');

  useEffect(() => {
    const updateOnlineState = (event: Event) => setIsOnline(event.type !== 'offline');
    window.addEventListener('online', updateOnlineState);
    window.addEventListener('offline', updateOnlineState);
    return () => {
      window.removeEventListener('online', updateOnlineState);
      window.removeEventListener('offline', updateOnlineState);
    };
  }, []);

  useLayoutEffect(() => {
    const layout = loginLayoutRef.current;
    const form = loginFormRef.current;
    const studio = loginStudioRef.current;
    const brand = layout?.querySelector<HTMLElement>('.login-brand');
    const divider = layout?.querySelector<HTMLElement>('.login-divider');
    const panel = loginPanelRef.current;
    const errorSlot = loginErrorSlotRef.current;
    const phoneInput = loginPhoneRef.current;
    const codeInput = loginCodeRef.current;
    const passwordInput = loginPasswordRef.current;
    if (!layout || !form || !studio || !panel) return;

    if (showAuthForm) {
      form.style.setProperty('--login-form-open-height', `${form.scrollHeight}px`);
    } else {
      form.style.removeProperty('--login-form-open-height');
    }

    const syncPanelTop = () => {
      const layoutTop = layout.getBoundingClientRect().top;
      const appliedTop = Number.parseFloat(getComputedStyle(panel).top) || 0;
      const studioRect = studio.getBoundingClientRect();

      if (divider && brand && window.innerWidth >= 461) {
        const heading = brand.querySelector<HTMLElement>('.login-wordmark');
        const tagline = brand.querySelector<HTMLElement>('.login-tagline');
        if (heading) {
          const headingRect = heading.getBoundingClientRect();
          const taglineRect = tagline?.getBoundingClientRect();
          const dividerRect = divider.getBoundingClientRect();
          const heroTop = headingRect.top;
          const heroBottom = taglineRect?.bottom ?? headingRect.bottom;
          divider.style.setProperty('--login-divider-line-top', `${heroTop - dividerRect.top}px`);
          divider.style.setProperty('--login-divider-line-height', `${heroBottom - heroTop}px`);
        }
      }

      if (showAuthForm && visibleAuthMessage && errorSlot && window.innerWidth >= 461) {
        const errorMessage = errorSlot.querySelector<HTMLElement>('.login-error');
        if (!errorMessage) return;
        const messageRect = errorMessage.getBoundingClientRect();
        const messageHeight = messageRect.height;
        const errorAnchorOffset = messageHeight <= 100 ? 40 : -20;
        const errorAnchorTop = layoutTop + errorAnchorOffset;
        panel.style.setProperty('--login-panel-offset', `${appliedTop + errorAnchorTop - messageRect.top}px`);
        return;
      }

      const firstAuthInput = authStep === 'phone'
        ? phoneInput
        : authStep === 'code'
          ? codeInput
          : passwordInput;
      if (showAuthForm && firstAuthInput && window.innerWidth >= 461) {
        const inputRect = firstAuthInput.getBoundingClientRect();
        const studioCenter = studioRect.top + studioRect.height / 2;
        const inputCenter = inputRect.top + inputRect.height / 2;
        panel.style.setProperty('--login-panel-offset', `${appliedTop + studioCenter - inputCenter}px`);
        return;
      }

      const panelFlowTop = panel.offsetTop - appliedTop;
      panel.style.setProperty('--login-panel-offset', `${studioRect.top - layoutTop - panelFlowTop}px`);
    };
    syncPanelTop();
    const resizeObserver = new ResizeObserver(syncPanelTop);
    resizeObserver.observe(studio);
    if (brand) {
      resizeObserver.observe(brand);
    }
    if (visibleAuthMessage && errorSlot) {
      resizeObserver.observe(errorSlot);
    }
    if (showAuthForm && authStep === 'phone') {
      resizeObserver.observe(panel);
    }
    window.addEventListener('resize', syncPanelTop);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', syncPanelTop);
    };
  }, [authError, authStep, locale, showAuthForm, visibleAuthMessage]);

  return (
    <>
      {connecting && isOnline && (
        <div className="connection-spinner show" role="status" aria-live="polite">
          <div className="connection-status-card">
            <div className="connection-spinner-ring" aria-hidden="true" />
            <span>{t(openingStudio ? 'auth.openingStudio' : 'auth.checkingConnection')}</span>
          </div>
        </div>
      )}

      <div className="app">
        <section className={`auth-panel auth-screen ${showAuthForm ? 'is-auth-open' : ''}`} lang={locale}>
          <div className="auth-top-controls">
            <button
              type="button"
              className="auth-theme-button"
              aria-label={t(colorTheme === 'light' ? 'auth.switchToDarkTheme' : 'auth.switchToLightTheme')}
              title={t(colorTheme === 'light' ? 'auth.switchToDarkTheme' : 'auth.switchToLightTheme')}
              onClick={() => {
                const nextTheme: ColorTheme = colorTheme === 'light' ? 'dark' : 'light';
                applyColorTheme(nextTheme, { animate: true });
                setColorTheme(nextTheme);
              }}
            >
              {colorTheme === 'light'
                ? <Moon size={19} strokeWidth={1.8} aria-hidden="true" />
                : <Sun size={19} strokeWidth={1.8} aria-hidden="true" />}
            </button>
          </div>
          <main className="login-layout" ref={loginLayoutRef}>
            <section className="login-brand" aria-label="MSGi Studio">
              <h1 className="login-wordmark">
                <span className="login-wordmark-top">
                  <span className="login-mark" aria-hidden="true" />
                  <span>{t('auth.loginHeroMain')}</span>
                </span>
                <span className="login-wordmark-bottom" ref={loginStudioRef}>{t('auth.loginHeroSub')}</span>
              </h1>
              <p className="login-tagline">
                <span>{t('auth.loginHeroTagline')}</span>
                <span>{t('auth.loginHeroTaglineSub')}</span>
              </p>
            </section>

            {signedOut ? (
              <div className="login-divider" aria-hidden="true" />
            ) : (
              <button
                className="login-divider"
                type="button"
                aria-label={showAuthForm ? t('auth.startOver') : t('auth.signIn')}
                aria-expanded={showAuthForm}
                aria-controls="telegram-login-form"
                data-tooltip={showAuthForm ? t('auth.startOver') : t('auth.signIn')}
                onClick={() => {
                  setShowAuthForm((current) => !current);
                  setAuthStep('phone');
                  setPhoneNumber('');
                  setPhoneCode('');
                  setTwoFactorPassword('');
                  setAuthError('');
                }}
              >
                <span className="login-button-tooltip" aria-hidden="true">
                  {showAuthForm ? t('auth.startOver') : t('auth.signIn')}
                </span>
              </button>
            )}

            <section className="login-panel" ref={loginPanelRef} aria-label={t('hero.signInIntro')}>
              <div className={`login-method ${signedOut ? 'is-returning' : ''}`}>
                {signedOut ? (
                  <div className="login-returning-user">
                    <span className="login-returning-greeting">{t('auth.welcomeBack')}</span>
                    <button
                      type="button"
                      className="login-returning-account"
                      onClick={handleWelcomeBack}
                      disabled={authBusy}
                      aria-label={returningUserActionLabel}
                      data-tooltip={returningUserActionLabel}
                    >
                      <span>{returningUserActionLabel}</span>
                      <ArrowUpRight size={18} aria-hidden="true" />
                    </button>
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      className="login-method-action"
                      aria-label={t('auth.continueTelegram')}
                      aria-expanded={showAuthForm}
                      aria-controls="telegram-login-form"
                      onClick={() => {
                        setShowAuthForm((current) => !current);
                        setAuthStep('phone');
                        setAuthError('');
                      }}
                    >
                      {t('auth.continue')}
                    </button>
                    <ArrowRight className="login-arrow" size={25} aria-hidden="true" />
                    <button
                      type="button"
                      className="login-method-action"
                      aria-expanded={showAuthForm}
                      aria-controls="telegram-login-form"
                      onClick={() => {
                        setShowAuthForm((current) => !current);
                        setAuthError('');
                      }}
                    >
                      {t('auth.telegram')}
                    </button>
                  </>
                )}
              </div>

              <div ref={loginErrorSlotRef} className={`login-error-slot${visibleAuthMessage ? ' has-message' : ''}`} aria-live="polite">
                <div className="login-error-slot-content">
                  {visibleAuthMessage && (
                    <p className={`login-error${isConnectionWarning ? ' is-warning' : ''}${authNotice ? ' is-info' : ''}`} role={isConnectionWarning || authNotice ? 'status' : 'alert'}>
                      {!isConnectionWarning && <span className="login-error-mark" aria-hidden="true">{authNotice ? 'i' : '!'}</span>}
                      <span>{visibleAuthMessage}</span>
                    </p>
                  )}
                </div>
              </div>

              {signedOut && (
                <button
                  type="button"
                  className="login-returning-start-over"
                  aria-expanded={showAuthForm}
                  aria-controls="telegram-login-form"
                  onClick={() => {
                    setShowAuthForm(true);
                    setAuthStep('phone');
                    setPhoneNumber('');
                    setPhoneCode('');
                    setTwoFactorPassword('');
                    setAuthError('');
                  }}
                  disabled={authBusy}
                >
                  {t('auth.startOver')}
                </button>
              )}

              <form
                id="telegram-login-form"
                ref={loginFormRef}
                className={`login-form ${showAuthForm ? 'is-visible' : ''}`}
                aria-hidden={!showAuthForm}
                onSubmit={(event) => {
                  event.preventDefault();
                  if (authBusy || (authStep === 'phone' ? !phoneNumber.trim() : !phoneCode.trim())) return;
                  void handleTelegramAuth();
                }}
              >
                <div
                  key={authStep}
                  className={`login-field${authStep !== 'phone' ? ' login-field-step-transition' : ''}`}
                >
                  <label className="login-field-label" htmlFor={`login-${authStep}`}>
                    {authStep === 'phone'
                      ? t('auth.phone')
                      : authStep === 'code'
                        ? t('auth.loginCode')
                        : t('auth.twoFactorPassword')}
                  </label>
                  <input
                    className="login-field-input"
                    id={`login-${authStep}`}
                    ref={authStep === 'phone' ? loginPhoneRef : authStep === 'code' ? loginCodeRef : loginPasswordRef}
                    type={authStep === 'phone' ? 'tel' : authStep === 'password' ? 'password' : 'text'}
                    value={authStep === 'phone' ? phoneNumber : authStep === 'code' ? phoneCode : twoFactorPassword}
                    onChange={(event) => {
                      if (authStep === 'phone') {
                        const nextPhoneNumber = event.target.value;
                        const addInternationalPrefix = phoneNumber.length === 0 && /^\d/.test(nextPhoneNumber);
                        setPhoneNumber(addInternationalPrefix ? `+${nextPhoneNumber}` : nextPhoneNumber);
                      } else if (authStep === 'code') {
                        setPhoneCode(event.target.value);
                      } else {
                        setTwoFactorPassword(event.target.value);
                      }
                    }}
                    placeholder={authStep === 'phone'
                      ? t('auth.phonePlaceholder')
                      : authStep === 'code'
                        ? t('auth.loginCodePlaceholder')
                        : t('auth.twoFactorPasswordPlaceholder')}
                    inputMode={authStep === 'code' ? 'numeric' : undefined}
                    autoComplete={authStep === 'phone' ? 'tel' : authStep === 'code' ? 'one-time-code' : 'current-password'}
                  />
                </div>

                <button
                  className="login-submit"
                  type="submit"
                  disabled={authBusy || (authStep === 'phone' ? !phoneNumber.trim() : !phoneCode.trim())}
                >
                  {authBusy
                    ? t('auth.connecting')
                    : authStep === 'phone'
                      ? t('auth.signIn')
                      : authStep === 'password'
                        ? t('auth.verifyConnect')
                        : t('auth.verifyCode')}
                </button>

                {authStep !== 'phone' && (
                  <button
                    type="button"
                    className="login-back-button"
                    onClick={() => {
                      setAuthStep('phone');
                      setPhoneNumber('');
                      setPhoneCode('');
                      setTwoFactorPassword('');
                      setAuthError('');
                    }}
                    disabled={authBusy}
                  >
                    {t('auth.startOver')}
                  </button>
                )}
              </form>
            </section>
          </main>
        </section>
      </div>
    </>
  );
}