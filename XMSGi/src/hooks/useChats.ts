import { useEffect, useRef, useState } from 'react';
import type { Chat, ChatPermissions } from '@/types';
import { createChatAvatarLoader } from '@/services/chatAvatarLoader';
import {
  loadPersistentChats,
  loadHiddenChats,
  savePersistentChats,
  saveHiddenChats,
} from '@/lib/storage';
import {
  mergeChats,
  normalizeChatPermissions,
  selectNextChat,
} from '@/services/chatDomainService';

export function useChats({ connected }: { connected: boolean }) {
  const [chats, setChats] = useState<Chat[]>([]);
  const [persistentChatsReady, setPersistentChatsReady] = useState(false);
  const [selectedChat, setSelectedChat] = useState<Chat | null>(null);
  const [chatPermissions, setChatPermissions] = useState<Record<string, ChatPermissions>>({});
  const avatarLoaderRef = useRef<ReturnType<typeof createChatAvatarLoader> | null>(null);
  if (!avatarLoaderRef.current) avatarLoaderRef.current = createChatAvatarLoader();
  useEffect(() => {
    let cancelled = false;

    void loadPersistentChats().then((loadedChats) => {
      if (cancelled) return;

      const hidden = loadHiddenChats();
      const visibleChats = mergeChats(loadedChats, [], hidden);

      setChats(visibleChats);

      if (visibleChats.length > 0) {
        setSelectedChat(selectNextChat(visibleChats, null));
      }

      setPersistentChatsReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedChat) return;

    setChats((current) => {
      const selectedIndex = current.findIndex((chat) => chat.id === selectedChat.id);

      if (selectedIndex <= 0) return current;

      const ordered = [current[selectedIndex], ...current.slice(0, selectedIndex), ...current.slice(selectedIndex + 1)];
      void savePersistentChats(ordered);
      return ordered;
    });
  }, [selectedChat]);

  useEffect(() => {
    if (!connected) {
      avatarLoaderRef.current?.clear();
      return;
    }
    if (!persistentChatsReady || typeof window.telegram?.getChats !== 'function') return;

    let cancelled = false;
    const telegramApi = window.telegram;

    telegramApi
      .getChats()
      .then(async (result) => {
        if (cancelled || !result.success || !result.chats) return;

        const hidden = loadHiddenChats();

        const telegramDialogs: Chat[] = result.chats.map((chat) => ({
          id: String(chat.id),
          name: chat.name,
          username: chat.username || '',
          type: chat.type || 'unknown',
          avatarDataUrl: chat.avatarDataUrl || '',
        }));

        const savedChats = await loadPersistentChats();
        if (cancelled) return;
        const savedAvatars = new Map(
          savedChats
            .filter((chat) => chat.avatarDataUrl)
            .map((chat) => [chat.id, chat.avatarDataUrl!]),
        );
        const telegramChats = telegramDialogs.map((chat) => ({
          ...chat,
          avatarDataUrl: chat.avatarDataUrl || savedAvatars.get(chat.id) || '',
        }));
        const telegramChatIds = new Set(telegramChats.map((chat) => chat.id));
        const locallyAddedChats = savedChats.filter(
          (chat) => !telegramChatIds.has(chat.id)
        );
        const visibleChats = mergeChats(locallyAddedChats, telegramChats, hidden);

        setChats((current) => {
          const nextChats = mergeChats(current, telegramChats, hidden);
          void savePersistentChats(nextChats);
          return nextChats;
        });

        setSelectedChat((current) => {
          const nextSelected = selectNextChat(visibleChats, current);
          return nextSelected;
        });

        const chatsNeedingAvatars = visibleChats
          .filter((chat) => !chat.avatarDataUrl)
          .map((chat) => chat.id);
        void avatarLoaderRef.current!.load(
          chatsNeedingAvatars,
          (chatId) => telegramApi.getChatAvatar(chatId),
        ).then((avatarById) => {
          if (cancelled || avatarById.size === 0) return;

          setChats((current) => {
            const updatedChats = current.map((chat) => {
              const avatarDataUrl = avatarById.get(chat.id);
              return avatarDataUrl ? { ...chat, avatarDataUrl } : chat;
            });

            void savePersistentChats(updatedChats);
            return updatedChats;
          });
          setSelectedChat((current) => {
            if (!current) return current;

            const avatarDataUrl = avatarById.get(current.id);
            return avatarDataUrl ? { ...current, avatarDataUrl } : current;
          });
        });

      })
      .catch(() => {
        // Keep locally saved chats if Telegram chat loading fails.
      });

    return () => {
      cancelled = true;
    };
  }, [connected, persistentChatsReady]);

  useEffect(() => {
    if (!connected || !selectedChat || typeof window.telegram?.getChatPermissions !== 'function') return;

    let cancelled = false;
    window.telegram.getChatPermissions(selectedChat.id).then((result) => {
      if (cancelled || !result.success || !result.permissions) return;
      setChatPermissions((current) => ({
        ...current,
        [selectedChat.id]: normalizeChatPermissions(selectedChat.id, result.permissions!),
      }));
    }).catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [connected, selectedChat]);

  async function refreshChatPermissions(chatId: string): Promise<ChatPermissions | null> {
    if (typeof window.telegram?.getChatPermissions !== 'function') return null;

    try {
      const result = await window.telegram.getChatPermissions(chatId);
      if (!result.success || !result.permissions) return null;
      setChatPermissions((current) => ({ ...current, [chatId]: result.permissions! }));
      return result.permissions;
    } catch {
      return null;
    }
  }

  function handleAddChat(chat: Chat) {
    const existing = chats.find((c) => c.id === chat.id);

    if (!existing) {
      setChats((current) => {
        const updated = [...current, chat];
        void savePersistentChats(updated);
        return updated;
      });

      const hidden = loadHiddenChats().filter(
        (id) => id !== chat.id
      );

      saveHiddenChats(hidden);
      setSelectedChat(chat);
      return;
    }

    const enriched = {
      ...existing,
      ...chat,
      name: chat.name || existing.name,
      username: chat.username || existing.username || '',
      type: chat.type || existing.type,
      avatarDataUrl: chat.avatarDataUrl || existing.avatarDataUrl || '',
    };
    setChats((current) => {
      const updated = current.map((item) => item.id === chat.id ? enriched : item);
      void savePersistentChats(updated);
      return updated;
    });
    setSelectedChat(enriched);
  }

  function handleRemoveChat(chat: Chat) {
    const hidden = loadHiddenChats();

    if (!hidden.includes(chat.id)) {
      saveHiddenChats([...hidden, chat.id]);
    }

    const updated = chats.filter((item) => item.id !== chat.id);

    setChats((current) => {
      const latest = current.filter((item) => item.id !== chat.id);
      void savePersistentChats(latest);
      return latest;
    });

    if (selectedChat?.id === chat.id) {
      setSelectedChat(updated.length > 0 ? updated[0] : null);
    }
  }

  return {
    chats,
    setChats,
    selectedChat,
    setSelectedChat,
    chatPermissions,
    selectedChatPermissions: selectedChat ? chatPermissions[selectedChat.id] || null : null,
    refreshChatPermissions,
    handleAddChat,
    handleRemoveChat,
  };
}
