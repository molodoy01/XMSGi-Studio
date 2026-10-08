import type {
  BridgeValidationErrorDetails,
  TelegramErrorCategory,
  TelegramOperationErrorDetails,
  TelegramOperationName,
} from '../types';

type ErrorRecord = {
  telegramError?: unknown;
  errorDetails?: unknown;
  error?: unknown;
  message?: unknown;
  code?: unknown;
  errorCode?: unknown;
  category?: unknown;
  retryable?: unknown;
  waitSeconds?: unknown;
  waitSecondsText?: unknown;
  cancelled?: unknown;
};

const categories = new Set<TelegramErrorCategory>([
  'flood',
  'slowmode',
  'cancelled',
  'auth',
  'permission',
  'network',
  'error',
  'unknown',
]);

function isRecord(value: unknown): value is ErrorRecord {
  return Boolean(value && typeof value === 'object');
}

export function normalizeTelegramBridgeError(
  source: unknown,
  operation: TelegramOperationName,
  fallbackMessage: string,
): TelegramOperationErrorDetails {
  const outer = isRecord(source) ? source : null;
  const sourceRecord = isRecord(outer?.errorDetails)
    ? outer.errorDetails
    : isRecord(outer?.telegramError) ? outer.telegramError : source;
  const record = isRecord(sourceRecord) ? sourceRecord : null;
  const message = source instanceof Error && source.message
    ? source.message
    : typeof source === 'string' && source
      ? source
      : typeof record?.error === 'string' && record.error
        ? record.error
        : typeof record?.message === 'string' && record.message
          ? record.message
          : fallbackMessage;
  const code = typeof record?.code === 'string' && record.code
    ? record.code
    : typeof record?.errorCode === 'string' && record.errorCode ? record.errorCode : undefined;
  const category: TelegramErrorCategory = typeof record?.category === 'string' && categories.has(record.category as TelegramErrorCategory)
    ? record.category as TelegramErrorCategory
    : record?.cancelled === true ? 'cancelled' : 'unknown';
  const rawWaitSeconds = Number(record?.waitSecondsText ?? record?.waitSeconds);
  const waitSeconds = Number.isSafeInteger(rawWaitSeconds) && rawWaitSeconds > 0 ? rawWaitSeconds : undefined;

  return {
    operation,
    category,
    retryable: typeof record?.retryable === 'boolean' ? record.retryable : false,
    message,
    ...(code ? { code } : {}),
    ...(waitSeconds === undefined ? {} : { waitSeconds }),
  };
}

export function createBridgeValidationError(message: string, code?: string): BridgeValidationErrorDetails {
  return {
    operation: 'validate',
    category: 'validation',
    retryable: false,
    message,
    ...(code ? { code } : {}),
  };
}

export type { BridgeErrorDetails, BridgeValidationErrorDetails, TelegramOperationErrorDetails } from '../types';