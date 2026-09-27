export type AccountType = 'personal' | 'workspace' | 'channel' | 'service';
export type ChannelProvider = 'telegram' | 'instagram' | 'vk' | 'discord' | 'linkedin' | 'custom';
export type PublishStatus = 'draft' | 'ready' | 'scheduled' | 'sending' | 'sent' | 'failed';

export interface Account {
  id: string;
  type: AccountType;
  provider: ChannelProvider;
  displayName: string;
  username?: string;
  status: 'active' | 'inactive' | 'blocked';
  credentialsRef?: string;
  settings?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ChannelTarget {
  id: string;
  accountId: string;
  provider: ChannelProvider;
  name: string;
  type: 'private' | 'group' | 'channel' | 'workspace' | 'unknown';
  username?: string;
  capabilities?: Record<string, boolean>;
}

export interface Post {
  id: string;
  accountId: string;
  channelId: string;
  status: PublishStatus;
  body: string;
  entities?: Array<{ type: string; offset: number; length: number; url?: string }>;
  mediaIds?: string[];
  replyMarkup?: unknown;
  scheduleId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Draft {
  id: string;
  authorAccountId: string;
  postId?: string;
  contentBody: string;
  richText?: string;
  attachments?: Array<{ name: string; path: string; size?: number }>;
  metadata?: Record<string, unknown>;
  lastSavedAt: string;
}

export interface Template {
  id: string;
  accountId: string;
  name: string;
  body: string;
  fields?: string[];
  tags?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Schedule {
  id: string;
  postId: string;
  accountId: string;
  channelId: string;
  triggerAt: string;
  recurrenceRule?: string;
  timezone?: string;
  status: 'pending' | 'scheduled' | 'sent' | 'failed' | 'cancelled';
}

export interface Media {
  id: string;
  kind: 'image' | 'video' | 'document' | 'audio' | 'unknown';
  filePath?: string;
  remoteUrl?: string;
  mimeType?: string;
  size?: number;
  checksum?: string;
  metadata?: Record<string, unknown>;
}

export interface PersonalNote {
  id: string;
  accountId: string;
  content: string;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface PublishResult {
  ok: boolean;
  provider: ChannelProvider;
  messageId?: string;
  confirmed?: boolean;
  error?: string;
}

export interface NormalizedMessage {
  text: string;
  entities?: Array<{ type: string; offset: number; length: number; url?: string }>;
  mediaIds?: string[];
  replyMarkup?: unknown;
}

export interface ChannelCapabilities {
  supportsRichText: boolean;
  supportsMedia: boolean;
  supportsTextPublishing: boolean;
  supportsScheduling: boolean;
  supportsScheduleCancellation: boolean;
  supportsEditing: boolean;
  supportsDeletion: boolean;
  supportsInlineKeyboard: boolean;
}

export interface ChannelAdapter {
  provider: ChannelProvider;
  validateTarget(target: ChannelTarget): boolean | Promise<boolean>;
  normalizeMessage(post: Post): NormalizedMessage | Promise<NormalizedMessage>;
  send(post: Post): PublishResult | Promise<PublishResult>;
  schedule(post: Post, schedule: Schedule): PublishResult | Promise<PublishResult>;
  cancelScheduled(channelId: string, messageId: string | number): PublishResult | Promise<PublishResult>;
  getCapabilities(): ChannelCapabilities | Promise<ChannelCapabilities>;
}

export interface Repository<T> {
  list(): T[];
  getById(id: string): T | null;
  save(entity: T): T;
  remove(id: string): void;
}
