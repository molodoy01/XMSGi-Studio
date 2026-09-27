import { resolveAccountId } from '../domain/accountContext';
import type { Draft, Post } from '../domain/types';

export type CreateDraftInput = {
  authorAccountId?: string;
  contentBody: string;
  richText?: string;
  attachments?: Array<{ name: string; path: string; size?: number }>;
  metadata?: Record<string, unknown>;
  postId?: string;
};

export type CreatePostInput = {
  accountId?: string;
  channelId: string;
  body: string;
  entities?: Array<{ type: string; offset: number; length: number; url?: string }>;
  mediaIds?: string[];
  replyMarkup?: unknown;
  scheduleId?: string;
};

export function createDomainDraft(input: CreateDraftInput): Draft {
  const authorAccountId = resolveAccountId(input.authorAccountId);

  return {
    id: crypto.randomUUID(),
    authorAccountId,
    postId: input.postId,
    contentBody: input.contentBody,
    richText: input.richText ?? input.contentBody,
    attachments: input.attachments ?? [],
    metadata: input.metadata ?? {},
    lastSavedAt: new Date().toISOString(),
  };
}

export function createPublishPost(input: CreatePostInput): Post {
  const accountId = resolveAccountId(input.accountId);

  return {
    id: crypto.randomUUID(),
    accountId,
    channelId: input.channelId,
    status: 'draft',
    body: input.body,
    entities: input.entities ?? [],
    mediaIds: input.mediaIds ?? [],
    replyMarkup: input.replyMarkup,
    scheduleId: input.scheduleId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
