import type { Dispatch, SetStateAction } from 'react';
import type { BridgeErrorDetails, StudioPlannerTextPayload } from '@shared/bridge';
import type { ScheduleRepeatOptions } from '../lib/scheduling';
import type {
  Chat,
  NotificationType,
  RichTextEntity,
  SavedDraft,
  ScheduledMessage,
} from '../types';

export type WorkspacePageProps = {
  connected: boolean;
  connectionRecoveryStatus?: 'reconnecting' | 'offline' | null;
  chats: Chat[];
  selectedChat: Chat | null;
  setSelectedChat: Dispatch<SetStateAction<Chat | null>>;
  selectedChatControlled?: boolean;
  onAddChat: (chat: Chat) => void;
  onRemoveChat: (chat: Chat) => void;
  removeModal: { show: boolean; chat: Chat | null };
  setRemoveModal: Dispatch<SetStateAction<{ show: boolean; chat: Chat | null }>>;
  confirmRemoveChat: () => void;
  upcoming: ScheduledMessage[];
  date: string;
  time: string;
  scheduling: boolean;
  successPulse: boolean;
  lastAction: 'sent' | 'scheduled' | null;
  setDate: Dispatch<SetStateAction<string>>;
  setTime: Dispatch<SetStateAction<string>>;
  handleSchedule: (payload?: {
    chatId: string;
    message: string;
    date: string;
    time: string;
    attachments?: string[];
    attachmentGroups?: string[][];
    entities?: RichTextEntity[];
    effect?: string;
    replaceMessage?: ScheduledMessage;
  }, repeat?: ScheduleRepeatOptions) => void | Promise<void | boolean | 'sent-history-failed'>;
  handleCancelMessage: (message: ScheduledMessage) => void;
  handleCancelMessages?: (messages: ScheduledMessage[]) => Promise<boolean>;
  handleSendDraftNow: (
    chat: Chat,
    text: string,
    attachments?: string[],
    entities?: RichTextEntity[],
    attachmentGroups?: string[][],
    onAttachmentGroupResult?: (groupIndex: number, sent: boolean) => void,
    effect?: string,
    suppressNotifications?: boolean,
  ) => Promise<boolean | 'sent-history-failed'>;
  publishingDraft: boolean;
  showNotification?: (
    message: string,
    type: NotificationType,
    title: string,
    errorDetails?: BridgeErrorDetails,
    durationMs?: number,
  ) => void;
  inlineNotification?: StudioInlineNotification | null;
  onRegisterPlannerTextOpener?: (opener: ((payload: StudioPlannerTextPayload) => Promise<boolean>) | null) => void;
  onRegisterBeforeLeaveStudio?: (flush: (() => Promise<boolean>) | null) => void;
  onRegisterHistoryDraftOpener?: (opener: ((draft: SavedDraft) => void) | null) => void;
  onRegisterHistoryDraftUseHandler?: (handler: ((draft: SavedDraft) => Promise<boolean>) | null) => void;
  onRegisterHistoryDraftClearHandler?: (handler: (() => Promise<boolean>) | null) => void;
  onRegisterHistoryDraftDeleteHandler?: (handler: ((draftId: string) => Promise<boolean>) | null) => void;
  onRegisterHistoryRescheduleHandler?: (handler: ((message: ScheduledMessage) => void) | null) => void;
};

export type StudioInlineNotification = {
  message: string;
  title: string;
  type: NotificationType;
  durationMs: number;
  revision: number;
};
