export {};

import type { PersistedDraftStore } from './types';

type DraftStorageResult = {
  success: boolean;
  store?: PersistedDraftStore;
  needsMigration?: boolean;
  schemaMigrated?: boolean;
  migrated?: boolean;
  recovered?: boolean;
  backupIndexes?: number[];
  attachment?: { name: string; path: string; size: number };
  cancelled?: boolean;
  text?: string;
  code?: string;
  error?: string;
};

type TelegramFormattingEntity = {
  type: 'bold' | 'italic' | 'underline' | 'strikethrough' | 'text_url';
  offset: number;
  length: number;
  url?: string;
};

type TelegramBridgeErrorCategory = import('@shared/types').TelegramErrorCategory;

declare global {
  interface TelegramAuthState {
    hasSession: boolean;
    signedOut: boolean;
    connected: boolean;
    userName: string;
    state: string;
  }

  interface TelegramAuthStateResult {
    success: boolean;
    authState?: TelegramAuthState;
    error?: string;
  }

  interface Window {
    draftStorage: {
      load: () => Promise<DraftStorageResult>;
      migrate: (legacy: { savedDrafts: unknown[]; workspaceDraft: Record<string, unknown> | null }) => Promise<DraftStorageResult>;
      save: (store: PersistedDraftStore) => Promise<DraftStorageResult>;
      flush: (store: PersistedDraftStore) => DraftStorageResult;
      restoreBackup: (index: number) => Promise<DraftStorageResult>;
      exportBackup: () => Promise<DraftStorageResult>;
      importBackup: () => Promise<DraftStorageResult>;
      exportText: (text: string) => Promise<DraftStorageResult>;
      importText: () => Promise<DraftStorageResult>;
      copyAttachment: (file: File) => Promise<DraftStorageResult>;
    };
    gemini: {
      generate: (prompt: string, context: {
        currentDate: string;
        currentTime: string;
        chats: { id: string; name: string }[];
      }) => Promise<{
        success: boolean;
        intent?: {
          action: 'schedule' | 'clarify';
          chat: string;
          message: string;
          date: string;
          time: string;
          clarification: string;
        };
        errorCode?: 'quota' | 'generic' | 'setup_required';
        error?: string;
      }>;
      getSettings: () => Promise<{
        hasKey: boolean;
        maskedKey: string;
        enabled: boolean;
        encryptionAvailable: boolean;
      }>;
      saveKey: (key: string) => Promise<{
        success: boolean;
        settings?: {
          hasKey: boolean;
          maskedKey: string;
          enabled: boolean;
          encryptionAvailable: boolean;
        };
        error?: string;
      }>;
      removeKey: () => Promise<{
        success: boolean;
        settings?: {
          hasKey: boolean;
          maskedKey: string;
          enabled: boolean;
          encryptionAvailable: boolean;
        };
        error?: string;
      }>;
      setEnabled: (enabled: boolean) => Promise<{
        success: boolean;
        settings?: {
          hasKey: boolean;
          maskedKey: string;
          enabled: boolean;
          encryptionAvailable: boolean;
        };
        error?: string;
      }>;
    };
    telegram: {
      getConfig: () => Promise<{ success: boolean; config?: { hasCredentials?: boolean; hasSession?: boolean; connected?: boolean }; error?: string }>;
      getAuthState: () => Promise<TelegramAuthStateResult>;
      signOutKeepSession: () => Promise<TelegramAuthStateResult>;
      welcomeBack: () => Promise<TelegramAuthStateResult>;
      forgetAccount: () => Promise<TelegramAuthStateResult>;
      clearSession: () => Promise<{ success: boolean; cleared?: boolean; config?: { hasCredentials?: boolean; hasSession?: boolean; connected?: boolean }; error?: string }>;
      login: (data: { API_ID?: string | number; API_HASH?: string; phoneNumber?: string; phone?: string; password?: string; phoneCode?: string; apiId?: string | number; apiHash?: string }) => Promise<{ success: boolean; requiresCode?: boolean; requiresPassword?: boolean; nextStep?: string; error?: string; isCodeViaApp?: boolean }>;
      connect: () => Promise<{ success: boolean; error?: string }>;
      getChats: () => Promise<{ success: boolean; chats?: { id: string; name: string; username?: string; type?: 'private' | 'group' | 'supergroup' | 'channel' | 'unknown'; avatarDataUrl?: string }[]; error?: string }>;
      getChatAvatar: (chatId: string) => Promise<{ success: boolean; avatarDataUrl?: string; error?: string }>;
      findChat: (query: string) => Promise<{
        success: boolean;
        chat?: { id: string; name: string; username?: string; type?: 'private' | 'group' | 'supergroup' | 'channel' | 'unknown'; avatarDataUrl?: string };
        error?: string;
      }>;
      getContacts: () => Promise<{
        success: boolean;
        contacts?: { id: string; name: string; username?: string; phone?: string }[];
        error?: string;
      }>;
      send: (chatId: string, message: string, attachments?: string[], entities?: TelegramFormattingEntity[], replyMarkup?: { inline_keyboard: Array<Array<{ text: string; url?: string; callback_data?: string }>> }) => Promise<{
        success: boolean;
        error?: string;
        code?: string;
        category?: TelegramBridgeErrorCategory;
        retryable?: boolean;
        waitSeconds?: number;
        cancelled?: boolean;
      }>;
      schedule: (data: {
        chatId: string;
        message: string;
        targetTimestamp: number;
        attachments?: string[];
        entities?: TelegramFormattingEntity[];
        replyMarkup?: { inline_keyboard: Array<Array<{ text: string; url?: string; callback_data?: string }>> };
      }) => Promise<{
        success: boolean;
        id?: string | number;
        telegramMessageId?: string | number;
        confirmed?: boolean;
        error?: string;
        code?: string;
        category?: TelegramBridgeErrorCategory;
        retryable?: boolean;
        waitSeconds?: number;
        cancelled?: boolean;
      }>;
      getChatHistory: (data: { chatId: string; limit?: number }) => Promise<{
        success: boolean;
        history?: {
          chat: {
            id: string;
            title: string;
            username?: string;
            type?: string;
            avatarDataUrl?: string;
            topic?: string;
          };
          messages: {
            id: string;
            text: string;
            date: string;
            outgoing: boolean;
            senderName?: string;
            entities?: Array<{ type: 'bold' | 'italic' | 'underline' | 'strikethrough' | 'text_url'; offset: number; length: number; url?: string }>;
            mediaType?: string;
            mediaName?: string;
            replyMarkup?: { inline_keyboard: Array<Array<{ text: string; url?: string; callback_data?: string }>> };
            groupId?: string;
            media?: {
              kind: 'photo' | 'video' | 'document' | 'audio' | 'unknown';
              name?: string;
              mimeType?: string;
              size?: number;
              duration?: number;
              width?: number;
              height?: number;
              thumbnailDataUrl?: string;
              dataUrl?: string;
            };
          }[];
        };
        error?: string;
      }>;
      cancel: (data: {
        chatId: string;
        telegramMessageId: string | number;
      }) => Promise<{
        success: boolean;
        error?: string;
        code?: string;
        category?: TelegramBridgeErrorCategory;
        retryable?: boolean;
        waitSeconds?: number;
        cancelled?: boolean;
      }>;
      onStatus: (callback: (status: unknown) => void) => void;
    };
  }
}