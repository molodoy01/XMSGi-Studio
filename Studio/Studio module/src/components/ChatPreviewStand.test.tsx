import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Chat } from '@/types';
import { ChatPreviewStand } from './ChatPreviewStand';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const wallpaperStorageKey = 'awaitmsg-chat-preview-wallpaper';
const chat: Chat = { id: 'chat-1', name: 'Telegram', username: 'telegram', type: 'channel' };

function renderChatPreviewStand(attachments: { name: string; path: string; previewUrl?: string }[] = []) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  const onToggleChatList = vi.fn();
  const previewFeedRef: { current: HTMLDivElement | null } = { current: null };

  act(() => {
    root.render(
      <ChatPreviewStand
        chats={[chat]}
        selectedChat={chat}
        previewHistory={null}
        previewHistoryLoading={false}
        previewFeedRef={previewFeedRef}
        draftText=""
        draftEntities={[]}
        inlineButtons={[]}
        attachments={attachments}
        previewTime=""
        collapsed={false}
        chatListOpen={false}
        onToggleChatList={onToggleChatList}
        onSelectChat={vi.fn()}
      />,
    );
  });

  return {
    container,
    onToggleChatList,
    previewFeedRef,
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function openWallpaperPicker(container: HTMLElement) {
  if (container.querySelector('.chat-preview-wallpaper-quick-picker')) return;
  act(() => {
    (container.querySelector('[aria-label="Preview settings"]') as HTMLButtonElement).click();
  });
  act(() => {
    (container.querySelector('button[aria-label="Choose chat background"]') as HTMLButtonElement).click();
  });
}

function switchToWebPreview(container: HTMLElement) {
  act(() => {
    (container.querySelector('[aria-label="Preview settings"]') as HTMLButtonElement).click();
  });
  act(() => {
    (container.querySelector('[aria-label="Switch to Web preview"]') as HTMLButtonElement).click();
  });
}

describe('ChatPreviewStand wallpaper picker', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.localStorage.clear();
  });

  it('shows wallpaper presets in the web preview and groups chat controls under settings', () => {
    const { container, onToggleChatList, unmount } = renderChatPreviewStand();

    try {
      switchToWebPreview(container);
      expect(container.querySelector('.chat-preview-stand')?.classList.contains('is-web')).toBe(true);
      expect(container.querySelector('.chat-preview-toolbar-label')?.textContent?.trim()).toBe('Live chat preview');
      expect(container.querySelector('.chat-preview-wallpaper-quick-picker')).toBeNull();
      expect(container.querySelectorAll('.chat-preview-header-actions > button')).toHaveLength(1);
      expect(container.querySelector('[aria-label="Show chats"]')).toBeNull();
      expect(container.querySelector('button[aria-label="Choose chat background"]')).toBeNull();

      act(() => {
        (container.querySelector('[aria-label="Preview settings"]') as HTMLButtonElement).click();
      });

      expect(container.querySelector('[aria-label="Show chats"]')).not.toBeNull();
      const wallpaperToggle = container.querySelector('button[aria-label="Choose chat background"]') as HTMLButtonElement;
      expect(wallpaperToggle.getAttribute('aria-pressed')).toBe('false');
      act(() => wallpaperToggle.click());
      expect(container.querySelector('.chat-preview-wallpaper-quick-picker')).not.toBeNull();

      act(() => {
        (container.querySelector('[aria-label="Preview settings"]') as HTMLButtonElement).click();
      });
      act(() => {
        (container.querySelector('button[aria-label="Choose chat background"]') as HTMLButtonElement).click();
      });
      expect(container.querySelector('.chat-preview-wallpaper-quick-picker')).toBeNull();

      act(() => {
        (container.querySelector('[aria-label="Preview settings"]') as HTMLButtonElement).click();
      });

      act(() => {
        (container.querySelector('[aria-label="Show chats"]') as HTMLButtonElement).click();
      });

      expect(onToggleChatList).toHaveBeenCalledTimes(1);
      expect(container.querySelector('.chat-preview-options-menu')).toBeNull();
    } finally {
      unmount();
    }
  });

  it('keeps the wallpaper picker toggle in mobile preview', () => {
    const { container, unmount } = renderChatPreviewStand();

    try {
      expect(container.querySelector('.chat-preview-stand')?.classList.contains('is-mobile')).toBe(true);
      expect(container.querySelector('.chat-preview-wallpaper-quick-picker')).toBeNull();
      expect(container.querySelector('.chat-preview-toolbar-label')?.textContent?.trim()).toBe('Live preview');
      act(() => {
        (container.querySelector('[aria-label="Preview settings"]') as HTMLButtonElement).click();
      });
      expect(container.querySelector('[aria-label="Show chats"]')).toBeNull();
      act(() => {
        (container.querySelector('button[aria-label="Choose chat background"]') as HTMLButtonElement).click();
      });

      expect(container.querySelector('.chat-preview-wallpaper-quick-picker')).not.toBeNull();
      expect(container.querySelector('.chat-preview-wallpaper-quick-picker')?.classList.contains('is-inline')).toBe(false);
      act(() => {
        (container.querySelector('[aria-label="Preview settings"]') as HTMLButtonElement).click();
      });
      act(() => {
        (container.querySelector('button[aria-label="Choose chat background"]') as HTMLButtonElement).click();
      });
      expect(container.querySelector('.chat-preview-wallpaper-quick-picker')).toBeNull();
    } finally {
      unmount();
    }
  });

  it('applies a web background and lets the user reopen the toolbar palette', () => {
    const { container, unmount } = renderChatPreviewStand();

    try {
      switchToWebPreview(container);
      openWallpaperPicker(container);
      act(() => {
        (container.querySelector('[aria-label="Graphite background"]') as HTMLButtonElement).click();
      });

      expect(container.querySelector('.chat-preview-window')?.classList.contains('theme-graphite')).toBe(true);
      expect(container.querySelector('.chat-preview-wallpaper-quick-picker')).toBeNull();

      act(() => {
        (container.querySelector('[aria-label="Preview settings"]') as HTMLButtonElement).click();
      });
      act(() => {
        (container.querySelector('.chat-preview-options-menu button[aria-label="Choose chat background"]') as HTMLButtonElement).click();
      });

      expect(container.querySelector('.chat-preview-wallpaper-quick-picker')).not.toBeNull();
      expect(container.querySelector('.chat-preview-toolbar')?.contains(container.querySelector('.chat-preview-wallpaper-quick-picker'))).toBe(true);
    } finally {
      unmount();
    }
  });

  it('keeps same-named file attachments distinct in the live preview', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { container, unmount } = renderChatPreviewStand([
      { name: 'report.txt', path: '/files/one/report.txt' },
      { name: 'report.txt', path: '/files/two/report.txt' },
    ]);

    try {
      expect(container.querySelectorAll('.chat-preview-document')).toHaveLength(2);
      expect(consoleError.mock.calls.flat().some((value) =>
        typeof value === 'string' && value.includes('Encountered two children with the same key')
      )).toBe(false);
    } finally {
      unmount();
      consoleError.mockRestore();
    }
  });

  it('places the live preview scrollbar outside the frame and scrolls the feed', () => {
    const { container, previewFeedRef, unmount } = renderChatPreviewStand();
    const feed = previewFeedRef.current as HTMLDivElement;
    Object.defineProperty(feed, 'scrollHeight', { configurable: true, value: 1000 });
    Object.defineProperty(feed, 'clientHeight', { configurable: true, value: 200 });
    feed.scrollTop = 300;
    const scrollbar = container.querySelector('[role="scrollbar"]') as HTMLDivElement;

    try {
      expect(scrollbar).not.toBeNull();
      expect(scrollbar.classList.contains('is-hidden')).toBe(true);
      act(() => feed.dispatchEvent(new Event('scroll')));

      expect(scrollbar.classList.contains('is-hidden')).toBe(false);
      expect(scrollbar.parentElement?.classList.contains('chat-preview-window-shell')).toBe(true);
      expect(container.querySelector('.chat-preview-window')?.contains(scrollbar)).toBe(false);
      expect(scrollbar.getAttribute('aria-valuenow')).toBe('38');

      const setPointerCapture = vi.fn();
      Object.defineProperty(scrollbar, 'setPointerCapture', { configurable: true, value: setPointerCapture });
      const pointerDown = new Event('pointerdown', { bubbles: true, cancelable: true });
      Object.defineProperties(pointerDown, {
        pointerId: { value: 7 },
        clientY: { value: 24 },
      });
      act(() => scrollbar.querySelector('.chat-preview-scrollbar-thumb')?.dispatchEvent(pointerDown));
      expect(scrollbar.classList.contains('is-dragging')).toBe(true);
      expect(setPointerCapture).toHaveBeenCalledWith(7);

      act(() => scrollbar.dispatchEvent(new Event('pointerup', { bubbles: true })));
      expect(scrollbar.classList.contains('is-dragging')).toBe(false);

      act(() => scrollbar.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })));
      act(() => feed.dispatchEvent(new Event('scroll')));

      expect(feed.scrollTop).toBe(800);
      expect(scrollbar.getAttribute('aria-valuenow')).toBe('100');
    } finally {
      unmount();
    }
  });

  it('keeps the external scrollbar active beside the phone preview', () => {
    const { container, previewFeedRef, unmount } = renderChatPreviewStand();
    const feed = previewFeedRef.current as HTMLDivElement;
    Object.defineProperty(feed, 'scrollHeight', { configurable: true, value: 1000 });
    Object.defineProperty(feed, 'clientHeight', { configurable: true, value: 200 });
    const scrollbar = container.querySelector('[role="scrollbar"]') as HTMLDivElement;

    try {
      act(() => feed.dispatchEvent(new Event('scroll')));

      expect(container.querySelector('.chat-preview-stand')?.classList.contains('is-mobile')).toBe(true);
      expect(scrollbar.classList.contains('is-hidden')).toBe(false);
      expect(scrollbar.getAttribute('aria-hidden')).toBe('false');
      expect(scrollbar.parentElement?.classList.contains('chat-preview-window-shell')).toBe(true);
      expect(container.querySelector('.chat-preview-window')?.contains(scrollbar)).toBe(false);

      act(() => scrollbar.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })));
      act(() => feed.dispatchEvent(new Event('scroll')));
      expect(scrollbar.getAttribute('aria-valuenow')).toBe('100');
    } finally {
      unmount();
    }
  });

  it('does not automatically open the chat list when switching preview devices', () => {
    const { container, unmount } = renderChatPreviewStand();

    try {
      const openSettings = container.querySelector('[aria-label="Preview settings"]') as HTMLButtonElement;
      act(() => openSettings.click());
      act(() => (container.querySelector('[aria-label="Switch to Web preview"]') as HTMLButtonElement).click());

      expect(container.querySelector('.chat-preview-stand')?.classList.contains('is-chat-list-open')).toBe(false);
      expect(container.querySelector('.chat-preview-chat-list')).toBeNull();

      act(() => (container.querySelector('[aria-label="Preview settings"]') as HTMLButtonElement).click());
      act(() => (container.querySelector('[aria-label="Switch to Mobile preview"]') as HTMLButtonElement).click());
      expect(container.querySelector('.chat-preview-stand')?.classList.contains('is-chat-list-open')).toBe(false);
    } finally {
      unmount();
    }
  });

  it('starts in mobile preview after remounting regardless of the previous selection', () => {
    const firstPreview = renderChatPreviewStand();
    switchToWebPreview(firstPreview.container);
    firstPreview.unmount();

    const secondPreview = renderChatPreviewStand();
    try {
      expect(secondPreview.container.querySelector('.chat-preview-stand')?.classList.contains('is-mobile')).toBe(true);
    } finally {
      secondPreview.unmount();
    }
  });

  it('limits the picker to five backgrounds including its two built-ins', () => {
    const uploadedWallpapers = [1, 2, 3, 4].map((index) => `data:image/png;base64,${index}`);
    window.localStorage.setItem(wallpaperStorageKey, JSON.stringify({
      theme: 'custom',
      image: uploadedWallpapers[3],
      accent: '',
      wallpapers: uploadedWallpapers,
    }));
    const { container, unmount } = renderChatPreviewStand();

    try {
      openWallpaperPicker(container);
      const backgroundChoices = container.querySelectorAll(
        '.chat-preview-wallpaper-quick-choice.is-default, .chat-preview-wallpaper-quick-choice.is-graphite, .chat-preview-wallpaper-quick-choice.is-uploaded',
      );
      const addButton = container.querySelector('.chat-preview-wallpaper-quick-choice.is-add') as HTMLButtonElement;
      const saved = JSON.parse(window.localStorage.getItem(wallpaperStorageKey) || '{}');

      expect(backgroundChoices).toHaveLength(5);
      expect(container.querySelectorAll('.chat-preview-wallpaper-quick-choice.is-uploaded img')).toHaveLength(3);
      expect(container.querySelector('.chat-preview-wallpaper-quick-choice.is-uploaded img')?.getAttribute('src'))
        .toBe(uploadedWallpapers[1]);
      expect(addButton.disabled).toBe(true);
      expect(saved.wallpapers).toHaveLength(3);
      expect(saved.wallpapers).toContain(uploadedWallpapers[3]);
    } finally {
      unmount();
    }
  });

  it('selects an uploaded background and falls back to Telegram when it is removed', () => {
    const image = 'data:image/png;base64,AA==';
    window.localStorage.setItem(wallpaperStorageKey, JSON.stringify({
      theme: 'telegram',
      image,
      accent: '',
      wallpapers: [image],
    }));
    const { container, unmount } = renderChatPreviewStand();

    try {
      openWallpaperPicker(container);
      act(() => {
        (container.querySelector('[aria-label="Uploaded background 1"]') as HTMLButtonElement).click();
      });

      expect(container.querySelector('.chat-preview-window')?.classList.contains('theme-custom')).toBe(true);
      openWallpaperPicker(container);
      expect(container.querySelector('[aria-label="Uploaded background 1"]')?.getAttribute('aria-pressed')).toBe('true');

      act(() => {
        (container.querySelector('[aria-label="Remove uploaded background 1"]') as HTMLButtonElement).click();
      });

      expect(container.querySelector('.chat-preview-window')?.classList.contains('theme-telegram')).toBe(true);
      expect(container.querySelector('[aria-label="Uploaded background 1"]')).toBeNull();
      expect(JSON.parse(window.localStorage.getItem(wallpaperStorageKey) || '{}').wallpapers).toEqual([]);
    } finally {
      unmount();
    }
  });
});