import type { TelegramStatusSnapshot } from '@/hooks/useTelegramAuth';
import type { TranslationKey } from '@/lib/i18n';

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
