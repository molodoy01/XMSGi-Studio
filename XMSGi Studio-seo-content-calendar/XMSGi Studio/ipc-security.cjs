const MAX_MESSAGE_LENGTH = 4096;
const MAX_CHAT_ID_LENGTH = 128;
const MAX_QUERY_LENGTH = 256;
const MAX_PHONE_LENGTH = 32;
const MAX_API_HASH_LENGTH = 256;
const MAX_PASSWORD_LENGTH = 512;
const MAX_CODE_LENGTH = 32;
const MAX_ATTACHMENT_PATH_LENGTH = 4096;
const MAX_ATTACHMENTS = 30;
const MAX_ATTACHMENTS_PER_GROUP = 10;
const MAX_FORMATTING_ENTITIES = 100;
const MIN_TIMESTAMP = 946684800;
const MAX_TIMESTAMP = 4102444800;

function invalidInput(message) {
  throw new Error(`Invalid IPC input: ${message}`);
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateString(value, name, { min = 1, max, allowEmpty = false } = {}) {
  if (typeof value !== 'string') {
    invalidInput(`${name} must be a string`);
  }

  if (!allowEmpty && value.trim().length < min) {
    invalidInput(`${name} is required`);
  }

  if (value.length > max) {
    invalidInput(`${name} is too long`);
  }

  if (/\0/.test(value)) {
    invalidInput(`${name} contains an invalid character`);
  }

  return value;
}

function validateChatId(value) {
  const chatId = validateString(value, 'chatId', { max: MAX_CHAT_ID_LENGTH });

  if (chatId !== 'me' && !/^-?\d{1,20}$/.test(chatId)) {
    invalidInput('chatId has an invalid format');
  }

  return chatId;
}

function validateMessage(value) {
  return validateString(value, 'message', { max: MAX_MESSAGE_LENGTH });
}

function validateFormattingEntities(value, messageLength) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_FORMATTING_ENTITIES) {
    invalidInput('entities must be an array');
  }

  return value.map((entity, index) => {
    if (!isPlainObject(entity)) invalidInput(`entities[${index}] must be an object`);
    if (!['bold', 'italic', 'underline', 'strikethrough', 'text_url'].includes(entity.type)) {
      invalidInput(`entities[${index}].type is invalid`);
    }
    if (!Number.isInteger(entity.offset) || !Number.isInteger(entity.length) || entity.offset < 0 || entity.length < 1 || entity.offset + entity.length > messageLength) {
      invalidInput(`entities[${index}] has an invalid range`);
    }
    if (entity.type === 'text_url') {
      if (typeof entity.url !== 'string' || entity.url.length > 2048 || !/^(?:https?:\/\/|tg:)/i.test(entity.url)) {
        invalidInput(`entities[${index}].url is invalid`);
      }
      return { type: entity.type, offset: entity.offset, length: entity.length, url: entity.url };
    }
    return { type: entity.type, offset: entity.offset, length: entity.length };
  });
}

function validateTimestamp(value) {
  if (!Number.isInteger(value) || value < MIN_TIMESTAMP || value > MAX_TIMESTAMP) {
    invalidInput('targetTimestamp has an invalid range');
  }

  return value;
}

function validateEffect(value) {
  if (value === undefined) return undefined;

  if (typeof value !== 'string' || !/^\d{1,20}$/.test(value)) {
    invalidInput('effect has an invalid format');
  }

  return value;
}


function validateQuery(value) {
  return validateString(value, 'query', { max: MAX_QUERY_LENGTH });
}

function validateSchedulePayload(value) {
  if (!isPlainObject(value)) {
    invalidInput('schedule payload must be an object');
  }

  const attachments = validateAttachments(value.attachments);
  const attachmentGroups = validateAttachmentGroups(value.attachmentGroups, attachments);
  const message = attachments.length > 0
    ? validateString(value.message, 'message', { max: MAX_MESSAGE_LENGTH, allowEmpty: true })
    : validateMessage(value.message);

  return {
    chatId: validateChatId(value.chatId),
    message,
    entities: validateFormattingEntities(value.entities, message.length),
    targetTimestamp: validateTimestamp(value.targetTimestamp),
    attachments,
    ...(attachmentGroups ? { attachmentGroups } : {}),
    silent: value.silent === true,
    effect: validateEffect(value.effect)
  };
}

