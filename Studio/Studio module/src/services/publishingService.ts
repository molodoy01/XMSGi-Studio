import { resolveAccountId } from '../domain/accountContext';
import type { ChannelAdapter, Post, Schedule } from '../domain/types';
import { telegramChannelAdapter } from './telegramChannelAdapter';
import { createPublishPost } from './postStudioService';

export type PublishDraftInput = {
  accountId?: string;
  channelId: string;
  body: string;
  entities?: Array<{ type: string; offset: number; length: number; url?: string }>;
  mediaIds?: string[];
  replyMarkup?: unknown;
  scheduleAt?: string;
  recurrenceRule?: string;
  timezone?: string;
};

export function createScheduledPost(input: PublishDraftInput): { post: Post; schedule: Schedule } {
  const accountId = resolveAccountId(input.accountId);
  const post = createPublishPost({
    accountId,
    channelId: input.channelId,
    body: input.body,
    entities: input.entities ?? [],
    mediaIds: input.mediaIds ?? [],
    replyMarkup: input.replyMarkup,
  });

  const now = new Date().toISOString();
  const schedule: Schedule = {
    id: crypto.randomUUID(),
    postId: post.id,
    accountId,
    channelId: input.channelId,
    triggerAt: input.scheduleAt ?? now,
    recurrenceRule: input.recurrenceRule,
    timezone: input.timezone ?? 'UTC',
    status: 'scheduled',
  };

  return { post, schedule };
}

export async function publishToChannel(
  input: PublishDraftInput,
  adapter: ChannelAdapter = telegramChannelAdapter,
) {
  const { post } = createScheduledPost(input);
  const normalized = await adapter.normalizeMessage(post);
  const publishResult = await adapter.send(post);

  return {
    post,
    normalized,
    publishResult,
  };
}

export async function scheduleToChannel(
  input: PublishDraftInput,
  adapter: ChannelAdapter = telegramChannelAdapter,
) {
  const { post, schedule } = createScheduledPost(input);
  const publishResult = await adapter.schedule(post, schedule);

  return { post, schedule, publishResult };
}
