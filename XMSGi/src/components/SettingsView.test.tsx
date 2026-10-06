import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { TelegramStatusSnapshot } from '@/hooks/useTelegramAuth';
import { LocaleProvider } from '@/lib/i18n';
import { SettingsView } from './SettingsView';

function renderSettings(overrides: Partial<React.ComponentProps<typeof SettingsView>> = {}) {
  const onTelegramDisconnect = vi.fn();
  const onTelegramReconnect = vi.fn();
  const { container } = render(
    <LocaleProvider>
      <SettingsView
        onClose={vi.fn()}
        accountName="Alex Example"
        telegramUsername="alex_example"
        telegramConnected
        telegramConnecting={false}
        telegramAuthStep="phone"
        telegramPhoneNumber=""
        telegramPhoneCode=""
        telegramTwoFactorPassword=""
        telegramAuthBusy={false}
        telegramAuthError=""
        telegramStatus={{ accountId: 'account-1', status: 'normal' } satisfies TelegramStatusSnapshot}
        geminiSettings={{ hasKey: false, maskedKey: '', enabled: false, encryptionAvailable: true }}
        settingsKey=""
        settingsBusy={false}
        settingsError=""
        onSettingsKeyChange={vi.fn()}
        onSaveGeminiKey={vi.fn()}
        onRemoveGeminiKey={vi.fn()}
        onToggleAssistant={vi.fn()}
        telegramCredentials={{ hasCredentials: true, hasSession: true, connected: true, signedOut: false }}
        telegramApiId=""
        telegramApiHash=""
        telegramCredentialsBusy={false}
        telegramCredentialsError=""
        onTelegramApiIdChange={vi.fn()}
        onTelegramApiHashChange={vi.fn()}
        onSaveTelegramCredentials={vi.fn()}
        onTelegramPhoneNumberChange={vi.fn()}
        onTelegramPhoneCodeChange={vi.fn()}
        onTelegramTwoFactorPasswordChange={vi.fn()}
        onTelegramAuth={vi.fn()}
        onTelegramReconnect={onTelegramReconnect}
        onTelegramDisconnect={onTelegramDisconnect}
        {...overrides}
      />
    </LocaleProvider>,
  );

  return { container, onTelegramDisconnect, onTelegramReconnect };
}

describe('SettingsView Telegram integration', () => {
  it('shows the Studio tagline and requested Settings version', () => {
    renderSettings();

    expect(screen.getByText('XMSGi Studio — Save ideas. Set reminders. Choose the moment. Make it happen.')).toBeInTheDocument();
    expect(screen.getByText('Version 1.1.0')).toBeInTheDocument();
  });

  it('keeps API fields out of the main settings screen', () => {
    const { container } = renderSettings();

    const summary = screen.getByRole('button', { name: /alex_example/ });
    expect(summary).toHaveTextContent('Manage');
    expect(summary.querySelector('.settings-telegram-mark')).not.toBeInTheDocument();
    expect(summary.parentElement?.firstElementChild).toHaveClass('settings-telegram-mark');
    expect(container.querySelector('.telegram-credentials-form')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('API_ID')).not.toBeInTheDocument();
  });

  it('opens connection controls and reveals API fields only on demand', () => {
    const { onTelegramDisconnect } = renderSettings();

    fireEvent.click(screen.getByRole('button', { name: /alex_example/ }));

    const dialog = screen.getByRole('dialog', { name: 'Manage connection' });
    expect(dialog.parentElement?.parentElement).toBe(document.body);
    expect(Array.from(dialog.querySelectorAll('.telegram-manager-actions > button')).map((button) => button.textContent?.trim()))
      .toEqual(['Cancel', 'Disconnect account']);
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect account' }));
    expect(onTelegramDisconnect).toHaveBeenCalledOnce();

    const advancedSettings = document.querySelector('.telegram-manager-advanced') as HTMLDetailsElement;
    const technicalDetails = document.querySelector('.telegram-manager-details');
    expect(advancedSettings.open).toBe(false);
    expect(technicalDetails).not.toBeVisible();
    fireEvent.click(screen.getByText('Advanced API settings'));
    expect(advancedSettings.open).toBe(true);
    expect(technicalDetails).toBeVisible();
    expect(screen.getByLabelText('API_ID')).toBeInTheDocument();
    expect(screen.getByLabelText('API_HASH')).toBeInTheDocument();
  });

  it('offers reconnect for an existing Telegram session when disconnected', () => {
    const { onTelegramReconnect } = renderSettings({
      telegramConnected: false,
      telegramCredentials: { hasCredentials: true, hasSession: true, connected: false, signedOut: false },
    });

    fireEvent.click(screen.getByRole('button', { name: /Not connected/ }));
    expect(screen.queryByText('Ready')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }));

    expect(onTelegramReconnect).toHaveBeenCalledOnce();
  });
});