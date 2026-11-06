import type { PersistedWorkspaceDocumentHistories, SavedDraft } from '@shared/types';

export type { DraftAttachment } from './domain/types';
export type {
  Chat,
  ChatPermissions,
  BridgeErrorDetails,
  DraftColor,
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
  documentHistories?: PersistedWorkspaceDocumentHistories;
  [key: string]: unknown;
}
