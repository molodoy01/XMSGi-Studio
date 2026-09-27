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
    />
  );
}
