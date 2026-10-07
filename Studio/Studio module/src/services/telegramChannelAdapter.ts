import type {
  ChannelAdapter,
  ChannelCapabilities,
  ChannelTarget,
  NormalizedMessage,
  Post,
  PublishResult,
  Schedule,
} from '../domain/types';
import type { TelegramErrorCategory, TelegramOperationName } from '@shared/types';
import { handleTelegramError } from './telegramErrorHandler';

export const telegramCapabilities: ChannelCapabilities = {
  supportsRichText: true,
  supportsMedia: true,
  supportsTextPublishing: true,
  supportsScheduling: true,
  supportsScheduleCancellation: true,
  supportsEditing: false,
  supportsDeletion: false,
  supportsInlineKeyboard: true,
};

type TelegramFormattingEntity = {
  type: 'bold' | 'italic' | 'underline' | 'strikethrough' | 'text_url';
  offset: number;
  length: number;
  url?: string;
};

type TelegramReplyMarkup = {
  inline_keyboard: Array<Array<{ text: string; url?: string; callback_data?: string }>>;
};

const formattingEntityTypes = new Set<TelegramFormattingEntity['type']>([
  'bold',
  'italic',
  'underline',
  'strikethrough',
  'text_url',
]);

function getTelegramBridge(): Window['telegram'] | undefined {
  return typeof window === 'undefined' ? undefined : window.telegram;
}

function getFormattingEntities(entities: NormalizedMessage['entities']): TelegramFormattingEntity[] {
  return (entities ?? []).filter((entity): entity is TelegramFormattingEntity => (
    formattingEntityTypes.has(entity.type as TelegramFormattingEntity['type'])
    && Number.isInteger(entity.offset)
    && entity.offset >= 0
    && Number.isInteger(entity.length)
    && entity.length >= 0
    && (entity.type !== 'text_url' || typeof entity.url === 'string')
  ));
}

function getReplyMarkup(value: unknown): TelegramReplyMarkup | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const markup = value as Partial<TelegramReplyMarkup>;
  if (!Array.isArray(markup.inline_keyboard)) return undefined;

  const isButton = (button: unknown) => Boolean(
    button
    && typeof button === 'object'
    && typeof (button as { text?: unknown }).text === 'string'
    && ((button as { url?: unknown }).url === undefined || typeof (button as { url?: unknown }).url === 'string')
    && ((button as { callback_data?: unknown }).callback_data === undefined || typeof (button as { callback_data?: unknown }).callback_data === 'string'),
  );
  const validMarkup = markup.inline_keyboard.every((row) => Array.isArray(row) && row.every(isButton));
  return validMarkup ? value as TelegramReplyMarkup : undefined;
}

function failedResult(source: unknown, operation: TelegramOperationName, fallbackMessage: string): PublishResult {
  const errorDetails = handleTelegramError(source, operation, fallbackMessage);
  return { ok: false, provider: 'telegram', error: errorDetails.message, errorDetails };
}

function toPublishResult(result: {
  success: boolean;
  id?: string | number;
  telegramMessageId?: string | number;
  confirmed?: boolean;
  error?: string;
  code?: string;
  category?: TelegramErrorCategory;
  retryable?: boolean;
  waitSeconds?: number;
  cancelled?: boolean;
}, operation: TelegramOperationName): PublishResult {
  const messageId = result.telegramMessageId ?? result.id;
  if (!result.success) {
    const errorDetails = handleTelegramError(result, operation, operation === 'cancel'
      ? 'Telegram could not cancel the scheduled message.'
      : 'Telegram could not publish the message.');
    return {
      ok: false,
      provider: 'telegram',
      ...(messageId === undefined ? {} : { messageId: String(messageId) }),
      error: errorDetails.message,
      errorDetails,
    };
  }

  return {
    ok: true,
    provider: 'telegram',
    ...(messageId === undefined ? {} : { messageId: String(messageId) }),
    ...(result.confirmed === undefined ? {} : { confirmed: result.confirmed }),
    ...(result.error ? { error: result.error } : {}),
  };
}

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
      replyMarkup: post.replyMarkup,
    };
  }

  async send(post: Post): Promise<PublishResult> {
    const telegram = getTelegramBridge();
    if (!telegram?.send) return failedResult('Telegram bridge is not connected.', 'publish', 'Telegram bridge is not connected.');

    try {
      const message = await this.normalizeMessage(post);
      return toPublishResult(await telegram.send(
        post.channelId,
        message.text,
        message.mediaIds,
        getFormattingEntities(message.entities),
        getReplyMarkup(message.replyMarkup),
      ), 'publish');
    } catch (error) {
      return failedResult(error, 'publish', 'Telegram could not send the message.');
    }
  }

  async schedule(post: Post, schedule: Schedule): Promise<PublishResult> {
    const telegram = getTelegramBridge();
    if (!telegram?.schedule) return failedResult('Telegram bridge is not connected.', 'publish', 'Telegram bridge is not connected.');

    const targetTimestamp = Math.floor(new Date(schedule.triggerAt).getTime() / 1000);
    if (!Number.isFinite(targetTimestamp)) return failedResult('Schedule time is invalid.', 'publish', 'Telegram could not schedule the message.');

    try {
      const message = await this.normalizeMessage(post);
      return toPublishResult(await telegram.schedule({
        chatId: post.channelId,
        message: message.text,
        targetTimestamp,
        attachments: message.mediaIds,
        entities: getFormattingEntities(message.entities),
        replyMarkup: getReplyMarkup(message.replyMarkup),
      }), 'publish');
    } catch (error) {
      return failedResult(error, 'publish', 'Telegram could not schedule the message.');
    }
  }

  async cancelScheduled(channelId: string, messageId: string | number): Promise<PublishResult> {
    const telegram = getTelegramBridge();
    if (!telegram?.cancel) return failedResult('Telegram bridge is not connected.', 'cancel', 'Telegram bridge is not connected.');

    try {
      return toPublishResult(await telegram.cancel({ chatId: channelId, telegramMessageId: messageId }), 'cancel');
    } catch (error) {
      return failedResult(error, 'cancel', 'Telegram could not cancel the scheduled message.');
    }
  }

  getCapabilities(): ChannelCapabilities {
    return telegramCapabilities;
  }
}

export const telegramChannelAdapter = new TelegramChannelAdapter();
