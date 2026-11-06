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
  handleForgetAccount: () => Promise<void>;
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
  handleForgetAccount,
}: LoginPageProps) {
  const { locale, t } = useLocale();
  const [colorTheme, setColorTheme] = useState(readColorTheme);
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [fontsReadyLocale, setFontsReadyLocale] = useState<string | null>(null);
  const returningUserLabel = returningUserName || (returningUserUsername ? `@${returningUserUsername}` : t('auth.returningUser'));
  const returningUserActionLabel = t('auth.returnToApp', { name: returningUserLabel });
  const loginFontsReady = fontsReadyLocale === locale;
  const loginLayoutRef = useRef<HTMLElement>(null);
  const loginFormRef = useRef<HTMLFormElement>(null);
  const loginDividerRef = useRef<HTMLElement | null>(null);
  const setLoginDividerRef = (element: HTMLDivElement | HTMLButtonElement | null) => {
    loginDividerRef.current = element;
  };
  const hasAuthInput = authStep === 'phone'
    ? Boolean(phoneNumber.trim())
    : authStep === 'code'
      ? Boolean(phoneCode.trim())
      : Boolean(twoFactorPassword.trim());
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

  useEffect(() => {
    if (loginFontsReady) return undefined;

    const fontSet = document.fonts;
    if (!fontSet || typeof fontSet.load !== 'function') {
      setFontsReadyLocale(locale);
      return undefined;
    }

    let active = true;
    const fontLoads = [
      fontSet.load('700 76px "Orbitron"', `${t('auth.loginHeroMain')} ${t('auth.welcomeBack')}`),
      fontSet.load('800 40px "Orbitron"', t('auth.loginHeroSub')),
      fontSet.load('700 23px "Orbitron"', `${t('auth.loginHeroTagline')} ${t('auth.continue')} ${t('auth.telegram')}`),
      fontSet.load('700 18px "Exo 2"', `${t('auth.loginHeroTagline')} ${t('auth.loginHeroTaglineSub')}`),
      fontSet.load('700 14px "Exo 2"', t('auth.loginHeroTaglineSub')),
      fontSet.load('600 14px "Exo 2"', `${returningUserActionLabel} ${t('auth.openingStudio')}`),
    ];

    void Promise.allSettled(fontLoads).then((results) => {
      if (!active) return;
      for (const result of results) {
        if (result.status === 'rejected') {
          console.error('Unable to load a login hero font before display.', result.reason);
        }
      }
      setFontsReadyLocale(locale);
    });

    return () => {
      active = false;
    };
  }, [locale, loginFontsReady, returningUserActionLabel, t]);

  useLayoutEffect(() => {
    const layout = loginLayoutRef.current;
    const form = loginFormRef.current;
    const brand = layout?.querySelector<HTMLElement>('.login-brand');
    const divider = loginDividerRef.current;
    if (!layout || !form) return;

    if (showAuthForm) {
      form.style.setProperty('--login-form-open-height', `${form.scrollHeight}px`);
    } else {
      form.style.removeProperty('--login-form-open-height');
    }

    const syncDivider = () => {
      if (!divider || !brand || window.innerWidth < 461) return;
      const heading = brand.querySelector<HTMLElement>('.login-wordmark');
      const tagline = brand.querySelector<HTMLElement>('.login-tagline');
      if (!heading) return;
      const headingRect = heading.getBoundingClientRect();
      const taglineRect = tagline?.getBoundingClientRect();
      const dividerRect = divider.getBoundingClientRect();
      const heroTop = headingRect.top;
      const heroBottom = taglineRect?.bottom ?? headingRect.bottom;
      divider.style.setProperty('--login-divider-line-top', `${heroTop - dividerRect.top}px`);
      divider.style.setProperty('--login-divider-line-height', `${heroBottom - heroTop}px`);
    };
    syncDivider();
    const resizeObserver = new ResizeObserver(syncDivider);
    resizeObserver.observe(layout);
    if (brand) resizeObserver.observe(brand);
    window.addEventListener('resize', syncDivider);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', syncDivider);
    };
  }, [authBusy, authStep, locale, loginFontsReady, showAuthForm, signedOut, visibleAuthMessage]);

  return (
    <>
      {connecting && isOnline && !(openingStudio && signedOut) && (
        <div className="connection-spinner show" role="status" aria-live="polite">
          <div className="connection-status-card">
            <div className="connection-spinner-ring" aria-hidden="true" />
            <span>{t(openingStudio ? 'auth.openingStudio' : 'auth.checkingConnection')}</span>
          </div>
        </div>
      )}

      <div className="app">
        <section className={`auth-panel auth-screen${showAuthForm ? ' is-auth-open' : ''}${signedOut ? ' is-returning' : ''}${loginFontsReady ? ' is-login-fonts-ready' : ''}`} lang={locale}>
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
                <span className="login-wordmark-bottom">{t('auth.loginHeroSub')}</span>
              </h1>
              <p className="login-tagline">
                <span>{t('auth.loginHeroTagline')}</span>
                <span>{t('auth.loginHeroTaglineSub')}</span>
              </p>
            </section>

            {signedOut ? (
              <div ref={setLoginDividerRef} className="login-divider" aria-hidden="true" />
            ) : (
              <button
                ref={setLoginDividerRef}
                className="login-divider"
                type="button"
                aria-label={showAuthForm ? t('common.close') : t('auth.signIn')}
                aria-expanded={showAuthForm}
                aria-controls="telegram-login-form"
                data-tooltip={showAuthForm ? undefined : t('auth.signIn')}
                onClick={() => {
                  setShowAuthForm((current) => !current);
                }}
              >
                {!showAuthForm && (
                  <span className="login-button-tooltip" aria-hidden="true">
                    {t('auth.signIn')}
                  </span>
                )}
              </button>
            )}

            <section className="login-panel" aria-label={t('hero.signInIntro')}>
              <div className={`login-method ${signedOut ? 'is-returning' : ''}`}>
                {signedOut ? (
                  <div className="login-returning-user">
                    <span className="login-returning-greeting">{t('auth.welcomeBack')}</span>
                    <button
                      type="button"
                      className="login-returning-account"
                      onClick={handleWelcomeBack}
                      disabled={authBusy}
                      aria-label={openingStudio ? t('auth.openingStudio') : returningUserActionLabel}
                      aria-busy={openingStudio}
                      aria-live="polite"
                      data-tooltip={openingStudio ? t('auth.openingStudio') : returningUserActionLabel}
                    >
                      <span>{openingStudio ? t('auth.openingStudio') : returningUserActionLabel}</span>
                      {openingStudio
                        ? <span className="login-returning-spinner" aria-hidden="true" />
                        : <ArrowUpRight size={18} aria-hidden="true" />}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="login-method-action"
                    aria-label={t('auth.continueTelegram')}
                    aria-expanded={showAuthForm}
                    aria-controls="telegram-login-form"
                    onClick={() => {
                      setShowAuthForm((current) => !current);
                    }}
                  >
                    <span className="login-method-label">
                      {t('auth.continue')}
                    </span>
                    <ArrowRight className="login-arrow" size={25} aria-hidden="true" />
                    <span className="login-method-label">
                      {t('auth.telegram')}
                    </span>
                  </button>
                )}
              </div>

              <div className={`login-error-slot${visibleAuthMessage ? ' has-message' : ''}`} aria-live="polite">
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
                  onClick={() => { void handleForgetAccount(); }}
                  disabled={authBusy}
                >
                  {t('auth.signOutStartOver')}
                </button>
              )}

              <form
                id="telegram-login-form"
                ref={loginFormRef}
                className={`login-form ${showAuthForm ? 'is-visible' : ''}`}
                aria-hidden={!showAuthForm}
                onSubmit={(event) => {
                  event.preventDefault();
                  if (authBusy || !hasAuthInput) return;
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
                  disabled={authBusy || !hasAuthInput}
                >
                  {authBusy
                    ? t('auth.connecting')
                    : authStep === 'phone'
                      ? t('auth.signIn')
                      : authStep === 'password'
                        ? t('auth.verifyConnect')
                        : t('auth.verifyCode')}
                </button>

                <div className={`login-back-slot${authStep !== 'phone' ? ' is-visible' : ''}`}>
                  <button
                    type="button"
                    className="login-back-button"
                    onClick={() => {
                      if (authBusy || authStep === 'phone') return;
                      setAuthStep('phone');
                      setPhoneNumber('');
                      setPhoneCode('');
                      setTwoFactorPassword('');
                      setAuthError('');
                    }}
                    aria-disabled={authBusy || authStep === 'phone'}
                    aria-hidden={authStep === 'phone'}
                    tabIndex={authStep === 'phone' ? -1 : 0}
                  >
                    {t('auth.startOver')}
                  </button>
                </div>
              </form>
            </section>
          </main>
        </section>
      </div>
    </>
  );
}