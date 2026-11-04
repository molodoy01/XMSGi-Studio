import { ArrowLeft, BatteryFull, ImagePlus, MessageCircle, Mic, Monitor, Paperclip, Search, Send, Signal, SlidersHorizontal, Smartphone, Smile, Wifi, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CSSProperties, MutableRefObject } from 'react';
import { ChatAvatar } from './ChatAvatar';
import carbonDarkWallpaper from '../assets/carbon-dark-wallpaper.jpg';
import carbonLightWallpaper from '../assets/carbon-light-wallpaper.png';
import type { Chat, PreviewChatHistory, RichTextEntity } from '@studio/types';
import { ChatPreviewHistory } from '@studio/components/ChatPreviewHistory';
import { groupHistory } from '@studio/components/chatPreviewHistoryUtils';
import { useLocale } from '@studio/lib/i18n';
import { normalizeTelegramMessage } from '@shared/telegramText.cjs';
import { richTextToHtml } from '@studio/lib/richText';
import './ChatPreviewStand.css';

type PreviewAttachment = {
  name: string;
  path: string;
  previewUrl?: string;
};

type WallpaperTheme = 'telegram' | 'graphite' | 'custom';
type PreviewDevice = 'web' | 'mobile';

const CHAT_LIST_OVERSCAN = 6;
const CHAT_LIST_VIRTUALIZATION_THRESHOLD = 40;

export type ChatWallpaper = {
  theme: WallpaperTheme;
  image: string;
  accent: string;
};

const CHAT_WALLPAPER_STORAGE_KEY = 'xmsgi-chat-preview-wallpaper';
const LEGACY_CHAT_WALLPAPER_STORAGE_KEY = 'awaitmsg-chat-preview-wallpaper';
const MAX_WALLPAPERS = 5;
const MAX_UPLOADED_WALLPAPERS = MAX_WALLPAPERS - 2;

type ChatPreviewStandProps = {
  chats: Chat[];
  selectedChat: Chat | null;
  previewHistory: PreviewChatHistory | null;
  previewHistoryLoading: boolean;
  previewFeedRef: MutableRefObject<HTMLDivElement | null>;
  draftText: string;
  draftEntities: RichTextEntity[];
  attachments: PreviewAttachment[];
  previewTime: string;
  collapsed: boolean;
  chatListOpen: boolean;
  onToggleChatList: () => void;
  onSelectChat: (chat: Chat) => void;
  onWallpaperChange?: (wallpaper: ChatWallpaper) => void;
};

type SavedWallpaper = {
  version?: number;
  theme: WallpaperTheme;
  image: string;
  accent: string;
  wallpapers?: string[];
};

type PreviewScrollMetrics = {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
};

function loadSavedWallpaper(): SavedWallpaper {
  try {
    const primaryRaw = window.localStorage.getItem(CHAT_WALLPAPER_STORAGE_KEY);
    const raw = primaryRaw ?? window.localStorage.getItem(LEGACY_CHAT_WALLPAPER_STORAGE_KEY);
    if (!raw) return { theme: 'telegram', image: '', accent: '' };
    if (!primaryRaw && raw) {
      window.localStorage.setItem(CHAT_WALLPAPER_STORAGE_KEY, raw);
    }

    const saved = JSON.parse(raw) as Partial<SavedWallpaper>;
    const savedImage = typeof saved.image === 'string' ? saved.image : '';
    const wallpaperImages = Array.isArray(saved.wallpapers)
      ? saved.wallpapers.filter((image): image is string => typeof image === 'string' && image.length > 0)
      : savedImage ? [savedImage] : [];
    const uniqueWallpapers = [...new Set([...wallpaperImages, ...(savedImage ? [savedImage] : [])])];
    const prioritizedWallpapers = savedImage
      ? [...uniqueWallpapers.filter((image) => image !== savedImage), savedImage]
      : uniqueWallpapers;

    return {
      theme: saved.theme === 'custom' && savedImage
        ? 'custom'
        : saved.theme === 'graphite' && (saved.version ?? 0) >= 2
          ? 'graphite'
          : 'telegram',
      image: savedImage,
      accent: typeof saved.accent === 'string' ? saved.accent : '',
      wallpapers: prioritizedWallpapers.slice(-MAX_UPLOADED_WALLPAPERS),
    };
  } catch {
    return { theme: 'telegram', image: '', accent: '' };
  }
}

function readImageAccent(dataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const size = 24;
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext('2d');
        if (!context) return resolve('');
        context.drawImage(image, 0, 0, size, size);
        const pixels = context.getImageData(0, 0, size, size).data;
        let red = 0;
        let green = 0;
        let blue = 0;
        let count = 0;
        for (let index = 0; index < pixels.length; index += 4) {
          if (pixels[index + 3] < 180) continue;
          red += pixels[index];
          green += pixels[index + 1];
          blue += pixels[index + 2];
          count += 1;
        }
        resolve(count ? `rgb(${Math.round(red / count)}, ${Math.round(green / count)}, ${Math.round(blue / count)})` : '');
      } catch {
        resolve('');
      }
    };
    image.onerror = () => resolve('');
    image.src = dataUrl;
  });
}

