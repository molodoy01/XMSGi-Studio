import type {
  Chat,
  InlineKeyboardMarkup,
  NotificationState,
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
  entities?: RichTextEntity[];
  replyMarkup?: InlineKeyboardMarkup;
  silent?: boolean;
  effect?: string;
  replaceMessage?: ScheduledMessage;
}

export interface StudioBridgeNotification extends NotificationState {
  errorDetails?: BridgeErrorDetails;
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
  handleSchedule: (payload?: StudioSchedulePayload, repeat?: StudioScheduleRepeatOptions) => void | Promise<void>;
  handleSendDraftNow: (
    chat: Chat,
    text: string,
    attachments?: string[],
    entities?: RichTextEntity[],
    replyMarkup?: InlineKeyboardMarkup,
  ) => Promise<boolean>;
  handleSendNow: (message: ScheduledMessage) => void | Promise<void>;
  handleDeleteMessage: (message: ScheduledMessage) => void | Promise<void>;
  handleClearSent: () => void;
  handleCancelMessage: (message: ScheduledMessage) => void | Promise<boolean | void>;
  handleCancelMessages: (messages: ScheduledMessage[]) => Promise<boolean>;
}

export interface StudioSchedulerRuntime extends StudioSchedulerActions {
  protocolVersion: BridgeProtocolVersion;
  notification: StudioBridgeNotification;
  closeNotification: () => void;
}

export type RegisterHandler<T> = (handler: T | null) => void;

export interface StudioHistoryBridgeCallbacks {
  onRegisterHistoryDraftOpener?: RegisterHandler<(draft: SavedDraft) => void>;
  onRegisterHistoryDraftUseHandler?: RegisterHandler<(draft: SavedDraft) => void>;
  onRegisterHistoryDraftClearHandler?: RegisterHandler<() => Promise<boolean>>;
  onRegisterHistoryDraftDeleteHandler?: RegisterHandler<(draftId: string) => Promise<boolean>>;
  onRegisterHistoryRescheduleHandler?: RegisterHandler<(message: ScheduledMessage) => void>;
}

export interface StudioBridgeProps extends StudioHistoryBridgeCallbacks {
  connected?: boolean;
  chats?: Chat[];
  scheduler?: StudioSchedulerRuntime;
  activeAccountId?: 'account-1' | 'account-2';
}