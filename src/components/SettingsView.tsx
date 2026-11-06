import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { ChevronRight, Moon, Send, Sun, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useLocale } from '@/lib/i18n';
import { applyColorTheme, readColorTheme, type ColorTheme } from '@/lib/colorTheme';
import type { TelegramStatusSnapshot } from '@/hooks/useTelegramAuth';
import { getTelegramStatusPresentation } from '@/workspace/AppShell';

type SettingsViewProps = {
  colorThemeStorageKey?: string;
  onClose: () => void;
  accountName: string;
  telegramUsername: string;
  telegramConnected: boolean;
  telegramConnecting: boolean;
  telegramAuthStep: 'phone' | 'code' | 'password';
  telegramPhoneNumber: string;
  telegramPhoneCode: string;
  telegramTwoFactorPassword: string;
  telegramAuthBusy: boolean;
  telegramAuthError: string;
  telegramAuthNotice: boolean;
  telegramStatus: TelegramStatusSnapshot;
  telegramCredentials: { hasCredentials: boolean; apiId?: string; hasSession: boolean; connected: boolean; signedOut: boolean };
  telegramApiId: string;
  telegramApiHash: string;
  telegramCredentialsBusy: boolean;
  telegramCredentialsError: string;
  onTelegramApiIdChange: (value: string) => void;
  onTelegramApiHashChange: (value: string) => void;
  onSaveTelegramCredentials: () => void;
  onTelegramPhoneNumberChange: (value: string) => void;
  onTelegramPhoneCodeChange: (value: string) => void;
  onTelegramTwoFactorPasswordChange: (value: string) => void;
  onTelegramAuth: () => void;
  onTelegramReconnect: () => void;
  onTelegramDisconnect: () => void;
};

