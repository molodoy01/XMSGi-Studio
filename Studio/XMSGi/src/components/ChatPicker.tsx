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

export function ChatPicker({
  chats,
  selectedChat,
  onSelect,
  onAddChat,
  onRemoveChat,
  onError,
}: Props) {
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
          onError(result.error || 'That chat could not be found.', 'Chat not found');
        }
      })
      .catch(() => {
        setAdding(false);
        if (onError) {
          onError('We could not reach Telegram while looking for that chat.', 'Connection problem');
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
        {selectedChat ? selectedChat.name : 'Choose a chat…'}
      </div>

      <div className={`chat-picker-menu ${open ? 'open' : ''}`}>
        <div className="chat-add-form open">
          <input
            type="text"
            value={addQuery}
            onChange={(e) => setAddQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Add chat, @name or phone"
          />
          <button className="chat-add-button" onClick={handleAddChat} disabled={adding}>
            {adding ? '...' : 'Add'}
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
            <span className="chat-option-avatar" aria-hidden="true">
              {chat.avatarDataUrl ? <img src={chat.avatarDataUrl} alt="" /> : chat.name.slice(0, 1).toUpperCase()}
            </span>
            <span className="chat-option-copy">
              <strong className="chat-option-name">{chat.name}</strong>
              <span className="chat-option-type">{chat.name === 'Saved Messages' ? 'Saved Messages' : chat.type || 'Chat'}</span>
            </span>
            {selectedChat?.id === chat.id && (
              <button
                className="msg-btn delete"
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
