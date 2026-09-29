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

async function openQueue() {
  const historyButton = document.querySelector('.workspace-page-mode-button-history') as HTMLButtonElement;
  await act(async () => {
    historyButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
  });
}

describe('App media publish records', () => {
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
      date: '2026-09-24',
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

  it('keeps attachments on a scheduled Queue record', async () => {
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

    await openQueue();
    expect(document.querySelector('.message-attachment-image')).toBeTruthy();
    expect(window.telegram.schedule).toHaveBeenCalledWith(expect.objectContaining({
      chatId: 'telegram',
      message: 'Media post',
      attachments: ['/managed/photo.png'],
    }));
    unmount();
  });

  it('keeps attachments on a sent History record', async () => {
    const { unmount } = await renderApp();
    await attachImage();

    const primaryButton = document.querySelector('.workspace-page-publish-main') as HTMLButtonElement;
    await act(async () => {
      primaryButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    await openQueue();
    expect(document.querySelector('.message-attachment-image')).toBeTruthy();
    expect(window.telegram.send).toHaveBeenCalledWith(
      'telegram',
      'Media post',
      ['/managed/photo.png'],
      [],
      undefined,
    );
    unmount();
  });

});