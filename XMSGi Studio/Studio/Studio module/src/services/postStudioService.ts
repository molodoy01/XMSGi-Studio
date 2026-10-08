import { resolveAccountId } from '../domain/accountContext';
import type { Draft, DraftAttachment, Post } from '../domain/types';

export type CreateDraftInput = {
  authorAccountId?: string;
  contentBody: string;
  richText?: string;
  attachments?: Array<{ name: string; path: string; size?: number }>;
  metadata?: Record<string, unknown>;
  postId?: string;
};

function normalizeDraftAttachments(value: CreateDraftInput['attachments']): DraftAttachment[] {
  return (value ?? []).map((attachment, index) => {
    const extended = attachment as Partial<DraftAttachment>;
    const extension = attachment.name.split('.').pop()?.toLowerCase();
    const mimeType = extended.mimeType || (extension === 'png' ? 'image/png'
      : extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg'
        : extension === 'gif' ? 'image/gif'
          : extension === 'webp' ? 'image/webp'
            : extension === 'avif' ? 'image/avif' : 'application/octet-stream');
    const type = extended.type === 'image' || extended.type === 'file'
      ? extended.type
      : mimeType.startsWith('image/') ? 'image' : 'file';

    return {
      id: extended.id || `draft-attachment-${crypto.randomUUID()}-${index}`,
      type,
      name: attachment.name,
      mimeType,
      size: typeof attachment.size === 'number' ? attachment.size : 0,
      path: attachment.path,
      ...(typeof extended.previewUrl === 'string' ? { previewUrl: extended.previewUrl } : {}),
      position: typeof extended.position === 'number' ? Math.max(0, extended.position) : 0,
    };
  });
}

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
    attachments: normalizeDraftAttachments(input.attachments),
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
