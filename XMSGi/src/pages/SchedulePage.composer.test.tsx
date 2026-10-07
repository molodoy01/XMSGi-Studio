import { useState, type ComponentProps } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '@/lib/i18n';
import { SchedulePage } from './SchedulePage';

function renderComposer(initialMessage = '', savedMessagesAvailable = true, signedOut = false, connected = !signedOut) {
  const showNotification = vi.fn();
  const handleSchedule = vi.fn();
  const handleWelcomeBack = vi.fn(async () => undefined);
  const setSelectedChat = vi.fn();
  const savedMessagesChat = { id: 'saved-messages', name: 'Saved Messages', type: 'private' as const };
  vi.stubGlobal('telegram', {
    getFilePath: (file: File) => `/attachments/${file.name}`,
    getAvailableEffects: async () => ({
      success: true,
      effects: [{ id: 'effect-1', emoticon: '🎉', premiumRequired: false }],
    }),
  });

  function Harness({ isSuccessPulse = false }: { isSuccessPulse?: boolean }) {
    const [message, setMessage] = useState(initialMessage);
    const props: ComponentProps<typeof SchedulePage> = {
      message,
      setMessage,
      isSettingsOpen: false,
      setIsSettingsOpen: vi.fn(),
      notification: { visible: false, message: '', type: 'info', title: '' },
      closeNotification: vi.fn(),
      connected,
      signedOut,
      returningUserName: signedOut ? 'Alex Example' : '',
      returningUserUsername: signedOut ? 'alex_example' : '',
      connecting: false,
      connectionResolved: true,
      authStep: 'phone',
      showAuthForm: false,
      phoneNumber: '',
      phoneCode: '',
      twoFactorPassword: '',
      authBusy: false,
      authError: '',
      setShowAuthForm: vi.fn(),
      setAuthStep: vi.fn(),
      setPhoneNumber: vi.fn(),
      setPhoneCode: vi.fn(),
      setTwoFactorPassword: vi.fn(),
      setAuthError: vi.fn(),
      handleTelegramAuth: vi.fn(async () => undefined),
      handleWelcomeBack,
      chats: [
        { id: 'chat-1', name: 'Test chat' },
        ...(savedMessagesAvailable ? [savedMessagesChat] : []),
      ],
      selectedChat: { id: 'chat-1', name: 'Test chat' },
      selectedChatPermissions: { canView: true, canSend: true, canSchedule: true },
      setSelectedChat,
      handleAddChat: vi.fn(),
      handleRemoveChat: vi.fn(),
      assistantPrompt: '',
      setAssistantPrompt: vi.fn(),
      assistantResponse: '',
      setAssistantResponse: vi.fn(),
      displayedAssistantResponse: '',
      assistantIntent: null,
      setAssistantIntent: vi.fn(),
      assistantExampleIndex: 0,
      isThinking: false,
      geminiSettings: { enabled: false },
      settingsKey: '',
      setSettingsKey: vi.fn(),
      settingsBusy: false,
      settingsError: '',
      assistantExamples: [],
      handleSaveGeminiKey: vi.fn(),
      handleRemoveGeminiKey: vi.fn(),
      handleToggleAssistant: vi.fn(),
      handleAssistantSubmit: vi.fn(),
      date: '2035-01-15',
      time: '12:30',
      scheduling: false,
      successPulse: isSuccessPulse,
      dateEditedRef: { current: false },
      timeEditedRef: { current: false },
      openPickerRef: { current: null },
      handleSchedule,
      setDate: vi.fn(),
      setTime: vi.fn(),
      showNotification,
    };

    return <SchedulePage {...props} />;
  }

  const result = render(<LocaleProvider><Harness /></LocaleProvider>);
  const editor = result.container.querySelector<HTMLTextAreaElement>('.message-field textarea');
  if (!editor && connected) throw new Error('Production message textarea was not rendered.');

  return {
    ...result,
    editor: editor!,
    handleSchedule,
    handleWelcomeBack,
    setSelectedChat,
    savedMessagesChat,
    showSuccess: () => result.rerender(<LocaleProvider><Harness isSuccessPulse /></LocaleProvider>),
  };
}

