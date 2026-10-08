import { useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { Chat, NotificationState } from '@/types';

type RemoveModalState = {
  show: boolean;
  chat: Chat | null;
};

type Options = {
  chats?: Chat[];
  setNotification: Dispatch<SetStateAction<NotificationState>>;
};

export function useStudioChats({ chats: initialChats, setNotification }: Options) {
  const [selectedChat, setSelectedChat] = useState<Chat | null>(initialChats?.[0] ?? null);
  const [chats, setChats] = useState(initialChats ?? []);
  const [removeModal, setRemoveModal] = useState<RemoveModalState>({ show: false, chat: null });

  const addChat = (chat: Chat) => {
    setChats((current) => current.some((item) => item.id === chat.id) ? current : [...current, chat]);
  };

  const removeChat = (chat: Chat) => setRemoveModal({ show: true, chat });

  const confirmRemoveChat = () => {
    const chat = removeModal.chat;
    if (!chat) return;

    setChats((current) => current.filter((item) => item.id !== chat.id));
    if (selectedChat?.id === chat.id) {
      setSelectedChat(chats.find((item) => item.id !== chat.id) ?? null);
    }
    setRemoveModal({ show: false, chat: null });
  };

  useEffect(() => {
    let cancelled = false;
    const applyChats = (nextChats: Chat[]) => {
      setChats(nextChats);
      setSelectedChat((current) => current && nextChats.some((chat) => chat.id === current.id)
        ? current
        : nextChats[0] ?? null);
    };

    if (initialChats !== undefined) {
      applyChats(initialChats);
    } else if (typeof window.telegram?.getChats === 'function') {
      window.telegram.getChats()
        .then((result) => {
          if (!cancelled && result.success) applyChats(result.chats ?? []);
        })
        .catch((error) => {
          if (!cancelled) {
            setNotification({
              message: error instanceof Error ? error.message : 'Telegram chats could not be loaded.',
              title: 'Studio',
              type: 'error',
              visible: true,
            });
          }
        });
    }

    return () => { cancelled = true; };
  }, [initialChats, setNotification]);

  return {
    chats,
    selectedChat,
    setSelectedChat,
    addChat,
    removeChat,
    removeModal,
    setRemoveModal,
    confirmRemoveChat,
  };
}