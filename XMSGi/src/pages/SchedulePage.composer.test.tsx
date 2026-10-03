import { useState, type ComponentProps } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '@/lib/i18n';
import { SchedulePage } from './SchedulePage';

function renderComposer(initialMessage = '') {
  const showNotification = vi.fn();
  const handleSchedule = vi.fn();
  vi.stubGlobal('telegram', {
    getFilePath: (file: File) => `/attachments/${file.name}`,
    getAvailableEffects: async () => ({
      success: true,
      effects: [{ id: 'effect-1', emoticon: '🎉', premiumRequired: false }],
    }),
  });

  function Harness() {
    const [message, setMessage] = useState(initialMessage);
    const props: ComponentProps<typeof SchedulePage> = {
      message,
      setMessage,
      isSettingsOpen: false,
      setIsSettingsOpen: vi.fn(),
      notification: { visible: false, message: '', type: 'info', title: '' },
      closeNotification: vi.fn(),
      connected: true,
      signedOut: false,
      returningUserName: '',
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
      handleWelcomeBack: vi.fn(async () => undefined),
      handleForgetAccount: vi.fn(async () => undefined),
      chats: [{ id: 'chat-1', name: 'Test chat' }],
      selectedChat: { id: 'chat-1', name: 'Test chat' },
      selectedChatPermissions: { canView: true, canSend: true, canSchedule: true },
      setSelectedChat: vi.fn(),
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
      successPulse: false,
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
  if (!editor) throw new Error('Production message textarea was not rendered.');

  return { ...result, editor, handleSchedule };
}

describe('SchedulePage production composer', () => {
  afterEach(() => vi.unstubAllGlobals());

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
  });

  it('shows available Telegram effects inside the effect submenu', async () => {
    const { container } = renderComposer();
    fireEvent.click(container.querySelector('.message-send-button')!);
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Effect' }));

    const effectsMenu = screen.getByRole('menu', { name: 'Available Telegram effects' });
    expect(effectsMenu.parentElement).toBe(document.body);
    expect(await screen.findByText('🎉')).toBeInTheDocument();
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