import { describe, expect, it } from 'vitest';
import { getTelegramStatusPresentation } from './AppShell';

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
