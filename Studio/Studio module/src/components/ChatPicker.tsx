import { useEffect, useRef, useState } from 'react';
import type { Chat } from '@/types';
import { ChatAvatar } from './ChatAvatar';
import { useLocale } from '@/lib/i18n';

interface Props {
  chats: Chat[];
  selectedChat: Chat | null;
  onSelect: (chat: Chat) => void;
  onAddChat: (chat: Chat) => void;
  onRemoveChat: (chat: Chat) => void;
  onError?: (message: string, title: string) => void;
}

export function ChatPicker({
  chats,
  selectedChat,
  onSelect,
  onAddChat,
  onRemoveChat,
  onError,
}: Props) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [addQuery, setAddQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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
          onError(result.error || t('studio.addChatFailed'), t('studio.chatNotFound'));
        }
      })
      .catch(() => {
        setAdding(false);
        if (onError) {
          onError(t('studio.connectionFailed'), t('studio.connectionProblem'));
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
        {selectedChat ? selectedChat.name : t('studio.chooseChat')}
      </div>

      <div className={`chat-picker-menu ${open ? 'open' : ''}`}>
        <div className="chat-add-form open">
          <input
            type="text"
            value={addQuery}
            onChange={(e) => setAddQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('studio.addChatPlaceholder')}
          />
          <button className="chat-add-button" onClick={handleAddChat} disabled={adding}>
            {adding ? t('studio.addingChat') : t('studio.addChat')}
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
            <ChatAvatar name={chat.name} src={chat.avatarDataUrl} className="chat-option-avatar" />
            <span className="chat-option-copy">
              <strong className="chat-option-name">{chat.name}</strong>
              <span className="chat-option-type">{chat.name === 'Saved Messages'
                ? t('studio.savedMessagesType')
                : chat.type === 'private'
                  ? t('studio.privateChat')
                  : chat.type === 'group'
                    ? t('studio.groupChat')
                    : chat.type === 'supergroup'
                      ? t('studio.supergroup')
                      : chat.type === 'channel'
                        ? t('studio.channelType')
                        : t('studio.chatType')}</span>
            </span>
            {selectedChat?.id === chat.id && (
              <button
                className="msg-btn delete"
                aria-label={t('common.remove')}
                title={t('common.remove')}
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveChat(chat);
                }}
                style={{ opacity: 1 }}
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
