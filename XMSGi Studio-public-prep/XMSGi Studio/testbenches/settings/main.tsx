import type { TelegramStatusSnapshot } from '@/hooks/useTelegramAuth';
import { useLocale } from '@/lib/i18n';
import { SettingsPage } from '@/pages/SettingsPage';
import { TestbenchPageSelector } from '../shared/TestbenchNavigation';
import { TESTBENCH_COLOR_THEME_STORAGE_KEY } from '../shared/testbenchTheme';
import '../shared/TestbenchNavigation.css';
import '../../src/index.css';
import '../../src/styles/colorThemes.css';
import './main.css';

export function SettingsTestbench() {
  const { locale } = useLocale();
  const isRussian = locale === 'ru';
  const telegramStatus: TelegramStatusSnapshot = { accountId: 'settings-testbench', status: 'normal' };

  return (
    <div className="settings-testbench">
      <nav className="testbench-navigation" aria-label={isRussian ? 'Настройки стенда' : 'Stand controls'}>
        <TestbenchPageSelector locale={locale} currentPage="settings" />
        <a className="settings-testbench-exit" href="/">{isRussian ? 'Выход' : 'Exit'}</a>
      </nav>
      <SettingsPage
        colorThemeStorageKey={TESTBENCH_COLOR_THEME_STORAGE_KEY}
        onClose={() => undefined}
        accountName=""
        telegramUsername=""
        telegramConnected={false}
        telegramConnecting={false}
        telegramAuthStep="phone"
        telegramPhoneNumber=""
        telegramPhoneCode=""
        telegramTwoFactorPassword=""
        telegramAuthBusy={false}
        telegramAuthError=""
        telegramStatus={telegramStatus}
        telegramCredentials={{ hasCredentials: false, hasSession: false, connected: false, signedOut: false }}
        telegramApiId=""
        telegramApiHash=""
        telegramCredentialsBusy={false}
        telegramCredentialsError=""
        onTelegramApiIdChange={() => undefined}
        onTelegramApiHashChange={() => undefined}
        onSaveTelegramCredentials={() => undefined}
        onTelegramPhoneNumberChange={() => undefined}
        onTelegramPhoneCodeChange={() => undefined}
        onTelegramTwoFactorPasswordChange={() => undefined}
        onTelegramAuth={() => undefined}
        onTelegramReconnect={() => undefined}
        onTelegramDisconnect={() => undefined}
      />
    </div>
  );
}