function validateScheduleReconciliationPayload(value) {
  const validated = validateSchedulePayload(value);
  let telegramMessageIds = [];

  if (Object.prototype.hasOwnProperty.call(value, 'telegramMessageIds')) {
    if (!Array.isArray(value.telegramMessageIds) || value.telegramMessageIds.length > 30) {
      invalidInput('telegramMessageIds must be an array of at most 30 Telegram IDs');
    }
    telegramMessageIds = value.telegramMessageIds.map((id) => {
      const validNumber = typeof id === 'number' && Number.isSafeInteger(id) && id > 0;
      const validString = typeof id === 'string' && /^\d{1,20}$/.test(id) && Number(id) > 0;
      if (!validNumber && !validString) {
        invalidInput('telegramMessageIds contains an invalid Telegram ID');
      }
      return id;
    });
  }

  return { ...validated, telegramMessageIds };
}

function validateHistoryPayload(value) {
  if (!isPlainObject(value)) {
    invalidInput('history payload must be an object');
  }

  const limit = value.limit === undefined ? 50 : value.limit;

  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    invalidInput('history limit has an invalid range');
  }

  const offsetId = value.offsetId;
  if (offsetId !== undefined && (!Number.isSafeInteger(offsetId) || offsetId < 1 || offsetId > 2147483647)) {
    invalidInput('history offset has an invalid range');
  }

  return {
    chatId: validateChatId(value.chatId),
    limit,
    ...(offsetId === undefined ? {} : { offsetId })
  };
}

function validateDeleteSavedMessagePayload(value) {
  if (!isPlainObject(value)) {
    invalidInput('delete saved message payload must be an object');
  }

  const messageId = value.messageId;
  const validMessageId = (typeof messageId === 'number' && Number.isSafeInteger(messageId))
    || (typeof messageId === 'string' && /^\d{1,10}$/.test(messageId));
  if (!validMessageId || Number(messageId) < 1 || Number(messageId) > 2147483647) {
    invalidInput('messageId has an invalid format');
  }

  return {
    chatId: validateChatId(value.chatId),
    messageId: Number(messageId)
  };
}

function validateAttachments(value) {
  if (value === undefined) return [];

  if (!Array.isArray(value)) {
    invalidInput('attachments must be an array');
  }
  if (value.length > MAX_ATTACHMENTS) {
    invalidInput(`attachments cannot exceed ${MAX_ATTACHMENTS}`);
  }

  return value.map((attachment, index) =>
    validateString(attachment, `attachments[${index}]`, {
      max: MAX_ATTACHMENT_PATH_LENGTH
    })
  );
}

function validateAttachmentGroups(value, attachments) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > MAX_ATTACHMENTS) {
    invalidInput('attachmentGroups must be an array');
  }

  const groups = value.map((group, groupIndex) => {
    if (!Array.isArray(group) || group.length === 0 || group.length > MAX_ATTACHMENTS_PER_GROUP) {
      invalidInput(`attachmentGroups[${groupIndex}] must contain 1 to ${MAX_ATTACHMENTS_PER_GROUP} paths`);
    }
    return group.map((attachment, attachmentIndex) => validateString(
      attachment,
      `attachmentGroups[${groupIndex}][${attachmentIndex}]`,
      { max: MAX_ATTACHMENT_PATH_LENGTH },
    ));
  });
  const flattened = groups.flat();
  if (flattened.length !== attachments.length || flattened.some((attachment, index) => attachment !== attachments[index])) {
    invalidInput('attachmentGroups must match attachments');
  }
  return groups;
}

function validateCancelPayload(value) {
  if (!isPlainObject(value)) {
    invalidInput('cancel payload must be an object');
  }

  const chatId = validateChatId(value.chatId);
  const telegramMessageId = value.telegramMessageId;
  const isValidTelegramMessageId = (id) => (
    (typeof id === 'number' && Number.isSafeInteger(id))
    || (typeof id === 'string' && /^\d{1,20}$/.test(id))
  );
  const hasTelegramMessageId = isValidTelegramMessageId(telegramMessageId);
  let telegramMessageIds;

  if (value.telegramMessageIds !== undefined) {
    if (!Array.isArray(value.telegramMessageIds)
      || value.telegramMessageIds.length < 1
      || value.telegramMessageIds.length > MAX_ATTACHMENTS
      || !value.telegramMessageIds.every(isValidTelegramMessageId)) {
      invalidInput('telegramMessageIds has an invalid format');
    }
    telegramMessageIds = value.telegramMessageIds;
    if (hasTelegramMessageId && String(telegramMessageId) !== String(telegramMessageIds[0])) {
      invalidInput('telegramMessageId does not match the first Telegram message ID');
    }
  }

  if (!hasTelegramMessageId && !telegramMessageIds) {
    invalidInput('telegramMessageId has an invalid format');
  }

  const message = value.message === undefined || value.message === ''
    ? undefined
    : validateMessage(value.message);
  const targetTimestamp = value.targetTimestamp === undefined
    ? undefined
    : validateTimestamp(value.targetTimestamp);

  return {
    chatId,
    ...(hasTelegramMessageId ? { telegramMessageId } : {}),
    ...(telegramMessageIds ? { telegramMessageIds } : {}),
    message,
    targetTimestamp,
  };
}

