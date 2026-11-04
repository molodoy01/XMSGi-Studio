import type { DraftAttachment, PublishRequest } from '@/domain/messageDraft';

type TelegramFormattingEntity = NonNullable<Parameters<Window['telegram']['send']>[3]>[number];
type TelegramFormattingEntities = NonNullable<Parameters<Window['telegram']['send']>[3]>;

export type SchedulerBridgeResult = {
  success: boolean;
  error?: string;
  alreadySent?: boolean;
  sentAt?: string;
  telegramMessageId?: string | number;
  telegramMessageIds?: Array<string | number>;
  confirmed?: boolean;
  operationIdentity?: string;
  id?: string | number;
};

export type PendingScheduleReconciliation = {
  state: 'scheduled' | 'unknown';
  telegramMessageId?: string | number;
  telegramMessageIds?: Array<string | number>;
  error?: string;
};

export type ImmediateSendReconciliation = {
  state: 'sent' | 'unknown';
  telegramMessageId?: string | number;
  telegramMessageIds?: Array<string | number>;
  sentAt?: string;
  error?: string;
};

type TelegramBridge = Window['telegram'];
type TelegramSchedulePayload = Parameters<TelegramBridge['schedule']>[0];
type TelegramReconciliationPayload = Parameters<TelegramBridge['reconcilePendingSchedule']>[0];
type TelegramScheduleOperation = Parameters<TelegramBridge['getScheduleIdentities']>[0][number];
type TelegramHistorySavePayload = Parameters<TelegramBridge['saveScheduleHistory']>[0];

function getBridge(): Window['telegram'] | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.telegram;
}

export async function waitForTelegramRateLimit() {
  const bridge = getBridge();
  if (!bridge || typeof bridge.waitForRateLimit !== 'function') {
    return { success: true };
  }
  return bridge.waitForRateLimit();
}

export async function loadScheduleHistory(scope: 'personal' | 'workspace') {
  const bridge = getBridge();
  if (!bridge || typeof bridge.loadScheduleHistory !== 'function') return undefined;
  return bridge.loadScheduleHistory(scope);
}

export function hasScheduleHistoryStorage(): boolean {
  const bridge = getBridge();
  return Boolean(bridge && typeof bridge.saveScheduleHistory === 'function');
}

export async function saveScheduleHistory(data: TelegramHistorySavePayload) {
  const bridge = getBridge();
  if (!bridge || typeof bridge.saveScheduleHistory !== 'function') {
    return { success: false, error: 'desktopBridgeRequired' };
  }
  return bridge.saveScheduleHistory(data);
}

export async function getScheduleIdentities(operations: TelegramScheduleOperation[]) {
  const bridge = getBridge();
  if (!bridge || typeof bridge.getScheduleIdentities !== 'function') {
    return { success: false, error: 'desktopBridgeRequired' };
  }
  return bridge.getScheduleIdentities(operations);
}

export async function scheduleTelegramMessage(data: TelegramSchedulePayload): Promise<SchedulerBridgeResult> {
  const bridge = getBridge();
  if (!bridge || typeof bridge.schedule !== 'function') {
    return { success: false, error: 'desktopBridgeRequired' };
  }
  return bridge.schedule(data);
}

export async function reconcilePendingSchedule(
  data: TelegramReconciliationPayload,
): Promise<PendingScheduleReconciliation> {
  const bridge = getBridge();
  if (!bridge || typeof bridge.reconcilePendingSchedule !== 'function') {
    return { state: 'unknown', error: 'Telegram schedule state cannot be checked in this runtime.' };
  }

  try {
    const result = await bridge.reconcilePendingSchedule(data);
    if (!result || typeof result !== 'object' || result.success !== true) {
      return { state: 'unknown', error: result?.error || 'Telegram schedule state could not be checked.' };
    }
    if (result.state === 'unknown') return { state: 'unknown', error: result.error };
    if (result.state !== 'scheduled') {
      const error = 'Telegram returned an unsupported or unlinked reconciliation state.';
      console.error(error, result.state);
      return { state: 'unknown', error };
    }

    const validId = (id: unknown): id is string | number => (
      (typeof id === 'string' && /^\d{1,20}$/.test(id) && Number(id) > 0)
      || (typeof id === 'number' && Number.isSafeInteger(id) && id > 0)
    );
    if (result.telegramMessageId !== undefined && !validId(result.telegramMessageId)) {
      console.error('Telegram returned an invalid scheduled message ID.');
      return { state: 'unknown', error: 'Telegram returned an invalid scheduled message ID.' };
    }
    if (result.telegramMessageIds !== undefined
      && (!Array.isArray(result.telegramMessageIds)
        || result.telegramMessageIds.length === 0
        || !result.telegramMessageIds.every(validId))) {
      console.error('Telegram returned invalid scheduled message IDs.');
      return { state: 'unknown', error: 'Telegram returned invalid scheduled message IDs.' };
    }
    const telegramMessageIds = result.telegramMessageIds;
    const telegramMessageId = result.telegramMessageId ?? telegramMessageIds?.[0];
    if (telegramMessageId === undefined) {
      console.error('Telegram confirmed a schedule without returning its message ID.');
      return { state: 'unknown', error: 'Telegram confirmed a schedule without returning its message ID.' };
    }
    return {
      state: 'scheduled',
      telegramMessageId,
      telegramMessageIds,
      error: result.error,
    };
  } catch (error) {
    console.error(
      'Schedule reconciliation bridge failed:',
      error instanceof Error ? error.message : 'unknown error',
    );
    return {
      state: 'unknown',
      error: error instanceof Error ? error.message : 'Telegram schedule state could not be checked.',
    };
  }
}

