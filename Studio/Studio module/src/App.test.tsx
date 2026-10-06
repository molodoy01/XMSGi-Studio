import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function renderApp() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  await act(async () => {
    root.render(<App connected />);
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
    Element.prototype.scrollTo = vi.fn((...args: [number, number] | [ScrollToOptions?]) => undefined) as typeof Element.prototype.scrollTo;
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
        send: vi.fn().mockResolvedValue({ success: true }),
        schedule: vi.fn().mockResolvedValue({ success: true, telegramMessageId: 42, confirmed: true }),
        cancel: vi.fn().mockResolvedValue({ success: true }),
        findChat: vi.fn().mockResolvedValue({ success: false, error: 'Chat not found.' }),
        getFilePath: vi.fn(() => '/tmp/photo.png'),
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
      },
    });
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
    expect(document.body.textContent).toContain('Укажите дату и время в будущем');
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
        (preview.querySelector('[aria-label="Show chats"]') as HTMLButtonElement).click();
      });

      expect(preview.classList.contains('is-chat-list-open')).toBe(true);
      expect(preview.querySelector('.chat-preview-chat-list')).not.toBeNull();
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
      undefined,
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
    });

    expect(tray.classList.contains('is-empty')).toBe(true);
    expect(tray.querySelector('.workspace-page-attachment-card')).toBeNull();
    expect(editor.textContent).toBe(messageBeforeRemove);
    unmount();
  });

});