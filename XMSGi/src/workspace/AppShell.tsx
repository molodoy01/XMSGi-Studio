import type { PropsWithChildren } from 'react';
import { useLocale, type TranslationKey } from '@/lib/i18n';
import type { TelegramStatusSnapshot } from '@/hooks/useTelegramAuth';

export type TelegramStatusPresentation = {
  tone: 'normal' | 'warning' | 'error';
  labelKey: TranslationKey;
  messageKey: TranslationKey;
};

export function getTelegramStatusPresentation(status: TelegramStatusSnapshot): TelegramStatusPresentation {
  if (status.status === 'rate-limited') {
    return { tone: 'warning', labelKey: 'telegramStatus.rateLimited', messageKey: 'telegramStatus.rateLimitedMessage' };
  }

  if (status.status === 'slowmode') {
    return { tone: 'warning', labelKey: 'telegramStatus.slowmode', messageKey: 'telegramStatus.slowmodeMessage' };
  }

  if (status.status === 'auth required') {
    return { tone: 'error', labelKey: 'telegramStatus.authRequired', messageKey: 'telegramStatus.authRequiredMessage' };
  }

  if (status.status === 'network/retrying') {
    return { tone: 'warning', labelKey: 'telegramStatus.network', messageKey: 'telegramStatus.networkMessage' };
  }

  if (status.category === 'permission') {
    return { tone: 'error', labelKey: 'telegramStatus.permission', messageKey: 'telegramStatus.permissionMessage' };
  }

  if (status.status === 'error' || status.category === 'unknown') {
    return { tone: 'error', labelKey: 'telegramStatus.error', messageKey: 'telegramStatus.errorMessage' };
  }

  return { tone: 'normal', labelKey: 'telegramStatus.connected', messageKey: 'telegramStatus.connectedMessage' };
}

type AppShellProps = PropsWithChildren<{
  view: 'studio' | 'planner';
  onViewChange: (view: 'studio' | 'planner') => void;
  connected: boolean;
  authBusy: boolean;
  isConfirmingLogout: boolean;
  setIsConfirmingLogout: React.Dispatch<React.SetStateAction<boolean>>;
  setShowAuthForm: React.Dispatch<React.SetStateAction<boolean>>;
  handleDisconnect: () => Promise<void>;
  handleForgetAccount: () => Promise<void>;
  onOpenSettings: () => void;
}>;

export function AppShell({
  children,
  view,
  onViewChange,
  connected,
  authBusy,
  isConfirmingLogout,
  setIsConfirmingLogout,
  setShowAuthForm,
  handleDisconnect,
  handleForgetAccount,
  onOpenSettings,
}: AppShellProps) {
  const { t } = useLocale();
  const nextViewLabel = view === 'planner' ? 'STUDIO' : 'PLANNER';
  const sectionLabel = view === 'planner' ? t('product.planner') : t('product.studio');

  return (
    <div className="product-shell">
      {connected && (
        <header className="topbar">
          <div className="topbar-identity">
            <span className="brand" aria-label="XMSGi"><span>XMSGi</span></span>
            <span className="product-section-title">{sectionLabel}</span>
          </div>

          <button
            type="button"
            className="settings-action product-mode-switch"
            aria-label={nextViewLabel}
            aria-pressed={view === 'planner'}
            onClick={() => onViewChange(view === 'planner' ? 'studio' : 'planner')}
          >
            <span className="action-label">{nextViewLabel}</span>
          </button>

          <div className="topbar-actions">
            <div className="logout-action-group">
              <button
                className="account-action"
                onClick={() => setIsConfirmingLogout((current) => !current)}
                disabled={authBusy || !connected}
                title={t('auth.logout')}
                aria-label={t('auth.logout')}
                aria-expanded={isConfirmingLogout}
              >
                <span className="action-label">{t('auth.logout')}</span>
              </button>

              {isConfirmingLogout && connected && (
                <div className="logout-confirmation" role="dialog" aria-label={t('auth.confirmLogout')}>
                  <strong className="logout-confirmation-title">{t('auth.signOut')}</strong>
                  <div className="logout-choice-list" role="radiogroup" aria-label={t('auth.signOutPreference')}>
                    <button type="button" className="logout-choice" onClick={handleDisconnect} disabled={authBusy}>{t('auth.rememberMe')}</button>
                    <button type="button" className="logout-choice" onClick={handleForgetAccount} disabled={authBusy}>{t('auth.forgetMe')}</button>
                  </div>
                  <div className="logout-confirmation-actions">
                    <button type="button" className="logout-confirmation-action" onClick={() => setIsConfirmingLogout(false)} disabled={authBusy}>{t('common.cancel')}</button>
                  </div>
                </div>
              )}
            </div>

            <button
              type="button"
              className="settings-action"
              onClick={() => {
                setShowAuthForm(false);
                setIsConfirmingLogout(false);
                onOpenSettings();
              }}
              title={t('topbar.settings')}
              aria-label={t('topbar.settings')}
            >
              <span className="action-label">{t('topbar.settings')}</span>
            </button>
          </div>
        </header>
      )}
      <main className="product-shell-content">{children}</main>
    </div>
  );
}