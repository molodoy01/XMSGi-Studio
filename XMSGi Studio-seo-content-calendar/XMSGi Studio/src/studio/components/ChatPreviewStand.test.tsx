import { act, fireEvent, render } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '@studio/lib/i18n';
import * as richTextModule from '@studio/lib/richText';
import type { Chat, PreviewChatHistory } from '@studio/types';
import { ChatPreviewStand } from './ChatPreviewStand';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const wallpaperStorageKey = 'awaitmsg-chat-preview-wallpaper';
const chat: Chat = { id: 'chat-1', name: 'Telegram', username: 'telegram', type: 'channel' };
type PreviewProps = ComponentProps<typeof ChatPreviewStand>;

function renderChatPreviewStand(
  attachments: PreviewProps['attachments'] = [],
  draftText: PreviewProps['draftText'] = '',
  draftEntities: PreviewProps['draftEntities'] = [],
  previewHistory: PreviewProps['previewHistory'] = null,
  chats: PreviewProps['chats'] = [chat],
  chatListOpen: PreviewProps['chatListOpen'] = false,
) {
  const onToggleChatList = vi.fn();
  const previewFeedRef: { current: HTMLDivElement | null } = { current: null };

  const renderPreview = (
    nextDraftText: PreviewProps['draftText'] = draftText,
    nextDraftEntities: PreviewProps['draftEntities'] = draftEntities,
    nextChatListOpen: PreviewProps['chatListOpen'] = false,
    nextPreviewHistory: PreviewProps['previewHistory'] = previewHistory,
    nextPreviewHistoryLoading: PreviewProps['previewHistoryLoading'] = false,
    nextChats: PreviewProps['chats'] = chats,
  ) => (
    <LocaleProvider>
        <ChatPreviewStand
          chats={nextChats}
          selectedChat={chat}
          previewHistory={nextPreviewHistory}
          previewHistoryLoading={nextPreviewHistoryLoading}
          previewFeedRef={previewFeedRef}
          draftText={nextDraftText}
          draftEntities={nextDraftEntities}
          attachments={attachments}
          previewTime=""
          collapsed={false}
          chatListOpen={nextChatListOpen}
          onToggleChatList={onToggleChatList}
          onSelectChat={vi.fn()}
        />
    </LocaleProvider>
  );
  const view = render(renderPreview(draftText, draftEntities, chatListOpen));
  const rerender = (
    nextDraftText: PreviewProps['draftText'] = draftText,
    nextDraftEntities: PreviewProps['draftEntities'] = draftEntities,
    nextChatListOpen: PreviewProps['chatListOpen'] = false,
    nextPreviewHistory: PreviewProps['previewHistory'] = previewHistory,
    nextPreviewHistoryLoading: PreviewProps['previewHistoryLoading'] = false,
    nextChats: PreviewProps['chats'] = chats,
  ) => act(() => view.rerender(renderPreview(
    nextDraftText,
    nextDraftEntities,
    nextChatListOpen,
    nextPreviewHistory,
    nextPreviewHistoryLoading,
    nextChats,
  )));

  return {
    container: view.container,
    onToggleChatList,
    previewFeedRef,
    rerender,
    rerenderHistory(nextPreviewHistory: PreviewChatHistory | null, loading = false) {
      rerender(undefined, undefined, false, nextPreviewHistory, loading);
    },
    unmount: view.unmount,
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
    document.documentElement.dataset.theme = 'dark';
  });

  it('falls back to the default wallpaper when a saved custom wallpaper is empty', () => {
    window.localStorage.setItem('xmsgi-chat-preview-wallpaper', JSON.stringify({ version: 2, theme: 'custom', image: '', accent: '', wallpapers: [] }));

    const { container, unmount } = renderChatPreviewStand();

    try {
      const preview = container.querySelector('.chat-preview-window');
      expect(preview?.classList.contains('theme-telegram')).toBe(true);
      expect(preview?.getAttribute('style') ?? '').toContain('carbon-dark-wallpaper.jpg');
    } finally {
      unmount();
    }
  });

  it('switches the built-in wallpaper with the application color theme', async () => {
    const { container, unmount } = renderChatPreviewStand();

    try {
      const preview = container.querySelector('.chat-preview-window') as HTMLDivElement;
      expect(preview.classList.contains('theme-telegram')).toBe(true);
      expect(preview.style.backgroundImage).toContain('carbon-dark-wallpaper.jpg');

      await act(async () => {
        document.documentElement.dataset.theme = 'light';
        await Promise.resolve();
      });

      expect(preview.classList.contains('theme-graphite')).toBe(true);
      expect(preview.style.backgroundImage).toContain('carbon-light-wallpaper.png');
      openWallpaperPicker(container);
      expect(container.querySelector('[aria-label="Light background"]')?.classList.contains('is-selected')).toBe(true);

      await act(async () => {
        document.documentElement.dataset.theme = 'dark';
        await Promise.resolve();
      });

      expect(preview.classList.contains('theme-telegram')).toBe(true);
      expect(preview.style.backgroundImage).toContain('carbon-dark-wallpaper.jpg');
    } finally {
      unmount();
    }
  });

  it('places mobile background choices above the live preview label', () => {
    const { container, unmount } = renderChatPreviewStand();

    try {
      openWallpaperPicker(container);

      const toolbar = container.querySelector('.chat-preview-toolbar');
      const picker = toolbar?.querySelector('.chat-preview-wallpaper-quick-picker');
      const label = toolbar?.querySelector('.chat-preview-toolbar-label');

      expect(toolbar?.classList.contains('is-wallpaper-picker-open')).toBe(true);
      expect(picker).not.toBeNull();
      expect(label).not.toBeNull();
      expect(picker!.compareDocumentPosition(label!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    } finally {
      unmount();
    }
  });

  it('opens history photos at original size and closes with the button or Escape', () => {
    const original = 'data:image/jpeg;base64,original';
    const thumbnail = 'data:image/jpeg;base64,thumbnail';
    const previewHistory: PreviewChatHistory = {
      chat: { id: chat.id, title: chat.name },
      messages: [{
        id: 'photo-1',
        text: '',
        date: '2026-10-11T12:00:00.000Z',
        outgoing: false,
        media: { kind: 'photo', name: 'photo.jpg', dataUrl: original, thumbnailDataUrl: thumbnail },
      }],
    };
    const { container, unmount } = renderChatPreviewStand([], '', [], previewHistory);

    try {
      const photoButton = container.querySelector('.chat-preview-history-photo-trigger') as HTMLButtonElement;
      expect(photoButton).not.toBeNull();
      expect(photoButton.querySelector('img')?.getAttribute('src')).toBe(original);

      act(() => photoButton.click());
      expect(document.body.querySelector('.chat-preview-image-viewer img')?.getAttribute('src')).toBe(original);

      const closeButton = document.body.querySelector('.chat-preview-image-viewer-close') as HTMLButtonElement;
      expect(closeButton.getAttribute('aria-label')).toBe('Close photo preview');
      act(() => closeButton.click());
      expect(document.body.querySelector('.chat-preview-image-viewer')).toBeNull();

      act(() => photoButton.click());
      act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
      expect(document.body.querySelector('.chat-preview-image-viewer')).toBeNull();
    } finally {
      unmount();
    }
  });

  it('opens an attached draft photo at full size when tapped', () => {
    const original = 'data:image/jpeg;base64,draft-original';
    const { container, unmount } = renderChatPreviewStand([
      { name: 'draft-photo.jpg', path: '/photos/draft-photo.jpg', previewUrl: original },
    ]);

    try {
      const photoButton = container.querySelector('.chat-preview-attachment-photo-trigger') as HTMLButtonElement;
      expect(photoButton).not.toBeNull();
      expect(photoButton.getAttribute('aria-label')).toBe('View photo full size');

      act(() => photoButton.click());
      expect(document.body.querySelector('.chat-preview-image-viewer img')?.getAttribute('src')).toBe(original);

      act(() => (document.body.querySelector('.chat-preview-image-viewer-close') as HTMLButtonElement).click());
      expect(document.body.querySelector('.chat-preview-image-viewer')).toBeNull();
    } finally {
      unmount();
    }
  });

  it('renders sanitized text and keeps formatting in the live preview', () => {
    const { container, unmount } = renderChatPreviewStand([], 'A\u200BB', [
      { type: 'bold', offset: 2, length: 1 },
    ]);

    try {
      expect(container.querySelector('.chat-preview-message')?.innerHTML).toBe('A<strong>B</strong>');
    } finally {
      unmount();
    }
  });

  it('keeps outgoing and incoming messages on their Telegram sides', () => {
    const previewHistory: PreviewChatHistory = {
      chat: { id: chat.id, title: chat.name },
      messages: [
        { id: 'in', text: 'Incoming', date: '2026-10-11T12:00:00.000Z', outgoing: false },
        { id: 'out', text: 'Outgoing', date: '2026-10-11T12:01:00.000Z', outgoing: true },
      ],
    };
    const { container, unmount } = renderChatPreviewStand([], '', [], previewHistory);

    try {
      const entries = Array.from(container.querySelectorAll('.chat-preview-history-entry'));
      expect(entries).toHaveLength(2);
      expect(entries[0].classList.contains('is-incoming')).toBe(true);
      expect(entries[1].classList.contains('is-outgoing')).toBe(true);
    } finally {
      unmount();
    }
  });

  it('hides the empty-preview hint when live history already contains messages', () => {
    const previewHistory: PreviewChatHistory = {
      chat: { id: chat.id, title: chat.name },
      messages: [{ id: 'history-1', text: 'History exists', date: '2026-10-11T12:00:00.000Z', outgoing: false }],
    };
    const { container, unmount } = renderChatPreviewStand([], '', [], previewHistory);

    try {
      expect(container.querySelector('.chat-preview-empty')).toBeNull();
      const composerInput = container.querySelector('.chat-preview-composer-input');
      expect(composerInput?.textContent?.trim()).not.toBe('');
      expect(composerInput?.querySelector('.chat-preview-composer-emoji')).not.toBeNull();
      expect(container.querySelectorAll('.chat-preview-composer > .chat-preview-composer-action')).toHaveLength(2);
    } finally {
      unmount();
    }
  });

  it('scrolls to the bottom after selected chat history finishes loading', () => {
    const previewHistory: PreviewChatHistory = {
      chat: { id: chat.id, title: chat.name },
      messages: [{ id: 'history-1', text: 'History exists', date: '2026-10-11T12:00:00.000Z', outgoing: false }],
    };
    const { previewFeedRef, rerenderHistory, unmount } = renderChatPreviewStand();
    const feed = previewFeedRef.current as HTMLDivElement;
    Object.defineProperty(feed, 'scrollHeight', { configurable: true, value: 900 });
    Object.defineProperty(feed, 'clientHeight', { configurable: true, value: 200 });

    try {
      rerenderHistory(previewHistory, true);
      expect(feed.scrollTop).toBe(0);

      rerenderHistory(previewHistory);

      expect(feed.scrollTop).toBe(700);
    } finally {
      unmount();
    }
  });

  it('renders Markdown loaded from a template like Telegram will render it', () => {
    const { container, unmount } = renderChatPreviewStand([], '**ДЕЙСТВУЙ**\n**[Название]**');

    try {
      expect(container.querySelector('.chat-preview-message')?.innerHTML)
        .toBe('<strong>ДЕЙСТВУЙ</strong><br><strong>[Название]</strong>');
    } finally {
      unmount();
    }
  });

  it('keeps loaded history markup stable while the live draft changes', () => {
    const historyText = 'Previously loaded Telegram message';
    const previewHistory: PreviewChatHistory = {
      chat: { id: chat.id, title: chat.name },
      messages: [{ id: 'history-1', text: historyText, date: '2026-10-11T12:00:00.000Z', outgoing: false }],
    };
    const richTextToHtml = vi.spyOn(richTextModule, 'richTextToHtml');
    const { container, rerender, unmount } = renderChatPreviewStand([], '', [], previewHistory);

    try {
      expect(container.textContent).toContain(historyText);
      expect(richTextToHtml).toHaveBeenCalledWith(historyText, []);
      richTextToHtml.mockClear();

      rerender('New draft text', []);

      expect(container.textContent).toContain(historyText);
      expect(container.textContent).toContain('New draft text');
      expect(richTextToHtml).not.toHaveBeenCalledWith(historyText, []);
    } finally {
      richTextToHtml.mockRestore();
      unmount();
    }
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
      expect(container.querySelector('.chat-preview-wallpaper-quick-picker')).toBeNull();
      expect(container.querySelector('.chat-preview-options-menu')).toBeNull();

      act(() => {
        (container.querySelector('[aria-label="Preview settings"]') as HTMLButtonElement).click();
      });
      expect(container.querySelector('.chat-preview-options-menu')).not.toBeNull();

      act(() => {
        (container.querySelector('button[aria-label="Choose chat background"]') as HTMLButtonElement).click();
      });
      expect(container.querySelector('.chat-preview-wallpaper-quick-picker')).not.toBeNull();

      act(() => {
        (container.querySelector('[aria-label="Preview settings"]') as HTMLButtonElement).click();
      });
      expect(container.querySelector('.chat-preview-wallpaper-quick-picker')).toBeNull();
      expect(container.querySelector('.chat-preview-options-menu')).toBeNull();

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

  it('closes the open chat list before opening web preview settings', () => {
    const { container, onToggleChatList, rerender, unmount } = renderChatPreviewStand();

    try {
      switchToWebPreview(container);
      rerender(undefined, undefined, true);
      const settingsButton = container.querySelector('[aria-label="Preview settings"]') as HTMLButtonElement;

      act(() => settingsButton.click());

      expect(onToggleChatList).toHaveBeenCalledTimes(1);
      expect(container.querySelector('.chat-preview-options-menu')).toBeNull();
      expect(settingsButton.getAttribute('aria-expanded')).toBe('false');

      rerender(undefined, undefined, false);
      act(() => settingsButton.click());

      expect(container.querySelector('.chat-preview-options-menu')).not.toBeNull();
      expect(settingsButton.getAttribute('aria-expanded')).toBe('true');
    } finally {
      unmount();
    }
  });

  it('virtualizes large chat lists and follows scroll position', () => {
    const chats: Chat[] = Array.from({ length: 500 }, (_, index) => ({
      id: `chat-${index}`,
      name: `Chat ${index + 1}`,
      type: 'private',
    }));
    const { container, unmount } = renderChatPreviewStand([], '', [], null, chats, true);

    try {
      const list = container.querySelector('.chat-preview-chat-list-items') as HTMLDivElement;
      expect(list.querySelectorAll('.chat-preview-chat-list-item').length).toBeLessThan(chats.length);

      Object.defineProperty(list, 'clientHeight', { configurable: true, value: 290 });
      list.scrollTop = 58 * 100;
      fireEvent.scroll(list);

      expect(list.querySelector('.chat-preview-chat-list-item')?.textContent).toContain('Chat 95');
      expect(list.textContent).toContain('Chat 101');
      expect(Array.from(list.querySelectorAll('.chat-preview-chat-list-item strong'))
        .some((name) => name.textContent === 'Chat 1')).toBe(false);
    } finally {
      unmount();
    }
  });

  it('uses the external preview scrollbar for the open chat list', () => {
    const chats: Chat[] = Array.from({ length: 500 }, (_, index) => ({
      id: `chat-${index}`,
      name: `Chat ${index + 1}`,
      type: 'private',
    }));
    const { container, unmount } = renderChatPreviewStand([], '', [], null, chats, true);
    const list = container.querySelector('.chat-preview-chat-list-items') as HTMLDivElement;
    Object.defineProperties(list, {
      scrollHeight: { configurable: true, value: chats.length * 58 },
      clientHeight: { configurable: true, value: 290 },
    });
    list.scrollTop = 58 * 100;
    fireEvent.scroll(list);
    const scrollbar = container.querySelector('[role="scrollbar"]') as HTMLDivElement;

    try {
      expect(scrollbar.parentElement?.classList.contains('chat-preview-window-shell')).toBe(true);
      expect(container.querySelector('.chat-preview-window')?.contains(scrollbar)).toBe(false);
      expect(scrollbar).toHaveAttribute('aria-label', 'Chat list scroll');
      expect(scrollbar).toHaveAttribute('aria-controls', 'chat-preview-chat-list-items');
      expect(scrollbar).toHaveAttribute('aria-valuenow', '20');

      act(() => scrollbar.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })));
      fireEvent.scroll(list);

      expect(list.scrollTop).toBe(chats.length * 58 - 290);
      expect(scrollbar).toHaveAttribute('aria-valuenow', '100');
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
      expect(container.querySelector('.chat-preview-wallpaper-quick-picker')).toBeNull();
    } finally {
      unmount();
    }
  });

  it('uses the updated Studio wallpaper as the first-time live preview default', () => {
    const { container, unmount } = renderChatPreviewStand();

    try {
      const preview = container.querySelector('.chat-preview-window') as HTMLDivElement;
      expect(preview.classList.contains('theme-telegram')).toBe(true);
      expect(preview.style.backgroundImage).toContain('carbon-dark-wallpaper.jpg');

      openWallpaperPicker(container);
      expect(container.querySelector('.chat-preview-wallpaper-quick-choice.is-default')?.classList.contains('is-selected')).toBe(true);
    } finally {
      unmount();
    }
  });

  it('migrates the former bundled wallpaper to the updated default', () => {
    window.localStorage.setItem(wallpaperStorageKey, JSON.stringify({ theme: 'graphite', image: '', accent: '' }));
    const { container, unmount } = renderChatPreviewStand();

    try {
      const preview = container.querySelector('.chat-preview-window') as HTMLDivElement;
      expect(preview.classList.contains('theme-telegram')).toBe(true);
      expect(preview.style.backgroundImage).toContain('carbon-dark-wallpaper.jpg');
    } finally {
      unmount();
    }
  });

  it('remembers the light wallpaper after remounting in light mode', () => {
    document.documentElement.dataset.theme = 'light';
    const firstPreview = renderChatPreviewStand();

    try {
      openWallpaperPicker(firstPreview.container);
      act(() => {
        (firstPreview.container.querySelector('[aria-label="Light background"]') as HTMLButtonElement).click();
      });

      expect(JSON.parse(window.localStorage.getItem(wallpaperStorageKey) || '{}')).toMatchObject({ version: 2, theme: 'graphite' });
    } finally {
      firstPreview.unmount();
    }

    const restoredPreview = renderChatPreviewStand();
    try {
      expect(restoredPreview.container.querySelector('.chat-preview-window')?.classList.contains('theme-graphite')).toBe(true);
    } finally {
      restoredPreview.unmount();
    }
  });

  it('applies the default Studio wallpaper in web preview and lets the user reopen the toolbar palette', () => {
    const { container, unmount } = renderChatPreviewStand();

    try {
      switchToWebPreview(container);
      openWallpaperPicker(container);
      act(() => {
        (container.querySelector('[aria-label="Dark background"]') as HTMLButtonElement).click();
      });

      expect(container.querySelector('.chat-preview-window')?.classList.contains('theme-telegram')).toBe(true);
      expect(container.querySelector<HTMLElement>('.chat-preview-window')?.style.backgroundImage)
        .toContain('carbon-dark-wallpaper.jpg');
      expect(container.querySelector<HTMLElement>('.chat-preview-window')?.style.backgroundSize).toBe('cover');
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

  it('keeps the latest draft text visible as it grows in the live preview', () => {
    const { previewFeedRef, rerender, unmount } = renderChatPreviewStand([], 'First line');
    const feed = previewFeedRef.current as HTMLDivElement;
    const draftBubble = feed.querySelector('.chat-preview-draft-bubble') as HTMLElement;
    Object.defineProperty(feed, 'scrollHeight', { configurable: true, value: 1200 });
    Object.defineProperty(feed, 'clientHeight', { configurable: true, value: 300 });
    vi.spyOn(feed, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 100,
      width: 320,
      height: 300,
      top: 100,
      right: 320,
      bottom: 400,
      left: 0,
      toJSON: () => ({}),
    } as DOMRect);
    vi.spyOn(draftBubble, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 150,
      width: 200,
      height: 450,
      top: 150,
      right: 200,
      bottom: 600,
      left: 0,
      toJSON: () => ({}),
    } as DOMRect);

    try {
      rerender('First line\n'.repeat(40));
      expect(feed.scrollTop).toBe(50);
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