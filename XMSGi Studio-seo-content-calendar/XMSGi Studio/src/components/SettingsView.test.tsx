import { fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TelegramStatusSnapshot } from '@/hooks/useTelegramAuth';
import { LocaleProvider } from '@/lib/i18n';
import { EDITOR_APPEARANCE_STORAGE_KEY } from '@shared/editorAppearance';
import { COLOR_THEME_STORAGE_KEY } from '@/lib/colorTheme';
import { SettingsView } from './SettingsView';

const themeTransitionStyles = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../styles/tokens.css'),
  'utf8',
);

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
        telegramAuthNotice={false}
        telegramStatus={{ accountId: 'account-1', status: 'normal' } satisfies TelegramStatusSnapshot}
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

beforeEach(() => {
  localStorage.removeItem(EDITOR_APPEARANCE_STORAGE_KEY);
  localStorage.removeItem(COLOR_THEME_STORAGE_KEY);
  document.documentElement.dataset.theme = 'light';
  delete document.documentElement.dataset.themeVariant;
  document.documentElement.style.colorScheme = 'light';
  document.documentElement.classList.remove('is-theme-transitioning');
});

describe('SettingsView Telegram integration', () => {
  it('shows the Studio tagline and requested Settings version', () => {
    renderSettings();

    expect(screen.getByText('XMSGi Studio — Create messages, save ideas, schedule posts, and keep everything under control in one convenient workspace.')).toBeInTheDocument();
    expect(screen.getByText('Version 1.3.6')).toBeInTheDocument();
  });

  it('aligns the language selector to the right of its heading', () => {
    const { container } = renderSettings();
    const heading = within(container).getByRole('heading', { name: 'Language' });
    const switchGroup = within(container).getByRole('group', { name: 'Language' });

    expect(heading.parentElement).toHaveClass('settings-language-heading-row');
    expect(heading.parentElement).toContainElement(switchGroup);
  });

  it('shows the requested Russian Studio description in About', () => {
    const originalLocale = window.localStorage.getItem('awaitmsg_locale');
    window.localStorage.setItem('awaitmsg_locale', 'ru');

    try {
      renderSettings();
      expect(screen.getByText('XMSGi Studio — Создавайте сообщения, храните идеи, планируйте отправку и держите всё под контролем — в одном удобном рабочем пространстве.')).toBeInTheDocument();
    } finally {
      if (originalLocale === null) window.localStorage.removeItem('awaitmsg_locale');
      else window.localStorage.setItem('awaitmsg_locale', originalLocale);
    }
  });

  it('shows the saved Telegram API_ID without exposing the API hash', () => {
    const { container } = renderSettings({
      telegramCredentials: { hasCredentials: true, apiId: '17349', hasSession: true, connected: true, signedOut: false },
    });
    fireEvent.click(container.querySelector('.settings-telegram-summary')!);
    fireEvent.click(screen.getByText('Advanced API settings'));

    const credentialsDetails = document.querySelector('.telegram-manager-details');
    expect(credentialsDetails).toHaveTextContent('API_ID: 1734••••');
    expect(credentialsDetails).not.toHaveTextContent('17349');
    expect(credentialsDetails).not.toHaveTextContent('API_HASH');
  });

  it('labels the theme switch in English and Russian', () => {
    const originalLocale = window.localStorage.getItem('awaitmsg_locale');

    try {
      window.localStorage.setItem('awaitmsg_locale', 'en');
      const english = renderSettings();
      expect(within(english.container).getByText('App theme')).toBeInTheDocument();
      expect(within(english.container).getByText('Choose a light or dark theme for the entire app.')).toBeInTheDocument();
      expect(within(english.container).getByRole('group', { name: 'Color' })).toBeInTheDocument();
      expect(within(english.container).getByRole('button', { name: 'Light' })).toBeInTheDocument();
      expect(within(english.container).getByRole('button', { name: 'Dark' })).toBeInTheDocument();
      expect(within(english.container).queryByRole('button', { name: /graphite/i })).not.toBeInTheDocument();

      window.localStorage.setItem('awaitmsg_locale', 'ru');
      const russian = renderSettings();
      expect(within(russian.container).getByText('Тема приложения')).toBeInTheDocument();
      expect(within(russian.container).getByText('Выберите светлую или тёмную тему для всего приложения.')).toBeInTheDocument();
      expect(within(russian.container).getByRole('group', { name: 'Цвет' })).toBeInTheDocument();
      expect(within(russian.container).getByRole('button', { name: 'Светлая' })).toBeInTheDocument();
      expect(within(russian.container).getByRole('button', { name: 'Тёмная' })).toBeInTheDocument();
      expect(within(russian.container).queryByRole('button', { name: /графит/i })).not.toBeInTheDocument();
    } finally {
      if (originalLocale === null) window.localStorage.removeItem('awaitmsg_locale');
      else window.localStorage.setItem('awaitmsg_locale', originalLocale);
    }
  });

  it('keeps the appearance section free of framed previews and custom color controls', () => {
    const { container } = renderSettings();
    const appearance = screen.getByRole('region', { name: 'App theme' });

    expect(within(appearance).queryByRole('region', { name: 'Editor preview' })).not.toBeInTheDocument();
    expect(appearance).not.toHaveTextContent('Saved on this device');
    expect(container.querySelector('.settings-editor-mode-colors')).not.toBeInTheDocument();
    expect(container.querySelector('input[type="color"]')).not.toBeInTheDocument();
  });

  it('switches and persists the app color theme', () => {
    renderSettings();

    const themeGroup = screen.getByRole('group', { name: 'Color' });
    const darkButton = within(themeGroup).getByRole('button', { name: 'Dark' });
    const lightButton = within(themeGroup).getByRole('button', { name: 'Light' });

    fireEvent.click(darkButton);
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
    expect(document.documentElement).toHaveClass('is-theme-transitioning');
    expect(localStorage.getItem(COLOR_THEME_STORAGE_KEY)).toBe('dark');
    expect(darkButton).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(lightButton);
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.documentElement.dataset.themeVariant).toBeUndefined();
    expect(localStorage.getItem(COLOR_THEME_STORAGE_KEY)).toBe('light');
    expect(lightButton).toHaveAttribute('aria-pressed', 'true');
  });

  it('uses the shared text color timing throughout Settings', () => {
    const settingsTransitionRule = themeTransitionStyles.match(
      /html\.is-theme-transitioning body :where\(\*\)\s*\{([^}]*)\}/,
    )?.[1] ?? '';

    expect(settingsTransitionRule).toMatch(/transition-duration:\s*320ms/);
    expect(settingsTransitionRule).toMatch(/transition-delay:\s*0ms,\s*0ms/);
    expect(settingsTransitionRule).toMatch(/transition-timing-function:\s*cubic-bezier\(0\.22, 0\.61, 0\.36, 1\)/);
    expect(themeTransitionStyles).not.toMatch(/::view-transition/);
  });

  it('supports an isolated theme storage key for the settings testbench', () => {
    const testbenchThemeStorageKey = 'settings-testbench-theme';
    renderSettings({ colorThemeStorageKey: testbenchThemeStorageKey });

    fireEvent.click(screen.getByRole('button', { name: 'Dark' }));

    expect(localStorage.getItem(testbenchThemeStorageKey)).toBe('dark');
    expect(localStorage.getItem(COLOR_THEME_STORAGE_KEY)).toBeNull();
  });

  it('ignores previously saved custom colors and keeps theme choices unframed', () => {
    localStorage.setItem(EDITOR_APPEARANCE_STORAGE_KEY, JSON.stringify({
      style: 'outline',
      palette: 'custom',
      modeColors: { send: '#287fa6', schedule: '#b482f5', draft: '#f58b37' },
    }));
    renderSettings();
    const appearance = screen.getByRole('region', { name: 'App theme' });

    expect(within(appearance).queryByRole('region', { name: 'Editor preview' })).not.toBeInTheDocument();
    expect(within(appearance).getByRole('group', { name: 'Color' })).toBeInTheDocument();
    expect(within(appearance).queryByRole('group', { name: 'Editor appearance style' })).not.toBeInTheDocument();
    expect(appearance.querySelector('.settings-editor-mode-colors')).not.toBeInTheDocument();
    expect(appearance.querySelectorAll('input[type="color"]')).toHaveLength(0);
  });

  it('keeps API fields out of the main settings screen', () => {
    const { container } = renderSettings();

    const summary = screen.getByRole('button', { name: /alex_example/ });
    expect(summary).toHaveTextContent('Manage');
    expect(summary.querySelector('.settings-telegram-mark')).not.toBeInTheDocument();
    expect(container.querySelector('.settings-telegram-mark')).not.toBeInTheDocument();
    expect(container.querySelector('.telegram-credentials-form')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('API_ID')).not.toBeInTheDocument();
  });

  it('does not open Telegram setup automatically for an empty profile', () => {
    renderSettings({
      telegramConnected: false,
      telegramCredentials: { hasCredentials: false, hasSession: false, connected: false, signedOut: false },
    });

    expect(screen.queryByRole('dialog', { name: 'Manage connection' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('API_ID')).not.toBeInTheDocument();
  });

  it('opens connection controls and reveals API fields only on demand', () => {
    const { onTelegramDisconnect } = renderSettings();

    fireEvent.click(screen.getByRole('button', { name: /alex_example/ }));

    const dialog = screen.getByRole('dialog', { name: 'Manage connection' });
    expect(dialog.parentElement?.parentElement).toBe(document.body);
    expect(Array.from(dialog.querySelectorAll('.telegram-manager-actions > button')).map((button) => button.textContent?.trim()))
      .toEqual(['Disconnect account', 'Cancel']);
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

  it('opens the API credential form for a saved session missing credentials', async () => {
    renderSettings({
      telegramConnected: false,
      telegramCredentials: { hasCredentials: false, hasSession: true, connected: false, signedOut: true },
    });

    const dialog = await screen.findByRole('dialog', { name: 'Manage connection' });
    expect(dialog.querySelector('.telegram-manager-advanced')).toHaveAttribute('open');
    expect(screen.getByLabelText('API_ID')).toBeInTheDocument();
    expect(screen.getByLabelText('API_HASH')).toBeInTheDocument();
  });

  it('opens phone sign-in controls for a remembered account with no session', async () => {
    renderSettings({
      telegramConnected: false,
      telegramCredentials: { hasCredentials: true, hasSession: false, connected: false, signedOut: true },
    });

    const dialog = await screen.findByRole('dialog', { name: 'Manage connection' });
    expect(dialog).toHaveTextContent('Signed out');
    expect(within(dialog).getByLabelText('Phone')).toBeInTheDocument();
  });

  it('shows the two-factor prompt as an informational status in Telegram settings', async () => {
    const message = 'Code accepted. Your Telegram account has two-step verification enabled. Enter your password to continue.';
    renderSettings({
      telegramConnected: false,
      telegramAuthStep: 'password',
      telegramAuthError: message,
      telegramAuthNotice: true,
      telegramCredentials: { hasCredentials: true, hasSession: false, connected: false, signedOut: true },
    });

    const dialog = await screen.findByRole('dialog', { name: 'Manage connection' });
    const notice = within(dialog).getByText(message);

    expect(notice).toHaveAttribute('role', 'status');
    expect(notice).toHaveClass('settings-view-notice');
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
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