import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Chat } from '@/types';
import { telegramFindChat } from '@/services/chatAppService';

interface Props {
  chats: Chat[];
  selectedChat: Chat | null;
  onSelect: (chat: Chat) => void;
  onAddChat: (chat: Chat) => void;
  onRemoveChat: (chat: Chat) => void;
  onError?: (message: string, title: string) => void;
  permissionWarning?: string;
  warningPulse?: boolean;
  showRecentGroups?: boolean;
  showRemoveControl?: boolean;
}

type ChatScrollMetrics = {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  listOffset: number;
};

import { useLocale } from '@/lib/i18n';

const RECENT_CHAT_IDS_STORAGE_KEY = 'xmsgi:planner:recent-chat-ids';
const MAX_RECENT_CHAT_IDS = 5;
const CHAT_ROW_HEIGHT = 64;
const CHAT_LIST_OVERSCAN = 6;
const CHAT_LIST_VIRTUALIZATION_THRESHOLD = 40;

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
  warningPulse = false,
  showRecentGroups = false,
  showRemoveControl = true,
}: Props) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [addQuery, setAddQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollViewportRef = useRef<HTMLDivElement>(null);
  const chatListRef = useRef<HTMLDivElement>(null);
  const scrollDragRef = useRef<{ pointerY: number; scrollTop: number } | null>(null);
  const [scrollMetrics, setScrollMetrics] = useState<ChatScrollMetrics>({
    scrollTop: 0,
    scrollHeight: 0,
    clientHeight: 0,
    listOffset: 0,
  });
  const [recentChatIds, setRecentChatIds] = useState<string[]>(() => {
    if (!showRecentGroups) return [];
    try {
      const storedIds: unknown = JSON.parse(window.localStorage.getItem(RECENT_CHAT_IDS_STORAGE_KEY) || '[]');
      return Array.isArray(storedIds)
        ? storedIds.filter((id): id is string => typeof id === 'string').slice(0, MAX_RECENT_CHAT_IDS)
        : [];
    } catch {
      return [];
    }
  });

  const syncScrollMetrics = () => {
    const viewport = scrollViewportRef.current;
    if (!viewport) return;
    const viewportBounds = viewport.getBoundingClientRect();
    const listBounds = chatListRef.current?.getBoundingClientRect();
    setScrollMetrics({
      scrollTop: viewport.scrollTop,
      scrollHeight: viewport.scrollHeight,
      clientHeight: viewport.clientHeight,
      listOffset: listBounds
        ? listBounds.top - viewportBounds.top + viewport.scrollTop
        : 0,
    });
  };

  useEffect(() => {
    const viewport = scrollViewportRef.current;
    if (!open || !viewport) return;

    viewport.addEventListener('scroll', syncScrollMetrics, { passive: true });
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(syncScrollMetrics);
    resizeObserver?.observe(viewport);
    if (chatListRef.current) resizeObserver?.observe(chatListRef.current);
    Array.from(viewport.children).forEach((child) => resizeObserver?.observe(child));
    syncScrollMetrics();

    return () => {
      viewport.removeEventListener('scroll', syncScrollMetrics);
      resizeObserver?.disconnect();
    };
  }, [addQuery, chats.length, open]);

  const scrollRange = Math.max(0, scrollMetrics.scrollHeight - scrollMetrics.clientHeight);
  const scrollbarTrackHeight = scrollMetrics.clientHeight;
  const scrollbarThumbHeight = scrollbarTrackHeight > 0 && scrollMetrics.scrollHeight > 0
    ? Math.min(scrollbarTrackHeight, Math.max(20, scrollbarTrackHeight * scrollMetrics.clientHeight / scrollMetrics.scrollHeight))
    : 20;
  const scrollbarThumbTop = scrollRange > 0 && scrollbarTrackHeight > scrollbarThumbHeight
    ? scrollMetrics.scrollTop / scrollRange * (scrollbarTrackHeight - scrollbarThumbHeight)
    : 0;
  const searchValue = addQuery.trim().toLowerCase();
  const searchText = searchValue.replace(/^@/, '');
  const searchDigits = searchValue.replace(/\D/g, '');
  const matchesSearch = (chat: Chat) => {
    if (!searchValue) return true;
    const searchableText = `${chat.name} ${chat.username ?? ''}`.toLowerCase();
    const searchablePhone = (chat.phone ?? '').replace(/\D/g, '');
    return searchableText.includes(searchText) || Boolean(searchDigits && searchablePhone.includes(searchDigits));
  };
  const recentChatIdSet = new Set(recentChatIds);
  const frequentChats = open && showRecentGroups
    ? recentChatIds.flatMap((id) => {
        const chat = chats.find((item) => item.id === id);
        return chat && matchesSearch(chat) ? [chat] : [];
      })
    : [];
  const allChats = open
    ? chats.filter((chat) => (
      (!showRecentGroups || !recentChatIdSet.has(chat.id)) && matchesSearch(chat)
    ))
    : [];

  const isLargeChatList = allChats.length > CHAT_LIST_VIRTUALIZATION_THRESHOLD;
  const startChatIndex = isLargeChatList
    ? Math.max(0, Math.floor((scrollMetrics.scrollTop - scrollMetrics.listOffset) / CHAT_ROW_HEIGHT) - CHAT_LIST_OVERSCAN)
    : 0;
  const visibleChatCount = Math.max(
    CHAT_LIST_VIRTUALIZATION_THRESHOLD,
    Math.ceil(scrollMetrics.clientHeight / CHAT_ROW_HEIGHT) + CHAT_LIST_OVERSCAN * 2,
  );
  const visibleChats = isLargeChatList
    ? allChats.slice(startChatIndex, startChatIndex + visibleChatCount)
    : allChats;

  const rememberRecentChat = (chat: Chat) => {
    if (!showRecentGroups) return;
    const nextRecentChatIds = [chat.id, ...recentChatIds.filter((id) => id !== chat.id)].slice(0, MAX_RECENT_CHAT_IDS);
    setRecentChatIds(nextRecentChatIds);
    try {
      window.localStorage.setItem(RECENT_CHAT_IDS_STORAGE_KEY, JSON.stringify(nextRecentChatIds));
    } catch {
      // Recent chats remain available for this session if storage is unavailable.
    }
  };

  const renderChatOption = (chat: Chat, style?: CSSProperties) => (
    <div
      key={chat.id}
      className={`chat-option ${selectedChat?.id === chat.id ? 'selected' : ''}`}
      style={style}
      onClick={() => {
        rememberRecentChat(chat);
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
      {showRemoveControl && (
        <button
          type="button"
          className="chat-option-remove"
          aria-label={`${t('common.remove')} ${chat.name}`}
          title={t('common.remove')}
          onClick={(event) => {
            event.stopPropagation();
            onRemoveChat(chat);
          }}
        >
          ×
        </button>
      )}
    </div>
  );

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

  const renderChatList = () => (
    <div
      className="chat-picker-chat-list"
      ref={chatListRef}
      style={isLargeChatList ? { height: allChats.length * CHAT_ROW_HEIGHT, position: 'relative' } : undefined}
    >
      {visibleChats.map((chat, visibleIndex) => {
        const chatIndex = startChatIndex + visibleIndex;
        const style = isLargeChatList
          ? {
            position: 'absolute' as const,
            top: chatIndex * CHAT_ROW_HEIGHT,
            left: 0,
            right: 0,
            height: CHAT_ROW_HEIGHT,
            boxSizing: 'border-box' as const,
          }
          : undefined;
        return renderChatOption(chat, style);
      })}
    </div>
  );

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node | null;
      if (containerRef.current && !containerRef.current.contains(target)) {
        setOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside, { passive: true });
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function handleAddChat() {
    if (!addQuery.trim() || adding) return;

    setAdding(true);

    telegramFindChat(addQuery)
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
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen((current) => !current);
        }}
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
            <span
              className={`chat-picker-current-warning${warningPulse ? ' is-flashing' : ''}`}
              role="status"
            >
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
              aria-label={t('studio.searchChats')}
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

          {showRecentGroups ? (
            <div className="chat-picker-groups">
              {frequentChats.length > 0 && (
                <section className="chat-picker-group" aria-label="Frequent chats">
                  <div className="chat-picker-group-title">Frequent chats</div>
                  {frequentChats.map((chat) => renderChatOption(chat))}
                </section>
              )}
              <section className="chat-picker-group" aria-label="All chats">
                <div className="chat-picker-group-title">All chats</div>
                {renderChatList()}
              </section>
            </div>
          ) : renderChatList()}
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
