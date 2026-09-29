import { useEffect, useState, type PropsWithChildren } from 'react';
import { useLocale } from '@/lib/i18n';
import { getTelegramStatusPresentation as getTelegramStatusPresentationFromModule } from './telegramStatusPresentation';
import { HistoryDrawer, type HistoryDrawerRecord } from './HistoryDrawer';

/* eslint-disable react-refresh/only-export-components */
export { getTelegramStatusPresentationFromModule as getTelegramStatusPresentation };
/* eslint-enable react-refresh/only-export-components */

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
  historyRecords: HistoryDrawerRecord[];
  onHistoryCancel: (record: HistoryDrawerRecord) => void;
  onHistoryDelete: (record: HistoryDrawerRecord) => void;
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
  historyRecords,
  onHistoryCancel,
  onHistoryDelete,
}: AppShellProps) {
  const { t } = useLocale();
  const nextViewLabel = view === 'planner' ? 'STUDIO' : 'PLANNER';
  const sectionLabel = view === 'planner' ? t('product.planner') : t('product.studio');
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  useEffect(() => {
    if (!isHistoryOpen) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsHistoryOpen(false);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isHistoryOpen]);

  return (
    <div className={`product-shell ${view === 'planner' ? 'planner-shell' : 'studio-shell'}`} style={{ position: 'relative' }}>
      {connected && (
        <header className="topbar">
          <div className="topbar-identity">
            <span className="brand" aria-label="XMSGi"><span>XMSGi</span></span>
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
              onClick={() => setIsHistoryOpen(true)}
              title="История"
              aria-label="История"
            >
              <span className="action-label">История</span>
            </button>

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
      {connected && (
        <span className="product-section-title product-section-title-detached" aria-current="page">
          {sectionLabel}
        </span>
      )}
      <main className="product-shell-content">{children}</main>
      <HistoryDrawer
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        records={historyRecords}
        onCancel={onHistoryCancel}
        onDelete={onHistoryDelete}
      />
    </div>
  );
}