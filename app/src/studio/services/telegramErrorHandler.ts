import type {
  TelegramErrorCategory,
  TelegramOperationErrorDetails,
  TelegramOperationName,
} from '@shared/types';

type ErrorRecord = {
  operation?: unknown;
  error?: unknown;
  message?: unknown;
  code?: unknown;
  errorCode?: unknown;
  name?: unknown;
  waitSeconds?: unknown;
  waitSecondsText?: unknown;
  cancelled?: unknown;
  telegramError?: unknown;
  category?: unknown;
  retryable?: unknown;
};

const errorCategories = new Set<TelegramErrorCategory>([
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

function isTelegramOperationError(value: unknown): value is TelegramOperationErrorDetails {
  if (!isRecord(value)) return false;
  return (value.operation === 'publish' || value.operation === 'cancel')
    && typeof value.category === 'string'
    && errorCategories.has(value.category as TelegramErrorCategory)
    && typeof value.retryable === 'boolean'
    && typeof value.message === 'string';
}

function getMessage(source: unknown, record: ErrorRecord | null, fallbackMessage: string): string {
  if (source instanceof Error && source.message) return source.message;
  if (typeof source === 'string' && source) return source;
  if (typeof record?.error === 'string' && record.error) return record.error;
  if (record?.error instanceof Error && record.error.message) return record.error.message;
  if (typeof record?.message === 'string' && record.message) return record.message;
  return fallbackMessage;
}

function getCode(record: ErrorRecord | null): string | undefined {
  if (typeof record?.code === 'string' && record.code) return record.code;
  if (typeof record?.errorCode === 'string' && record.errorCode) return record.errorCode;
  return undefined;
}

export function handleTelegramError(
  source: unknown,
  operation: TelegramOperationName,
  fallbackMessage: string,
): TelegramOperationErrorDetails {
  const record = isRecord(source) ? source : null;
  const remoteDetails = record?.telegramError;
  if (isTelegramOperationError(remoteDetails)) {
    return { ...remoteDetails, operation };
  }

  const code = getCode(record);
  const message = getMessage(source, record, fallbackMessage);
  if (typeof record?.category === 'string' && errorCategories.has(record.category as TelegramErrorCategory)) {
    const category = record.category as TelegramErrorCategory;
    const parsedWaitSeconds = Number(record.waitSecondsText ?? record.waitSeconds);
    const waitSeconds = Number.isSafeInteger(parsedWaitSeconds) && parsedWaitSeconds > 0
      ? parsedWaitSeconds
      : undefined;
    return {
      operation,
      category,
      retryable: typeof record.retryable === 'boolean' ? record.retryable : category === 'network',
      message,
      ...(code ? { code } : {}),
      ...(waitSeconds === undefined ? {} : { waitSeconds }),
    };
  }

  const errorName = typeof record?.name === 'string' ? record.name : '';
  const sourceText = [code, message, errorName].filter(Boolean).join(' ');
  const floodMatch = sourceText.match(/FLOOD_WAIT[_\s:]*(\d+)/i);
  const waitValue = record?.waitSecondsText ?? record?.waitSeconds ?? floodMatch?.[1];
  const parsedWaitSeconds = Number(waitValue);
  const waitSeconds = Number.isSafeInteger(parsedWaitSeconds) && parsedWaitSeconds > 0
    ? parsedWaitSeconds
    : undefined;
  const isFloodWait = /FLOOD_WAIT/i.test(sourceText);
  const isInvalidFloodWait = /TELEGRAM_FLOOD_WAIT_(?:INVALID|EXCEEDS_MAX)/i.test(code ?? '');

  if (isFloodWait) {
    return {
      operation,
      category: 'flood',
      retryable: !isInvalidFloodWait && waitSeconds !== undefined,
      message,
      ...(code ? { code } : {}),
      ...(waitSeconds === undefined ? {} : { waitSeconds }),
    };
  }

  if (/SLOWMODE_WAIT/i.test(sourceText) || code === 'TELEGRAM_SLOWMODE_WAIT') {
    return {
      operation,
      category: 'slowmode',
      retryable: false,
      message,
      ...(code ? { code } : {}),
      ...(waitSeconds === undefined ? {} : { waitSeconds }),
    };
  }

  if (record?.cancelled === true || code === 'TELEGRAM_REQUEST_CANCELLED' || code === 'ERR_CANCELED' || errorName === 'AbortError') {
    return {
      operation,
      category: 'cancelled',
      retryable: false,
      message,
      ...(code ? { code } : {}),
    };
  }

  const category: TelegramErrorCategory = /AUTH(?:ORIZATION|_KEY|_TOO_MUCH|_SIGN_UP|_SIGN_IN)?|SESSION_(?:REVOKED|EXPIRED|INVALID)|PHONE_CODE|PASSWORD|USER_DEACTIVATED/i.test(sourceText)
    ? 'auth'
    : /CHAT_(?:WRITE_)?FORBIDDEN|CHAT_ADMIN_REQUIRED|USER_(?:IS_)?BLOCKED|USER_BANNED|CHANNEL_(?:PRIVATE|FORBIDDEN)|PERMISSION|NOT_MODERATOR|RIGHTS_FORBIDDEN/i.test(sourceText)
      ? 'permission'
      : /ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENETUNREACH|EAI_AGAIN|ECONNABORTED|NETWORK|TIMEOUT|CONNECTION|(?:^|\D)(?:502|503|504)(?:\D|$)/i.test(sourceText)
        ? 'network'
        : 'unknown';

  return {
    operation,
    category,
    retryable: category === 'network',
    message,
    ...(code ? { code } : {}),
  };
}