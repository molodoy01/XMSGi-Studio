import { useEffect, useState } from 'react';
import { ChevronRight, Send, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useLocale } from '@/lib/i18n';
import type { TelegramStatusSnapshot } from '@/hooks/useTelegramAuth';
import { getTelegramStatusPresentation } from '@/workspace/AppShell';

type GeminiSettings = {
  hasKey: boolean;
  maskedKey: string;
  enabled: boolean;
  encryptionAvailable: boolean;
};

type SettingsViewProps = {
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
  telegramStatus: TelegramStatusSnapshot;
  geminiSettings: GeminiSettings;
  settingsKey: string;
  settingsBusy: boolean;
  settingsError: string;
  onSettingsKeyChange: (value: string) => void;
  onSaveGeminiKey: () => void;
  onRemoveGeminiKey: () => void;
  onToggleAssistant: () => void;
  telegramCredentials: { hasCredentials: boolean; hasSession: boolean; connected: boolean; signedOut: boolean };
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
  telegramStatus,
  geminiSettings,
  settingsKey,
  settingsBusy,
  settingsError,
  onSettingsKeyChange,
  onSaveGeminiKey,
  onRemoveGeminiKey,
  onToggleAssistant,
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
  const [isEditingKey, setIsEditingKey] = useState(false);
  const [isConfirmingRemoval, setIsConfirmingRemoval] = useState(false);
  const [isTelegramManagementOpen, setIsTelegramManagementOpen] = useState(false);
  const statusPresentation = getTelegramStatusPresentation(telegramStatus);
  const statusMessage = telegramStatus.status === 'rate-limited'
    ? t(statusPresentation.messageKey, { wait: telegramStatus.waitSecondsText || '?' })
    : telegramStatus.error && statusPresentation.tone === 'error'
      ? `${t(statusPresentation.messageKey)} ${telegramStatus.error}`
      : t(statusPresentation.messageKey);

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
    <div className="settings-view">
      <main className="settings-view-content">
        <h1>{t('settings.title')}</h1>

        <div className="settings-sections">
          <section className="settings-view-section">
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
          </section>
          <section className="settings-view-section settings-telegram-section">
            <div className={`settings-telegram-entry ${telegramConnected ? 'is-connected' : ''}`}>
              <span className="settings-telegram-mark" aria-hidden="true">
                <Send size={17} strokeWidth={1.8} />
              </span>
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
                className="telegram-manager-backdrop"
                onMouseDown={(event) => {
                  if (event.target === event.currentTarget) setIsTelegramManagementOpen(false);
                }}
              >
                <section className="telegram-manager-dialog" role="dialog" aria-modal="true" aria-labelledby="telegram-manager-title">
                  <header className="telegram-manager-header">
                    <div>
                      <span className="settings-section-label">{t('settings.telegram')}</span>
                      <h2 id="telegram-manager-title">{t('settings.telegramManageTitle')}</h2>
                    </div>
                    <button type="button" className="telegram-manager-close" onClick={() => setIsTelegramManagementOpen(false)} aria-label={t('common.close')} autoFocus>
                      <X size={18} aria-hidden="true" />
                    </button>
                  </header>

                  <div className="telegram-manager-status" role="status" aria-live="polite">
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

                  <div className="telegram-manager-actions">
                    {telegramConnected ? (
                      <>
                        <button type="button" className="telegram-manager-secondary" onClick={() => setIsTelegramManagementOpen(false)}>{t('common.cancel')}</button>
                        <button type="button" className="telegram-manager-primary is-danger" onClick={onTelegramDisconnect} disabled={telegramAuthBusy}>
                          {telegramAuthBusy ? t('auth.connecting') : t('settings.telegramDisconnect')}
                        </button>
                      </>
                    ) : telegramCredentials.hasSession && telegramCredentials.hasCredentials ? (
                      <>
                        <button type="button" className="telegram-manager-secondary" onClick={() => setIsTelegramManagementOpen(false)}>{t('common.cancel')}</button>
                        <button type="button" className="telegram-manager-primary" onClick={onTelegramReconnect} disabled={telegramAuthBusy}>
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
                        {telegramAuthError && <p className="settings-view-error" role="alert">{telegramAuthError}</p>}
                        <div className="telegram-manager-actions">
                          <button type="button" className="telegram-manager-secondary" onClick={() => setIsTelegramManagementOpen(false)}>{t('common.cancel')}</button>
                          <button type="submit" className="telegram-manager-primary" disabled={telegramAuthBusy || (telegramAuthStep === 'phone' ? !telegramPhoneNumber.trim() : telegramAuthStep === 'code' ? !telegramPhoneCode.trim() : !telegramTwoFactorPassword)}>
                            {telegramAuthBusy ? t('auth.connecting') : telegramAuthStep === 'phone' ? t('settings.telegramConnect') : telegramAuthStep === 'code' ? t('auth.verifyCode') : t('auth.verifyConnect')}
                          </button>
                        </div>
                      </form>
                    ) : (
                      <>
                        <p className="settings-view-description">{t('settings.telegramNeedsApi')}</p>
                        <button type="button" className="telegram-manager-secondary" onClick={() => setIsTelegramManagementOpen(false)}>{t('common.cancel')}</button>
                      </>
                    )}
                    {telegramAuthError && (telegramConnected || telegramCredentials.hasSession) && <p className="settings-view-error" role="alert">{telegramAuthError}</p>}
                  </div>

                  <details className="telegram-manager-advanced" open={!telegramCredentials.hasCredentials}>
                    <summary>{t('settings.telegramAdvancedApi')}</summary>
                    <div className="telegram-manager-details">
                      <span>{t('settings.telegramCredentials')}: <strong>{telegramCredentials.hasCredentials ? t('settings.credentialsReady') : t('settings.credentialsMissing')}</strong></span>
                      <span>{t('settings.sessionStatus')}: <strong>{telegramCredentials.hasSession ? t('settings.credentialsReady') : t('settings.credentialsMissing')}</strong></span>
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
                      <button type="submit" disabled={telegramCredentialsBusy || !telegramApiId.trim() || !telegramApiHash.trim()}>
                        {t('common.save')}
                      </button>
                    </form>
                  </details>
                </section>
              </div>,
              document.body,
            )}
          </section>
          <section className="settings-view-section" style={{ display: 'none' }}>
            <h2>{t('settings.aiAssistant')}</h2>
            <p className="settings-view-description">
              {t('settings.aiDescription')}
            </p>
            <button
              type="button"
              className={`settings-toggle-line ${geminiSettings.enabled ? 'is-on' : ''}`}
              onClick={onToggleAssistant}
              disabled={settingsBusy}
              aria-pressed={geminiSettings.enabled}
            >
              <span>{t('settings.aiAssistant')}</span>
              <span className={`settings-toggle-state ${geminiSettings.enabled ? 'is-on' : 'is-off'}`}>
                {geminiSettings.enabled ? t('settings.on') : t('settings.off')}
              </span>
            </button>
          </section>

          <section className="settings-view-section" style={{ display: 'none' }}>
            <div className="settings-section-heading-row">
              <h2>{t('settings.geminiKey')}</h2>
              <span className={`settings-status ${geminiSettings.hasKey ? 'is-ready' : 'is-missing'}`}>
                {geminiSettings.hasKey ? t('settings.keyReady') : t('settings.noKey')}
              </span>
            </div>
            <p className="settings-view-description">{t('settings.keyDescription')}</p>

            {isEditingKey ? (
              <form
                className="settings-key-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  onSaveGeminiKey();
                  setIsEditingKey(false);
                }}
              >
                <input
                  type="password"
                  value={settingsKey}
                  onChange={(event) => onSettingsKeyChange(event.target.value)}
                  placeholder={t('settings.keyPlaceholder')}
                  autoFocus
                  disabled={settingsBusy}
                />
                <button type="submit" disabled={settingsBusy || !settingsKey.trim()}>
                  {t('common.save')}
                </button>
              </form>
            ) : (
              <div className="settings-key-row">
                <span className="settings-key-value">
                  {geminiSettings.hasKey ? geminiSettings.maskedKey : t('settings.noKeyYet')}
                </span>
                <span className="settings-key-actions">
                  <button type="button" onClick={() => setIsEditingKey(true)} disabled={settingsBusy}>
                    {t('settings.changeKey')}
                  </button>
                  {geminiSettings.hasKey && (
                    <button
                      type="button"
                      onClick={() => setIsConfirmingRemoval(true)}
                      disabled={settingsBusy}
                    >
                      {t('common.remove')}
                    </button>
                  )}
                </span>
              </div>
            )}

            {isConfirmingRemoval && geminiSettings.hasKey && (
              <div className="settings-remove-confirmation">
                <span>{t('settings.removeThisKey')}</span>
                <span className="settings-key-actions">
                  <button
                    type="button"
                    onClick={() => setIsConfirmingRemoval(false)}
                    disabled={settingsBusy}
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onRemoveGeminiKey();
                      setIsConfirmingRemoval(false);
                    }}
                    disabled={settingsBusy}
                  >
                      {t('settings.removeKey')}
                  </button>
                </span>
              </div>
            )}

            <a
              className="settings-api-link"
              href="https://aistudio.google.com/app/apikey"
              target="_blank"
              rel="noreferrer"
            >
              {t('settings.getKey')} <span aria-hidden="true">→</span>
            </a>
            {settingsError && <p className="settings-view-error">{settingsError}</p>}
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
    </div>
  );
}
