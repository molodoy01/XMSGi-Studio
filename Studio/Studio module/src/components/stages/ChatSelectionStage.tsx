import { useEffect, useState } from 'react';
import { MessageCircle, Search, Star } from 'lucide-react';
import type { Chat } from '@/types';
import { useLocale } from '@/lib/i18n';
import type { StageMode } from './types';

const FAVORITE_CHATS_STORAGE_KEY = 'xmsgi_favorite_chats';
const LEGACY_FAVORITE_CHATS_STORAGE_KEY = 'awaitmsg_favorite_chats';

interface Props {
  mode: StageMode;
  chats: Chat[];
  selectedChats: Chat[];
  onChatSelectionChange: (chats: Chat[]) => void;
  onChatSelectionDone: () => void;
  onChatSelectionBack: () => void;
  onChatError: (message: string) => void;
  onAddChat: (chat: Chat) => void;
  onRemoveChat: (chat: Chat) => void;
}

export function ChatSelectionStage({
  mode,
  chats,
  selectedChats,
  onChatSelectionChange,
  onChatSelectionDone,
  onChatSelectionBack,
  onChatError,
  onAddChat,
  onRemoveChat,
}: Props) {
  const { locale, t } = useLocale();
  const [showAddChat, setShowAddChat] = useState(false);
  const [addChatQuery, setAddChatQuery] = useState('');
  const [showChatSearch, setShowChatSearch] = useState(false);
  const [chatSearchQuery, setChatSearchQuery] = useState('');
  const [addingChat, setAddingChat] = useState(false);
  const [failedAvatarSources, setFailedAvatarSources] = useState<Set<string>>(() => new Set());
  const [favoriteChatIds, setFavoriteChatIds] = useState<string[]>(() => {
    try {
      const primaryRaw = window.localStorage.getItem(FAVORITE_CHATS_STORAGE_KEY);
      const raw = primaryRaw ?? window.localStorage.getItem(LEGACY_FAVORITE_CHATS_STORAGE_KEY);
      if (raw === null) return [];
      if (!primaryRaw) {
        window.localStorage.setItem(FAVORITE_CHATS_STORAGE_KEY, raw);
      }
      const stored = JSON.parse(raw);
      return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string') : [];
    } catch {
      return [];
    }
  });
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);

  const getChatTypeLabel = (chat: Chat) => {
    if (chat.name === 'Saved Messages') return t('studio.savedMessagesType');
    if (chat.type === 'private') return t('studio.privateChat');
    if (chat.type === 'group') return t('studio.groupChat');
    if (chat.type === 'supergroup') return t('studio.supergroup');
    if (chat.type === 'channel') return t('studio.channelType');
    return t('studio.chatType');
  };

  useEffect(() => {
    if (mode === 'chat') {
      onChatError('');
      setShowChatSearch(false);
      setChatSearchQuery('');
      setShowAddChat(false);
      setAddChatQuery('');
    }
  }, [mode]);

  useEffect(() => {
    const serialized = JSON.stringify(favoriteChatIds);
    window.localStorage.setItem(FAVORITE_CHATS_STORAGE_KEY, serialized);
    window.localStorage.setItem(LEGACY_FAVORITE_CHATS_STORAGE_KEY, serialized);
  }, [favoriteChatIds]);

  const visibleSelectedChats = selectedChats.filter((chat) => chats.some((item) => item.id === chat.id));
  const filteredChats = chats.filter((chat) => {
    if (showFavoritesOnly && !favoriteChatIds.includes(chat.id)) return false;

    const query = chatSearchQuery.trim().toLocaleLowerCase(locale === 'ru' ? 'ru-RU' : 'en-US');
    if (!query) return true;

    return `${chat.name} ${chat.username || ''}`.toLocaleLowerCase(locale === 'ru' ? 'ru-RU' : 'en-US').includes(query);
  });
  const toggleChat = (chat: Chat) => {
    onChatSelectionChange([chat]);
  };
  const activateChatOption = (chat: Chat, selected: boolean) => {
    if (selected) onChatSelectionDone();
    else toggleChat(chat);
  };
  const toggleFavoriteChat = (chat: Chat) => {
    setFavoriteChatIds((current) => current.includes(chat.id)
      ? current.filter((id) => id !== chat.id)
      : [...current, chat.id]);
  };

  const addChat = async () => {
    if (!addChatQuery.trim() || addingChat) return;

    setAddingChat(true);
    onChatError('');
    try {
      const result = await window.telegram.findChat(addChatQuery.trim());
      if (!result.success || !result.chat) {
        const message = result.error || t('studio.addChatFailed');
        onChatError(message);
        return;
      }

      const chat: Chat = {
        id: String(result.chat.id),
        name: result.chat.name,
        username: result.chat.username || '',
        type: result.chat.type || 'unknown',
        avatarDataUrl: result.chat.avatarDataUrl || '',
      };
      onAddChat(chat);
      onChatSelectionChange([chat]);
      onChatError('');
      setAddChatQuery('');
      setShowAddChat(false);
    } catch {
      const message = t('studio.connectionFailed');
      onChatError(message);
    } finally {
      setAddingChat(false);
    }
  };

  return (
    <div className={`workspace-page-rich-text-stage-view workspace-page-rich-text-chat-stage ${mode === 'chat' ? 'is-active' : ''}`} aria-hidden={mode !== 'chat'}>
      <header className="workspace-page-stage-header workspace-page-chat-stage-header">
        <strong>{t('studio.channel')}</strong>
        <span>{visibleSelectedChats.length > 0 ? t('studio.selectedChatOrChannel') : t('studio.chooseOneChat')}</span>
      </header>

      <div className="workspace-page-stage-main workspace-page-chat-stage-main">
        <div className="workspace-page-chat-stage-list" role="listbox" aria-label={t('studio.chooseTelegramChat')} aria-multiselectable="false">
          {filteredChats.length > 0 ? filteredChats.map((chat) => {
            const selected = visibleSelectedChats.some((item) => item.id === chat.id);
            const favorite = favoriteChatIds.includes(chat.id);
            const avatarSource = chat.avatarDataUrl || '';
            const avatarFailed = Boolean(avatarSource && failedAvatarSources.has(avatarSource));
            return (
              <div
                key={chat.id}
                className={`workspace-page-chat-stage-item ${selected ? 'is-selected' : ''}`}
                role="option"
                aria-selected={selected}
                tabIndex={0}
                onClick={() => activateChatOption(chat, selected)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    activateChatOption(chat, selected);
                  }
                }}
              >
                <span className={`workspace-page-chat-stage-avatar ${avatarFailed ? 'is-broken' : ''}`} aria-hidden="true">
                  {avatarSource && !avatarFailed ? (
                    <img
                      src={avatarSource}
                      alt=""
                      onError={() => setFailedAvatarSources((current) => new Set(current).add(avatarSource))}
                    />
                  ) : avatarFailed ? chat.name.slice(0, 1).toUpperCase() : <MessageCircle size={15} strokeWidth={1.8} />}
                </span>
                <span className="workspace-page-chat-stage-copy">
                  <strong>{chat.name}</strong>
                  <span>{getChatTypeLabel(chat)}{chat.username ? ` · @${chat.username}` : ''}</span>
                </span>
                <span className="workspace-page-chat-stage-check" aria-hidden="true">{selected ? '✓' : ''}</span>
                <button
                  type="button"
                  className={`workspace-page-chat-stage-favorite ${favorite ? 'is-favorite' : ''}`}
                  onClick={(event) => { event.stopPropagation(); toggleFavoriteChat(chat); }}
                  aria-label={t(favorite ? 'studio.removeFavorite' : 'studio.addFavorite', { name: chat.name })}
                  aria-pressed={favorite}
                >
                  <Star size={15} strokeWidth={1.8} fill={favorite ? 'currentColor' : 'none'} />
                </button>
                <button type="button" className="workspace-page-chat-stage-remove" onClick={(event) => { event.stopPropagation(); onRemoveChat(chat); }} aria-label={t('studio.removeSavedChat', { name: chat.name })}>×</button>
              </div>
            );
          }) : (
            <div className="workspace-page-chat-stage-empty" role="status">
              <strong>{chats.length === 0 ? t('studio.noChatsSaved') : showFavoritesOnly ? t('studio.noFavoriteChats') : t('studio.noChatsFound')}</strong>
              <span>{chats.length === 0 ? t('studio.addTelegramChat') : showFavoritesOnly ? t('studio.markFavoriteHint') : t('studio.tryAnotherChatSearch')}</span>
            </div>
          )}
        </div>

        {showAddChat && (
          <div className="workspace-page-chat-stage-add-form">
            <input value={addChatQuery} onChange={(event) => setAddChatQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void addChat(); } }} placeholder={t('studio.chatNamePlaceholder')} aria-label={t('studio.chatNameLabel')} autoFocus />
            <button type="button" onClick={() => void addChat()} disabled={addingChat}>{addingChat ? t('studio.addingChat') : t('studio.addChat')}</button>
          </div>
        )}

        {showChatSearch && (
          <div className="workspace-page-chat-stage-search">
            <input
              type="search"
              value={chatSearchQuery}
              onChange={(event) => setChatSearchQuery(event.target.value)}
              placeholder={t('studio.findChat')}
              aria-label={t('studio.findChat')}
              autoFocus
            />
          </div>
        )}
      </div>

      <div className="workspace-page-stage-actions workspace-page-chat-stage-footer">
        <div className="workspace-page-chat-stage-footer-left">
          <button type="button" className="workspace-page-stage-secondary" onClick={onChatSelectionBack}>← {t('studio.back')}</button>
          <button type="button" className="workspace-page-chat-stage-add" onClick={() => { setShowAddChat((current) => { if (!current) setShowChatSearch(false); return !current; }); onChatError(''); }} aria-expanded={showAddChat}>
            <span aria-hidden="true">+</span> {t('studio.addAnotherChat')}
          </button>
          <button type="button" className="workspace-page-chat-stage-add" onClick={() => { setShowChatSearch((current) => { if (!current) setShowAddChat(false); return !current; }); onChatError(''); }} aria-expanded={showChatSearch}>
            <Search size={13} strokeWidth={1.8} /> {t('studio.findAChat')}
          </button>
        </div>
        <div className="workspace-page-chat-stage-footer-right">
          <button
            type="button"
            className={`workspace-page-chat-favorites-filter ${showFavoritesOnly ? 'is-active' : ''}`}
            onClick={() => {
              setShowFavoritesOnly((current) => !current);
              setShowAddChat(false);
              setShowChatSearch(false);
              setAddChatQuery('');
              setChatSearchQuery('');
              onChatError('');
            }}
            aria-pressed={showFavoritesOnly}
          >
            <Star size={13} strokeWidth={1.8} fill={showFavoritesOnly ? 'currentColor' : 'none'} /> {t('studio.favorites')}
          </button>
          <button type="button" className="workspace-page-stage-primary" onClick={onChatSelectionDone}>{t('studio.done')}</button>
        </div>
      </div>
    </div>
  );
}