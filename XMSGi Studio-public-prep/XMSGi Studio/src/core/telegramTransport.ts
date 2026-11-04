export type TelegramConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
export type TelegramAuthStep = 'phone' | 'code' | 'password' | 'ready';

export type TelegramAccountConfig = {
  hasCredentials: boolean;
  hasSession: boolean;
  connected: boolean;
  signedOut: boolean;
  userName: string;
  username: string;
};

export type TelegramChat = {
  id: string;
  name: string;
  username?: string;
  type?: string;
  avatarDataUrl?: string;
};

export type TelegramSendPayload = {
  chatId: string;
  text: string;
  entities?: unknown[];
  attachments?: string[];
  inlineButtons?: unknown[];
};

export type TelegramSchedulePayload = {
  chatId: string;
  text: string;
  entities?: unknown[];
  attachments?: string[];
  inlineButtons?: unknown[];
  scheduledAt: string;
  repeatMode?: string;
};

export type TelegramOperationResult = {
  ok: boolean;
  error?: string;
  operationId?: string;
};

export interface TelegramTransportContract {
  getConfig(): Promise<TelegramAccountConfig>;
  connect(): Promise<TelegramOperationResult>;
  connectWithCode(data: { phoneNumber?: string; code?: string; password?: string }): Promise<TelegramOperationResult>;
  signOutKeepSession(): Promise<TelegramOperationResult>;
  forgetAccount(): Promise<TelegramOperationResult>;
  getChats(): Promise<TelegramChat[]>;
  sendMessage(payload: TelegramSendPayload): Promise<TelegramOperationResult>;
  scheduleMessage(payload: TelegramSchedulePayload): Promise<TelegramOperationResult>;
  cancelScheduledOperation(operationId: string): Promise<TelegramOperationResult>;
}

export const TELEGRAM_TRANSPORT_BOUNDRY = 'telegram-transport-boundary';
