import { ArrowLeft, BatteryFull, ImagePlus, MessageCircle, Mic, Paperclip, Search, Send, Signal, SlidersHorizontal, Smartphone, Smile, Wifi, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { Chat, PreviewChatHistory, RichTextEntity } from '@/types';
import { toInlineKeyboardMarkup, type InlineButtonRow } from '@/lib/inlineKeyboard';
import { InlineKeyboardPreview } from '@/components/InlineKeyboardPreview';
import { richTextToHtml } from '@/lib/richText';
import './ChatPreviewStand.css';

type PreviewAttachment = {
  name: string;
  path: string;
  previewUrl?: string;
};

type WallpaperTheme = 'telegram' | 'graphite' | 'custom';
type PreviewDevice = 'web' | 'mobile';

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
  inlineButtons: InlineButtonRow[];
  attachments: PreviewAttachment[];
  previewTime: string;
  collapsed: boolean;
  chatListOpen: boolean;
  onToggleChatList: () => void;
  onSelectChat: (chat: Chat) => void;
  onWallpaperChange?: (wallpaper: ChatWallpaper) => void;
};

type HistoryGroup = {
  key: string;
  groupId?: string;
  messages: PreviewChatHistory['messages'];
};

type SavedWallpaper = {
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
      theme: saved.theme === 'custom' ? 'custom' : saved.theme === 'graphite' ? 'graphite' : 'telegram',
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

function formatDuration(duration?: number) {
  if (!duration || duration < 1) return '';
  const minutes = Math.floor(duration / 60);
  const seconds = Math.floor(duration % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function isImageAttachment(attachment: PreviewAttachment) {
  return Boolean(attachment.path || attachment.previewUrl) && /\.(?:avif|gif|jpe?g|png|webp)$/i.test(attachment.name);
}

function renderHistoryMedia(message: PreviewChatHistory['messages'][number]) {
  const media = message.media;
  if (!media) return null;

  if (media.kind === 'photo' || media.kind === 'video') {
    return media.dataUrl || media.thumbnailDataUrl ? (
      <div className="chat-preview-history-media-frame">
        <img loading="lazy" src={media.thumbnailDataUrl || media.dataUrl} alt={media.name || 'Telegram media'} />
        {media.kind === 'video' && <span className="chat-preview-play">▶</span>}
        {media.kind === 'video' && media.duration && (
          <span className="chat-preview-duration">{formatDuration(media.duration)}</span>
        )}
      </div>
    ) : (
      <div className="chat-preview-media-placeholder">
        {media.kind === 'video' ? 'Video preview unavailable' : 'Photo preview unavailable'}
      </div>
    );
  }

  if (media.kind === 'audio') {
    return (
      <div className="chat-preview-audio">
        <strong>{media.name || 'Audio message'}</strong>
        <span>{formatDuration(media.duration) || 'Audio preview unavailable'}</span>
        {media.dataUrl && <audio controls preload="metadata" src={media.dataUrl} />}
      </div>
    );
  }

  return (
    <div className="chat-preview-document">
      <span className="chat-preview-file-icon">FILE</span>
      <span>{media.name || 'Document'}</span>
    </div>
  );
}

function groupHistory(messages: PreviewChatHistory['messages']): HistoryGroup[] {
  const groups: HistoryGroup[] = [];

  for (const message of messages) {
    const previous = groups[groups.length - 1];
    const groupHasMedia = previous?.messages.some((item) => item.media) ?? false;
    if (message.groupId && previous?.groupId === message.groupId && (Boolean(message.media) || groupHasMedia)) {
      previous.messages.push(message);
    } else {
      groups.push({
        key: message.media ? message.groupId || message.id : message.id,
        groupId: message.groupId,
        messages: [message],
      });
    }
  }

  return groups;
}

function getEntityText(text: string, entity: RichTextEntity) {
  return text.slice(entity.offset, entity.offset + entity.length).trim() || 'Open link';
}

export function ChatPreviewStand({
  selectedChat,
  chats,
  previewHistory,
  previewHistoryLoading,
  previewFeedRef,
  draftText,
  draftEntities,
  inlineButtons,
  attachments,
  previewTime,
  collapsed,
  chatListOpen,
  onToggleChatList,
  onSelectChat,
  onWallpaperChange,
}: ChatPreviewStandProps) {
  const savedWallpaper = useMemo(loadSavedWallpaper, []);
  const [previewDevice, setPreviewDevice] = useState<PreviewDevice>('web');
  const [wallpaperTheme, setWallpaperTheme] = useState<WallpaperTheme>(savedWallpaper.theme);
  const [customWallpaperImage, setCustomWallpaperImage] = useState(savedWallpaper.image);
  const [lastUploadedWallpaper, setLastUploadedWallpaper] = useState(savedWallpaper.image);
  const [uploadedWallpapers, setUploadedWallpapers] = useState<string[]>(savedWallpaper.wallpapers ?? []);
  const [wallpaperAccent, setWallpaperAccent] = useState(savedWallpaper.accent);
  const wallpaperFileInputRef = useRef<HTMLInputElement | null>(null);
  const previewOptionsRef = useRef<HTMLDivElement | null>(null);
  const previewScrollTrackRef = useRef<HTMLDivElement | null>(null);
  const previewScrollDragRef = useRef<{ pointerY: number; scrollTop: number } | null>(null);
  const [wallpaperPickerOpen, setWallpaperPickerOpen] = useState(false);
  const [previewOptionsOpen, setPreviewOptionsOpen] = useState(false);
  const [chatSearchQuery, setChatSearchQuery] = useState('');
  const [previewScrollDragging, setPreviewScrollDragging] = useState(false);
  const [previewScrollMetrics, setPreviewScrollMetrics] = useState<PreviewScrollMetrics>({
    scrollTop: 0,
    scrollHeight: 0,
    clientHeight: 0,
  });

  useEffect(() => {
    try {
      const serialized = JSON.stringify({ theme: wallpaperTheme, image: lastUploadedWallpaper, accent: wallpaperAccent });
      window.localStorage.setItem(CHAT_WALLPAPER_STORAGE_KEY, serialized);
      window.localStorage.setItem(LEGACY_CHAT_WALLPAPER_STORAGE_KEY, serialized);
    } catch {
      // Ignore unavailable or full local storage; the current session still works.
    }
  }, [lastUploadedWallpaper, wallpaperAccent, wallpaperTheme]);

  useEffect(() => {
    try {
      const serialized = JSON.stringify({ theme: wallpaperTheme, image: lastUploadedWallpaper, accent: wallpaperAccent, wallpapers: uploadedWallpapers });
      window.localStorage.setItem(CHAT_WALLPAPER_STORAGE_KEY, serialized);
      window.localStorage.setItem(LEGACY_CHAT_WALLPAPER_STORAGE_KEY, serialized);
    } catch {
      // Keep the current session usable when storage is unavailable.
    }
  }, [lastUploadedWallpaper, uploadedWallpapers, wallpaperAccent, wallpaperTheme]);

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
  }, [attachments.length, collapsed, draftText, previewFeedRef, previewHistory?.messages, previewHistoryLoading]);

  const activePreviewHistory = previewHistory?.chat.id === selectedChat?.id
    ? previewHistory
    : null;
  const previewTitle = activePreviewHistory?.chat.title || selectedChat?.name || 'Select a chat';
  const previewType = activePreviewHistory?.chat.topic
    || (activePreviewHistory?.chat.username ? `@${activePreviewHistory.chat.username}` : '')
    || activePreviewHistory?.chat.type
    || selectedChat?.type
    || 'online';
  const historyGroups = useMemo(
    () => groupHistory(activePreviewHistory?.messages ?? []),
    [activePreviewHistory?.messages],
  );
  const imageAttachments = attachments.filter(isImageAttachment);
  const documentAttachments = attachments.filter((attachment) => !isImageAttachment(attachment));
  const linkEntities = draftEntities.filter((entity) => entity.type === 'text_url' && entity.url);
  const normalizedChatSearch = chatSearchQuery.trim().toLocaleLowerCase();
  const visibleChats = chats.filter((chat) => (
    !normalizedChatSearch
    || `${chat.name} ${chat.username ?? ''} ${chat.type ?? ''}`.toLocaleLowerCase().includes(normalizedChatSearch)
  ));
  const hasDraft = Boolean(draftText.trim() || attachments.length);
  const wallpaperImage = customWallpaperImage;
  const wallpaperStyle = wallpaperTheme === 'custom' && wallpaperImage
    ? { backgroundImage: `url(${wallpaperImage})` }
    : undefined;

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
      setWallpaperTheme('telegram');
      setWallpaperAccent('');
    }
  };

  const previewFeedCanScroll = previewScrollMetrics.scrollHeight > previewScrollMetrics.clientHeight + 1;
  const previewScrollbarThumbHeight = previewFeedCanScroll
    ? Math.min(100, Math.max(10, previewScrollMetrics.clientHeight / previewScrollMetrics.scrollHeight * 100))
    : 100;
  const previewScrollbarThumbTop = previewFeedCanScroll
    ? previewScrollMetrics.scrollTop / (previewScrollMetrics.scrollHeight - previewScrollMetrics.clientHeight)
      * (100 - previewScrollbarThumbHeight)
    : 0;

  const handlePreviewDeviceChange = (nextDevice: PreviewDevice) => {
    if (nextDevice === previewDevice) return;
    setPreviewDevice(nextDevice);
  };

  const handlePreviewScrollbarPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const feed = previewFeedRef.current;
    const track = previewScrollTrackRef.current;
    if (!feed || !track) return;

    const maxScroll = Math.max(0, feed.scrollHeight - feed.clientHeight);
    const trackHeight = track.clientHeight;
    const thumbHeight = Math.min(trackHeight, Math.max(16, feed.clientHeight / Math.max(1, feed.scrollHeight) * trackHeight));
    const target = event.target as HTMLElement;

    if (target.closest('.chat-preview-scrollbar-thumb')) {
      previewScrollDragRef.current = { pointerY: event.clientY, scrollTop: feed.scrollTop };
      setPreviewScrollDragging(true);
      track.setPointerCapture(event.pointerId);
    } else {
      const trackBounds = track.getBoundingClientRect();
      const travel = Math.max(1, trackHeight - thumbHeight);
      const position = (event.clientY - trackBounds.top - thumbHeight / 2) / travel;
      feed.scrollTop = Math.max(0, Math.min(maxScroll, position * maxScroll));
    }
    event.preventDefault();
  };

  const handlePreviewScrollbarPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = previewScrollDragRef.current;
    const feed = previewFeedRef.current;
    const track = previewScrollTrackRef.current;
    if (!drag || !feed || !track) return;

    const maxScroll = Math.max(0, feed.scrollHeight - feed.clientHeight);
    const trackHeight = track.clientHeight;
    const thumbHeight = Math.min(trackHeight, Math.max(16, feed.clientHeight / Math.max(1, feed.scrollHeight) * trackHeight));
    const travel = Math.max(1, trackHeight - thumbHeight);
    feed.scrollTop = Math.max(0, Math.min(maxScroll, drag.scrollTop + (event.clientY - drag.pointerY) / travel * maxScroll));
  };

  const handlePreviewScrollbarKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const feed = previewFeedRef.current;
    if (!feed) return;

    const pageStep = Math.max(40, feed.clientHeight * 0.75);
    const nextScrollTop = event.key === 'ArrowDown' ? feed.scrollTop + 40
      : event.key === 'ArrowUp' ? feed.scrollTop - 40
        : event.key === 'PageDown' ? feed.scrollTop + pageStep
          : event.key === 'PageUp' ? feed.scrollTop - pageStep
            : event.key === 'Home' ? 0
              : event.key === 'End' ? feed.scrollHeight - feed.clientHeight
                : null;
    if (nextScrollTop === null) return;

    event.preventDefault();
    feed.scrollTop = nextScrollTop;
  };

  return (
    <div className={`chat-preview-stand is-${previewDevice} ${collapsed ? 'is-collapsed' : ''} ${chatListOpen ? 'is-chat-list-open' : ''}`}>
      <div className="chat-preview-toolbar">
        <span className="chat-preview-toolbar-label">Live chat preview</span>
        {wallpaperPickerOpen && (
          <div className="chat-preview-wallpaper-quick-picker" aria-label="Choose chat background">
            <button
              type="button"
              className={`chat-preview-wallpaper-quick-choice is-default ${wallpaperTheme === 'telegram' ? 'is-selected' : ''}`}
              onClick={() => { setWallpaperTheme('telegram'); setWallpaperPickerOpen(false); }}
              aria-label="Default background"
              title="Default background"
            />
            <button
              type="button"
              className={`chat-preview-wallpaper-quick-choice is-graphite ${wallpaperTheme === 'graphite' ? 'is-selected' : ''}`}
              onClick={() => { setWallpaperTheme('graphite'); setWallpaperPickerOpen(false); }}
              aria-label="Graphite background"
              title="Graphite background"
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
        <input
          ref={wallpaperFileInputRef}
          className="sr-only"
          type="file"
          accept="image/*"
          onChange={handleWallpaperFile}
        />
      </div>

      <div className="chat-preview-window-shell">
      <div className={`chat-preview-window theme-${wallpaperTheme} ${chatListOpen ? 'is-chat-list-open' : ''}`} style={wallpaperStyle}>
        <div className="chat-preview-mobile-system-bar" aria-hidden="true">
          <span>9:41</span>
          <span className="chat-preview-mobile-system-icons">
            <Signal size={12} strokeWidth={2} />
            <Wifi size={13} strokeWidth={2} />
            <BatteryFull size={15} strokeWidth={2} />
          </span>
        </div>
        {chatListOpen && (
          <aside className="chat-preview-chat-list" aria-label="Chats">
            <div className="chat-preview-chat-list-heading">Chats</div>
            <div className="chat-preview-chat-list-items">
              {visibleChats.map((chat) => (
                <button
                  type="button"
                  key={chat.id}
                  className={`chat-preview-chat-list-item ${selectedChat?.id === chat.id ? 'is-selected' : ''}`}
                  onClick={() => onSelectChat(chat)}
                >
                  <span className="chat-preview-chat-list-avatar" aria-hidden="true">
                    {chat.avatarDataUrl ? <img src={chat.avatarDataUrl} alt="" /> : chat.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="chat-preview-chat-list-copy">
                    <strong>{chat.name}</strong>
                    <span>{chat.name === 'Saved Messages' ? 'Saved Messages' : chat.type || 'Chat'}</span>
                  </span>
                </button>
              ))}
              {visibleChats.length === 0 && <span className="chat-preview-chat-list-empty">No chats found</span>}
            </div>
            {previewDevice === 'web' && (
              <label className="chat-preview-chat-search">
                <Search size={14} strokeWidth={1.8} aria-hidden="true" />
                <input
                  type="text"
                  value={chatSearchQuery}
                  onChange={(event) => setChatSearchQuery(event.target.value)}
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
          {activePreviewHistory?.chat.avatarDataUrl ? (
            <img className="chat-preview-avatar" src={activePreviewHistory.chat.avatarDataUrl} alt="" />
          ) : (
            <div className="chat-preview-avatar" aria-hidden="true">{previewTitle.slice(0, 1).toUpperCase()}</div>
          )}
          <div className="chat-preview-header-copy">
            <strong>{previewTitle}</strong>
            <span><i className="chat-preview-status-dot" aria-hidden="true" />{previewType === 'private' ? 'online' : previewType}</span>
          </div>
          <div className="chat-preview-header-actions" ref={previewOptionsRef}>
            <button
              type="button"
              className="chat-preview-expand"
              onClick={() => {
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
                  <Smartphone size={17} strokeWidth={1.8} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className={`chat-preview-expand ${chatListOpen ? 'is-active' : ''}`}
                  onClick={() => { onToggleChatList(); setPreviewOptionsOpen(false); }}
                  aria-label={chatListOpen ? 'Hide chats' : 'Show chats'}
                  title={chatListOpen ? 'Hide chats' : 'Show chats'}
                >
                  {chatListOpen ? <span aria-hidden="true">×</span> : <MessageCircle size={17} strokeWidth={1.8} aria-hidden="true" />}
                </button>
                <button
                  type="button"
                  className="chat-preview-expand"
                  onClick={() => { setWallpaperPickerOpen((current) => !current); setPreviewOptionsOpen(false); }}
                  aria-label="Choose chat background"
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
                Today
              </button>
              {previewHistoryLoading && <div className="chat-preview-state">Loading history…</div>}
              {historyGroups.map((group) => {
                const firstMessage = group.messages[0];
                const hasMedia = group.messages.some((message) => message.media);
                return (
                  <article className={`chat-preview-history-entry ${firstMessage.outgoing ? 'is-outgoing' : 'is-incoming'} ${hasMedia ? 'has-media' : ''}`} key={group.key}>
                    {!firstMessage.outgoing && selectedChat?.type !== 'private' && firstMessage.senderName && (
                      <span className="chat-preview-sender">{firstMessage.senderName}</span>
                    )}
                    {hasMedia && (
                      <div className={`chat-preview-history-grid ${group.messages.length > 1 ? 'is-album' : ''}`}>
                        {group.messages.map((message) => <div key={message.id}>{renderHistoryMedia(message)}</div>)}
                      </div>
                    )}
                    {group.messages.filter((message) => message.text).map((message) => (
                      <div
                        className="chat-preview-message"
                        key={message.id}
                        dangerouslySetInnerHTML={{ __html: richTextToHtml(message.text, message.entities ?? []) }}
                      />
                    ))}
                    <InlineKeyboardPreview markup={group.messages.find((message) => message.replyMarkup)?.replyMarkup} />
                    <div className="chat-preview-meta">
                      <time>{new Date(firstMessage.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
                      {firstMessage.outgoing && <span aria-label="Sent">✓✓</span>}
                    </div>
                  </article>
                );
              })}

              {hasDraft ? (
                <article
                  className="chat-preview-bubble is-outgoing chat-preview-draft-bubble"
                >
                  {imageAttachments.length > 0 && (
                    <div className={`chat-preview-attachment-grid ${imageAttachments.length > 1 ? 'is-album' : ''}`}>
                      {imageAttachments.map((attachment) => (
                        <img key={attachment.name} src={attachment.previewUrl || toFileUrl(attachment.path)} alt={attachment.name} />
                      ))}
                    </div>
                  )}
                  {documentAttachments.length > 0 && (
                    <div className="chat-preview-document-list">
                      {documentAttachments.map((attachment) => (
                        <div className="chat-preview-document" key={attachment.name}>
                          <span className="chat-preview-file-icon">FILE</span>
                          <span>{attachment.name}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {draftText.trim() && (
                    <div className="chat-preview-message" dangerouslySetInnerHTML={{ __html: richTextToHtml(draftText, draftEntities) }} />
                  )}
                  <div className="chat-preview-meta"><time>{previewTime}</time><span aria-label="Sent">✓✓</span></div>
                  <InlineKeyboardPreview markup={toInlineKeyboardMarkup(inlineButtons)} />
                  {linkEntities.length > 0 && (
                    <div className="chat-preview-inline-keyboard">
                      {linkEntities.map((entity, index) => <a href={entity.url} target="_blank" rel="noreferrer" key={`${entity.url}-${index}`}>{getEntityText(draftText, entity)}</a>)}
                    </div>
                  )}
                </article>
              ) : (
                <div className="chat-preview-empty">Your message will appear here as you write.</div>
              )}
            </div>
          </div>
        )}
        {!collapsed && (
          <div className="chat-preview-composer" aria-hidden="true">
            <span className="chat-preview-composer-action"><Paperclip size={19} strokeWidth={1.8} /></span>
            <span className="chat-preview-composer-input">Message</span>
            <span className="chat-preview-composer-action"><Smile size={19} strokeWidth={1.8} /></span>
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
        className={`chat-preview-scrollbar-track ${previewFeedCanScroll && !collapsed ? '' : 'is-hidden'} ${previewScrollDragging ? 'is-dragging' : ''}`}
        ref={previewScrollTrackRef}
        role="scrollbar"
        tabIndex={previewFeedCanScroll && !collapsed ? 0 : -1}
        aria-label="Live chat preview scroll"
        aria-controls="chat-preview-feed"
        aria-orientation="vertical"
        aria-hidden={!previewFeedCanScroll || collapsed}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={previewFeedCanScroll
          ? Math.round(previewScrollMetrics.scrollTop / (previewScrollMetrics.scrollHeight - previewScrollMetrics.clientHeight) * 100)
          : 0}
        onPointerDown={handlePreviewScrollbarPointerDown}
        onPointerMove={handlePreviewScrollbarPointerMove}
          onPointerUp={() => { previewScrollDragRef.current = null; setPreviewScrollDragging(false); }}
          onPointerCancel={() => { previewScrollDragRef.current = null; setPreviewScrollDragging(false); }}
          onLostPointerCapture={() => { previewScrollDragRef.current = null; setPreviewScrollDragging(false); }}
        onKeyDown={handlePreviewScrollbarKeyDown}
      >
        {previewFeedCanScroll && !collapsed && (
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
    </div>
  );
}
