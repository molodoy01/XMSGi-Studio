import type { InlineButtonRow } from './lib/inlineKeyboard';
import type { DraftAttachment } from './domain/types';
import type { Chat, RichTextEntity } from '@shared/types';

export type { DraftAttachment } from './domain/types';
export type {
  Chat,
  ChatPermissions,
  InlineButton,
  InlineButtonActionType,
  InlineButtonRow,
  InlineKeyboardButton,
  InlineKeyboardMarkup,
  NotificationState,
  NotificationType,
  PreviewChatHistory,
  PreviewHistoryMedia,
  PreviewHistoryMessage,
  RichTextEntity,
  RichTextEntityType,
  ScheduledMessage,
  Template,
} from '@shared/types';

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