function normalizeAttachments(attachments?: Array<DraftAttachment | string>): string[] {
  if (!attachments) return [];

  return attachments
    .map((attachment) => typeof attachment === 'string' ? attachment : attachment.path)
    .filter((path): path is string => typeof path === 'string' && path.length > 0);
}

function normalizeEntities(entities: PublishRequest['entities']): TelegramFormattingEntities {
  const supportedTypes = new Set<TelegramFormattingEntity['type']>([
    'bold',
    'italic',
    'underline',
    'strikethrough',
    'text_url',
  ]);

  const normalized: TelegramFormattingEntities = [];
  for (const entity of entities ?? []) {
    if (!supportedTypes.has(entity.type as TelegramFormattingEntity['type'])) return [];
    const type = entity.type as TelegramFormattingEntity['type'];
    if (type === 'text_url') {
      if (typeof entity.url !== 'string') continue;
      normalized.push({ type, offset: entity.offset, length: entity.length, url: entity.url });
      continue;
    }
    normalized.push({ type, offset: entity.offset, length: entity.length });
  }
  return normalized;
}

export async function sendNow(payload: PublishRequest): Promise<SchedulerBridgeResult> {
  const bridge = getBridge();
  if (!bridge || typeof bridge.send !== 'function') {
    return { success: false, error: 'desktopBridgeRequired' };
  }

  const entities = normalizeEntities(payload.entities);

  const result = await bridge.send(
    payload.chatId,
    payload.text,
    normalizeAttachments(payload.attachments),
    entities,
    payload.silent ?? false,
    payload.effect,
    payload.accountId,
    payload.sendAttemptId,
  );
  if (!result || typeof result !== 'object' || typeof result.success !== 'boolean') {
    console.error('Telegram send returned an invalid bridge result.');
    return { success: false, error: 'Telegram returned an invalid send result.' };
  }
  if (!result.success) return result;

  const validId = (id: unknown): id is string | number => (
    (typeof id === 'string' && /^\d{1,20}$/.test(id) && Number(id) > 0)
    || (typeof id === 'number' && Number.isSafeInteger(id) && id > 0)
  );
  if (result.telegramMessageId !== undefined && !validId(result.telegramMessageId)) {
    console.error('Telegram send returned an invalid message ID.');
    return { success: false, error: 'Telegram returned an invalid sent message ID.' };
  }
  if (result.telegramMessageIds !== undefined
    && (!Array.isArray(result.telegramMessageIds) || !result.telegramMessageIds.every(validId))) {
    console.error('Telegram send returned invalid message IDs.');
    return { success: false, error: 'Telegram returned invalid sent message IDs.' };
  }

  const telegramMessageIds = result.telegramMessageIds
    ?? (result.telegramMessageId === undefined ? [] : [result.telegramMessageId]);
  const telegramMessageId = result.telegramMessageId ?? telegramMessageIds[0];
  if (!telegramMessageId
    || !validId(telegramMessageId)
    || telegramMessageIds.length !== Math.max(1, normalizeAttachments(payload.attachments).length)
    || new Set(telegramMessageIds.map(String)).size !== telegramMessageIds.length
    || String(telegramMessageIds[0]) !== String(telegramMessageId)) {
    console.error('Telegram confirmed a send without a complete set of correlated message IDs.');
    return { success: false, error: 'Telegram did not return enough information to confirm this send.' };
  }

  return { ...result, telegramMessageId, telegramMessageIds };
}

