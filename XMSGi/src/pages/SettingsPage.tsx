import { SettingsView } from '@/components/SettingsView';
import type { TelegramStatusSnapshot } from '@/hooks/useTelegramAuth';

type SettingsPageProps = {
  onClose: () => void;
  accountName: string;
  telegramStatus: TelegramStatusSnapshot;
  activeAccountId: 'account-1' | 'account-2';
  onAccountChange: (accountId: 'account-1' | 'account-2') => void;
  geminiSettings: {
    hasKey: boolean;
    maskedKey: string;
    enabled: boolean;
    encryptionAvailable: boolean;
  };
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

export function SettingsPage({
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
}: SettingsPageProps) {
  return (
    <SettingsView
      onClose={onClose}
      accountName={accountName}
      telegramStatus={telegramStatus}
      activeAccountId={activeAccountId}
      onAccountChange={onAccountChange}
      geminiSettings={geminiSettings}
      settingsKey={settingsKey}
      settingsBusy={settingsBusy}
      settingsError={settingsError}
      onSettingsKeyChange={onSettingsKeyChange}
      onSaveGeminiKey={onSaveGeminiKey}
      onRemoveGeminiKey={onRemoveGeminiKey}
      onToggleAssistant={onToggleAssistant}
      telegramCredentials={telegramCredentials}
      telegramApiId={telegramApiId}
      telegramApiHash={telegramApiHash}
      telegramCredentialsBusy={telegramCredentialsBusy}
      telegramCredentialsError={telegramCredentialsError}
      onTelegramApiIdChange={onTelegramApiIdChange}
      onTelegramApiHashChange={onTelegramApiHashChange}
      onSaveTelegramCredentials={onSaveTelegramCredentials}
    />
  );
}
