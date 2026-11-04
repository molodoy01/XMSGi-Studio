import { useEffect, useLayoutEffect, useRef, useState, type PropsWithChildren } from 'react';
import { LogOut, UserRound, X } from 'lucide-react';
import { Notification } from '@/components/Notification';
import { useLocale } from '@/lib/i18n';
import type { NotificationState } from '@/types';
import {
  persistPostsReturnView,
  readPostsReturnView,
  type ProductView,
} from '@/lib/productView';
import { telegramGetAccountAvatar } from '@/services/telegramAppService';
import { getTelegramStatusPresentation as getTelegramStatusPresentationFromModule } from './telegramStatusPresentation';
import { HistoryDrawer } from './HistoryDrawer';
import { QuickPlannerNavigationContext } from './QuickPlannerNavigationContext';
import type { QuickPlannerPostsFilter } from './QuickPlannerNavigationContext';
import type { HistoryItem, HistorySource } from './historyModel';

/* eslint-disable react-refresh/only-export-components */
export { getTelegramStatusPresentationFromModule as getTelegramStatusPresentation };
/* eslint-enable react-refresh/only-export-components */

const ACCOUNT_AVATAR_CACHE_KEY = 'xmsgi-account-avatar-cache-v1';

function readCachedAccountAvatar() {
  try {
    const cachedAvatar = window.localStorage.getItem(ACCOUNT_AVATAR_CACHE_KEY);
    return cachedAvatar?.startsWith('data:image/') ? cachedAvatar : '';
  } catch {
    return '';
  }
}

function cacheAccountAvatar(avatarDataUrl: string) {
  try {
    window.localStorage.setItem(ACCOUNT_AVATAR_CACHE_KEY, avatarDataUrl);
  } catch {
    // Keep the topbar usable when local storage is unavailable.
  }
}

type AppShellProps = PropsWithChildren<{
  view: ProductView;
  onViewChange: (view: ProductView) => void;
  settingsOpen?: boolean;
  onCloseSettings?: () => void;
  notification?: NotificationState;
  closeNotification?: () => void;
  browserDraftMode?: boolean;
  connected: boolean;
  connectionRecoveryStatus?: 'reconnecting' | 'offline' | null;
  headerPending?: boolean;
  authBusy: boolean;
  isConfirmingLogout: boolean;
  setIsConfirmingLogout: React.Dispatch<React.SetStateAction<boolean>>;
  setShowAuthForm: React.Dispatch<React.SetStateAction<boolean>>;
  handleDisconnect: () => Promise<void>;
  handleForgetAccount: () => Promise<void>;
  onOpenSettings: () => void;
  historyRecords: HistoryItem[];
  onHistoryCancel: (record: HistoryItem) => void;
  onHistoryReschedule: (record: HistoryItem) => void;
  onHistorySendNow: (record: HistoryItem) => void;
  onHistoryDelete: (record: HistoryItem) => void | Promise<boolean>;
  onHistoryOpenDraft: (record: HistoryItem) => void;
  onHistoryUseDraft?: (record: HistoryItem, destination?: 'planner' | 'studio') => boolean | void | Promise<boolean | void>;
  onHistoryClearSent: (source: HistorySource | 'all') => void;
  onHistoryClearDrafts?: (source: HistorySource | 'all') => Promise<boolean>;
  onHistoryCancelQueue?: (records: HistoryItem[]) => Promise<boolean>;
}>;