function validateSendPayload(value) {
  if (!isPlainObject(value)) {
    invalidInput('send payload must be an object');
  }

  const attachments = validateAttachments(value.attachments);
  const attachmentGroups = validateAttachmentGroups(value.attachmentGroups, attachments);
  const message = attachments.length > 0
    ? validateString(value.message, 'message', { max: MAX_MESSAGE_LENGTH, allowEmpty: true })
    : validateMessage(value.message);
  const idempotencyKey = value.idempotencyKey === undefined
    ? undefined
    : validateString(value.idempotencyKey, 'idempotencyKey', { max: 128 });

  return {
    chatId: validateChatId(value.chatId),
    message,
    entities: validateFormattingEntities(value.entities, message.length),
    attachments,
    ...(attachmentGroups ? { attachmentGroups } : {}),
    silent: value.silent === true,
    effect: validateEffect(value.effect),
    idempotencyKey
  };
}

function validateSendAttemptReconciliationPayload(value) {
  if (!isPlainObject(value)) {
    invalidInput('send recovery payload must be an object');
  }

  const attachmentCount = value.attachmentCount ?? 0;
  if (!Number.isSafeInteger(attachmentCount) || attachmentCount < 0 || attachmentCount > MAX_ATTACHMENTS) {
    invalidInput('attachmentCount has an invalid format');
  }

  return {
    idempotencyKey: validateString(value.idempotencyKey, 'idempotencyKey', { max: 128 }),
    attachmentCount,
  };
}

function validateLoginPayload(value) {
  if (!isPlainObject(value)) {
    invalidInput('login payload must be an object');
  }

  const result = {};

  if (value.API_ID !== undefined || value.apiId !== undefined) {
    const apiId = value.API_ID ?? value.apiId;
    if (!/^[1-9]\d{0,9}$/.test(String(apiId))) {
      invalidInput('API_ID has an invalid format');
    }
    result.API_ID = String(apiId);
  }

  if (value.API_HASH !== undefined || value.apiHash !== undefined) {
    result.API_HASH = validateString(value.API_HASH ?? value.apiHash, 'API_HASH', {
      max: MAX_API_HASH_LENGTH
    });
  }

  result.phoneNumber = validateString(value.phoneNumber ?? value.phone, 'phoneNumber', {
    max: MAX_PHONE_LENGTH
  });

  if (value.phoneCode !== undefined) {
    result.phoneCode = validateString(value.phoneCode, 'phoneCode', {
      max: MAX_CODE_LENGTH
    });
  }

  if (value.password !== undefined) {
    result.password = validateString(value.password, 'password', {
      max: MAX_PASSWORD_LENGTH
    });
  }

  return result;
}

function validateTelegramCredentialsPayload(value) {
  if (!isPlainObject(value)) {
    invalidInput('Telegram credentials payload must be an object');
  }

  const apiId = value.API_ID ?? value.apiId;
  if (!/^[1-9]\d{0,9}$/.test(String(apiId ?? ''))) {
    invalidInput('API_ID has an invalid format');
  }

  return {
    API_ID: String(apiId),
    API_HASH: validateString(value.API_HASH ?? value.apiHash, 'API_HASH', {
      max: MAX_API_HASH_LENGTH
    })
  };
}

function isTrustedRendererUrl(url, allowedUrl) {
  return typeof url === 'string'
    && (url === allowedUrl || url.startsWith(`${allowedUrl}#`));
}

function assertTrustedRenderer(event, expectedWebContents, allowedUrl) {
  const sender = event?.sender;

  if (!expectedWebContents || sender !== expectedWebContents
    || !isTrustedRendererUrl(event?.senderFrame?.url || '', allowedUrl)) {
    throw new Error('Untrusted renderer.');
  }
}

module.exports = {
  MAX_MESSAGE_LENGTH,
  validateChatId,
  validateMessage,
  validateTimestamp,
  validateQuery,
  validateSchedulePayload,
  validateScheduleReconciliationPayload,
  validateHistoryPayload,
  validateDeleteSavedMessagePayload,
  validateCancelPayload,
  validateSendPayload,
  validateSendAttemptReconciliationPayload,
  validateLoginPayload,
  validateTelegramCredentialsPayload,
  isTrustedRendererUrl,
  assertTrustedRenderer
};
