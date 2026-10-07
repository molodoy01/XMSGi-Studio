declare module '$studio' {
  import type { ComponentType } from 'react';
  import type { Chat } from '@/types';

  export type DraftColor =
    | 'gray'
    | 'blue'
    | 'green'
    | 'orange'
    | 'purple'
    | 'red'
    | 'teal'
    | 'pink'
    | 'yellow';

  export interface SavedDraftAttachment {
    name?: string;
    path?: string;
  }

  export interface SavedDraft {
    id: string;
    name: string;
    body: string;
    color?: DraftColor;
    createdAt: string;
    updatedAt: string;
    attachments?: SavedDraftAttachment[];
    selectedChat?: Pick<Chat, 'id' | 'name' | 'username' | 'type' | 'avatarDataUrl'> | null;
    entities?: Array<{ type: string; offset: number; length: number; url?: string }>;
    [key: string]: unknown;
  }

  export interface PersistedDraftStore {
    schemaVersion?: number;
    migrationVersion?: number;
    savedDrafts: SavedDraft[];
    workspaceDraft?: SavedDraft | null;
    [key: string]: unknown;
  }

  export type StudioScheduledMessage = import('@/types').ScheduledMessage;
  export type StudioSchedulerRuntime = Record<string, unknown>;

  const StudioApp: ComponentType<{
    connected: boolean;
    chats: Chat[];
    scheduler: StudioSchedulerRuntime;
    activeAccountId: 'account-1' | 'account-2';
    onRegisterHistoryDraftOpener?: (opener: ((draft: SavedDraft) => void) | null) => void;
    onRegisterHistoryDraftUseHandler?: (handler: ((draft: SavedDraft) => void) | null) => void;
    onRegisterHistoryDraftClearHandler?: (handler: (() => Promise<boolean>) | null) => void;
    onRegisterHistoryDraftDeleteHandler?: (handler: ((draftId: string) => Promise<boolean>) | null) => void;
    onRegisterHistoryRescheduleHandler?: (handler: ((message: StudioScheduledMessage) => void) | null) => void;
  }>;

  export default StudioApp;
}