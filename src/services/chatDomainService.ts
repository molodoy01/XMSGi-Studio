import type { Chat, ChatPermissions } from '../types';

export type ChatDomainState = {
  chats: Chat[];
  selectedChat: Chat | null;
  chatPermissions: Record<string, ChatPermissions>;
};

export function mergeChats(local: Chat[], remote: Chat[], hiddenIds: string[]): Chat[] {
  const hidden = new Set(hiddenIds);
  const byId = new Map<string, Chat>();

  remote.forEach((chat) => {
    byId.set(chat.id, { ...chat, name: chat.name || 'Unnamed chat' });
  });

  local.forEach((chat) => {
    if (!byId.has(chat.id) && !hidden.has(chat.id)) {
      byId.set(chat.id, chat);
    }
  });

  return Array.from(byId.values()).filter((chat) => !hidden.has(chat.id));
}

export function selectNextChat(chats: Chat[], current: Chat | null): Chat | null {
  if (!chats.length) return null;
  if (!current) return chats[0];

  const currentIndex = chats.findIndex((chat) => chat.id === current.id);
  return currentIndex >= 0 ? chats[currentIndex] : chats[0];
}

export function normalizeChatPermissions(chatId: string, permissions: ChatPermissions): ChatPermissions {
  return {
    canView: Boolean(permissions.canView),
    canSend: permissions.canSend ?? null,
    canSchedule: permissions.canSchedule ?? null,
    error: permissions.error,
  };
}
