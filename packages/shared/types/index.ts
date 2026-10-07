export type ChatPermissionValue = boolean | null;

export interface ChatPermissions {
  canView: boolean;
  canSend: ChatPermissionValue;
  canSchedule: ChatPermissionValue;
  error?: string;
}

export interface Chat {
  id: string;
  name: string;
  username?: string;
  type?: 'private' | 'group' | 'supergroup' | 'channel' | 'unknown';
  avatarDataUrl?: string;
  permissions?: ChatPermissions;
}

export interface Template {
  id: string;
  name: string;
  body: string;
  entities?: RichTextEntity[];
  createdAt: string;
  updatedAt: string;
}

export type RichTextEntityType =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strikethrough'
  | 'text_url';

export interface RichTextEntity {
  type: RichTextEntityType;
  offset: number;
  length: number;
  url?: string;
}

export interface InlineButton {
  id: string;
  label: string;
  action: {
    type: InlineButtonActionType;
    value: string;
  };
}

export type InlineButtonActionType = 'url' | 'callback';
export type InlineButtonRow = InlineButton[];

export interface InlineKeyboardButton {
  text: string;
  url?: string;
  callback_data?: string;
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

export interface ScheduledMessage {
  id: string;
  accountId?: string;
  chatId: string;
  chatName: string;
  text: string;
  when: string;
  createdAt: string;
  status: 'pending' | 'scheduled' | 'confirmed' | 'sending' | 'sent' | 'failed';
  lastError?: string;
  retryAction?: 'schedule' | 'send' | 'cancel';
  lastAttemptAt?: string;
  sendAttemptId?: string;
  attachments?: string[];
  entities?: RichTextEntity[];
  replyMarkup?: InlineKeyboardMarkup;
  silent?: boolean;
  effect?: string;
  operationId?: string;
  operationIdentity?: string;
  replacementOfId?: string;
  sentAt?: string;
  telegramMessageId?: string | number;
  telegramMessageIds?: Array<string | number>;
}

export interface PreviewHistoryMessage {
  id: string;
  text: string;
  date: string;
  outgoing: boolean;
  senderName?: string;
  entities?: RichTextEntity[];
  mediaType?: string;
  mediaName?: string;
  media?: PreviewHistoryMedia;
  replyMarkup?: InlineKeyboardMarkup;
  groupId?: string;
}

export interface PreviewHistoryMedia {
  kind: 'photo' | 'video' | 'document' | 'audio' | 'unknown';
  name?: string;
  mimeType?: string;
  size?: number;
  duration?: number;
  width?: number;
  height?: number;
  thumbnailDataUrl?: string;
  dataUrl?: string;
}

export interface PreviewChatHistory {
  chat: {
    id: string;
    title: string;
    username?: string;
    type?: string;
    avatarDataUrl?: string;
    topic?: string;
  };
  messages: PreviewHistoryMessage[];
}

export type NotificationType = 'error' | 'warning' | 'success' | 'info';

export type NotificationState = {
  message: string;
  type: NotificationType;
  title: string;
  visible: boolean;
  revision?: number;
};