function toFileUrl(filePath: string) {
  if (/^(?:blob:|data:|https?:|file:)/i.test(filePath)) return filePath;

  const normalizedPath = filePath.replace(/\\/g, '/');
  const encodedPath = normalizedPath
    .split('/')
    .map((segment, index) => (index === 0 ? segment : encodeURIComponent(segment)))
    .join('/');

  return `file:///${encodedPath}`;
}

function isImageAttachment(attachment: PreviewAttachment) {
  return Boolean(attachment.path || attachment.previewUrl) && /\.(?:avif|gif|jpe?g|png|webp)$/i.test(attachment.name);
}

function getEntityText(text: string, entity: RichTextEntity) {
  return text.slice(entity.offset, entity.offset + entity.length).trim() || 'Open link';
}

function scrollPreviewFeedToDraft(feed: HTMLDivElement) {
  const draftBubble = feed.querySelector<HTMLElement>('.chat-preview-draft-bubble');
  if (!draftBubble || draftBubble.getBoundingClientRect().height <= feed.clientHeight) {
    feed.scrollTop = Math.max(0, feed.scrollHeight - feed.clientHeight);
    return;
  }

  const feedBounds = feed.getBoundingClientRect();
  const draftBounds = draftBubble.getBoundingClientRect();
  feed.scrollTop = Math.max(0, feed.scrollTop + draftBounds.top - feedBounds.top);
}

