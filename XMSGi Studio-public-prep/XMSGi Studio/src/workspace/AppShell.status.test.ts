import { createElement, useContext, useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '@/lib/i18n';
import { persistPostsReturnView } from '@/lib/productView';
import { LocalDateTimeClock } from '@/components/LocalDateTimeClock';
import { AppShell, getTelegramStatusPresentation } from './AppShell';
import { QuickPlannerNavigationContext } from './QuickPlannerNavigationContext';
import { normalizeSavedPlannerDraft } from './historyModel';

const baseStatus = {
  accountId: 'telegram-session:active-account',
  status: 'normal' as const,
};
const accountAvatarCacheKey = 'xmsgi-account-avatar-cache-v1';

function openHistorySourceMenu() {
  fireEvent.click(document.querySelector('.history-source-select') as HTMLButtonElement);
}

function getHistorySourceOption(source: 'all' | 'workspace' | 'personal') {
  return document.querySelector(`.history-source-menu [data-history-filter="${source}"]`) as HTMLButtonElement;
}

function QuickPlannerNavigationTestButtons() {
  const { currentSection, openQuickPlan, openStudio, openPosts, openSettings } = useContext(QuickPlannerNavigationContext);
  return createElement('div', null,
    createElement('span', null, 'Current screen'),
    createElement('span', { 'data-testid': 'quickplanner-current-section' }, currentSection),
    createElement('button', { type: 'button', onClick: openStudio }, 'Studio from Quick Plan'),
    createElement('button', { type: 'button', onClick: openQuickPlan }, 'Quick Plan from Studio'),
    createElement('button', { type: 'button', onClick: openPosts }, 'Posts from Quick Plan'),
    createElement('button', { type: 'button', onClick: openSettings }, 'Settings from Quick Plan'),
  );
}

describe('Telegram status presentation', () => {
  it.each([
    ['normal', { ...baseStatus, status: 'normal' as const }, 'normal', 'telegramStatus.connected'],
    ['rate limited', { ...baseStatus, status: 'rate-limited' as const }, 'warning', 'telegramStatus.rateLimited'],
    ['slowmode', { ...baseStatus, status: 'slowmode' as const }, 'warning', 'telegramStatus.slowmode'],
    ['auth required', { ...baseStatus, status: 'auth required' as const }, 'error', 'telegramStatus.authRequired'],
    ['network retrying', { ...baseStatus, status: 'network/retrying' as const }, 'warning', 'telegramStatus.network'],
    ['permission error', { ...baseStatus, status: 'error' as const, category: 'permission' as const }, 'error', 'telegramStatus.permission'],
    ['unknown error', { ...baseStatus, status: 'error' as const, category: 'unknown' as const }, 'error', 'telegramStatus.error'],
  ])('maps %s to a visible presentation', (_name, status, tone, labelKey) => {
    expect(getTelegramStatusPresentation(status)).toMatchObject({ tone, labelKey });
  });
});

describe('product navigation', () => {
  it('shows the XMSGi brand and opens Planner from the Studio topbar', () => {
    const onViewChange = vi.fn();
    render(createElement(LocaleProvider, null, createElement(AppShell, {
      view: 'studio',
      onViewChange,
      connected: true,
      authBusy: false,
      isConfirmingLogout: false,
      setIsConfirmingLogout: vi.fn(),
      setShowAuthForm: vi.fn(),
      handleDisconnect: async () => undefined,
      handleForgetAccount: async () => undefined,
      onOpenSettings: vi.fn(),
      historyRecords: [],
      onHistoryCancel: vi.fn(),
      onHistoryReschedule: vi.fn(),
      onHistorySendNow: vi.fn(),
      onHistoryDelete: vi.fn(),
      onHistoryOpenDraft: vi.fn(),
      onHistoryClearSent: vi.fn(),
    })));

    expect(screen.getByText('XMSGi')).toBeInTheDocument();
    expect(document.querySelector('.topbar-identity .brand-mark')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Planner' }));

    expect(onViewChange).toHaveBeenCalledWith('planner');
  });

  it.each(['studio', 'planner'] as const)('uses a draft in Studio from Posts when opened from %s', (destination) => {
    const draft = normalizeSavedPlannerDraft({
      id: `destination-${destination}`,
      message: 'Planner draft to use',
      attachments: [],
      entities: [],
      reminderType: null,
      savedAt: '2026-10-24T12:00:00.000Z',
    });
    const onHistoryUseDraft = vi.fn();

    function AppShellHarness() {
      const [view, setView] = useState<'studio' | 'planner' | 'posts'>(destination);
      return createElement(AppShell, {
        view,
        onViewChange: setView,
        connected: true,
        authBusy: false,
        isConfirmingLogout: false,
        setIsConfirmingLogout: vi.fn(),
        setShowAuthForm: vi.fn(),
        handleDisconnect: async () => undefined,
        handleForgetAccount: async () => undefined,
        onOpenSettings: vi.fn(),
        historyRecords: [draft],
        onHistoryCancel: vi.fn(),
        onHistoryReschedule: vi.fn(),
        onHistorySendNow: vi.fn(),
        onHistoryDelete: vi.fn(),
        onHistoryOpenDraft: vi.fn(),
        onHistoryUseDraft: (record, selectedDestination) => {
          onHistoryUseDraft(record, selectedDestination);
          if (selectedDestination) setView(selectedDestination);
        },
        onHistoryClearSent: vi.fn(),
      }, createElement('div', null, 'Studio'));
    }

    const { container } = render(createElement(LocaleProvider, null, createElement(AppShellHarness)));
    fireEvent.click(screen.getByRole('button', { name: 'Posts' }));
    fireEvent.click(container.querySelector('.history-source-select') as HTMLButtonElement);
    fireEvent.click(document.querySelector('.history-source-menu [data-history-filter="all"]') as HTMLButtonElement);
    fireEvent.click(screen.getByRole('tab', { name: 'Drafts' }));
    fireEvent.click(container.querySelector('.history-record-open') as HTMLButtonElement);
    fireEvent.click(container.querySelector('.history-detail-toolbar .is-more') as HTMLButtonElement);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Use in Studio' }));

    expect(onHistoryUseDraft).toHaveBeenCalledWith(draft, 'studio');
    expect(screen.queryByText(/Where would you like to open/)).not.toBeInTheDocument();
    expect(container.querySelector('.history-detail-draft-menu')).toBeNull();
    expect(container.querySelector('.history-draft-destination-menu')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Posts' })).not.toBeInTheDocument();
    expect(container.querySelector('.product-shell')).toHaveClass('studio-shell');
  });
});

describe('LocalDateTimeClock visibility', () => {
  beforeEach(() => window.localStorage.setItem('awaitmsg_locale', 'ru'));
  afterEach(() => window.localStorage.removeItem('awaitmsg_locale'));

  it('keeps the local clock completely hidden in the product shell', () => {
    const { container } = render(createElement(LocaleProvider, null, createElement(LocalDateTimeClock)));

    expect(container.firstChild).toBeNull();
    expect(screen.queryByLabelText('Местные дата и время')).not.toBeInTheDocument();
    expect(document.querySelector('.local-date-time-clock')).toBeNull();
  });
});

describe('Electron shell sizing', () => {
  it('does not globally compress the app content inside Electron', () => {
    document.documentElement.classList.add('electron-runtime');
    try {
      expect(getComputedStyle(document.documentElement).zoom).not.toBe('0.95');
      expect(getComputedStyle(document.documentElement).zoom).toBe('1');
    } finally {
      document.documentElement.classList.remove('electron-runtime');
    }
  });
});

describe('shared History Drawer entry point', () => {
  beforeEach(() => {
    window.localStorage.removeItem('xmsgi-history-drawer-open');
  });

  it('hides the legacy toast on Planner and keeps it available on other surfaces', () => {
    const closeNotification = vi.fn();
    const shellProps = {
      view: 'planner' as const,
      onViewChange: vi.fn(),
      browserDraftMode: false,
      notification: { message: 'Planner is ready.', title: 'Notice', type: 'info' as const, visible: true },
      closeNotification,
      connected: false,
      authBusy: false,
      isConfirmingLogout: false,
      setIsConfirmingLogout: vi.fn(),
      setShowAuthForm: vi.fn(),
      handleDisconnect: async () => undefined,
      handleForgetAccount: async () => undefined,
      onOpenSettings: vi.fn(),
      historyRecords: [],
      onHistoryCancel: vi.fn(),
      onHistoryReschedule: vi.fn(),
      onHistorySendNow: vi.fn(),
      onHistoryDelete: vi.fn(),
      onHistoryOpenDraft: vi.fn(),
      onHistoryClearSent: vi.fn(),
    };
    const { rerender } = render(createElement(LocaleProvider, null, createElement(AppShell, shellProps, createElement('div', null, 'Login'))));

    expect(screen.queryByLabelText('Current local date and time')).not.toBeInTheDocument();
    expect(screen.queryByText('Planner is ready.')).not.toBeInTheDocument();
    expect(document.querySelector('.shell-notification')).not.toBeInTheDocument();
    expect(closeNotification).toHaveBeenCalledOnce();

    rerender(createElement(LocaleProvider, null, createElement(AppShell, { ...shellProps, connected: true }, createElement('div', null, 'Planner'))));
    expect(screen.queryByLabelText('Current local date and time')).not.toBeInTheDocument();
    expect(screen.queryByText('Planner is ready.')).not.toBeInTheDocument();

    rerender(createElement(LocaleProvider, null, createElement(AppShell, { ...shellProps, browserDraftMode: true }, createElement('div', null, 'Local planner'))));
    expect(screen.queryByLabelText('Current local date and time')).not.toBeInTheDocument();

    rerender(createElement(LocaleProvider, null, createElement(AppShell, { ...shellProps, view: 'posts' }, createElement('div', null, 'Posts'))));
    expect(document.querySelector('.shell-notification')).toHaveTextContent('Planner is ready.');
  });

  it.each(['planner', 'studio'] as const)('opens the Posts page from %s', (view) => {
    window.localStorage.removeItem('xmsgi-history-filters');
    const onOpenSettings = vi.fn();
    const onViewChange = vi.fn();
    const plannerNavigation = createElement(QuickPlannerNavigationTestButtons);

    render(createElement(LocaleProvider, null, createElement(AppShell, {
      view,
      onViewChange,
      connected: true,
      authBusy: false,
      isConfirmingLogout: false,
      setIsConfirmingLogout: vi.fn(),
      setShowAuthForm: vi.fn(),
      handleDisconnect: async () => undefined,
      handleForgetAccount: async () => undefined,
      onOpenSettings,
      historyRecords: [],
      onHistoryCancel: vi.fn(),
      onHistoryReschedule: vi.fn(),
      onHistorySendNow: vi.fn(),
      onHistoryDelete: vi.fn(),
      onHistoryOpenDraft: vi.fn(),
      onHistoryClearSent: vi.fn(),
    }, plannerNavigation)));

    expect(screen.getByTestId('quickplanner-current-section')).toHaveTextContent(view === 'planner' ? 'quick-plan' : 'studio');
    fireEvent.click(screen.getByRole('button', { name: 'Studio from Quick Plan' }));
    expect(onViewChange).toHaveBeenCalledWith('studio');
    fireEvent.click(screen.getByRole('button', { name: 'Quick Plan from Studio' }));
    expect(onViewChange).toHaveBeenCalledWith('planner');

    fireEvent.click(screen.getByRole('button', { name: 'Posts from Quick Plan' }));
    expect(screen.getByRole('region', { name: 'Posts' })).toBeInTheDocument();
    expect(document.querySelector('.history-drawer-backdrop')).not.toBeInTheDocument();
    expect(document.querySelector('.product-shell-content')).toHaveClass('is-posts');
    openHistorySourceMenu();
    const activeSource = getHistorySourceOption(view === 'planner' ? 'personal' : 'workspace');
    expect(activeSource).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(activeSource);
    expect(screen.getByTestId('quickplanner-current-section')).toHaveTextContent('posts');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('region', { name: 'Posts' })).toBeInTheDocument();
    expect(screen.getByTestId('quickplanner-current-section')).toHaveTextContent('posts');

    fireEvent.click(screen.getByRole('button', { name: 'Posts' }));
    expect(screen.queryByRole('region', { name: 'Posts' })).not.toBeInTheDocument();
    expect(screen.getByTestId('quickplanner-current-section')).toHaveTextContent(view === 'planner' ? 'quick-plan' : 'studio');

    fireEvent.click(screen.getByRole('button', { name: 'Posts from Quick Plan' }));
    fireEvent.click(screen.getByRole('button', { name: 'Settings from Quick Plan' }));
    expect(onOpenSettings).toHaveBeenCalledOnce();

    expect(screen.queryByRole('region', { name: 'Posts' })).not.toBeInTheDocument();
  });

  it('closes Posts before navigating to Studio or Settings from Quick Planner', () => {
    const onOpenSettings = vi.fn();
    const onViewChange = vi.fn();
    const plannerNavigation = createElement(QuickPlannerNavigationTestButtons);

    render(createElement(LocaleProvider, null, createElement(AppShell, {
      view: 'planner',
      onViewChange,
      connected: true,
      authBusy: false,
      isConfirmingLogout: false,
      setIsConfirmingLogout: vi.fn(),
      setShowAuthForm: vi.fn(),
      handleDisconnect: async () => undefined,
      handleForgetAccount: async () => undefined,
      onOpenSettings,
      historyRecords: [],
      onHistoryCancel: vi.fn(),
      onHistoryReschedule: vi.fn(),
      onHistorySendNow: vi.fn(),
      onHistoryDelete: vi.fn(),
      onHistoryOpenDraft: vi.fn(),
      onHistoryClearSent: vi.fn(),
    }, plannerNavigation)));

    fireEvent.click(screen.getByRole('button', { name: 'Posts from Quick Plan' }));
    expect(screen.getByRole('region', { name: 'Posts' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Studio from Quick Plan' }));
    expect(screen.queryByRole('region', { name: 'Posts' })).not.toBeInTheDocument();
    expect(onViewChange).toHaveBeenCalledWith('studio');

    fireEvent.click(screen.getByRole('button', { name: 'Posts from Quick Plan' }));
    fireEvent.click(screen.getByRole('button', { name: 'Settings from Quick Plan' }));
    expect(screen.queryByRole('region', { name: 'Posts' })).not.toBeInTheDocument();
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });

  it('closes Posts when Remember me changes the parent view to Planner', async () => {
    let currentView: 'planner' | 'posts' = 'planner';
    let rerenderShell: (ui: React.ReactNode) => void = () => undefined;
    const renderShell = (isConfirmingLogout = false) => createElement(LocaleProvider, null, createElement(AppShell, {
      view: currentView,
      onViewChange: (view) => {
        currentView = view === 'posts' ? 'posts' : 'planner';
        rerenderShell(renderShell());
      },
      connected: true,
      authBusy: false,
      isConfirmingLogout,
      setIsConfirmingLogout: vi.fn(),
      setShowAuthForm: vi.fn(),
      handleDisconnect: async () => {
        currentView = 'planner';
        rerenderShell(renderShell());
      },
      handleForgetAccount: async () => undefined,
      onOpenSettings: vi.fn(),
      historyRecords: [],
      onHistoryCancel: vi.fn(),
      onHistoryReschedule: vi.fn(),
      onHistorySendNow: vi.fn(),
      onHistoryDelete: vi.fn(),
      onHistoryOpenDraft: vi.fn(),
      onHistoryClearSent: vi.fn(),
    }, createElement(QuickPlannerNavigationTestButtons)));
    const view = render(renderShell());
    rerenderShell = view.rerender;

    fireEvent.click(screen.getByRole('button', { name: 'Posts from Quick Plan' }));
    expect(screen.getByRole('region', { name: 'Posts' })).toBeInTheDocument();

    rerenderShell(renderShell(true));
    fireEvent.click(screen.getByRole('button', { name: 'Remember me' }));

    await waitFor(() => {
      expect(screen.queryByRole('region', { name: 'Posts' })).not.toBeInTheDocument();
    });
  });

  it('uses the active product on the first Posts open, then keeps the manually selected source', () => {
    window.localStorage.removeItem('xmsgi-history-filters');
    const onViewChange = vi.fn();
    const plannerNavigation = createElement(QuickPlannerNavigationTestButtons);

    render(createElement(LocaleProvider, null, createElement(AppShell, {
      view: 'planner',
      onViewChange,
      connected: true,
      authBusy: false,
      isConfirmingLogout: false,
      setIsConfirmingLogout: vi.fn(),
      setShowAuthForm: vi.fn(),
      handleDisconnect: async () => undefined,
      handleForgetAccount: async () => undefined,
      onOpenSettings: vi.fn(),
      historyRecords: [],
      onHistoryCancel: vi.fn(),
      onHistoryReschedule: vi.fn(),
      onHistorySendNow: vi.fn(),
      onHistoryDelete: vi.fn(),
      onHistoryOpenDraft: vi.fn(),
      onHistoryClearSent: vi.fn(),
    }, plannerNavigation)));

    fireEvent.click(screen.getByRole('button', { name: 'Posts from Quick Plan' }));
    openHistorySourceMenu();
    expect(getHistorySourceOption('personal')).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(getHistorySourceOption('workspace'));
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Studio from Quick Plan' }));
    fireEvent.click(screen.getByRole('button', { name: 'Posts' }));

    openHistorySourceMenu();
    const selectedWorkspace = getHistorySourceOption('workspace');
    expect(selectedWorkspace).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(selectedWorkspace);
  });

  it('renders Posts as a standalone page and does not close it on Escape', () => {
    persistPostsReturnView('planner');
    const onViewChange = vi.fn();
    const { container } = render(createElement(LocaleProvider, null, createElement(AppShell, {
      view: 'posts',
      onViewChange,
      connected: true,
      authBusy: false,
      isConfirmingLogout: false,
      setIsConfirmingLogout: vi.fn(),
      setShowAuthForm: vi.fn(),
      handleDisconnect: async () => undefined,
      handleForgetAccount: async () => undefined,
      onOpenSettings: vi.fn(),
      historyRecords: [],
      onHistoryCancel: vi.fn(),
      onHistoryReschedule: vi.fn(),
      onHistorySendNow: vi.fn(),
      onHistoryDelete: vi.fn(),
      onHistoryOpenDraft: vi.fn(),
      onHistoryClearSent: vi.fn(),
    }, createElement(QuickPlannerNavigationTestButtons))));

    expect(screen.getByRole('region', { name: 'Posts' })).toBeInTheDocument();
    expect(container.querySelector('.product-shell')).toHaveClass('planner-shell');
    expect(container.querySelector('.history-drawer-backdrop')).not.toBeInTheDocument();
    expect(container.querySelector('.product-shell-content')).toHaveClass('is-posts');
    expect(container.querySelector('.history-drawer')?.parentElement).toBe(container.querySelector('.product-shell-content'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('region', { name: 'Posts' })).toBeInTheDocument();
    expect(onViewChange).not.toHaveBeenCalledWith('planner');
  });

  it('closes Posts before topbar Studio and Settings navigation', () => {
    window.localStorage.removeItem('xmsgi-history-drawer-open');
    const onOpenSettings = vi.fn();
    const onViewChange = vi.fn();
    const shellProps: Parameters<typeof AppShell>[0] = {
      view: 'planner',
      onViewChange,
      connected: true,
      authBusy: false,
      isConfirmingLogout: false,
      setIsConfirmingLogout: vi.fn(),
      setShowAuthForm: vi.fn(),
      handleDisconnect: async () => undefined,
      handleForgetAccount: async () => undefined,
      onOpenSettings,
      historyRecords: [],
      onHistoryCancel: vi.fn(),
      onHistoryReschedule: vi.fn(),
      onHistorySendNow: vi.fn(),
      onHistoryDelete: vi.fn(),
      onHistoryOpenDraft: vi.fn(),
      onHistoryClearSent: vi.fn(),
    };
    const view = render(createElement(LocaleProvider, null, createElement(AppShell, shellProps, createElement('div', null, 'Quick Planner'))));

    fireEvent.click(screen.getByRole('button', { name: 'Posts' }));
    expect(screen.getByRole('region', { name: 'Posts' })).toBeInTheDocument();
    view.rerender(createElement(LocaleProvider, null, createElement(AppShell, { ...shellProps, view: 'posts' }, createElement('div', null, 'Posts'))));
    fireEvent.click(view.container.querySelector('.product-mode-switch') as HTMLButtonElement);
    expect(onViewChange).toHaveBeenLastCalledWith('studio');
    view.rerender(createElement(LocaleProvider, null, createElement(AppShell, { ...shellProps, view: 'studio' }, createElement('div', null, 'Studio'))));
    expect(screen.queryByRole('region', { name: 'Posts' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Posts' }));
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(onOpenSettings).toHaveBeenCalledOnce();
    expect(screen.queryByRole('region', { name: 'Posts' })).not.toBeInTheDocument();
  });

  it('shows the current Telegram profile photo in the topbar', async () => {
    window.localStorage.removeItem(accountAvatarCacheKey);
    const previousTelegram = Object.getOwnPropertyDescriptor(window, 'telegram');
    let resolveAvatar: ((value: { success: boolean; avatarDataUrl: string }) => void) | undefined;
    const getAccountAvatar = vi.fn(() => new Promise<{ success: boolean; avatarDataUrl: string }>((resolve) => {
      resolveAvatar = resolve;
    }));
    Object.defineProperty(window, 'telegram', {
      configurable: true,
      value: { getAccountAvatar },
    });
    const onOpenSettings = vi.fn();
    const setIsConfirmingLogout = vi.fn();
    const view = render(createElement(LocaleProvider, null, createElement(AppShell, {
      view: 'studio',
      onViewChange: vi.fn(),
      connected: true,
      authBusy: false,
      isConfirmingLogout: false,
      setIsConfirmingLogout,
      setShowAuthForm: vi.fn(),
      handleDisconnect: async () => undefined,
      handleForgetAccount: async () => undefined,
      onOpenSettings,
      historyRecords: [],
      onHistoryCancel: vi.fn(),
      onHistoryReschedule: vi.fn(),
      onHistorySendNow: vi.fn(),
      onHistoryDelete: vi.fn(),
      onHistoryOpenDraft: vi.fn(),
      onHistoryClearSent: vi.fn(),
    }, createElement('div', null, 'Current screen'))));

    try {
      const loadingIcon = view.container.querySelector('.topbar-logout-photo-fallback svg');
      expect(loadingIcon).toHaveAttribute('width', '38');
      expect(loadingIcon).toHaveAttribute('height', '38');
      resolveAvatar?.({ success: true, avatarDataUrl: 'data:image/jpeg;base64,account-photo' });
      await waitFor(() => {
        expect(view.container.querySelector('.topbar-logout-photo-image')).toHaveAttribute('src', 'data:image/jpeg;base64,account-photo');
      });
      expect(getAccountAvatar).toHaveBeenCalledOnce();
      expect(window.localStorage.getItem(accountAvatarCacheKey)).toBe('data:image/jpeg;base64,account-photo');

      const labels = Array.from(view.container.querySelectorAll('.topbar-actions .action-label'))
        .map((label) => label.textContent);
      expect(labels).toEqual(['Posts', 'Settings']);
      const photoTrigger = view.container.querySelector('.topbar-logout-photo');
      expect(photoTrigger).not.toBeNull();
      expect(photoTrigger?.querySelector('.topbar-logout-photo-image')).not.toBeNull();
      expect(photoTrigger?.querySelector('.topbar-logout-photo-ring')).not.toBeNull();
      expect(photoTrigger?.querySelector('.topbar-logout-photo-telegram')).toBeNull();
      const logoutButton = screen.getByRole('button', { name: 'Log out' });
      expect(logoutButton).toHaveAttribute('aria-haspopup', 'dialog');
      expect(logoutButton).toHaveClass('topbar-logout-photo');

      fireEvent.click(logoutButton);
      expect(setIsConfirmingLogout).toHaveBeenCalledWith(true);
      expect(onOpenSettings).not.toHaveBeenCalled();

      expect(view.container.querySelector('.product-section-title-detached')).not.toBeInTheDocument();
    } finally {
      view.unmount();
      window.localStorage.removeItem(accountAvatarCacheKey);
      if (previousTelegram) Object.defineProperty(window, 'telegram', previousTelegram);
      else Reflect.deleteProperty(window, 'telegram');
    }
  });

  it.each([
    [null, ''],
    ['reconnecting', 'is-reconnecting'],
    ['offline', 'is-offline'],
  ] as const)('shows the avatar status for connection state %s', (connectionRecoveryStatus, statusClass) => {
    const view = render(createElement(LocaleProvider, null, createElement(AppShell, {
      view: 'studio',
      onViewChange: vi.fn(),
      connected: true,
      connectionRecoveryStatus,
      authBusy: false,
      isConfirmingLogout: false,
      setIsConfirmingLogout: vi.fn(),
      setShowAuthForm: vi.fn(),
      handleDisconnect: async () => undefined,
      handleForgetAccount: async () => undefined,
      onOpenSettings: vi.fn(),
      historyRecords: [],
      onHistoryCancel: vi.fn(),
      onHistoryReschedule: vi.fn(),
      onHistorySendNow: vi.fn(),
      onHistoryDelete: vi.fn(),
      onHistoryOpenDraft: vi.fn(),
      onHistoryClearSent: vi.fn(),
    }, createElement('div', null, 'Studio'))));

    const status = view.container.querySelector('.topbar-logout-photo-status');
    expect(status).not.toBeNull();
    if (statusClass) expect(status).toHaveClass(statusClass);
    else expect(status).not.toHaveClass('is-reconnecting', 'is-offline');
  });

  it('marks the avatar status red while an error notification is visible', () => {
    const shellProps: Parameters<typeof AppShell>[0] = {
      view: 'studio',
      onViewChange: vi.fn(),
      connected: true,
      notification: { message: 'Could not publish.', title: 'Publish failed', type: 'error', visible: true },
      authBusy: false,
      isConfirmingLogout: false,
      setIsConfirmingLogout: vi.fn(),
      setShowAuthForm: vi.fn(),
      handleDisconnect: async () => undefined,
      handleForgetAccount: async () => undefined,
      onOpenSettings: vi.fn(),
      historyRecords: [],
      onHistoryCancel: vi.fn(),
      onHistoryReschedule: vi.fn(),
      onHistorySendNow: vi.fn(),
      onHistoryDelete: vi.fn(),
      onHistoryOpenDraft: vi.fn(),
      onHistoryClearSent: vi.fn(),
    };

    const view = render(createElement(LocaleProvider, null, createElement(AppShell, shellProps, createElement('div', null, 'Studio'))));

    expect(view.container.querySelector('.topbar-logout-photo-status')).toHaveClass('has-error');

    view.rerender(createElement(LocaleProvider, null, createElement(AppShell, {
      ...shellProps,
      notification: { ...shellProps.notification!, visible: false },
    }, createElement('div', null, 'Studio'))));

    expect(view.container.querySelector('.topbar-logout-photo-status')).not.toHaveClass('has-error');
  });

  it('shows the cached Telegram photo immediately while refreshing it', () => {
    const previousTelegram = Object.getOwnPropertyDescriptor(window, 'telegram');
    const cachedAvatar = 'data:image/jpeg;base64,cached-account-photo';
    const getAccountAvatar = vi.fn(() => new Promise<{ success: boolean; avatarDataUrl: string }>(() => undefined));
    window.localStorage.setItem(accountAvatarCacheKey, cachedAvatar);
    Object.defineProperty(window, 'telegram', {
      configurable: true,
      value: { getAccountAvatar },
    });

    const view = render(createElement(LocaleProvider, null, createElement(AppShell, {
      view: 'studio',
      onViewChange: vi.fn(),
      connected: true,
      authBusy: false,
      isConfirmingLogout: false,
      setIsConfirmingLogout: vi.fn(),
      setShowAuthForm: vi.fn(),
      handleDisconnect: async () => undefined,
      handleForgetAccount: async () => undefined,
      onOpenSettings: vi.fn(),
      historyRecords: [],
      onHistoryCancel: vi.fn(),
      onHistoryReschedule: vi.fn(),
      onHistorySendNow: vi.fn(),
      onHistoryDelete: vi.fn(),
      onHistoryOpenDraft: vi.fn(),
      onHistoryClearSent: vi.fn(),
    }, createElement('div', null, 'Current screen'))));

    try {
      expect(view.container.querySelector('.topbar-logout-photo-image')).toHaveAttribute('src', cachedAvatar);
      expect(getAccountAvatar).toHaveBeenCalledOnce();
    } finally {
      view.unmount();
      window.localStorage.removeItem(accountAvatarCacheKey);
      if (previousTelegram) Object.defineProperty(window, 'telegram', previousTelegram);
      else Reflect.deleteProperty(window, 'telegram');
    }
  });

  it('renders the airy sign-out window with sign-out choices and no cancel button', () => {
    const onCancel = vi.fn();
    const onDisconnect = vi.fn(async () => undefined);
    const onForget = vi.fn(async () => undefined);
    const setShowAuthForm = vi.fn();
    const view = render(createElement(LocaleProvider, null, createElement(AppShell, {
      view: 'studio',
      onViewChange: vi.fn(),
      connected: true,
      authBusy: false,
      isConfirmingLogout: true,
      setIsConfirmingLogout: onCancel,
      setShowAuthForm,
      handleDisconnect: onDisconnect,
      handleForgetAccount: onForget,
      onOpenSettings: vi.fn(),
      historyRecords: [],
      onHistoryCancel: vi.fn(),
      onHistoryReschedule: vi.fn(),
      onHistorySendNow: vi.fn(),
      onHistoryDelete: vi.fn(),
      onHistoryOpenDraft: vi.fn(),
      onHistoryClearSent: vi.fn(),
    }, createElement('div', null, 'Current screen'))));

    const modal = screen.getByRole('dialog', { name: 'Sign out?' });
    expect(modal).toHaveClass('topbar-logout-modal');
    expect(modal).toHaveAttribute('aria-modal', 'true');
    expect(view.container.querySelector('.topbar-logout-modal-backdrop')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    expect(Array.from(modal.querySelectorAll('.topbar-logout-modal-exit-choices button'))
      .map((button) => button.textContent?.trim()))
      .toEqual(['Forget me', 'Remember me']);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledWith(false);

    fireEvent.click(screen.getByRole('button', { name: 'Remember me' }));
    expect(setShowAuthForm).toHaveBeenCalledWith(false);
    expect(onDisconnect).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Forget me' }));
    expect(setShowAuthForm).toHaveBeenCalledWith(false);
    expect(onForget).toHaveBeenCalledOnce();
    view.unmount();
  });

  it('does not add a section title below the topbar on the quick planner screen', () => {
    const view = render(createElement(LocaleProvider, null, createElement(AppShell, {
      view: 'planner',
      onViewChange: vi.fn(),
      connected: true,
      authBusy: false,
      isConfirmingLogout: false,
      setIsConfirmingLogout: vi.fn(),
      setShowAuthForm: vi.fn(),
      handleDisconnect: async () => undefined,
      handleForgetAccount: async () => undefined,
      onOpenSettings: vi.fn(),
      historyRecords: [],
      onHistoryCancel: vi.fn(),
      onHistoryReschedule: vi.fn(),
      onHistorySendNow: vi.fn(),
      onHistoryDelete: vi.fn(),
      onHistoryOpenDraft: vi.fn(),
      onHistoryClearSent: vi.fn(),
    }, createElement('div', null, 'Planner canvas'))));

    expect(view.container.querySelector('.product-section-title-detached')).not.toBeInTheDocument();
    expect(screen.getByText('Planner canvas')).toBeInTheDocument();
  });

  it('hides the Planner title on the login and return screen', () => {
    const view = render(createElement(LocaleProvider, null, createElement(AppShell, {
      view: 'planner',
      browserDraftMode: false,
      onViewChange: vi.fn(),
      connected: false,
      authBusy: false,
      isConfirmingLogout: false,
      setIsConfirmingLogout: vi.fn(),
      setShowAuthForm: vi.fn(),
      handleDisconnect: async () => undefined,
      handleForgetAccount: async () => undefined,
      onOpenSettings: vi.fn(),
      historyRecords: [],
      onHistoryCancel: vi.fn(),
      onHistoryReschedule: vi.fn(),
      onHistorySendNow: vi.fn(),
      onHistoryDelete: vi.fn(),
      onHistoryOpenDraft: vi.fn(),
      onHistoryClearSent: vi.fn(),
    }, createElement('div', null, 'Login screen'))));

    expect(view.container.querySelector('.product-section-title-detached')).not.toBeInTheDocument();
  });

  it('shows only Done in the topbar while Settings is open', () => {
    const onCloseSettings = vi.fn();
    const view = render(createElement(LocaleProvider, null, createElement(AppShell, {
      view: 'planner',
      onViewChange: vi.fn(),
      settingsOpen: true,
      onCloseSettings,
      connected: true,
      authBusy: false,
      isConfirmingLogout: false,
      setIsConfirmingLogout: vi.fn(),
      setShowAuthForm: vi.fn(),
      handleDisconnect: async () => undefined,
      handleForgetAccount: async () => undefined,
      onOpenSettings: vi.fn(),
      historyRecords: [],
      onHistoryCancel: vi.fn(),
      onHistoryReschedule: vi.fn(),
      onHistorySendNow: vi.fn(),
      onHistoryDelete: vi.fn(),
      onHistoryOpenDraft: vi.fn(),
      onHistoryClearSent: vi.fn(),
    }, createElement('div', null, 'Settings page'))));

    const actionButtons = Array.from(view.container.querySelectorAll('.topbar-actions button'));
    expect(actionButtons).toHaveLength(1);
    expect(actionButtons[0]).toHaveAccessibleName('Done');
    expect(view.container.querySelector('.product-mode-switch')).not.toBeInTheDocument();
    expect(view.container.querySelector('.product-section-title')).not.toBeInTheDocument();
    expect(view.container.querySelector('.settings-view-done')).not.toBeInTheDocument();

    fireEvent.click(actionButtons[0]);
    expect(onCloseSettings).toHaveBeenCalledOnce();
    view.unmount();
  });

  it('does not restore a modal Posts drawer from a previous session', () => {
    const props = {
      view: 'studio' as const,
      onViewChange: vi.fn(),
      connected: true,
      authBusy: false,
      isConfirmingLogout: false,
      setIsConfirmingLogout: vi.fn(),
      setShowAuthForm: vi.fn(),
      handleDisconnect: async () => undefined,
      handleForgetAccount: async () => undefined,
      onOpenSettings: vi.fn(),
      historyRecords: [],
      onHistoryCancel: vi.fn(),
      onHistoryReschedule: vi.fn(),
      onHistorySendNow: vi.fn(),
      onHistoryDelete: vi.fn(),
      onHistoryOpenDraft: vi.fn(),
      onHistoryClearSent: vi.fn(),
    };
    const renderShell = () => render(createElement(
      LocaleProvider,
      null,
      createElement(AppShell, props, createElement('div', null, 'Current screen')),
    ));
    const firstView = renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Posts' }));
    expect(screen.getByRole('region', { name: 'Posts' })).toBeInTheDocument();
    firstView.unmount();

    window.localStorage.setItem('xmsgi-history-drawer-open', 'true');
    const secondView = renderShell();
    try {
      expect(screen.queryByRole('region', { name: 'Posts' })).not.toBeInTheDocument();
    } finally {
      secondView.unmount();
    }
  });

  it('reserves the topbar height while connection status is pending', () => {
    const props = {
      view: 'studio' as const,
      onViewChange: vi.fn(),
      connected: false,
      headerPending: true,
      authBusy: false,
      isConfirmingLogout: false,
      setIsConfirmingLogout: vi.fn(),
      setShowAuthForm: vi.fn(),
      handleDisconnect: async () => undefined,
      handleForgetAccount: async () => undefined,
      onOpenSettings: vi.fn(),
      historyRecords: [],
      onHistoryCancel: vi.fn(),
      onHistoryReschedule: vi.fn(),
      onHistorySendNow: vi.fn(),
      onHistoryDelete: vi.fn(),
      onHistoryOpenDraft: vi.fn(),
      onHistoryClearSent: vi.fn(),
    };
    const view = render(createElement(LocaleProvider, null, createElement(AppShell, props, createElement('div', null, 'Studio'))));

    expect(view.container.querySelector('.topbar-placeholder')).toBeInTheDocument();

    view.rerender(createElement(LocaleProvider, null, createElement(AppShell, { ...props, connected: true, headerPending: false }, createElement('div', null, 'Studio'))));

    expect(view.container.querySelector('.topbar-placeholder')).not.toBeInTheDocument();
    expect(view.container.querySelector('.topbar')).toBeInTheDocument();
  });
});