describe('SchedulePage production composer', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows the welcome copy and account name as a one-click return action', () => {
    const { container, handleWelcomeBack } = renderComposer('', true, true);
    const accountButton = container.querySelector<HTMLButtonElement>('.returning-user-name');

    expect(container.querySelector('.auth-panel')).toHaveClass('is-returning');
    expect(accountButton).toHaveTextContent('Alex Example');
    expect(container.querySelector('.returning-user-greeting')).toHaveTextContent('WELCOME BACK,');
    expect(container.querySelector('.returning-user-actions')).not.toBeInTheDocument();

    fireEvent.click(accountButton!);
    expect(handleWelcomeBack).toHaveBeenCalledOnce();
  });

  it('shows the localized two-line hero on login and return screens', () => {
    const previousLocale = window.localStorage.getItem('awaitmsg_locale');

    try {
      for (const [locale, main, sub, tagline, taglineSub] of [
        ['en', 'MSGi', 'Studio', 'Create. Shape. Publish.', 'Your Content. Your Studio.'],
        ['ru', 'MSGi', 'Studio', 'Создавай. Формируй. Публикуй.', 'Твой контент. Твоя студия.'],
      ]) {
        window.localStorage.setItem('awaitmsg_locale', locale);
        const login = renderComposer('', true, false, false);
        expect(login.container.querySelector('.auth-brand')).not.toBeInTheDocument();
        expect(login.container.querySelector('.auth-hero-logo-x')).toHaveAttribute('src', expect.stringContaining('xmsgi-logo-master'));
        expect(login.getByRole('img', { name: 'XMSGi' })).toBeInTheDocument();
        expect(login.container.querySelector('.auth-hero-line-main')).toHaveTextContent(main);
        expect(login.container.querySelector('.auth-hero-line-sub')).toHaveTextContent(sub);
        expect(login.container.querySelector('.auth-hero-tagline')).toHaveTextContent(tagline);
        expect(login.container.querySelector('.auth-hero-tagline-sub')).toHaveTextContent(taglineSub);
        login.unmount();

        const returning = renderComposer('', true, true, false);
        expect(returning.container.querySelector('.auth-hero-logo-x')).toHaveAttribute('src', expect.stringContaining('xmsgi-logo-master'));
        expect(returning.getByRole('img', { name: 'XMSGi' })).toBeInTheDocument();
        expect(returning.container.querySelector('.auth-hero-line-main')).toHaveTextContent(main);
        expect(returning.container.querySelector('.auth-hero-line-sub')).toHaveTextContent(sub);
        expect(returning.container.querySelector('.auth-hero-tagline')).toHaveTextContent(tagline);
        expect(returning.container.querySelector('.auth-hero-tagline-sub')).toHaveTextContent(taglineSub);
        returning.unmount();
      }
    } finally {
      if (previousLocale === null) window.localStorage.removeItem('awaitmsg_locale');
      else window.localStorage.setItem('awaitmsg_locale', previousLocale);
    }
  });

  it('pastes into a selected middle range and keeps the caret after the pasted text', () => {
    const { editor } = renderComposer('hello world');
    editor.focus();
    editor.setSelectionRange(6, 11);

    fireEvent.paste(editor, {
      clipboardData: { getData: (type: string) => type === 'text/plain' ? 'friend' : '' },
    });

    expect(editor.value).toBe('hello friend');
    expect(editor.selectionStart).toBe(12);
    expect(editor.selectionEnd).toBe(12);
  });

  it('keeps a long string without spaces in the production composer', () => {
    const { editor } = renderComposer();
    const text = 'a'.repeat(1000);

    fireEvent.change(editor, { target: { value: text } });

    expect(editor.value).toBe(text);
    expect(editor).not.toHaveAttribute('maxLength');
  });

  it('preserves multiline text while editing', () => {
    const { editor } = renderComposer();
    const text = 'first line\nsecond line\nthird line';

    fireEvent.change(editor, { target: { value: text } });

    expect(editor.value).toBe(text);
  });

  it('clears the planner message from the label control', () => {
    const { container, editor } = renderComposer('clear this message');

    fireEvent.click(container.querySelector('.message-clear-button')!);

    expect(editor.value).toBe('');
    expect(container.querySelector('.message-clear-button')).toBeNull();
  });

  it('keeps the three-line message options menu available', () => {
    const { container } = renderComposer();
    const optionsButton = container.querySelector<HTMLButtonElement>('.message-send-button');

    expect(optionsButton).not.toBeNull();
    fireEvent.click(optionsButton!);

    const optionsMenu = screen.getByRole('menu', { name: 'Message options' });
    expect(optionsMenu.parentElement).toBe(document.body);
    expect(optionsMenu.textContent).toContain('Silent sending');
    expect(optionsMenu.textContent).toContain('Effect');
    expect(optionsMenu.textContent).toContain('Create reminder in Saved Messages');
  });

  it('selects Saved Messages immediately when reminder mode is enabled', async () => {
    const { container, editor, savedMessagesChat, setSelectedChat } = renderComposer();
    const pencilLabel = 'Create reminder in Saved Messages';

    expect(container.querySelector('.message-reminder-indicator')).not.toBeInTheDocument();
    fireEvent.click(container.querySelector('.message-send-button')!);
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: pencilLabel }));

    expect(container.querySelector('.message-reminder-indicator')).toBeInTheDocument();
    expect(setSelectedChat).toHaveBeenCalledWith(savedMessagesChat);
    await waitFor(() => expect(editor).toHaveFocus());
  });

  it('disables the reminder option when Saved Messages is unavailable', () => {
    const { container } = renderComposer('', false);
    const pencilLabel = 'Create reminder in Saved Messages';
    fireEvent.click(container.querySelector('.message-send-button')!);

    expect(screen.getByRole('menuitemcheckbox', { name: pencilLabel })).toBeDisabled();
    expect(screen.queryByRole('button', { name: pencilLabel })).not.toBeInTheDocument();
  });

  it('hides the pencil when the reminder menu section is selected again', () => {
    const { container, savedMessagesChat, setSelectedChat } = renderComposer();
    const pencilLabel = 'Create reminder in Saved Messages';
    fireEvent.click(container.querySelector('.message-send-button')!);
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: pencilLabel }));

    fireEvent.click(container.querySelector('.message-send-button')!);
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: pencilLabel }));

    expect(container.querySelector('.message-reminder-indicator')).not.toBeInTheDocument();
    expect(setSelectedChat).toHaveBeenCalledTimes(1);
    expect(setSelectedChat).toHaveBeenCalledWith(savedMessagesChat);
  });

  it('shows available Telegram effects inside the effect submenu', async () => {
    const { container } = renderComposer();
    fireEvent.click(container.querySelector('.message-send-button')!);
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Effect' }));

    const effectsMenu = screen.getByRole('menu', { name: 'Available Telegram effects' });
    expect(effectsMenu.parentElement).toBe(document.body);
    expect(await screen.findByText('🎉')).toBeInTheDocument();
  });

  it('closes the time picker after a successful send or schedule', () => {
    const { container, showSuccess } = renderComposer();
    fireEvent.click(container.querySelector('.moment-time-icon')!);

    expect(screen.getByRole('listbox', { name: 'Choose time' })).toBeInTheDocument();

    showSuccess();

    expect(screen.queryByRole('listbox', { name: 'Choose time' })).not.toBeInTheDocument();
  });

  it('inserts an emoji into the selection and blocks scheduling while the picker is open', () => {
    const { container, editor, handleSchedule } = renderComposer('hello world');
    editor.focus();
    editor.setSelectionRange(6, 11);

    fireEvent.mouseDown(container.querySelector('.message-emoji-button')!);
    fireEvent.click(container.querySelector('.message-emoji-button')!);

    const scheduleButton = container.querySelector<HTMLButtonElement>('.moment-field + .action-button')!;
    expect(scheduleButton).toBeDisabled();
    fireEvent.click(scheduleButton);
    expect(handleSchedule).not.toHaveBeenCalled();

    const emojiButton = container.querySelector<HTMLButtonElement>('.message-emoji-option')!;
    const emoji = emojiButton.textContent ?? '';
    fireEvent.mouseDown(emojiButton);
    fireEvent.click(emojiButton);

    expect(editor.value).toBe(`hello ${emoji}`);
    expect(editor.selectionStart).toBe(6 + emoji.length);
    expect(editor.selectionEnd).toBe(6 + emoji.length);
    expect(scheduleButton).toBeEnabled();
  });

  it('preserves text when attachments are added and removed', () => {
    const text = 'a'.repeat(1500);
    const { container, editor } = renderComposer(text);
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!fileInput) throw new Error('Production attachment input was not rendered.');

    fireEvent.change(fileInput, {
      target: { files: [new File(['attachment'], 'attachment.txt', { type: 'text/plain' })] },
    });

    expect(editor.value).toBe(text);
    fireEvent.click(container.querySelector('button[aria-label="Remove attachment.txt"]')!);
    expect(editor.value).toBe(text);
  });
});