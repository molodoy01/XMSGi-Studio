import { useEffect, useRef, useState } from 'react';
import type { Chat } from '@/types';

interface Props {
  chats: Chat[];
  selectedChat: Chat | null;
  onSelect: (chat: Chat) => void;
  onAddChat: (chat: Chat) => void;
  onRemoveChat: (chat: Chat) => void;
  onError?: (message: string, title: string) => void;
  permissionWarning?: string;
}

type ChatScrollMetrics = {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
};

import { useLocale } from '@/lib/i18n';

function ChatAvatar({
  name,
  src,
  className,
}: {
  name: string;
  src?: string;
  className: string;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const initial = name.trim().slice(0, 1).toUpperCase() || 'C';

  return (
    <span className={className}>
      {src && !imageFailed ? (
        <img src={src} alt="" onError={() => setImageFailed(true)} />
      ) : (
        <span aria-hidden="true">{initial}</span>
      )}
    </span>
  );
}

export function ChatPicker({
  chats,
  selectedChat,
  onSelect,
  onAddChat,
  onRemoveChat,
  onError,
  permissionWarning,
}: Props) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [addQuery, setAddQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollViewportRef = useRef<HTMLDivElement>(null);
  const scrollDragRef = useRef<{ pointerY: number; scrollTop: number } | null>(null);
  const [scrollMetrics, setScrollMetrics] = useState<ChatScrollMetrics>({
    scrollTop: 0,
    scrollHeight: 0,
    clientHeight: 0,
  });

  const syncScrollMetrics = () => {
    const viewport = scrollViewportRef.current;
    if (!viewport) return;
    setScrollMetrics({
      scrollTop: viewport.scrollTop,
      scrollHeight: viewport.scrollHeight,
      clientHeight: viewport.clientHeight,
    });
  };

  useEffect(() => {
    const viewport = scrollViewportRef.current;
    if (!open || !viewport) return;

    viewport.addEventListener('scroll', syncScrollMetrics, { passive: true });
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(syncScrollMetrics);
    resizeObserver?.observe(viewport);
    Array.from(viewport.children).forEach((child) => resizeObserver?.observe(child));
    syncScrollMetrics();

    return () => {
      viewport.removeEventListener('scroll', syncScrollMetrics);
      resizeObserver?.disconnect();
    };
  }, [chats.length, open]);

  const scrollRange = Math.max(0, scrollMetrics.scrollHeight - scrollMetrics.clientHeight);
  const scrollbarTrackHeight = scrollMetrics.clientHeight;
  const scrollbarThumbHeight = scrollbarTrackHeight > 0 && scrollMetrics.scrollHeight > 0
    ? Math.min(scrollbarTrackHeight, Math.max(20, scrollbarTrackHeight * scrollMetrics.clientHeight / scrollMetrics.scrollHeight))
    : 20;
  const scrollbarThumbTop = scrollRange > 0 && scrollbarTrackHeight > scrollbarThumbHeight
    ? scrollMetrics.scrollTop / scrollRange * (scrollbarTrackHeight - scrollbarThumbHeight)
    : 0;

  const handleScrollbarPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const viewport = scrollViewportRef.current;
    const track = event.currentTarget;
    if (!viewport || scrollRange <= 0) return;

    const trackBounds = track.getBoundingClientRect();
    if (!(event.target as HTMLElement).closest('.chat-picker-scrollbar-thumb')) {
      const trackTravel = Math.max(1, trackBounds.height - scrollbarThumbHeight);
      const position = (event.clientY - trackBounds.top - scrollbarThumbHeight / 2) / trackTravel;
      viewport.scrollTop = Math.max(0, Math.min(scrollRange, position * scrollRange));
    }

    scrollDragRef.current = { pointerY: event.clientY, scrollTop: viewport.scrollTop };
    track.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const handleScrollbarPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = scrollDragRef.current;
    const viewport = scrollViewportRef.current;
    const track = event.currentTarget;
    if (!drag || !viewport || scrollRange <= 0) return;

    const trackTravel = Math.max(1, track.clientHeight - scrollbarThumbHeight);
    viewport.scrollTop = Math.max(0, Math.min(
      scrollRange,
      drag.scrollTop + (event.clientY - drag.pointerY) / trackTravel * scrollRange,
    ));
  };

  const handleScrollbarKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const viewport = scrollViewportRef.current;
    if (!viewport || scrollRange <= 0) return;
    const step = Math.max(36, viewport.clientHeight * 0.75);
    const nextTop = event.key === 'ArrowDown' ? viewport.scrollTop + 36
      : event.key === 'ArrowUp' ? viewport.scrollTop - 36
        : event.key === 'PageDown' ? viewport.scrollTop + step
          : event.key === 'PageUp' ? viewport.scrollTop - step
            : event.key === 'Home' ? 0
              : event.key === 'End' ? scrollRange
                : null;
    if (nextTop === null) return;
    event.preventDefault();
    viewport.scrollTop = Math.max(0, Math.min(scrollRange, nextTop));
  };

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function handleAddChat() {
    if (!addQuery.trim() || adding) return;

    setAdding(true);

    window.telegram
      .findChat(addQuery)
      .then((result) => {
        setAdding(false);

        if (result.success && result.chat) {
          onAddChat(result.chat);
          onSelect(result.chat);
          setAddQuery('');
          setOpen(false);
        } else if (onError) {
          onError(result.error || t('chat.notFoundMessage'), t('chat.notFound'));
        }
      })
      .catch(() => {
        setAdding(false);
        if (onError) {
          onError(t('chat.connectionMessage'), t('chat.connectionProblem'));
        }
      });
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddChat();
    }
  }

  return (
    <div className={`chat-picker ${open ? 'is-open' : ''}`} ref={containerRef}>
      <div
        className={`chat-picker-current ${open ? 'is-open' : ''}`}
        onClick={() => setOpen(!open)}
        tabIndex={0}
        role="button"
      >
        <ChatAvatar
          name={selectedChat?.name || ''}
          src={selectedChat?.avatarDataUrl}
          className="chat-picker-current-avatar"
        />
        <span className="chat-picker-current-copy">
          <span className="chat-picker-current-name">
            {selectedChat
              ? selectedChat.name === 'Saved Messages'
                ? t('chat.savedMessages')
                : selectedChat.name
              : t('chat.choose')}
          </span>
          {permissionWarning && (
            <span className="chat-picker-current-warning" role="status">
              {permissionWarning}
            </span>
          )}
        </span>
      </div>

      <div className={`chat-picker-menu ${open ? 'open' : ''}`}>
        <div className="chat-picker-scroll-area" id="chat-picker-scroll-area" ref={scrollViewportRef}>
          <div className="chat-add-form open">
            <input
              type="text"
              value={addQuery}
              onChange={(e) => setAddQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('chat.addPlaceholder')}
            />
            <button
              className="chat-add-button"
              onClick={handleAddChat}
              disabled={adding}
              aria-label={t('chat.addTitle')}
              title={t('chat.addTitle')}
            >
              {adding ? t('chat.adding') : '+'}
            </button>
          </div>

          {chats.map((chat) => (
            <div
              key={chat.id}
              className={`chat-option ${selectedChat?.id === chat.id ? 'selected' : ''}`}
              onClick={() => {
                onSelect(chat);
                setOpen(false);
              }}
            >
              <ChatAvatar
                name={chat.name}
                src={chat.avatarDataUrl}
                className="chat-option-avatar"
              />
              <span className="chat-option-copy">
                <strong className="chat-option-name">
                  {chat.name === 'Saved Messages' ? t('chat.savedMessages') : chat.name}
                </strong>
                {chat.name !== 'Saved Messages' && (
                  <span className="chat-option-type">
                    {chat.type === 'private'
                      ? t('chat.private')
                      : chat.type === 'group'
                        ? t('chat.group')
                        : chat.type === 'channel'
                          ? t('chat.channel')
                          : chat.type || t('chat.type')}
                  </span>
                )}
              </span>
              <button
                type="button"
                className="chat-option-remove"
                aria-label={`${t('common.remove')} ${chat.name}`}
                title={t('common.remove')}
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveChat(chat);
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        {scrollRange > 0 && (
          <div
            className="chat-picker-scrollbar"
            role="scrollbar"
            tabIndex={0}
            aria-label={t('chat.chatListScrollbar')}
            aria-controls="chat-picker-scroll-area"
            aria-orientation="vertical"
            aria-valuemin={0}
            aria-valuemax={scrollRange}
            aria-valuenow={Math.round(scrollMetrics.scrollTop)}
            onPointerDown={handleScrollbarPointerDown}
            onPointerMove={handleScrollbarPointerMove}
            onPointerUp={() => { scrollDragRef.current = null; }}
            onPointerCancel={() => { scrollDragRef.current = null; }}
            onLostPointerCapture={() => { scrollDragRef.current = null; }}
            onKeyDown={handleScrollbarKeyDown}
          >
            <span
              className="chat-picker-scrollbar-thumb"
              style={{ height: `${scrollbarThumbHeight}px`, top: `${scrollbarThumbTop}px` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
