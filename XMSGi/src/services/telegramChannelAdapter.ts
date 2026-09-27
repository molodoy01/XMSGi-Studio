import type {
  ChannelAdapter,
  ChannelCapabilities,
  ChannelTarget,
  NormalizedMessage,
  Post,
  PublishResult,
} from '../domain/types';

export const telegramCapabilities: ChannelCapabilities = {
  supportsRichText: true,
  supportsMedia: true,
  supportsScheduling: true,
  supportsInlineKeyboard: true,
};

export class TelegramChannelAdapter implements ChannelAdapter {
  provider = 'telegram' as const;

  validateTarget(target: ChannelTarget): boolean {
    return target.provider === 'telegram' && Boolean(target.id);
  }

  async normalizeMessage(post: Post): Promise<NormalizedMessage> {
    return {
      text: post.body,
      entities: post.entities ?? [],
      mediaIds: post.mediaIds ?? [],
      replyMarkup: undefined,
    };
  }

  async send(post: Post): Promise<PublishResult> {
    return {
      ok: true,
      provider: 'telegram',
      messageId: `telegram:${post.id}`,
    };
  }

  async getCapabilities(): Promise<ChannelCapabilities> {
    return telegramCapabilities;
  }
}

export const telegramChannelAdapter = new TelegramChannelAdapter();