export function SettingsView({
  colorThemeStorageKey,
  onClose,
  accountName,
  telegramUsername,
  telegramConnected,
  telegramConnecting,
  telegramAuthStep,
  telegramPhoneNumber,
  telegramPhoneCode,
  telegramTwoFactorPassword,
  telegramAuthBusy,
  telegramAuthError,
  telegramAuthNotice,
  telegramStatus,
  telegramCredentials,
  telegramApiId,
  telegramApiHash,
  telegramCredentialsBusy,
  telegramCredentialsError,
  onTelegramApiIdChange,
  onTelegramApiHashChange,
  onSaveTelegramCredentials,
  onTelegramPhoneNumberChange,
  onTelegramPhoneCodeChange,
  onTelegramTwoFactorPasswordChange,
  onTelegramAuth,
  onTelegramReconnect,
  onTelegramDisconnect,
}: SettingsViewProps) {
  const { locale, setLocale, t } = useLocale();
  const settingsViewRef = useRef<HTMLDivElement | null>(null);
  const settingsContentRef = useRef<HTMLElement | null>(null);
  const scrollbarDragRef = useRef<{ startY: number; startScrollTop: number } | null>(null);
  const [settingsScrollMetrics, setSettingsScrollMetrics] = useState({
    scrollTop: 0,
    scrollHeight: 0,
    clientHeight: 0,
    trackHeight: 0,
  });
  const isElectronRuntime = typeof document !== 'undefined'
    && document.documentElement.classList.contains('electron-runtime');
  const [isTelegramManagementOpen, setIsTelegramManagementOpen] = useState(false);
  const [colorTheme, setColorTheme] = useState(() => readColorTheme(colorThemeStorageKey));
  const settingsScrollRange = Math.max(0, settingsScrollMetrics.scrollHeight - settingsScrollMetrics.clientHeight);
  const settingsScrollbarThumbHeight = settingsScrollMetrics.scrollHeight > 0
    ? Math.min(
      settingsScrollMetrics.trackHeight,
      Math.max(32, settingsScrollMetrics.trackHeight * settingsScrollMetrics.clientHeight / settingsScrollMetrics.scrollHeight),
    )
    : 0;
  const settingsScrollbarMaxOffset = Math.max(0, settingsScrollMetrics.trackHeight - settingsScrollbarThumbHeight);
  const settingsScrollbarThumbOffset = settingsScrollRange > 0
    ? settingsScrollbarMaxOffset * settingsScrollMetrics.scrollTop / settingsScrollRange
    : 0;
  const statusPresentation = getTelegramStatusPresentation(telegramStatus);
  const statusMessage = telegramStatus.status === 'rate-limited'
    ? t(statusPresentation.messageKey, { wait: telegramStatus.waitSecondsText || '?' })
    : telegramStatus.error && statusPresentation.tone === 'error'
      ? `${t(statusPresentation.messageKey)} ${telegramStatus.error}`
      : t(statusPresentation.messageKey);
  const selectColorTheme = (nextTheme: ColorTheme) => {
    applyColorTheme(nextTheme, { animate: true, storageKey: colorThemeStorageKey });
    setColorTheme(nextTheme);
  };

  const handleSettingsScrollbarPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const content = settingsContentRef.current;
    if (!content || settingsScrollbarMaxOffset <= 0 || settingsScrollRange <= 0) return;

    const clickedThumb = Boolean((event.target as HTMLElement).closest('.settings-scrollbar-thumb'));
    if (!clickedThumb) {
      const trackRect = event.currentTarget.getBoundingClientRect();
      const desiredThumbOffset = Math.min(
        settingsScrollbarMaxOffset,
        Math.max(0, event.clientY - trackRect.top - settingsScrollbarThumbHeight / 2),
      );
      content.scrollTop = desiredThumbOffset / settingsScrollbarMaxOffset * settingsScrollRange;
    }

    scrollbarDragRef.current = { startY: event.clientY, startScrollTop: content.scrollTop };
    if (typeof event.currentTarget.setPointerCapture === 'function') {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    event.preventDefault();
  };

  const handleSettingsScrollbarPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const content = settingsContentRef.current;
    const drag = scrollbarDragRef.current;
    if (!content || !drag || settingsScrollbarMaxOffset <= 0) return;

    const scrollDelta = (event.clientY - drag.startY) / settingsScrollbarMaxOffset * settingsScrollRange;
    content.scrollTop = Math.max(0, Math.min(settingsScrollRange, drag.startScrollTop + scrollDelta));
  };

  const handleSettingsScrollbarPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    scrollbarDragRef.current = null;
    if (
      typeof event.currentTarget.hasPointerCapture === 'function'
      && event.currentTarget.hasPointerCapture(event.pointerId)
    ) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleSettingsScrollbarKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const content = settingsContentRef.current;
    if (!content) return;

    const pageStep = Math.max(40, content.clientHeight * 0.8);
    const keySteps: Record<string, number> = {
      ArrowDown: 40,
      ArrowUp: -40,
      PageDown: pageStep,
      PageUp: -pageStep,
      Home: -content.scrollTop,
      End: settingsScrollRange - content.scrollTop,
    };
    if (!(event.key in keySteps)) return;

    event.preventDefault();
    content.scrollTop += keySteps[event.key];
  };

  useEffect(() => {
    const settingsView = settingsViewRef.current;
    const content = settingsContentRef.current;
    if (!settingsView || !content) return;

    const updateScrollMetrics = () => {
      const nextMetrics = {
        scrollTop: content.scrollTop,
        scrollHeight: content.scrollHeight,
        clientHeight: content.clientHeight,
        trackHeight: settingsView.clientHeight,
      };
      setSettingsScrollMetrics((current) => (
        current.scrollTop === nextMetrics.scrollTop
        && current.scrollHeight === nextMetrics.scrollHeight
        && current.clientHeight === nextMetrics.clientHeight
        && current.trackHeight === nextMetrics.trackHeight
          ? current
          : nextMetrics
      ));
    };

    updateScrollMetrics();
    content.addEventListener('scroll', updateScrollMetrics, { passive: true });
    window.addEventListener('resize', updateScrollMetrics);
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateScrollMetrics);
    resizeObserver?.observe(settingsView);
    resizeObserver?.observe(content);
    const sections = content.querySelector('.settings-sections');
    if (sections) resizeObserver?.observe(sections);

    return () => {
      content.removeEventListener('scroll', updateScrollMetrics);
      window.removeEventListener('resize', updateScrollMetrics);
      resizeObserver?.disconnect();
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (isTelegramManagementOpen) {
          event.stopPropagation();
          setIsTelegramManagementOpen(false);
        } else {
          onClose();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isTelegramManagementOpen, onClose]);

  useEffect(() => {
    const sessionNeedsCredentials = telegramCredentials.hasSession && !telegramCredentials.hasCredentials;
    const signedOutNeedsSignIn = telegramCredentials.signedOut && !telegramCredentials.hasSession;
    if (sessionNeedsCredentials || signedOutNeedsSignIn) {
      setIsTelegramManagementOpen(true);
    }
  }, [telegramCredentials.hasCredentials, telegramCredentials.hasSession, telegramCredentials.signedOut]);

  return (
    <div className="settings-view" ref={settingsViewRef}>
      <main id="settings-view-content" className="settings-view-content" ref={settingsContentRef}>
        <h1>{t('settings.title')}</h1>

        <div className="settings-sections">
          <section className="settings-view-section">
            <div className="settings-section-heading-row settings-language-heading-row">
              <h2>{t('settings.language')}</h2>
              <div className="settings-language-switch" role="group" aria-label={t('settings.language')}>
                <button type="button" className={locale === 'en' ? 'is-selected' : ''} onClick={() => setLocale('en')} aria-pressed={locale === 'en'}>
                  EN
                </button>
                <span aria-hidden="true">|</span>
                <button type="button" className={locale === 'ru' ? 'is-selected' : ''} onClick={() => setLocale('ru')} aria-pressed={locale === 'ru'}>
                  RU
                </button>
              </div>
            </div>
          </section>
          <section className="settings-view-section settings-editor-appearance" aria-labelledby="settings-editor-appearance-title">
            <div className="settings-editor-appearance-heading">
              <h2 id="settings-editor-appearance-title">{t('settings.editorAppearance')}</h2>
            </div>
            <p className="settings-view-description">{t('settings.editorAppearanceDescription')}</p>

            <div className="settings-theme-choice-row">
              <span className="settings-editor-control-label">{t('settings.colorTheme')}</span>
              <div className="settings-theme-options" role="group" aria-label={t('settings.colorTheme')}>
                <button
                  type="button"
                  className={colorTheme === 'light' ? 'is-selected' : ''}
                  onClick={() => selectColorTheme('light')}
                  aria-pressed={colorTheme === 'light'}
                >
                  <Sun size={16} strokeWidth={1.7} aria-hidden="true" />
                  {t('settings.lightTheme')}
                </button>
                <button
                  type="button"
                  className={colorTheme === 'dark' ? 'is-selected' : ''}
                  onClick={() => selectColorTheme('dark')}
                  aria-pressed={colorTheme === 'dark'}
                >
                  <Moon size={16} strokeWidth={1.7} aria-hidden="true" />
                  {t('settings.darkTheme')}
                </button>
              </div>
            </div>
          </section>
          <section className="settings-view-section settings-telegram-section">
            <div className={`settings-telegram-entry ${telegramConnected ? 'is-connected' : ''}`}>
              <button
                type="button"
                className="settings-telegram-summary"
                onClick={() => setIsTelegramManagementOpen(true)}
                aria-haspopup="dialog"
                aria-expanded={isTelegramManagementOpen}
              >
                <span className="settings-telegram-summary-main">
                  <strong>{t('settings.telegram')}</strong>
                  <span className={`settings-telegram-summary-state ${telegramConnected ? 'is-connected' : ''}`}>
                    <span className="settings-telegram-status-dot" aria-hidden="true" />
                    {telegramConnected ? t('telegramStatus.connected') : t('settings.telegramNotConnected')}
                  </span>
                  {telegramConnected && (telegramUsername || accountName) && (
                    <span className="settings-telegram-summary-account">
                      {telegramUsername ? `@${telegramUsername.replace(/^@/, '')}` : accountName}
                    </span>
                  )}
                </span>
                <span className="settings-telegram-summary-open">
                  <span>{t('settings.manageTelegram')}</span>
                  <ChevronRight size={17} strokeWidth={1.8} aria-hidden="true" />
                </span>
              </button>
            </div>
            {isTelegramManagementOpen && createPortal(
              <div
                className="telegram-manager-backdrop topbar-logout-modal-backdrop"
                onMouseDown={(event) => {
                  if (event.target === event.currentTarget) setIsTelegramManagementOpen(false);
                }}
              >
                <section className="telegram-manager-dialog topbar-logout-modal" role="dialog" aria-modal="true" aria-labelledby="telegram-manager-title">
                  <header className="telegram-manager-header">
                    <div>
                      <span className="telegram-manager-icon topbar-logout-modal-icon" aria-hidden="true">
                        <Send size={22} strokeWidth={1.8} />
                      </span>
                      <h2 id="telegram-manager-title" className="topbar-logout-modal-title">{t('settings.telegramManageTitle')}</h2>
                    </div>
                    <button type="button" className="telegram-manager-close topbar-logout-modal-close" onClick={() => setIsTelegramManagementOpen(false)} aria-label={t('common.close')} autoFocus>
                      <X size={18} aria-hidden="true" />
                    </button>
                  </header>

                  <div className="telegram-manager-status topbar-logout-modal-description" role="status" aria-live="polite">
                    <span className={`settings-telegram-status-dot ${telegramConnected ? 'is-connected' : ''}`} aria-hidden="true" />
                    <div>
                      <strong>{telegramConnected ? t('telegramStatus.connected') : t('settings.telegramNotConnected')}</strong>
                      {telegramConnected && (telegramUsername || accountName) && (
                        <span>{telegramUsername ? `@${telegramUsername.replace(/^@/, '')}` : accountName}</span>
                      )}
                      {telegramConnecting && <span>{t('auth.connecting')}</span>}
                      {!telegramConnected && !telegramConnecting && telegramCredentials.signedOut && <span>{t('settings.signedOut')}</span>}
                      {!telegramConnected && !telegramConnecting && !telegramCredentials.signedOut && telegramStatus.status !== 'normal' && <span>{statusMessage}</span>}
                    </div>
                  </div>

                  <div className="telegram-manager-actions topbar-logout-modal-actions">
                    {telegramConnected ? (
                      <>
                        <button type="button" className="topbar-logout-modal-action topbar-logout-modal-action--confirm" onClick={onTelegramDisconnect} disabled={telegramAuthBusy}>
                          {telegramAuthBusy ? t('auth.connecting') : t('settings.telegramDisconnect')}
                        </button>
                        <button type="button" className="topbar-logout-modal-action topbar-logout-modal-action--cancel" onClick={() => setIsTelegramManagementOpen(false)}>{t('common.cancel')}</button>
                      </>
                    ) : telegramCredentials.hasSession && telegramCredentials.hasCredentials ? (
                      <>
                        <button type="button" className="topbar-logout-modal-action topbar-logout-modal-action--cancel" onClick={() => setIsTelegramManagementOpen(false)}>{t('common.cancel')}</button>
                        <button type="button" className="topbar-logout-modal-action topbar-logout-modal-action--confirm" onClick={onTelegramReconnect} disabled={telegramAuthBusy}>
                          {telegramAuthBusy ? t('auth.connecting') : t('settings.telegramReconnect')}
                        </button>
                      </>
                    ) : telegramCredentials.hasCredentials ? (
                      <form
                        className="telegram-manager-login"
                        onSubmit={(event) => {
                          event.preventDefault();
                          onTelegramAuth();
                        }}
                      >
                        {telegramAuthStep === 'phone' ? (
                          <label>
                            <span>{t('auth.phone')}</span>
                            <input type="tel" value={telegramPhoneNumber} onChange={(event) => onTelegramPhoneNumberChange(event.target.value)} placeholder={t('auth.phonePlaceholder')} autoComplete="tel" />
                          </label>
                        ) : telegramAuthStep === 'code' ? (
                          <label>
                            <span>{t('auth.loginCode')}</span>
                            <input value={telegramPhoneCode} onChange={(event) => onTelegramPhoneCodeChange(event.target.value)} placeholder={t('auth.loginCodePlaceholder')} autoComplete="one-time-code" />
                          </label>
                        ) : (
                          <label>
                            <span>{t('auth.twoFactorPassword')}</span>
                            <input type="password" value={telegramTwoFactorPassword} onChange={(event) => onTelegramTwoFactorPasswordChange(event.target.value)} placeholder={t('auth.twoFactorPasswordPlaceholder')} autoComplete="current-password" />
                          </label>
                        )}
                        {telegramAuthError && (
                          <p
                            className={telegramAuthNotice ? 'settings-view-notice' : 'settings-view-error'}
                            role={telegramAuthNotice ? 'status' : 'alert'}
                          >
                            {telegramAuthError}
                          </p>
                        )}
                        <div className="telegram-manager-actions topbar-logout-modal-actions">
                          <button type="button" className="topbar-logout-modal-action topbar-logout-modal-action--cancel" onClick={() => setIsTelegramManagementOpen(false)}>{t('common.cancel')}</button>
                          <button type="submit" className="topbar-logout-modal-action topbar-logout-modal-action--confirm" disabled={telegramAuthBusy || (telegramAuthStep === 'phone' ? !telegramPhoneNumber.trim() : telegramAuthStep === 'code' ? !telegramPhoneCode.trim() : !telegramTwoFactorPassword)}>
                            {telegramAuthBusy ? t('auth.connecting') : telegramAuthStep === 'phone' ? t('settings.telegramConnect') : telegramAuthStep === 'code' ? t('auth.verifyCode') : t('auth.verifyConnect')}
                          </button>
                        </div>
                      </form>
                    ) : (
                      <>
                        <p className="settings-view-description">{t('settings.telegramNeedsApi')}</p>
                        <button type="button" className="topbar-logout-modal-action topbar-logout-modal-action--cancel" onClick={() => setIsTelegramManagementOpen(false)}>{t('common.cancel')}</button>
                      </>
                    )}
                    {telegramAuthError && (telegramConnected || telegramCredentials.hasSession) && (
                      <p
                        className={telegramAuthNotice ? 'settings-view-notice' : 'settings-view-error'}
                        role={telegramAuthNotice ? 'status' : 'alert'}
                      >
                        {telegramAuthError}
                      </p>
                    )}
                  </div>

                  <details className="telegram-manager-advanced" open={!telegramCredentials.hasCredentials}>
                    <summary>{t('settings.telegramAdvancedApi')}</summary>
                    <div className="telegram-manager-details">
                      <span>{t('settings.sessionStatus')}: <strong>{telegramCredentials.hasSession ? t('settings.credentialsReady') : t('settings.credentialsMissing')}</strong></span>
                      <span>{t('settings.telegramCredentials')}: <strong>{telegramCredentials.hasCredentials ? t('settings.credentialsReady') : t('settings.credentialsMissing')}</strong></span>
                      {telegramCredentials.apiId && (
                        <span>{t('settings.apiIdStatus')}: <strong>{`${telegramCredentials.apiId.slice(0, 4)}••••`}</strong></span>
                      )}
                      {telegramCredentials.signedOut && <span>{t('settings.signedOut')}</span>}
                    </div>
                    <p className="settings-view-description">{t('settings.telegramCredentialsDescription')}</p>
                    {telegramCredentialsError && <p className="settings-view-error" role="alert">{telegramCredentialsError}</p>}
                    <form
                      className="telegram-credentials-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        onSaveTelegramCredentials();
                      }}
                    >
                      <input
                        type="text"
                        inputMode="numeric"
                        autoComplete="off"
                        value={telegramApiId}
                        onChange={(event) => onTelegramApiIdChange(event.target.value)}
                        placeholder={t('settings.apiIdPlaceholder')}
                        aria-label={t('settings.apiIdPlaceholder')}
                        disabled={telegramCredentialsBusy}
                      />
                      <input
                        type="password"
                        autoComplete="new-password"
                        value={telegramApiHash}
                        onChange={(event) => onTelegramApiHashChange(event.target.value)}
                        placeholder={t('settings.apiHashPlaceholder')}
                        aria-label={t('settings.apiHashPlaceholder')}
                        disabled={telegramCredentialsBusy}
                      />
                      <button type="submit" className="topbar-logout-modal-action" disabled={telegramCredentialsBusy || !telegramApiId.trim() || !telegramApiHash.trim()}>
                        {t('common.save')}
                      </button>
                    </form>
                  </details>
                </section>
              </div>,
              document.body,
            )}
          </section>
          <section className="settings-view-section settings-about-section">
            <h2>{t('settings.about')}</h2>
            <p className="settings-view-description">
              {t('settings.aboutDescription')}
            </p>
            <p className="settings-version">{t('settings.version')}</p>
          </section>
        </div>
      </main>
      {isElectronRuntime && settingsScrollRange > 0 && (
        <div
          className="settings-scrollbar"
          role="scrollbar"
          aria-label={t('settings.title')}
          aria-controls="settings-view-content"
          aria-orientation="vertical"
          aria-valuemin={0}
          aria-valuemax={settingsScrollRange}
          aria-valuenow={Math.round(settingsScrollMetrics.scrollTop)}
          tabIndex={0}
          onPointerDown={handleSettingsScrollbarPointerDown}
          onPointerMove={handleSettingsScrollbarPointerMove}
          onPointerUp={handleSettingsScrollbarPointerUp}
          onPointerCancel={handleSettingsScrollbarPointerUp}
          onKeyDown={handleSettingsScrollbarKeyDown}
        >
          <span
            className="settings-scrollbar-thumb"
            aria-hidden="true"
            style={{
              height: `${settingsScrollbarThumbHeight}px`,
              transform: `translateY(${settingsScrollbarThumbOffset}px)`,
            }}
          />
        </div>
      )}
    </div>
  );
}
