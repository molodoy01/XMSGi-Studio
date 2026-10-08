import type { InlineButtonRow } from './lib/inlineKeyboard';
import type { DraftAttachment } from './domain/types';
import type { SavedDraft } from '@shared/types';

export type { DraftAttachment } from './domain/types';
export type {
  Chat,
  ChatPermissions,
  BridgeErrorDetails,
  DraftColor,
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
  SavedDraft,
  SavedDraftAttachment,
  ScheduledMessage,
  Template,
} from '@shared/types';

export interface PersistedDraftStore {
  schemaVersion: number;
  migrationVersion: number;
  savedDrafts: SavedDraft[];
  workspaceDraft: Record<string, unknown> | null;
  [key: string]: unknown;
}
