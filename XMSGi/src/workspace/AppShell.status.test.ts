import { createElement } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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

    fireEvent.click(screen.getByRole('button', { name: 'История' }));

    expect(screen.getByRole('dialog', { name: 'История' })).toBeInTheDocument();
    expect(screen.getByText('Current screen')).toBeInTheDocument();
  });
});
