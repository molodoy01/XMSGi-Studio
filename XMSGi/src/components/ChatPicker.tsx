import { useEffect, useRef, useState } from 'react';
import type { Chat } from '@/types';

interface Props {
  chats: Chat[];
  selectedChat: Chat | null;
  onSelect: (chat: Chat) => void;
  onAddChat: (chat: Chat) => void;
  onRemoveChat: (chat: Chat) => void;
  onError?: (message: string, title: string) => void;
}
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
        </span>
      </div>

      <div className={`chat-picker-menu ${open ? 'open' : ''}`}>
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
    </div>
  );
}
