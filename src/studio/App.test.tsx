import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StudioBridgeProps } from '@shared/bridge';
import { LocaleProvider } from '@studio/lib/i18n';
import App from './App';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function renderApp(props: Partial<StudioBridgeProps> = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  await act(async () => {
    root.render(<LocaleProvider><App {...props} connected={props.connected ?? true} /></LocaleProvider>);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

  return {
    root,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

async function attachImage() {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File(['image'], 'photo.png', { type: 'image/png' });
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });

  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();
  });
}

function getTomorrowLocalDate() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
}

function getYesterdayLocalDate() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
}

describe('App media publishing', () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { ResizeObserver?: { new (): { observe: (node: Element) => void; unobserve: (node: Element) => void; disconnect: () => void } } }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.scrollTo = vi.fn(() => undefined) as typeof Element.prototype.scrollTo;
    document.body.innerHTML = '';
    localStorage.clear();
    localStorage.setItem('awaitmsg-workspace-draft', JSON.stringify({
      body: 'Media post',
      entities: [],
      attachments: [],
      savedAt: '12:00',
      date: getTomorrowLocalDate(),
      time: '18:30',
      repeatMode: 'none',
      repeatDays: [],
      repeatOccurrences: 1,
    }));
    Object.defineProperty(window, 'telegram', {
      configurable: true,
      value: {
        getChats: vi.fn().mockResolvedValue({ success: true, chats: [
          { id: 'telegram', name: 'Telegram', username: 'telegram', type: 'channel' },
        ] }),
        getChatHistory: vi.fn().mockResolvedValue({ success: true, history: { chat: { id: 'telegram', title: 'Telegram' }, messages: [] } }),
        loadScheduleHistory: vi.fn().mockResolvedValue({ success: true, history: { upcoming: [], sent: [] } }),
        saveScheduleHistory: vi.fn().mockResolvedValue({ success: true }),
        send: vi.fn().mockResolvedValue({
          success: true,
          telegramMessageId: 42,
          historyPersisted: true,
        }),
        schedule: vi.fn().mockResolvedValue({ success: true, telegramMessageId: 42, confirmed: true }),
        cancel: vi.fn().mockResolvedValue({ success: true }),
        findChat: vi.fn().mockResolvedValue({ success: false, error: 'Chat not found.' }),
        getFilePath: vi.fn(() => '/tmp/photo.png'),
        onStatus: vi.fn(() => () => undefined),
        onSendHistoryWarning: vi.fn(() => () => undefined),
      },
    });
    Object.defineProperty(window, 'draftStorage', {
      configurable: true,
      value: {
        load: vi.fn(async () => ({
          success: true,
          needsMigration: true,
          store: { schemaVersion: 2, migrationVersion: 0, savedDrafts: [], workspaceDraft: null },
        })),
        migrate: vi.fn(async ({ workspaceDraft }) => ({
          success: true,
          migrated: true,
          store: { schemaVersion: 2, migrationVersion: 1, savedDrafts: [], workspaceDraft },
        })),
        save: vi.fn(async (store) => ({ success: true, store })),
        flush: vi.fn((store) => ({ success: true, store })),
        restoreBackup: vi.fn(async () => ({ success: false, error: 'No backup' })),
        exportBackup: vi.fn(async () => ({ success: true })),
        importBackup: vi.fn(async () => ({ success: false, cancelled: true })),
        exportText: vi.fn(async () => ({ success: true })),
        importText: vi.fn(async () => ({ success: true, text: 'Imported from text file' })),
        copyAttachment: vi.fn(async (file: File) => ({
          success: true,
          attachment: { name: file.name, path: `/managed/${file.name}`, size: file.size },
        })),
        copyAttachmentPath: vi.fn(async (sourcePath: string) => {
          const name = sourcePath.split(/[\\/]/).pop() || sourcePath;
          return {
            success: true,
            attachment: { name, path: sourcePath, size: 123 },
          };
        }),
      },
    });
  });

  it('uses the shared selected chat when Studio is mounted', async () => {
    const chats = [
      { id: 'chat-first', name: 'First chat', type: 'group' as const },
      { id: 'chat-selected', name: 'Selected chat', type: 'channel' as const },
    ];
    const onSelectChat = vi.fn();
    const { unmount } = await renderApp({ chats, selectedChat: chats[1], onSelectChat });

    expect(document.querySelector('.workspace-page-chat-trigger strong')?.textContent).toBe('Selected chat');
    unmount();
  });

  it('does not restore a stale draft chat over the host selected chat', async () => {
    const chats = [
      { id: 'chat-old', name: 'Old draft chat', type: 'group' as const },
      { id: 'chat-current', name: 'Current shared chat', type: 'channel' as const },
    ];
    vi.mocked(window.draftStorage.load).mockResolvedValueOnce({
      success: true,
      needsMigration: false,
      store: {
        schemaVersion: 2,
        migrationVersion: 1,
        savedDrafts: [],
        workspaceDraft: {
          body: 'Old draft content',
          attachments: [],
          selectedChat: chats[0],
        },
      },
    });
    const { unmount } = await renderApp({
      chats,
      selectedChat: chats[1],
      onSelectChat: vi.fn(),
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(document.querySelector('.workspace-page-chat-trigger strong')?.textContent).toBe('Current shared chat');
    unmount();
  });

  it('passes attachments to Telegram when scheduling', async () => {
    const { unmount } = await renderApp();
    await attachImage();

    const menuToggle = document.querySelector('.workspace-page-publish-menu-toggle') as HTMLButtonElement;
    await act(async () => {
      menuToggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    const scheduleOption = document.querySelector('.workspace-page-publish-option.is-scheduled') as HTMLButtonElement;
    await act(async () => {
      scheduleOption.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    const timeButton = Array.from(document.querySelectorAll('.workspace-page-schedule-compact-button'))
      .find((button) => button.textContent?.trim() === 'Time') as HTMLButtonElement;
    await act(async () => {
      timeButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const primaryButton = document.querySelector('.workspace-page-publish-main') as HTMLButtonElement;
    await act(async () => {
      primaryButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(window.telegram.schedule).toHaveBeenCalledWith(expect.objectContaining({
      chatId: 'telegram',
      message: 'Media post',
      attachments: ['/managed/photo.png'],
    }));
    unmount();
  });

  it('resets the displayed schedule after the bridged scheduler confirms success', async () => {
    const handleSchedule = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const scheduler: NonNullable<StudioBridgeProps['scheduler']> = {
      protocolVersion: 1,
      upcoming: [],
      sent: [],
      scheduling: false,
      successPulse: false,
      lastAction: null,
      revealingId: null,
      cancelingIds: new Set(),
      sendingIds: new Set(),
      publishingDraft: false,
      handleSchedule,
      handleSendDraftNow: vi.fn().mockResolvedValue(true),
      handleSendNow: vi.fn(),
      handleDeleteMessage: vi.fn(),
      handleClearSent: vi.fn(),
      handleCancelMessage: vi.fn(),
      handleCancelMessages: vi.fn().mockResolvedValue(true),
      showNotification: vi.fn(),
    };
    const { unmount } = await renderApp({ scheduler });

    await act(async () => {
      (document.querySelector('.workspace-page-publish-menu-toggle') as HTMLButtonElement).click();
    });
    await act(async () => {
      (document.querySelector('.workspace-page-publish-option.is-scheduled') as HTMLButtonElement).click();
    });
    const timeButton = Array.from(document.querySelectorAll('.workspace-page-schedule-compact-button'))
      .find((button) => button.textContent?.trim() === 'Time') as HTMLButtonElement;
    await act(async () => timeButton.click());
    await act(async () => {
      (document.querySelector('.workspace-page-publish-main') as HTMLButtonElement).click();
      await Promise.resolve();
    });

    expect(document.querySelector('.workspace-page-mode-summary strong')?.textContent).toContain('18:30');
    await act(async () => {
      (document.querySelector('.workspace-page-publish-main') as HTMLButtonElement).click();
      await Promise.resolve();
    });

    expect(handleSchedule).toHaveBeenCalledWith(expect.objectContaining({
      date: getTomorrowLocalDate(),
      time: '18:30',
      waitForConfirmation: true,
    }), expect.anything());
    expect(handleSchedule).toHaveBeenCalledTimes(2);
    expect(document.querySelector('.workspace-page-mode-summary strong')?.textContent).not.toContain('18:30');
    unmount();
  });

  it('blocks scheduling when the selected date is in the past', async () => {
    localStorage.setItem('awaitmsg-workspace-draft', JSON.stringify({
      body: 'Media post',
      entities: [],
      attachments: [],
      savedAt: '12:00',
      date: getYesterdayLocalDate(),
      time: '12:00',
      repeatMode: 'none',
      repeatDays: [],
      repeatOccurrences: 1,
    }));
    const { unmount } = await renderApp();

    const menuToggle = document.querySelector('.workspace-page-publish-menu-toggle') as HTMLButtonElement;
    await act(async () => {
      menuToggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    const scheduleOption = document.querySelector('.workspace-page-publish-option.is-scheduled') as HTMLButtonElement;
    await act(async () => {
      scheduleOption.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    const primaryButton = document.querySelector('.workspace-page-publish-main') as HTMLButtonElement;
    await act(async () => {
      primaryButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(window.telegram.schedule).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Choose a future date.');
    unmount();
  });

  it('keeps the live preview chat list closed until opened from its settings', async () => {
    const { unmount } = await renderApp();

    try {
      const preview = document.querySelector('.chat-preview-stand') as HTMLElement;
      expect(preview.classList.contains('is-chat-list-open')).toBe(false);
      expect(preview.querySelector('.chat-preview-chat-list')).toBeNull();

      await act(async () => {
        (preview.querySelector('[aria-label="Preview settings"]') as HTMLButtonElement).click();
      });
      await act(async () => {
        (preview.querySelector('[aria-label="Switch to Web preview"]') as HTMLButtonElement).click();
      });
      await act(async () => {
        (preview.querySelector('[aria-label="Preview settings"]') as HTMLButtonElement).click();
      });
      await act(async () => {
        (preview.querySelector('[aria-label="Show chats"]') as HTMLButtonElement).click();
      });

      expect(preview.classList.contains('is-chat-list-open')).toBe(true);
      expect(preview.querySelector('.chat-preview-chat-list')).not.toBeNull();
    } finally {
      unmount();
    }
  });

  it('keeps cached chats available in the live preview while disconnected', async () => {
    const cachedChat = {
      id: 'cached-chat',
      name: 'Cached chat',
      type: 'group' as const,
      avatarDataUrl: '',
    };
    const { unmount } = await renderApp({
      connected: false,
      chats: [cachedChat],
      selectedChat: cachedChat,
      onSelectChat: vi.fn(),
    });

    try {
      const preview = document.querySelector('.chat-preview-stand') as HTMLElement;
      await act(async () => {
        (preview.querySelector('[aria-label="Preview settings"]') as HTMLButtonElement).click();
      });
      await act(async () => {
        (preview.querySelector('[aria-label="Switch to Web preview"]') as HTMLButtonElement).click();
      });
      await act(async () => {
        (preview.querySelector('[aria-label="Preview settings"]') as HTMLButtonElement).click();
      });
      await act(async () => {
        (preview.querySelector('[aria-label="Show chats"]') as HTMLButtonElement).click();
      });

      expect(preview.querySelector('.chat-preview-chat-list')).not.toBeNull();
      expect(preview.querySelector('.chat-preview-chat-list')?.textContent).toContain('Cached chat');
    } finally {
      unmount();
    }
  });

  it('passes text, rich-text entities and attachments separately to Telegram when sending', async () => {
    localStorage.setItem('awaitmsg-workspace-draft', JSON.stringify({
      body: 'Media post',
      entities: [{ type: 'bold', offset: 6, length: 4 }],
      attachments: [],
      savedAt: '12:00',
      date: getTomorrowLocalDate(),
      time: '18:30',
      repeatMode: 'none',
      repeatDays: [],
      repeatOccurrences: 1,
    }));
    const { unmount } = await renderApp();
    await attachImage();

    const primaryButton = document.querySelector('.workspace-page-publish-main') as HTMLButtonElement;
    await act(async () => {
      primaryButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(window.telegram.send).toHaveBeenCalledWith(
      'telegram',
      'Media post',
      ['/managed/photo.png'],
      [{ type: 'bold', offset: 6, length: 4 }],
      false,
      undefined,
      'account-1',
      expect.any(String),
    );
    unmount();
  });

  it('shows attachments under the editor line and removes them without changing text', async () => {
    const { unmount } = await renderApp();
    await attachImage();

    const editor = document.querySelector('[aria-label="Post content"]') as HTMLElement;
    const tray = document.querySelector('.workspace-page-attachment-tray') as HTMLElement;
    const card = tray.querySelector('.workspace-page-attachment-card');
    const actionRow = document.querySelector('.workspace-page-action-row') as HTMLElement;

    expect(tray.classList.contains('is-empty')).toBe(false);
    expect(card).not.toBeNull();
    expect(card?.querySelector('.workspace-page-attachment-thumbnail')).not.toBeNull();
    expect(card?.textContent).toContain('image/png');
    expect(actionRow.compareDocumentPosition(tray) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();

    const messageBeforeRemove = editor.textContent;
    await act(async () => {
      (tray.querySelector('[aria-label="Remove photo.png"]') as HTMLButtonElement).click();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(tray.classList.contains('is-empty')).toBe(true);
    expect(tray.querySelector('.workspace-page-attachment-card')).toBeNull();
    expect(editor.textContent).toBe(messageBeforeRemove);
    unmount();
  });

});