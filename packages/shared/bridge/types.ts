import type { Dispatch, SetStateAction } from 'react';
import type {
  Chat,
  NotificationType,
  RichTextEntity,
  SavedDraft,
  ScheduledMessage,
} from '../types';
import type { BridgeErrorDetails } from './errors';
import type { BridgeProtocolVersion } from './protocol';

export type StudioScheduleRepeatMode = 'none' | 'daily' | 'weekly' | 'biweekly' | 'monthly';

export interface StudioScheduleRepeatOptions {
  mode: StudioScheduleRepeatMode;
  days?: string[];
  occurrences: number;
}

export interface StudioSchedulePayload {
  chatId: string;
  message: string;
  date: string;
  time: string;
  attachments?: string[];
  attachmentGroups?: string[][];
  entities?: RichTextEntity[];
  silent?: boolean;
  effect?: string;
  waitForConfirmation?: boolean;
  replaceMessage?: ScheduledMessage;
}

export interface StudioSchedulerActions {
  upcoming: ScheduledMessage[];
  sent: ScheduledMessage[];
  scheduling: boolean;
  successPulse: boolean;
  lastAction: 'sent' | 'scheduled' | null;
  revealingId: string | null;
  cancelingIds: ReadonlySet<string>;
  sendingIds: ReadonlySet<string>;
  publishingDraft: boolean;
  handleSchedule: (payload?: StudioSchedulePayload, repeat?: StudioScheduleRepeatOptions) => void | Promise<void | boolean | 'sent-history-failed'>;
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
  handleSendNow: (message: ScheduledMessage) => void | Promise<void>;
  handleDeleteMessage: (message: ScheduledMessage) => void | Promise<void>;
  handleClearSent: () => void;
  handleCancelMessage: (message: ScheduledMessage) => void | Promise<boolean | void>;
  handleCancelMessages: (messages: ScheduledMessage[]) => Promise<boolean>;
}

export interface StudioSchedulerRuntime extends StudioSchedulerActions {
  protocolVersion: BridgeProtocolVersion;
  showNotification: (
    message: string,
    type: NotificationType,
    title: string,
    errorDetails?: BridgeErrorDetails,
    durationMs?: number,
  ) => void;
}

export type RegisterHandler<T> = (handler: T | null) => void;

export interface StudioPlannerTextPayload {
  text: string;
  attachments: string[];
  entities: RichTextEntity[];
  effect?: string;
}

export interface StudioHistoryBridgeCallbacks {
  onRegisterPlannerTextOpener?: RegisterHandler<(payload: StudioPlannerTextPayload) => Promise<boolean>>;
  onRegisterBeforeLeaveStudio?: RegisterHandler<() => Promise<boolean>>;
  onRegisterHistoryDraftOpener?: RegisterHandler<(draft: SavedDraft) => void>;
  onRegisterHistoryDraftUseHandler?: RegisterHandler<(draft: SavedDraft) => Promise<boolean>>;
  onRegisterHistoryDraftClearHandler?: RegisterHandler<() => Promise<boolean>>;
  onRegisterHistoryDraftDeleteHandler?: RegisterHandler<(draftId: string) => Promise<boolean>>;
  onRegisterHistoryRescheduleHandler?: RegisterHandler<(message: ScheduledMessage) => void>;
}

export interface StudioBridgeProps extends StudioHistoryBridgeCallbacks {
  connected?: boolean;
  connectionRecoveryStatus?: 'reconnecting' | 'offline' | null;
  chats?: Chat[];
  selectedChat?: Chat | null;
  onSelectChat?: Dispatch<SetStateAction<Chat | null>>;
  scheduler?: StudioSchedulerRuntime;
  activeAccountId?: 'account-1' | 'account-2';
}