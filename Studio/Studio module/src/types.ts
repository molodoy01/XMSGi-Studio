import type { InlineButtonRow } from './lib/inlineKeyboard';
import type { DraftAttachment } from './domain/types';

export type { DraftAttachment } from './domain/types';

export interface Chat {
  id: string;
  name: string;
  username?: string;
  type?: 'private' | 'group' | 'supergroup' | 'channel' | 'unknown';
  avatarDataUrl?: string;
}

export interface Template {
  id: string;
  name: string;
  body: string;
  entities?: RichTextEntity[];
  createdAt: string;
  updatedAt: string;
}

export type DraftColor = 'gray' | 'coral' | 'amber' | 'green' | 'teal' | 'blue';

export interface SavedDraft {
  id: string;
  name: string;
  body: string;
  color?: DraftColor;
  entities?: RichTextEntity[];
  attachments?: DraftAttachment[];
  selectedChat?: Chat | null;
  inlineButtons?: InlineButtonRow[];
  date?: string;
  time?: string;
  repeatMode?: 'none' | 'daily' | 'weekly' | 'biweekly' | 'monthly';
  repeatDays?: string[];
  repeatOccurrences?: number;
  createdAt: string;
  updatedAt: string;
}

export interface PersistedDraftStore {
  schemaVersion: number;
  migrationVersion: number;
  savedDrafts: SavedDraft[];
  workspaceDraft: Record<string, unknown> | null;
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

export interface ScheduledMessage {
  id: string;
  chatId: string;
  chatName: string;
  text: string;
  when: string;
  createdAt: string;
  status: 'pending' | 'scheduled' | 'confirmed' | 'sent' | 'failed';
  attachments?: string[];
  entities?: RichTextEntity[];
  replyMarkup?: import('./lib/inlineKeyboard').InlineKeyboardMarkup;
  operationId?: string;
  sentAt?: string;
  telegramMessageId?: string | number;
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
  replyMarkup?: import('./lib/inlineKeyboard').InlineKeyboardMarkup;
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
};
