import { ImagePlus, MessageCircle } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { Chat, PreviewChatHistory, RichTextEntity } from '@/types';
import { toInlineKeyboardMarkup, type InlineButtonRow } from '@/lib/inlineKeyboard';
import { InlineKeyboardPreview } from '@/components/InlineKeyboardPreview';
import { useLocale } from '@/lib/i18n';
import { richTextToHtml } from '@/lib/richText';
import './ChatPreviewStand.css';

type PreviewAttachment = {
  name: string;
  path: string;
};

type WallpaperTheme = 'telegram' | 'graphite' | 'custom';

export type ChatWallpaper = {
  theme: WallpaperTheme;
  image: string;
  accent: string;
};

const CHAT_WALLPAPER_STORAGE_KEY = 'awaitmsg-chat-preview-wallpaper';

type ChatPreviewStandProps = {
  chats: Chat[];
  selectedChat: Chat | null;
  previewHistory: PreviewChatHistory | null;
  previewHistoryLoading: boolean;
  previewHistoryError: string;
  previewHistoryRetry: () => void;
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
  rightPanelMode?: 'preview' | 'queue';
  onRightPanelModeChange?: (mode: 'preview' | 'queue') => void;
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

function loadSavedWallpaper(): SavedWallpaper {
  try {
    const raw = window.localStorage.getItem(CHAT_WALLPAPER_STORAGE_KEY);
    if (!raw) return { theme: 'telegram', image: '', accent: '' };

    const saved = JSON.parse(raw) as Partial<SavedWallpaper>;
    return {
      theme: saved.theme === 'custom' ? 'custom' : saved.theme === 'graphite' ? 'graphite' : 'telegram',
      image: typeof saved.image === 'string' ? saved.image : '',
      accent: typeof saved.accent === 'string' ? saved.accent : '',
      wallpapers: Array.isArray(saved.wallpapers)
        ? saved.wallpapers.filter((image): image is string => typeof image === 'string' && image.length > 0)
        : typeof saved.image === 'string' && saved.image ? [saved.image] : [],
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
  return Boolean(attachment.path) && /\.(?:avif|gif|jpe?g|png|webp)$/i.test(attachment.name);
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
  previewHistoryError,
  previewHistoryRetry,
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
  const { t } = useLocale();
  const savedWallpaper = useMemo(loadSavedWallpaper, []);
  const [wallpaperTheme, setWallpaperTheme] = useState<WallpaperTheme>(savedWallpaper.theme);
  const [customWallpaperImage, setCustomWallpaperImage] = useState(savedWallpaper.image);
  const [lastUploadedWallpaper, setLastUploadedWallpaper] = useState(savedWallpaper.image);
  const [uploadedWallpapers, setUploadedWallpapers] = useState<string[]>(savedWallpaper.wallpapers ?? []);
  const [wallpaperAccent, setWallpaperAccent] = useState(savedWallpaper.accent);
  const wallpaperFileInputRef = useRef<HTMLInputElement | null>(null);
  const [wallpaperPickerOpen, setWallpaperPickerOpen] = useState(false);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        CHAT_WALLPAPER_STORAGE_KEY,
        JSON.stringify({ theme: wallpaperTheme, image: lastUploadedWallpaper, accent: wallpaperAccent }),
      );
    } catch {
      // Ignore unavailable or full local storage; the current session still works.
    }
  }, [lastUploadedWallpaper, wallpaperAccent, wallpaperTheme]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        CHAT_WALLPAPER_STORAGE_KEY,
        JSON.stringify({ theme: wallpaperTheme, image: lastUploadedWallpaper, accent: wallpaperAccent, wallpapers: uploadedWallpapers }),
      );
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
  const hasDraft = Boolean(draftText.trim() || attachments.length);
  const wallpaperImage = customWallpaperImage;
  const wallpaperStyle = wallpaperTheme === 'custom' && wallpaperImage
    ? { backgroundImage: `url(${wallpaperImage})` }
    : undefined;

  const handleWallpaperFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;

    const reader = new FileReader();
    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') {
        setCustomWallpaperImage(reader.result);
        setLastUploadedWallpaper(reader.result);
        setUploadedWallpapers((current) => current.includes(reader.result as string) ? current : [...current, reader.result as string]);
        setWallpaperTheme('custom');
        setWallpaperPickerOpen(false);
        void readImageAccent(reader.result).then(setWallpaperAccent);
      }
    });
    reader.readAsDataURL(file);
    event.target.value = '';
  };

  const draftBubbleColor = wallpaperTheme === 'graphite'
    ? 'rgba(36, 42, 46, 0.28)'
    : wallpaperTheme === 'custom' && wallpaperAccent
      ? 'rgba(20, 34, 38, 0.28)'
      : 'rgba(35, 76, 82, 0.28)';

  return (
    <div className={`chat-preview-stand ${collapsed ? 'is-collapsed' : ''} ${chatListOpen ? 'is-chat-list-open' : ''}`}>
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
              <button
                type="button"
                key={image}
                className={`chat-preview-wallpaper-quick-choice is-uploaded ${wallpaperTheme === 'custom' && customWallpaperImage === image ? 'is-selected' : ''}`}
                onClick={() => { setCustomWallpaperImage(image); setLastUploadedWallpaper(image); setWallpaperTheme('custom'); setWallpaperPickerOpen(false); }}
                aria-label={`Uploaded background ${index + 1}`}
                title={`Uploaded background ${index + 1}`}
              >
                <img src={image} alt="" />
              </button>
            ))}
            <button
              type="button"
              className="chat-preview-wallpaper-quick-choice is-add"
              onClick={() => wallpaperFileInputRef.current?.click()}
              aria-label="Add new background"
              title="Add new background"
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

      <div className={`chat-preview-window theme-${wallpaperTheme} ${chatListOpen ? 'is-chat-list-open' : ''}`} style={wallpaperStyle}>
        {chatListOpen && (
          <aside className="chat-preview-chat-list" aria-label="Chats">
            <div className="chat-preview-chat-list-heading">Chats</div>
            <div className="chat-preview-chat-list-items">
              {chats.map((chat) => (
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
                    <strong>{chat.name === 'Saved Messages' ? t('chat.savedMessages') : chat.name}</strong>
                    <span>{chat.name === 'Saved Messages' ? t('chat.savedMessages') : chat.type || t('chat.type')}</span>
                  </span>
                </button>
              ))}
            </div>
          </aside>
        )}
        <header className="chat-preview-header">
          {activePreviewHistory?.chat.avatarDataUrl ? (
            <img className="chat-preview-avatar" src={activePreviewHistory.chat.avatarDataUrl} alt="" />
          ) : (
            <div className="chat-preview-avatar" aria-hidden="true">{previewTitle.slice(0, 1).toUpperCase()}</div>
          )}
          <div className="chat-preview-header-copy">
            <strong>{previewTitle}</strong>
            <span><i className="chat-preview-status-dot" aria-hidden="true" />{previewType === 'private' ? 'online' : previewType}</span>
          </div>
          <div className="chat-preview-header-actions">
            <button type="button" className="chat-preview-expand" onClick={onToggleChatList} aria-label={chatListOpen ? 'Hide chats' : 'Show chats'} title={chatListOpen ? 'Hide chats' : 'Show chats'}>
              {chatListOpen ? <span aria-hidden="true">×</span> : <MessageCircle size={17} strokeWidth={1.8} aria-hidden="true" />}
            </button>
            <button
              type="button"
              className="chat-preview-expand"
              onClick={() => setWallpaperPickerOpen((current) => !current)}
              aria-label="Choose chat background"
              title="Choose chat background"
            >
              <ImagePlus size={17} strokeWidth={1.8} aria-hidden="true" />
            </button>
          </div>
        </header>

        {!collapsed && (
          <div className="chat-preview-wallpaper">
            <div className="chat-preview-service-date">Today</div>
            <div className="chat-preview-feed" ref={previewFeedRef}>
              {previewHistoryLoading && <div className="chat-preview-state">Loading history…</div>}
              {!previewHistoryLoading && previewHistoryError && (
                <div className="chat-preview-state is-error" role="alert">
                  <span>{previewHistoryError}</span>
                  <button type="button" onClick={previewHistoryRetry}>Retry</button>
                </div>
              )}

              {historyGroups.map((group) => {
                const firstMessage = group.messages[0];
                const hasMedia = group.messages.some((message) => message.media);
                return (
                  <article className={`chat-preview-history-entry ${firstMessage.outgoing ? 'is-outgoing' : 'is-incoming'} ${hasMedia ? 'has-media' : ''}`} key={group.key}>
                    <div className="chat-preview-history-entry-head">
                      <strong>{firstMessage.outgoing ? 'You' : firstMessage.senderName || previewTitle}</strong>
                      <time>{new Date(firstMessage.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
                    </div>
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
                  </article>
                );
              })}

              {hasDraft ? (
                <article
                  className="chat-preview-bubble is-outgoing chat-preview-draft-bubble"
                  style={{ '--draft-bubble-color': draftBubbleColor } as React.CSSProperties}
                >
                  {imageAttachments.length > 0 && (
                    <div className={`chat-preview-attachment-grid ${imageAttachments.length > 1 ? 'is-album' : ''}`}>
                      {imageAttachments.map((attachment) => (
                        <img key={attachment.name} src={toFileUrl(attachment.path)} alt={attachment.name} />
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
                  <div className="chat-preview-meta"><span>{previewTime}</span><span>edited</span><span>✓✓</span><span aria-label="24 views">◉ 24</span></div>
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
      </div>
    </div>
  );
}
