import type { Chat, ChatPermissions } from '@/types';

type TelegramWindowBridge = NonNullable<Window['telegram']>;

type TelegramChatPayload = {
  id: string | number;
  name: string;
  username?: string;
  phone?: string;
  type?: Chat['type'];
  avatarDataUrl?: string;
};

function getTelegramBridge(): TelegramWindowBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.telegram;
}

export async function telegramGetChats(): Promise<{
  success: boolean;
  chats?: TelegramChatPayload[];
  error?: string;
}> {
  const bridge = getTelegramBridge();
  if (!bridge || typeof bridge.getChats !== 'function') {
    return { success: false, error: 'desktopBridgeRequired' };
  }

  return bridge.getChats();
}

export async function telegramGetChatPermissions(chatId: string): Promise<{
  success: boolean;
  permissions?: ChatPermissions;
  error?: string;
}> {
  const bridge = getTelegramBridge();
  if (!bridge || typeof bridge.getChatPermissions !== 'function') {
    return { success: false, error: 'desktopBridgeRequired' };
  }

  return bridge.getChatPermissions(chatId);
}

export async function telegramGetChatAvatar(chatId: string): Promise<{
  success: boolean;
  avatarDataUrl?: string;
  error?: string;
}> {
  const bridge = getTelegramBridge();
  if (!bridge || typeof bridge.getChatAvatar !== 'function') {
    return { success: false, error: 'desktopBridgeRequired' };
  }

  return bridge.getChatAvatar(chatId);
}

export async function telegramFindChat(query: string) {
  const bridge = getTelegramBridge();
  if (!bridge || typeof bridge.findChat !== 'function') {
    return { success: false, error: 'desktopBridgeRequired' };
  }
  return bridge.findChat(query);
}

export async function telegramGetChatHistory(data: Parameters<TelegramWindowBridge['getChatHistory']>[0]) {
  const bridge = getTelegramBridge();
  if (!bridge || typeof bridge.getChatHistory !== 'function') {
    return { success: false, error: 'desktopBridgeRequired' };
  }
  return bridge.getChatHistory(data);
}

export function hasChatHistoryBridge(): boolean {
  const bridge = getTelegramBridge();
  return Boolean(bridge && typeof bridge.getChatHistory === 'function');
}

export async function telegramLoadSavedChats() {
  const bridge = getTelegramBridge();
  if (!bridge || typeof bridge.loadSavedChats !== 'function') return undefined;
  const result = await bridge.loadSavedChats();
  if (!result.success || !Array.isArray(result.chats)) {
    throw new Error(result.error || 'Saved chats could not be loaded.');
  }
  return result.chats;
}

export function hasSavedChatStorage(): boolean {
  const bridge = getTelegramBridge();
  return Boolean(bridge && typeof bridge.saveSavedChats === 'function');
}

export async function telegramSaveSavedChats(chats: Chat[]): Promise<{ success: boolean; error?: string }> {
  const bridge = getTelegramBridge();
  if (!bridge || typeof bridge.saveSavedChats !== 'function') {
    return { success: false, error: 'desktopBridgeRequired' };
  }
  const result = await bridge.saveSavedChats(chats);
  return result.success ? result : { success: false, error: result.error || 'Chats could not be saved.' };
}
