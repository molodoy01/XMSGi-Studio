export {};

type TelegramFormattingEntity = {
  type: 'bold' | 'italic' | 'underline' | 'strikethrough' | 'text_url';
  offset: number;
  length: number;
  url?: string;
};

type TelegramErrorCategory = import('@shared/types').TelegramErrorCategory;

declare global {
  interface TelegramAuthState {
    hasSession: boolean;
    signedOut: boolean;
    connected: boolean;
    userName: string;
    username?: string;
    state: string;
  }

  interface TelegramAuthStateResult {
    success: boolean;
    authState?: TelegramAuthState;
    error?: string;
  }

  interface TelegramAvailableEffect {
    id: string;
    emoticon: string;
    premiumRequired: boolean;
  }

  interface Window {
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
      getStatus: () => Promise<{
        success: boolean;
        accountId?: string;
        status?: 'normal' | 'rate-limited' | 'slowmode' | 'auth required' | 'network/retrying' | 'error';
        category?: 'flood' | 'slowmode' | 'auth' | 'permission' | 'network' | 'unknown' | null;
        error?: string;
      }>;
      getConfig: () => Promise<{ success: boolean; config?: { hasCredentials?: boolean; hasSession?: boolean; connected?: boolean; signedOut?: boolean }; error?: string }>;
      saveCredentials: (data: { API_ID: string; API_HASH: string }) => Promise<{ success: boolean; config?: { hasCredentials?: boolean; hasSession?: boolean; connected?: boolean; signedOut?: boolean }; error?: string }>;
      getAuthState: () => Promise<TelegramAuthStateResult>;
      signOutKeepSession: () => Promise<TelegramAuthStateResult>;
      welcomeBack: () => Promise<TelegramAuthStateResult>;
      forgetAccount: () => Promise<TelegramAuthStateResult>;
      clearSession: () => Promise<{ success: boolean; cleared?: boolean; config?: { hasCredentials?: boolean; hasSession?: boolean; connected?: boolean }; error?: string }>;
      login: (data: { API_ID?: string | number; API_HASH?: string; phoneNumber?: string; phone?: string; password?: string; phoneCode?: string; apiId?: string | number; apiHash?: string }) => Promise<{ success: boolean; requiresCode?: boolean; requiresPassword?: boolean; nextStep?: string; error?: string; isCodeViaApp?: boolean }>;
      connect: () => Promise<{ success: boolean; error?: string }>;
      getChats: () => Promise<{ success: boolean; chats?: { id: string; name: string; username?: string; type?: 'private' | 'group' | 'supergroup' | 'channel' | 'unknown'; avatarDataUrl?: string }[]; error?: string }>;
      getChatPermissions: (chatId: string) => Promise<{ success: boolean; permissions?: { canView: boolean; canSend: boolean | null; canSchedule: boolean | null; error?: string }; error?: string }>;
      getRateLimitState: () => Promise<{
        success: boolean;
        current?: { accountId: string; paused: boolean; pausedUntil: number | null; pausedUntilText?: string; remainingMs: number; remainingMsText?: string; waitSeconds?: number; waitSecondsText?: string; reason?: 'FLOOD_WAIT'; status?: 'normal' | 'rate-limited' | 'slowmode' | 'auth required' | 'network/retrying' | 'error'; category?: 'flood' | 'slowmode' | 'auth' | 'permission' | 'network' | 'unknown' | null; error?: string };
        pausedAccounts?: Array<{ accountId: string; paused: boolean; pausedUntil: number | null; pausedUntilText?: string; remainingMs: number; remainingMsText?: string; waitSeconds?: number; waitSecondsText?: string; reason?: 'FLOOD_WAIT' }>;
      }>;
      waitForRateLimit: () => Promise<{
        success: boolean;
        state?: { accountId: string; paused: boolean; pausedUntil: number | null; pausedUntilText?: string; remainingMs: number; remainingMsText?: string; waitSeconds?: number; waitSecondsText?: string; reason?: 'FLOOD_WAIT' };
        error?: string;
      }>;
      loadSavedChats: () => Promise<{ id: string; name: string; username?: string; type?: 'private' | 'group' | 'supergroup' | 'channel' | 'unknown'; avatarDataUrl?: string }[]>;
      saveSavedChats: (chats: { id: string; name: string; username?: string; type?: 'private' | 'group' | 'supergroup' | 'channel' | 'unknown'; avatarDataUrl?: string }[]) => Promise<{ success: boolean }>;
      loadScheduleHistory: (scope: 'personal' | 'workspace') => Promise<{
        success: boolean;
        history?: { upcoming: import('@/types').ScheduledMessage[]; sent: import('@/types').ScheduledMessage[] };
        needsMigration?: boolean;
        error?: string;
      }>;
      saveScheduleHistory: (data: {
        scope: 'personal' | 'workspace';
        field: 'upcoming' | 'sent';
        messages: import('@/types').ScheduledMessage[];
      } | {
        scope: 'personal' | 'workspace';
        field: 'snapshot';
        messages: {
          upcoming: import('@/types').ScheduledMessage[];
          sent: import('@/types').ScheduledMessage[];
        };
      }) => Promise<{ success: boolean; error?: string }>;
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
      getAvailableEffects: () => Promise<{
        success: boolean;
        effects?: TelegramAvailableEffect[];
        error?: string;
      }>;
      send: (chatId: string, message: string, attachments?: string[], entities?: TelegramFormattingEntity[], replyMarkup?: { inline_keyboard: Array<Array<{ text: string; url?: string; callback_data?: string }>> }, silent?: boolean, effect?: string, accountId?: string, idempotencyKey?: string) => Promise<{
        success: boolean;
        error?: string;
        code?: string;
        category?: TelegramErrorCategory;
        retryable?: boolean;
        waitSeconds?: number;
        cancelled?: boolean;
      }>;
      getScheduleIdentities: (operations: Array<{
        chatId: string;
        message: string;
        targetTimestamp: number;
        attachments?: string[];
        entities?: TelegramFormattingEntity[];
        replyMarkup?: { inline_keyboard: Array<Array<{ text: string; url?: string; callback_data?: string }>> };
        silent?: boolean;
        effect?: string;
      }>) => Promise<{ success: boolean; identities?: Array<string | null>; error?: string }>;
      schedule: (data: {
        accountId?: string;
        chatId: string;
        message: string;
        targetTimestamp: number;
        attachments?: string[];
        entities?: TelegramFormattingEntity[];
        replyMarkup?: { inline_keyboard: Array<Array<{ text: string; url?: string; callback_data?: string }>> };
        silent?: boolean;
        effect?: string;
      }) => Promise<{
        success: boolean;
        id?: string | number;
        telegramMessageId?: string | number;
        telegramMessageIds?: Array<string | number>;
        confirmed?: boolean;
        operationIdentity?: string;
        error?: string;
        code?: string;
        category?: TelegramErrorCategory;
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
      deleteSavedMessage: (data: { chatId: string; messageId: string }) => Promise<{
        success: boolean;
        error?: string;
      }>;
      getFilePath: (file: File) => string;
      cancel: (data: {
        chatId: string;
        telegramMessageId?: string | number;
        telegramMessageIds?: Array<string | number>;
        message?: string;
        targetTimestamp?: number;
      }) => Promise<{
        success: boolean;
        alreadySent?: boolean;
        code?: string;
        category?: TelegramErrorCategory;
        retryable?: boolean;
        waitSeconds?: number;
        cancelled?: boolean;
        telegramMessageId?: string | number;
        sentAt?: string;
        error?: string;
      }>;
      onStatus: (callback: (status: unknown) => void) => () => void;
    };
  }
}