export function AppShell({
  children,
  view,
  onViewChange,
  settingsOpen = false,
  onCloseSettings,
  notification,
  closeNotification,
  connected,
  connectionRecoveryStatus = null,
  headerPending = false,
  authBusy,
  isConfirmingLogout,
  setIsConfirmingLogout,
  setShowAuthForm,
  handleDisconnect,
  handleForgetAccount,
  onOpenSettings,
  historyRecords,
  onHistoryCancel,
  onHistoryReschedule,
  onHistorySendNow,
  onHistoryDelete,
  onHistoryOpenDraft,
  onHistoryUseDraft,
  onHistoryClearSent,
  onHistoryClearDrafts,
  onHistoryCancelQueue,
}: AppShellProps) {
  const { t } = useLocale();
  const [postsOpen, setPostsOpen] = useState(false);
  const previousProductViewRef = useRef<Exclude<ProductView, 'posts'>>(
    readPostsReturnView(view === 'planner' ? 'planner' : 'studio'),
  );
  const hasOpenedPostsRef = useRef(false);
  const activeProductView = view === 'posts' ? previousProductViewRef.current : view;
  const isPlannerSurfaceActive = view === 'planner' && !postsOpen && !settingsOpen;
  const nextProductView = activeProductView === 'planner' ? 'studio' : 'planner';
  const nextViewLabel = nextProductView === 'planner' ? t('product.planner') : t('product.studio');
  const [accountAvatarDataUrl, setAccountAvatarDataUrl] = useState(readCachedAccountAvatar);
  const logoutPhotoButtonRef = useRef<HTMLButtonElement>(null);
  const [historySourceFilterOnOpen, setHistorySourceFilterOnOpen] = useState<'all' | 'personal' | 'workspace' | undefined>();
  const [historySourceFilterOnOpenMode, setHistorySourceFilterOnOpenMode] = useState<'initial' | 'temporary'>('temporary');
  const [historyStatusFilterOnOpen, setHistoryStatusFilterOnOpen] = useState<QuickPlannerPostsFilter | undefined>();

  useEffect(() => {
    if (isPlannerSurfaceActive && notification?.visible) closeNotification?.();
  }, [closeNotification, isPlannerSurfaceActive, notification?.visible]);

  useLayoutEffect(() => {
    if (view === 'posts') return;
    setPostsOpen(false);
    setHistorySourceFilterOnOpen(undefined);
    setHistorySourceFilterOnOpenMode('temporary');
    setHistoryStatusFilterOnOpen(undefined);
  }, [view]);

  useEffect(() => {
    if (!isConfirmingLogout || authBusy) return undefined;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (document.activeElement === logoutPhotoButtonRef.current) {
        logoutPhotoButtonRef.current?.blur();
      }
      setIsConfirmingLogout(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [authBusy, isConfirmingLogout, setIsConfirmingLogout]);

  useEffect(() => {
    let active = true;

    if (!connected) {
      return undefined;
    }

    telegramGetAccountAvatar()
      .then((result) => {
        if (!active || !result.success || !result.avatarDataUrl) return;
        setAccountAvatarDataUrl(result.avatarDataUrl);
        cacheAccountAvatar(result.avatarDataUrl);
      })
      .catch(() => setAccountAvatarDataUrl(readCachedAccountAvatar()));

    return () => {
      active = false;
    };
  }, [connected]);

  const isPostsVisible = view === 'posts' || postsOpen;
  const isStudioSurfaceActive = view === 'studio' && !postsOpen && !settingsOpen;

  useEffect(() => {
    if (isStudioSurfaceActive && notification?.visible) closeNotification?.();
  }, [closeNotification, isStudioSurfaceActive, notification?.visible]);

  const openPosts = (statusFilter?: QuickPlannerPostsFilter) => {
    const isInitialPostsOpen = !hasOpenedPostsRef.current;
    hasOpenedPostsRef.current = true;
    if (view !== 'posts') {
      previousProductViewRef.current = view;
      persistPostsReturnView(view);
    }
    setHistorySourceFilterOnOpen(isInitialPostsOpen ? 'all' : undefined);
    setHistorySourceFilterOnOpenMode(isInitialPostsOpen ? 'initial' : 'temporary');
    setHistoryStatusFilterOnOpen(isInitialPostsOpen ? 'scheduled' : statusFilter);
    setPostsOpen(true);
    onViewChange('posts');
  };
  const closePosts = (restorePreviousView = true) => {
    setHistorySourceFilterOnOpen(undefined);
    setHistorySourceFilterOnOpenMode('temporary');
    setHistoryStatusFilterOnOpen(undefined);
    setPostsOpen(false);
    if (restorePreviousView) onViewChange(previousProductViewRef.current);
  };
  const changeView = (nextView: ProductView) => {
    if (nextView === 'posts') {
      openPosts();
      return;
    }
    previousProductViewRef.current = nextView;
    persistPostsReturnView(nextView);
    setHistorySourceFilterOnOpen(undefined);
    setHistorySourceFilterOnOpenMode('temporary');
    setHistoryStatusFilterOnOpen(undefined);
    if (isPostsVisible) {
      setPostsOpen(false);
      onViewChange(nextView);
      return;
    }
    onViewChange(nextView);
  };
  const openSettings = () => {
    if (isPostsVisible) closePosts();
    onOpenSettings();
  };

  return (
    <div className={`product-shell ${activeProductView === 'planner' ? 'planner-shell' : 'studio-shell'}`} style={{ position: 'relative' }}>
      {!connected && headerPending && (
        <div className="topbar topbar-placeholder" aria-hidden="true" />
      )}
      {connected && (
        <header className={`topbar${settingsOpen ? ' settings-topbar' : ''}`}>
          <div className="topbar-identity">
            <span className="brand" aria-label="XMSGi">
              <span>XMSGi</span>
            </span>
          </div>

          {!settingsOpen && (
            <button
              type="button"
              className="settings-action product-mode-switch"
              aria-label={nextViewLabel}
              aria-pressed={view === 'planner'}
              onClick={() => changeView(nextProductView)}
            >
              <span className="action-label">{nextViewLabel}</span>
            </button>
          )}

          <div className="topbar-actions">
            {settingsOpen ? (
              <button type="button" className="settings-action" onClick={onCloseSettings} aria-label={t('settings.done')}>
                <span className="action-label">{t('settings.done')}</span>
              </button>
            ) : (
              <>
            <button
              type="button"
              className={`settings-action${isPostsVisible ? ' is-active' : ''}`}
              onClick={() => isPostsVisible ? closePosts() : openPosts()}
              title={t('history.title')}
              aria-label={t('history.title')}
              aria-current={isPostsVisible ? 'page' : undefined}
            >
              <span className="action-label">{t('history.title')}</span>
            </button>

            <button
              type="button"
              className="settings-action"
              onClick={() => {
                setShowAuthForm(false);
                setIsConfirmingLogout(false);
                openSettings();
              }}
              title={t('topbar.settings')}
              aria-label={t('topbar.settings')}
            >
              <span className="action-label">{t('topbar.settings')}</span>
            </button>

            <button
              ref={logoutPhotoButtonRef}
              type="button"
              className="topbar-logout-photo"
              aria-haspopup="dialog"
              aria-label={t('auth.logout')}
              title={t('auth.logout')}
              onClick={() => setIsConfirmingLogout(true)}
              disabled={authBusy}
            >
              {!accountAvatarDataUrl ? (
                <span className="topbar-logout-photo-fallback" aria-hidden="true">
                  <UserRound size={28} strokeWidth={1.7} />
                </span>
              ) : (
                <img className="topbar-logout-photo-image" src={accountAvatarDataUrl} alt="" />
              )}
              <span className="topbar-logout-photo-ring" aria-hidden="true" />
              <span
                className={`topbar-logout-photo-status${connectionRecoveryStatus === 'reconnecting' ? ' is-reconnecting' : connectionRecoveryStatus === 'offline' ? ' is-offline' : ''}${notification?.visible && notification.type === 'error' ? ' has-error' : ''}`}
                title={t(connectionRecoveryStatus === 'offline' ? 'telegramStatus.offlineMessage' : connectionRecoveryStatus === 'reconnecting' ? 'telegramStatus.networkMessage' : 'telegramStatus.connectedMessage')}
                aria-label={t(connectionRecoveryStatus === 'offline' ? 'telegramStatus.offlineMessage' : connectionRecoveryStatus === 'reconnecting' ? 'telegramStatus.networkMessage' : 'telegramStatus.connectedMessage')}
                role="img"
              />
            </button>
              </>
            )}
          </div>
        </header>
      )}
      <QuickPlannerNavigationContext.Provider value={{
        currentSection: settingsOpen ? 'settings' : isPostsVisible ? 'posts' : view === 'studio' ? 'studio' : 'quick-plan',
        openQuickPlan: () => {
          changeView('planner');
        },
        openStudio: () => {
          changeView('studio');
        },
        openPosts,
        openSettings,
      }}>
        <main className={`product-shell-content${isPostsVisible ? ' is-posts' : ''}`}>
          {children}
          <HistoryDrawer
            isOpen={isPostsVisible}
            pageMode={isPostsVisible}
            sourceFilterOnOpen={historySourceFilterOnOpen}
            sourceFilterOnOpenMode={historySourceFilterOnOpenMode}
            statusFilterOnOpen={historyStatusFilterOnOpen}
            onClose={closePosts}
            records={historyRecords}
            onCancel={onHistoryCancel}
            onReschedule={onHistoryReschedule}
            onSendNow={onHistorySendNow}
            onDelete={onHistoryDelete}
            onOpenDraft={onHistoryOpenDraft}
            onUseDraft={onHistoryUseDraft}
            draftDestination={activeProductView}
            onClearSent={onHistoryClearSent}
            onClearDrafts={onHistoryClearDrafts}
            onCancelQueue={onHistoryCancelQueue}
          />
        </main>
      </QuickPlannerNavigationContext.Provider>
      {isConfirmingLogout && (
        <div
          className="topbar-logout-modal-backdrop"
          onClick={() => {
            if (!authBusy) {
              setShowAuthForm(false);
              setIsConfirmingLogout(false);
            }
          }}
        >
          <div
            className="topbar-logout-modal"
            role="dialog"
            aria-modal="true"
            aria-label={t('auth.signOut')}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="topbar-logout-modal-close"
              onClick={() => {
                setShowAuthForm(false);
                setIsConfirmingLogout(false);
              }}
              disabled={authBusy}
              aria-label={t('common.close')}
            >
              <X size={18} strokeWidth={1.8} aria-hidden="true" />
            </button>
            <span className="topbar-logout-modal-icon" aria-hidden="true">
              <LogOut size={24} strokeWidth={1.8} />
            </span>
            <h2 className="topbar-logout-modal-title">{t('auth.signOut')}</h2>
            <p className="topbar-logout-modal-description">{t('auth.signOutPreference')}</p>
            <div className="topbar-logout-modal-actions">
              <div className="topbar-logout-modal-exit-choices">
                <button
                  type="button"
                  className="topbar-logout-modal-action topbar-logout-modal-action--confirm"
                  onClick={async () => {
                    setShowAuthForm(false);
                    setIsConfirmingLogout(false);
                    await handleForgetAccount();
                  }}
                  disabled={authBusy}
                >
                  {t('auth.forgetMe')}
                </button>
                <button
                  type="button"
                  className="topbar-logout-modal-action topbar-logout-modal-action--cancel"
                  onClick={async () => {
                    setShowAuthForm(false);
                    setIsConfirmingLogout(false);
                    await handleDisconnect();
                  }}
                  disabled={authBusy}
                >
                  {t('auth.rememberMe')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {!isPlannerSurfaceActive && !isStudioSurfaceActive && notification && closeNotification && (
        <Notification
          message={notification.message}
          type={notification.type}
          title={notification.title}
          visible={notification.visible}
          onClose={closeNotification}
        />
      )}
    </div>
  );
}