export function ChatPreviewStand({
  selectedChat,
  chats,
  previewHistory,
  previewHistoryLoading,
  previewFeedRef,
  draftText,
  draftEntities,
  attachments,
  previewTime,
  collapsed,
  chatListOpen,
  onToggleChatList,
  onSelectChat,
  onWallpaperChange,
}: ChatPreviewStandProps) {
  const { t } = useLocale();
  const savedWallpaper = useMemo(loadSavedWallpaper, []);
  const [previewDevice, setPreviewDevice] = useState<PreviewDevice>('mobile');
  const [appColorTheme, setAppColorTheme] = useState<'light' | 'dark'>(() => (
    document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
  ));
  const appDefaultWallpaperTheme: WallpaperTheme = appColorTheme === 'light' ? 'graphite' : 'telegram';
  const [wallpaperTheme, setWallpaperTheme] = useState<WallpaperTheme>(() => (
    savedWallpaper.theme === 'custom' && savedWallpaper.image ? 'custom' : appDefaultWallpaperTheme
  ));
  const [customWallpaperImage, setCustomWallpaperImage] = useState(savedWallpaper.image);
  const [lastUploadedWallpaper, setLastUploadedWallpaper] = useState(savedWallpaper.image);
  const [uploadedWallpapers, setUploadedWallpapers] = useState<string[]>(savedWallpaper.wallpapers ?? []);
  const [wallpaperAccent, setWallpaperAccent] = useState(savedWallpaper.accent);
  const wallpaperFileInputRef = useRef<HTMLInputElement | null>(null);
  const previewOptionsRef = useRef<HTMLDivElement | null>(null);
  const chatListItemsRef = useRef<HTMLDivElement | null>(null);
  const previewScrollTrackRef = useRef<HTMLDivElement | null>(null);
  const previewScrollDragRef = useRef<{ pointerY: number; scrollTop: number } | null>(null);
  const [wallpaperPickerOpen, setWallpaperPickerOpen] = useState(false);
  const [previewOptionsOpen, setPreviewOptionsOpen] = useState(false);
  const [chatSearchQuery, setChatSearchQuery] = useState('');
  const [previewScrollDragging, setPreviewScrollDragging] = useState(false);
  const [expandedHistoryPhoto, setExpandedHistoryPhoto] = useState<{ src: string; name: string } | null>(null);
  const [previewScrollMetrics, setPreviewScrollMetrics] = useState<PreviewScrollMetrics>({
    scrollTop: 0,
    scrollHeight: 0,
    clientHeight: 0,
  });
  const [chatListScrollMetrics, setChatListScrollMetrics] = useState({ scrollTop: 0, scrollHeight: 0, clientHeight: 0 });

  useEffect(() => {
    const root = document.documentElement;
    const syncWithAppTheme = () => {
      const nextColorTheme = root.dataset.theme === 'light' ? 'light' : 'dark';
      setAppColorTheme(nextColorTheme);
      setWallpaperTheme((current) => current === 'custom' && customWallpaperImage
        ? current
        : nextColorTheme === 'light' ? 'graphite' : 'telegram');
    };
    const observer = new MutationObserver(syncWithAppTheme);
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, [customWallpaperImage]);

  useEffect(() => {
    if (!expandedHistoryPhoto) return;

    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpandedHistoryPhoto(null);
    };

    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [expandedHistoryPhoto]);

  useEffect(() => {
    const nextTheme = wallpaperTheme === 'custom' && !customWallpaperImage ? appDefaultWallpaperTheme : wallpaperTheme;
    const nextImage = nextTheme === 'custom' ? customWallpaperImage : '';

    try {
      const serialized = JSON.stringify({
        version: 2,
        theme: nextTheme,
        image: nextImage,
        accent: wallpaperAccent,
        wallpapers: uploadedWallpapers,
      });
      window.localStorage.setItem(CHAT_WALLPAPER_STORAGE_KEY, serialized);
      window.localStorage.setItem(LEGACY_CHAT_WALLPAPER_STORAGE_KEY, serialized);
    } catch {
      // Keep the current session usable when storage is unavailable.
    }
  }, [appDefaultWallpaperTheme, customWallpaperImage, uploadedWallpapers, wallpaperAccent, wallpaperTheme]);

  useEffect(() => {
    onWallpaperChange?.({
      theme: wallpaperTheme,
      image: customWallpaperImage,
      accent: wallpaperAccent,
    });
  }, [customWallpaperImage, onWallpaperChange, wallpaperAccent, wallpaperTheme]);

  useEffect(() => {
    if (!chatListOpen) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onToggleChatList();
    };

    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [chatListOpen, onToggleChatList]);

  useEffect(() => {
    if (!wallpaperPickerOpen) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setWallpaperPickerOpen(false);
    };

    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [wallpaperPickerOpen]);

  useEffect(() => {
    if (!previewOptionsOpen) return;

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!previewOptionsRef.current?.contains(event.target as Node)) setPreviewOptionsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPreviewOptionsOpen(false);
    };

    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [previewOptionsOpen]);

  useEffect(() => {
    const feed = previewFeedRef.current;
    if (!feed) {
      setPreviewScrollMetrics({ scrollTop: 0, scrollHeight: 0, clientHeight: 0 });
      return;
    }

    const syncMetrics = () => {
      const next = {
        scrollTop: feed.scrollTop,
        scrollHeight: feed.scrollHeight,
        clientHeight: feed.clientHeight,
      };
      setPreviewScrollMetrics((current) => (
        current.scrollTop === next.scrollTop
        && current.scrollHeight === next.scrollHeight
        && current.clientHeight === next.clientHeight
          ? current
          : next
      ));
    };

    feed.addEventListener('scroll', syncMetrics, { passive: true });
    feed.addEventListener('load', syncMetrics, true);
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(syncMetrics);
    resizeObserver?.observe(feed);
    const mutationObserver = typeof MutationObserver === 'undefined' ? null : new MutationObserver(syncMetrics);
    mutationObserver?.observe(feed, { childList: true, characterData: true, subtree: true });
    syncMetrics();

    return () => {
      feed.removeEventListener('scroll', syncMetrics);
      feed.removeEventListener('load', syncMetrics, true);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    };
  }, [attachments.length, collapsed, previewFeedRef, previewHistory?.messages, previewHistoryLoading]);

  const activePreviewHistory = previewHistory?.chat.id === selectedChat?.id
    ? previewHistory
    : null;
  const previewTitle = activePreviewHistory?.chat.title
    || (selectedChat?.name === 'Saved Messages' ? t('studio.savedMessagesType') : selectedChat?.name)
    || t('studio.chooseChat');
  const previewType = activePreviewHistory?.chat.topic
    || (activePreviewHistory?.chat.username ? `@${activePreviewHistory.chat.username}` : '')
    || activePreviewHistory?.chat.type
    || selectedChat?.type
    || t('studio.online');
  const historyGroups = useMemo(
    () => groupHistory(activePreviewHistory?.messages ?? []),
    [activePreviewHistory?.messages],
  );

  useLayoutEffect(() => {
    const feed = previewFeedRef.current;
    if (collapsed || previewHistoryLoading || !feed) return;

    scrollPreviewFeedToDraft(feed);
  }, [
    activePreviewHistory,
    attachments,
    collapsed,
    draftEntities,
    draftText,
    previewFeedRef,
    previewHistoryLoading,
  ]);

  const imageAttachments = attachments.filter(isImageAttachment);
  const documentAttachments = attachments.filter((attachment) => !isImageAttachment(attachment));
  const normalizedDraft = normalizeTelegramMessage(draftText, draftEntities);
  const linkEntities = normalizedDraft.entities.filter((entity) => entity.type === 'text_url' && entity.url);
  const normalizedChatSearch = chatSearchQuery.trim().toLocaleLowerCase();
  const visibleChats = chatListOpen ? chats.filter((chat) => (
    !normalizedChatSearch
    || `${chat.name} ${chat.username ?? ''} ${chat.type ?? ''}`.toLocaleLowerCase().includes(normalizedChatSearch)
  )) : [];
  const chatListRowHeight = previewDevice === 'mobile' ? 58 : 48;
  const shouldVirtualizeChatList = visibleChats.length > CHAT_LIST_VIRTUALIZATION_THRESHOLD;
  const firstVisibleChatIndex = shouldVirtualizeChatList
    ? Math.max(0, Math.floor(chatListScrollMetrics.scrollTop / chatListRowHeight) - CHAT_LIST_OVERSCAN)
    : 0;
  const visibleChatCount = Math.max(
    CHAT_LIST_VIRTUALIZATION_THRESHOLD,
    Math.ceil(chatListScrollMetrics.clientHeight / chatListRowHeight) + CHAT_LIST_OVERSCAN * 2,
  );
  const renderedChats = shouldVirtualizeChatList
    ? visibleChats.slice(firstVisibleChatIndex, firstVisibleChatIndex + visibleChatCount)
    : visibleChats;

  useEffect(() => {
    const list = chatListItemsRef.current;
    if (!chatListOpen || !list) {
      setChatListScrollMetrics({ scrollTop: 0, scrollHeight: 0, clientHeight: 0 });
      return;
    }

    const syncScrollMetrics = () => {
      setChatListScrollMetrics({ scrollTop: list.scrollTop, scrollHeight: list.scrollHeight, clientHeight: list.clientHeight });
    };
    list.scrollTop = 0;
    list.addEventListener('scroll', syncScrollMetrics, { passive: true });
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(syncScrollMetrics);
    resizeObserver?.observe(list);
    syncScrollMetrics();

    return () => {
      list.removeEventListener('scroll', syncScrollMetrics);
      resizeObserver?.disconnect();
    };
  }, [chatListOpen, previewDevice, visibleChats.length]);
  const hasDraft = Boolean(normalizedDraft.message.trim() || attachments.length);
  const hasHistoryMessages = Boolean(activePreviewHistory?.messages.length);
  const shouldShowEmptyPreviewHint = !hasDraft && !hasHistoryMessages;
  const wallpaperImage = customWallpaperImage;
  const effectiveWallpaperTheme: WallpaperTheme = wallpaperTheme === 'custom' && !wallpaperImage
    ? appDefaultWallpaperTheme
    : wallpaperTheme;
  const wallpaperStyle = {
    ...(effectiveWallpaperTheme === 'custom' && wallpaperImage
      ? { backgroundImage: `url(${wallpaperImage})`, backgroundPosition: 'center', backgroundSize: 'cover' }
      : effectiveWallpaperTheme === 'telegram'
        ? { backgroundImage: `url(${carbonDarkWallpaper})`, backgroundPosition: 'center', backgroundSize: 'cover' }
        : effectiveWallpaperTheme === 'graphite'
          ? { backgroundImage: `url(${carbonLightWallpaper})`, backgroundPosition: 'center', backgroundSize: 'cover' }
          : {}),
    '--chat-preview-wallpaper-accent': wallpaperAccent || (effectiveWallpaperTheme === 'graphite' ? '#60727f' : '#6e9d9b'),
  } as CSSProperties;

  const handleWallpaperFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    if (uploadedWallpapers.length >= MAX_UPLOADED_WALLPAPERS) return;

    const reader = new FileReader();
    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') {
        const image = reader.result;
        setUploadedWallpapers((current) => current.includes(image) || current.length >= MAX_UPLOADED_WALLPAPERS
          ? current
          : [...current, image]);
        setCustomWallpaperImage(image);
        setLastUploadedWallpaper(image);
        setWallpaperTheme('custom');
        setWallpaperPickerOpen(false);
        void readImageAccent(image).then(setWallpaperAccent);
      }
    });
    reader.readAsDataURL(file);
    event.target.value = '';
  };

  const removeUploadedWallpaper = (image: string) => {
    const nextWallpapers = uploadedWallpapers.filter((wallpaper) => wallpaper !== image);
    setUploadedWallpapers(nextWallpapers);
    if (lastUploadedWallpaper === image) {
      setLastUploadedWallpaper(nextWallpapers[nextWallpapers.length - 1] ?? '');
    }
    if (customWallpaperImage === image) {
      setCustomWallpaperImage('');
      setWallpaperTheme(appDefaultWallpaperTheme);
      setWallpaperAccent('');
    }
  };

  const activeScrollMetrics = chatListOpen ? chatListScrollMetrics : previewScrollMetrics;
  const activeScrollViewport = chatListOpen ? chatListItemsRef.current : previewFeedRef.current;
  const previewScrollbarCanScroll = activeScrollMetrics.scrollHeight > activeScrollMetrics.clientHeight + 1;
  const previewScrollbarThumbHeight = previewScrollbarCanScroll
    ? Math.min(100, Math.max(10, activeScrollMetrics.clientHeight / activeScrollMetrics.scrollHeight * 100))
    : 100;
  const previewScrollbarThumbTop = previewScrollbarCanScroll
    ? activeScrollMetrics.scrollTop / (activeScrollMetrics.scrollHeight - activeScrollMetrics.clientHeight)
      * (100 - previewScrollbarThumbHeight)
    : 0;

  const handlePreviewDeviceChange = (nextDevice: PreviewDevice) => {
    if (nextDevice === previewDevice) return;
    setPreviewDevice(nextDevice);
    setWallpaperPickerOpen(false);
  };

  const handlePreviewScrollbarPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const viewport = activeScrollViewport;
    const track = previewScrollTrackRef.current;
    if (!viewport || !track) return;

    const maxScroll = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
    const trackHeight = track.clientHeight;
    const thumbHeight = Math.min(trackHeight, Math.max(16, viewport.clientHeight / Math.max(1, viewport.scrollHeight) * trackHeight));
    const target = event.target as HTMLElement;

    if (target.closest('.chat-preview-scrollbar-thumb')) {
      previewScrollDragRef.current = { pointerY: event.clientY, scrollTop: viewport.scrollTop };
      setPreviewScrollDragging(true);
      track.setPointerCapture(event.pointerId);
    } else {
      const trackBounds = track.getBoundingClientRect();
      const travel = Math.max(1, trackHeight - thumbHeight);
      const position = (event.clientY - trackBounds.top - thumbHeight / 2) / travel;
      viewport.scrollTop = Math.max(0, Math.min(maxScroll, position * maxScroll));
    }
    event.preventDefault();
  };

  const handlePreviewScrollbarPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = previewScrollDragRef.current;
    const viewport = activeScrollViewport;
    const track = previewScrollTrackRef.current;
    if (!drag || !viewport || !track) return;

    const maxScroll = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
    const trackHeight = track.clientHeight;
    const thumbHeight = Math.min(trackHeight, Math.max(16, viewport.clientHeight / Math.max(1, viewport.scrollHeight) * trackHeight));
    const travel = Math.max(1, trackHeight - thumbHeight);
    viewport.scrollTop = Math.max(0, Math.min(maxScroll, drag.scrollTop + (event.clientY - drag.pointerY) / travel * maxScroll));
  };

  const handlePreviewScrollbarKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const viewport = activeScrollViewport;
    if (!viewport) return;

    const pageStep = Math.max(40, viewport.clientHeight * 0.75);
    const nextScrollTop = event.key === 'ArrowDown' ? viewport.scrollTop + 40
      : event.key === 'ArrowUp' ? viewport.scrollTop - 40
        : event.key === 'PageDown' ? viewport.scrollTop + pageStep
          : event.key === 'PageUp' ? viewport.scrollTop - pageStep
            : event.key === 'Home' ? 0
              : event.key === 'End' ? viewport.scrollHeight - viewport.clientHeight
                : null;
    if (nextScrollTop === null) return;

    event.preventDefault();
    viewport.scrollTop = nextScrollTop;
  };

  return (
    <div className={`chat-preview-stand is-${previewDevice} ${collapsed ? 'is-collapsed' : ''} ${chatListOpen ? 'is-chat-list-open' : ''}`}>
      <div className={`chat-preview-toolbar${wallpaperPickerOpen ? ' is-wallpaper-picker-open' : ''}`}>
        {wallpaperPickerOpen && (
          <div className={`chat-preview-wallpaper-quick-picker ${previewDevice === 'web' ? 'is-inline' : ''}`} aria-label="Choose chat background">
            <button
              type="button"
              className={`chat-preview-wallpaper-quick-choice is-default ${wallpaperTheme === 'telegram' ? 'is-selected' : ''}`}
              onClick={() => { setWallpaperTheme('telegram'); setWallpaperPickerOpen(false); }}
              aria-label="Dark background"
              title="Dark background"
            />
            <button
              type="button"
              className={`chat-preview-wallpaper-quick-choice is-graphite ${wallpaperTheme === 'graphite' ? 'is-selected' : ''}`}
              onClick={() => { setWallpaperTheme('graphite'); setWallpaperPickerOpen(false); }}
              aria-label="Light background"
              title="Light background"
            />
            {uploadedWallpapers.map((image, index) => (
              <div className="chat-preview-wallpaper-uploaded-item" key={image}>
                <button
                  type="button"
                  className={`chat-preview-wallpaper-quick-choice is-uploaded ${wallpaperTheme === 'custom' && customWallpaperImage === image ? 'is-selected' : ''}`}
                  onClick={() => { setCustomWallpaperImage(image); setLastUploadedWallpaper(image); setWallpaperTheme('custom'); setWallpaperPickerOpen(false); }}
                  aria-label={`Uploaded background ${index + 1}`}
                  aria-pressed={wallpaperTheme === 'custom' && customWallpaperImage === image}
                  title={`Uploaded background ${index + 1}`}
                >
                  <img src={image} alt="" />
                </button>
                <button
                  type="button"
                  className="chat-preview-wallpaper-remove"
                  onClick={() => removeUploadedWallpaper(image)}
                  aria-label={`Remove uploaded background ${index + 1}`}
                  title="Remove background"
                >
                  <X size={10} strokeWidth={2.2} aria-hidden="true" />
                </button>
              </div>
            ))}
            <button
              type="button"
              className="chat-preview-wallpaper-quick-choice is-add"
              onClick={() => wallpaperFileInputRef.current?.click()}
              aria-label="Add new background"
              title={uploadedWallpapers.length >= MAX_UPLOADED_WALLPAPERS ? `Maximum ${MAX_WALLPAPERS} backgrounds` : 'Add new background'}
              disabled={uploadedWallpapers.length >= MAX_UPLOADED_WALLPAPERS}
            >
              <ImagePlus size={15} strokeWidth={1.8} aria-hidden="true" />
            </button>
          </div>
        )}
        <span className="chat-preview-toolbar-label">
          {previewDevice === 'mobile' ? t('studio.livePreview') : t('studio.liveChatPreview')}
        </span>
        <input
          ref={wallpaperFileInputRef}
          className="sr-only"
          type="file"
          accept="image/*"
          onChange={handleWallpaperFile}
        />
      </div>

      <div className="chat-preview-window-shell">
      <div className={`chat-preview-window theme-${effectiveWallpaperTheme} ${chatListOpen ? 'is-chat-list-open' : ''}`} style={wallpaperStyle}>
        <div className="chat-preview-mobile-system-bar" aria-hidden="true">
        <span>{previewTime}</span>
          <span className="chat-preview-mobile-system-icons">
            <Signal size={12} strokeWidth={2} />
            <Wifi size={13} strokeWidth={2} />
            <BatteryFull size={15} strokeWidth={2} />
          </span>
        </div>
        {chatListOpen && (
          <aside className="chat-preview-chat-list" aria-label="Chats">
            <div className="chat-preview-chat-list-heading">{t('studio.chats')}</div>
            <div
              className="chat-preview-chat-list-items"
              id="chat-preview-chat-list-items"
              ref={chatListItemsRef}
              style={shouldVirtualizeChatList ? {
                height: visibleChats.length * chatListRowHeight,
                position: 'relative',
              } : undefined}
            >
              {renderedChats.map((chat, visibleIndex) => (
                <button
                  type="button"
                  key={chat.id}
                  className={`chat-preview-chat-list-item ${selectedChat?.id === chat.id ? 'is-selected' : ''}`}
                  style={shouldVirtualizeChatList ? {
                    position: 'absolute',
                    top: (firstVisibleChatIndex + visibleIndex) * chatListRowHeight,
                    left: 0,
                    right: 0,
                    height: chatListRowHeight,
                    boxSizing: 'border-box',
                  } : undefined}
                  onClick={() => onSelectChat(chat)}
                >
                  <ChatAvatar name={chat.name} src={chat.avatarDataUrl} className="chat-preview-chat-list-avatar" />
                  <span className="chat-preview-chat-list-copy">
                    <strong>{chat.name}</strong>
                    <span>{chat.name === 'Saved Messages' ? t('studio.savedMessagesType') : chat.type || t('studio.chatType')}</span>
                  </span>
                </button>
              ))}
              {visibleChats.length === 0 && <span className="chat-preview-chat-list-empty">{t('studio.noChatsFound')}</span>}
            </div>
            {previewDevice === 'web' && (
              <label className="chat-preview-chat-search">
                <Search size={14} strokeWidth={1.8} aria-hidden="true" />
                <input
                  type="text"
                  value={chatSearchQuery}
                  onChange={(event) => {
                    setChatSearchQuery(event.target.value);
                    if (chatListItemsRef.current) chatListItemsRef.current.scrollTop = 0;
                  }}
                  aria-label="Search chats"
                  placeholder="Search"
                  autoComplete="off"
                />
              </label>
            )}
          </aside>
        )}
        <header className="chat-preview-header">
          {previewDevice === 'mobile' && (
            <button type="button" className="chat-preview-mobile-back" onClick={onToggleChatList} aria-label="Back to chats" title="Back to chats">
              <ArrowLeft size={20} strokeWidth={2} aria-hidden="true" />
            </button>
          )}
          <ChatAvatar
            as="div"
            name={previewTitle}
            src={activePreviewHistory?.chat.avatarDataUrl || selectedChat?.avatarDataUrl}
            className="chat-preview-avatar"
          />
          <div className="chat-preview-header-copy">
            <strong>{previewTitle}</strong>
            <span><i className="chat-preview-status-dot" aria-hidden="true" />{previewType === 'private' ? t('studio.online') : previewType}</span>
          </div>
          <div className="chat-preview-header-actions" ref={previewOptionsRef}>
            <button
              type="button"
              className="chat-preview-expand"
              onClick={() => {
                if (wallpaperPickerOpen) {
                  setWallpaperPickerOpen(false);
                  return;
                }
                if (previewDevice === 'web' && chatListOpen && !previewOptionsOpen) {
                  onToggleChatList();
                  return;
                }
                const nextOpen = !previewOptionsOpen;
                if (nextOpen && chatListOpen) onToggleChatList();
                setPreviewOptionsOpen(nextOpen);
              }}
              aria-label="Preview settings"
              aria-expanded={previewOptionsOpen}
              aria-controls="chat-preview-options-menu"
              title="Preview settings"
            >
              <SlidersHorizontal size={17} strokeWidth={1.8} aria-hidden="true" />
            </button>
            {previewOptionsOpen && (
              <div className="chat-preview-options-menu" id="chat-preview-options-menu" role="group" aria-label="Preview settings">
                <button
                  type="button"
                  className="chat-preview-expand"
                  onClick={() => {
                    handlePreviewDeviceChange(previewDevice === 'mobile' ? 'web' : 'mobile');
                    setPreviewOptionsOpen(false);
                  }}
                  aria-label={previewDevice === 'mobile' ? 'Switch to Web preview' : 'Switch to Mobile preview'}
                  aria-pressed={previewDevice === 'mobile'}
                  title={previewDevice === 'mobile' ? 'Switch to Web preview' : 'Switch to Mobile preview'}
                >
                  {previewDevice === 'mobile'
                    ? <Monitor size={17} strokeWidth={1.8} aria-hidden="true" />
                    : <Smartphone size={17} strokeWidth={1.8} aria-hidden="true" />}
                </button>
                {previewDevice === 'web' && (
                  <button
                    type="button"
                    className={`chat-preview-expand ${chatListOpen ? 'is-active' : ''}`}
                    onClick={() => { onToggleChatList(); setPreviewOptionsOpen(false); }}
                    aria-label={chatListOpen ? 'Hide chats' : 'Show chats'}
                    title={chatListOpen ? 'Hide chats' : 'Show chats'}
                  >
                    {chatListOpen ? <span aria-hidden="true">×</span> : <MessageCircle size={17} strokeWidth={1.8} aria-hidden="true" />}
                  </button>
                )}
                <button
                  type="button"
                  className={`chat-preview-expand ${wallpaperPickerOpen ? 'is-active' : ''}`}
                  onClick={() => { setWallpaperPickerOpen((current) => !current); setPreviewOptionsOpen(false); }}
                  aria-label="Choose chat background"
                  aria-pressed={wallpaperPickerOpen}
                  title="Choose chat background"
                >
                  <ImagePlus size={17} strokeWidth={1.8} aria-hidden="true" />
                </button>
              </div>
            )}
          </div>
        </header>

        {!collapsed && (
          <div className="chat-preview-wallpaper">
            <div className="chat-preview-feed" id="chat-preview-feed" ref={previewFeedRef}>
              <button
                type="button"
                className="chat-preview-service-date"
                onClick={onToggleChatList}
                aria-label={chatListOpen ? 'Close chat list' : 'Open chat list'}
                title={chatListOpen ? 'Close chat list' : 'Open chat list'}
              >
                {t('studio.today')}
              </button>
              {previewHistoryLoading && <div className="chat-preview-state">{t('studio.loadingHistory')}</div>}
              <ChatPreviewHistory
                groups={historyGroups}
                selectedChatType={selectedChat?.type}
                onOpenPhoto={setExpandedHistoryPhoto}
                viewPhotoLabel={t('studio.viewPhotoFullSize')}
              />

              {hasDraft ? (
                <article
                  className="chat-preview-bubble is-outgoing chat-preview-draft-bubble"
                >
                  {imageAttachments.length > 0 && (
                    <div className={`chat-preview-attachment-grid ${imageAttachments.length > 1 ? 'is-album' : ''}`}>
                      {imageAttachments.map((attachment, index) => {
                        const src = attachment.previewUrl || toFileUrl(attachment.path);
                        return (
                          <button
                            key={`${attachment.path}:${index}`}
                            type="button"
                            className="chat-preview-attachment-photo-trigger"
                            onClick={() => setExpandedHistoryPhoto({ src, name: attachment.name })}
                            aria-label={t('studio.viewPhotoFullSize')}
                            title={t('studio.viewPhotoFullSize')}
                          >
                            <img
                              src={src}
                              alt={attachment.name}
                              onLoad={() => {
                                const feed = previewFeedRef.current;
                                if (!collapsed && !previewHistoryLoading && feed) scrollPreviewFeedToDraft(feed);
                              }}
                            />
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {documentAttachments.length > 0 && (
                    <div className="chat-preview-document-list">
                        {documentAttachments.map((attachment, index) => (
                          <div className="chat-preview-document" key={`${attachment.path}:${index}`}>
                          <span className="chat-preview-file-icon">FILE</span>
                          <span>{attachment.name}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {normalizedDraft.message.trim() && (
                    <div className="chat-preview-message" dangerouslySetInnerHTML={{ __html: richTextToHtml(normalizedDraft.message, normalizedDraft.entities) }} />
                  )}
                  <div className="chat-preview-meta"><time>{previewTime}</time><span aria-label="Sent">✓✓</span></div>
                  {linkEntities.length > 0 && (
                    <div className="chat-preview-link-preview">
                      {linkEntities.map((entity, index) => <a href={entity.url} target="_blank" rel="noreferrer" key={`${entity.url}-${index}`}>{getEntityText(normalizedDraft.message, entity)}</a>)}
                    </div>
                  )}
                </article>
              ) : (
                shouldShowEmptyPreviewHint ? <div className="chat-preview-empty">{t('studio.emptyPreview')}</div> : null
              )}
            </div>
          </div>
        )}
        {!collapsed && (
          <div className="chat-preview-composer" aria-hidden="true">
            <span className="chat-preview-composer-action"><Paperclip size={19} strokeWidth={1.8} /></span>
            <span className="chat-preview-composer-input">
              {t('studio.messagePlaceholder')}
              <span className="chat-preview-composer-emoji"><Smile size={19} strokeWidth={1.8} /></span>
            </span>
            <span className="chat-preview-composer-action">
              {hasDraft
                ? <Send size={18} strokeWidth={1.9} />
                : <Mic size={19} strokeWidth={1.8} />}
            </span>
          </div>
        )}
        <div className="chat-preview-mobile-home-indicator" aria-hidden="true"><span /></div>
      </div>
      <div
        className={`chat-preview-scrollbar-track ${previewScrollbarCanScroll && !collapsed ? '' : 'is-hidden'} ${previewScrollDragging ? 'is-dragging' : ''}`}
        ref={previewScrollTrackRef}
        role="scrollbar"
        tabIndex={previewScrollbarCanScroll && !collapsed ? 0 : -1}
        aria-label={chatListOpen ? 'Chat list scroll' : 'Live chat preview scroll'}
        aria-controls={chatListOpen ? 'chat-preview-chat-list-items' : 'chat-preview-feed'}
        aria-orientation="vertical"
        aria-hidden={!previewScrollbarCanScroll || collapsed}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={previewScrollbarCanScroll
          ? Math.round(activeScrollMetrics.scrollTop / (activeScrollMetrics.scrollHeight - activeScrollMetrics.clientHeight) * 100)
          : 0}
        onPointerDown={handlePreviewScrollbarPointerDown}
        onPointerMove={handlePreviewScrollbarPointerMove}
          onPointerUp={() => { previewScrollDragRef.current = null; setPreviewScrollDragging(false); }}
          onPointerCancel={() => { previewScrollDragRef.current = null; setPreviewScrollDragging(false); }}
          onLostPointerCapture={() => { previewScrollDragRef.current = null; setPreviewScrollDragging(false); }}
        onKeyDown={handlePreviewScrollbarKeyDown}
      >
        {previewScrollbarCanScroll && !collapsed && (
          <div
            className="chat-preview-scrollbar-thumb"
            style={{
              height: `${previewScrollbarThumbHeight}%`,
              top: `${previewScrollbarThumbTop}%`,
            }}
          />
        )}
      </div>
      </div>
      {expandedHistoryPhoto && createPortal(
        <div
          className="chat-preview-image-viewer"
          role="dialog"
          aria-modal="true"
          aria-label={t('studio.previewFile', { name: expandedHistoryPhoto.name || t('studio.photo') })}
          onClick={(event) => {
            if (event.target === event.currentTarget) setExpandedHistoryPhoto(null);
          }}
        >
          <button
            type="button"
            className="chat-preview-image-viewer-close"
            onClick={() => setExpandedHistoryPhoto(null)}
            aria-label={t('studio.closePhotoPreview')}
            title={t('studio.closePhotoPreview')}
          >
            <X size={22} strokeWidth={2} aria-hidden="true" />
          </button>
          <img src={expandedHistoryPhoto.src} alt={expandedHistoryPhoto.name || t('studio.photo')} />
        </div>,
        document.body,
      )}
    </div>
  );
}
