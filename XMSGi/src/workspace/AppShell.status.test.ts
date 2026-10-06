import { createElement } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '@/lib/i18n';
import { AppShell, getTelegramStatusPresentation } from './AppShell';

const baseStatus = {
  accountId: 'telegram-session:active-account',
  status: 'normal' as const,
};

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

describe('shared History Drawer entry point', () => {
  beforeEach(() => {
    window.localStorage.removeItem('xmsgi-history-drawer-open');
  });

  it.each(['planner', 'studio'] as const)('opens the same drawer from %s', (view) => {
    render(createElement(LocaleProvider, null, createElement(AppShell, {
      view,
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

    fireEvent.click(screen.getByRole('button', { name: 'Posts' }));

    expect(screen.getByRole('dialog', { name: 'Публикации' })).toBeInTheDocument();
    expect(screen.getByText('Current screen')).toBeInTheDocument();
  });

  it('orders History, Settings, and Log out in the topbar', () => {
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

    const labels = Array.from(view.container.querySelectorAll('.topbar-actions .action-label'))
      .map((label) => label.textContent);
    expect(labels).toEqual(['Posts', 'Settings', 'Log out']);
    view.unmount();
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

  it('restores the open history drawer after remounting', () => {
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
    expect(window.localStorage.getItem('xmsgi-history-drawer-open')).toBe('true');
    firstView.unmount();

    const secondView = renderShell();
    try {
      expect(screen.getByRole('dialog', { name: 'Публикации' })).toBeInTheDocument();
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