export async function reconcileImmediateSendAttempt(
  idempotencyKey: string,
  attachmentCount = 0,
): Promise<ImmediateSendReconciliation> {
  if (!Number.isSafeInteger(attachmentCount) || attachmentCount < 0) {
    return { state: 'unknown', error: 'Telegram send recovery received an invalid attachment count.' };
  }

  const bridge = getBridge();
  if (!bridge || typeof bridge.reconcileSendAttempt !== 'function') {
    return { state: 'unknown', error: 'Telegram send result cannot be checked in this runtime.' };
  }

  try {
    const result = await bridge.reconcileSendAttempt({ idempotencyKey, attachmentCount });
    if (!result || typeof result !== 'object' || result.success !== true) {
      return { state: 'unknown', error: result?.error || 'Telegram send result could not be checked.' };
    }
    if (result.state === 'unknown') return { state: 'unknown', error: result.error };
    if (result.state !== 'sent') {
      console.error('Telegram returned an unsupported send-recovery state.', result.state);
      return { state: 'unknown', error: 'Telegram returned an unsupported send-recovery state.' };
    }

    const validId = (id: unknown): id is string | number => (
      (typeof id === 'string' && /^\d{1,20}$/.test(id) && Number(id) > 0)
      || (typeof id === 'number' && Number.isSafeInteger(id) && id > 0)
    );
    if (result.telegramMessageId === undefined || !validId(result.telegramMessageId)) {
      console.error('Telegram confirmed send recovery without a valid message ID.');
      return { state: 'unknown', error: 'Telegram send recovery did not include a valid message ID.' };
    }
    const expectedMessageCount = Math.max(1, attachmentCount);
    const telegramMessageIds = result.telegramMessageIds
      ?? (expectedMessageCount === 1 ? [result.telegramMessageId] : undefined);
    if (!Array.isArray(telegramMessageIds)
      || telegramMessageIds.length !== expectedMessageCount
      || !telegramMessageIds.every(validId)
      || new Set(telegramMessageIds.map(String)).size !== telegramMessageIds.length
      || String(telegramMessageIds[0]) !== String(result.telegramMessageId)) {
      console.error('Telegram send recovery returned invalid message IDs.');
      return { state: 'unknown', error: 'Telegram send recovery did not include a complete, consistent set of message IDs.' };
    }
    return {
      state: 'sent',
      telegramMessageId: result.telegramMessageId,
      telegramMessageIds,
      ...(typeof result.sentAt === 'string' && Number.isFinite(Date.parse(result.sentAt)) ? { sentAt: result.sentAt } : {}),
      error: result.error,
    };
  } catch (error) {
    console.error('Telegram send recovery bridge failed:', error instanceof Error ? error.message : 'unknown error');
    return {
      state: 'unknown',
      error: error instanceof Error ? error.message : 'Telegram send result could not be checked.',
    };
  }
}

export async function scheduleMessage(payload: PublishRequest): Promise<SchedulerBridgeResult> {
  const bridge = getBridge();
  if (!bridge || typeof bridge.schedule !== 'function') {
    return { success: false, error: 'desktopBridgeRequired' };
  }

  const scheduledAt = payload.scheduledAt ?? (payload.targetTimestamp ? new Date(payload.targetTimestamp).toISOString() : undefined);
  if (!scheduledAt) {
    return { success: false, error: 'Schedule time is required.' };
  }

  const targetTimestamp = payload.targetTimestamp ?? Math.floor(new Date(scheduledAt).getTime() / 1000);
  if (Number.isNaN(targetTimestamp)) {
    return { success: false, error: 'Schedule time is invalid.' };
  }

  const entities = normalizeEntities(payload.entities);

  return (await bridge.schedule({
    chatId: payload.chatId,
    message: payload.text,
    targetTimestamp,
    attachments: normalizeAttachments(payload.attachments),
    entities,
    silent: payload.silent,
    effect: payload.effect,
    accountId: payload.accountId,
  })) as unknown as SchedulerBridgeResult;
}

export async function cancelScheduledMessage(data: {
  chatId: string;
  telegramMessageId?: string | number;
  telegramMessageIds?: Array<string | number>;
  message?: string;
  targetTimestamp?: number;
}): Promise<SchedulerBridgeResult> {
  const bridge = getBridge();
  if (!bridge || typeof bridge.cancel !== 'function') {
    return { success: false, error: 'desktopBridgeRequired' };
  }

  return (await bridge.cancel(data)) as unknown as SchedulerBridgeResult;
}
