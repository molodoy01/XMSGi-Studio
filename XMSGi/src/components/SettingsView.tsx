import { useEffect, useState } from 'react';
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
  telegramStatus: TelegramStatusSnapshot;
  activeAccountId: 'account-1' | 'account-2';
  onAccountChange: (accountId: 'account-1' | 'account-2') => void;
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
};

export function SettingsView({
  onClose,
  accountName,
  telegramStatus,
  activeAccountId,
  onAccountChange,
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
}: SettingsViewProps) {
  const { locale, setLocale, t } = useLocale();
  const [isEditingKey, setIsEditingKey] = useState(false);
  const [isConfirmingRemoval, setIsConfirmingRemoval] = useState(false);
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
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  return (
    <div className="settings-view">
      <header className="settings-view-header">
        <button
          type="button"
          className="settings-view-done"
          onClick={onClose}
        >
          {t('settings.done')}
        </button>
      </header>

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
            <h2>{t('settings.telegramAccount')}</h2>
            <h3>{t('settings.telegramCredentials')}</h3>
            <p className="settings-view-description">{t('settings.telegramCredentialsDescription')}</p>
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
            <div className="telegram-credentials-status" role="status" aria-live="polite">
              <span>{t('settings.telegramCredentials')}: <strong className={telegramCredentials.hasCredentials ? 'is-ready' : 'is-missing'}>{telegramCredentials.hasCredentials ? t('settings.credentialsReady') : t('settings.credentialsMissing')}</strong></span>
              <span>{t('settings.sessionStatus')}: <strong className={telegramCredentials.hasSession ? 'is-ready' : 'is-missing'}>{telegramCredentials.hasSession ? t('settings.credentialsReady') : t('settings.credentialsMissing')}</strong></span>
              <span>{t('telegramStatus.connected')}: <strong className={telegramCredentials.connected ? 'is-ready' : 'is-missing'}>{telegramCredentials.connected ? t('settings.credentialsReady') : t('settings.credentialsMissing')}</strong></span>
              {telegramCredentials.signedOut && <span className="is-signed-out">{t('settings.signedOut')}</span>}
            </div>
            {telegramCredentialsError && <p className="settings-view-error">{telegramCredentialsError}</p>}
            <p className="settings-view-description">
              {accountName || t('telegramStatus.account')}
            </p>
            <div className="account-switcher settings-account-switcher" role="group" aria-label="Active account">
              {(['account-1'] as const).map((accountId) => (
                <button
                  key={accountId}
                  type="button"
                  className={activeAccountId === accountId ? 'is-active' : ''}
                  aria-pressed={activeAccountId === accountId}
                  onClick={() => onAccountChange(accountId)}
                >
                  Account 1
                </button>
              ))}
            </div>
            <div className={`telegram-status telegram-status-${statusPresentation.tone}`} role="status" aria-live="polite">
              <span className="telegram-status-copy">
                <strong>{t(statusPresentation.labelKey)}</strong>
                <span>{statusMessage}</span>
              </span>
            </div>
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
            <p className="settings-version">Version 2.1.7</p>
          </section>
        </div>
      </main>
    </div>
  );
}
