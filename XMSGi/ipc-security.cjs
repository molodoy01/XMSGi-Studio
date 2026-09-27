const MAX_MESSAGE_LENGTH = 4096;
const MAX_CHAT_ID_LENGTH = 128;
const MAX_QUERY_LENGTH = 256;
const MAX_PHONE_LENGTH = 32;
const MAX_API_HASH_LENGTH = 256;
const MAX_PASSWORD_LENGTH = 512;
const MAX_CODE_LENGTH = 32;
const MAX_ATTACHMENT_PATH_LENGTH = 4096;
const MAX_ATTACHMENTS = 10;
const MAX_FORMATTING_ENTITIES = 100;
const MAX_INLINE_BUTTON_ROWS = 20;
const MAX_INLINE_BUTTONS_PER_ROW = 8;
const MAX_INLINE_BUTTON_LABEL_LENGTH = 128;
const MAX_CALLBACK_DATA_BYTES = 64;
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

function validateReplyMarkup(value) {
  if (value === undefined) return undefined;
  if (!isPlainObject(value) || !Array.isArray(value.inline_keyboard) || value.inline_keyboard.length > MAX_INLINE_BUTTON_ROWS) {
    invalidInput('replyMarkup has an invalid structure');
  }

  return {
    inline_keyboard: value.inline_keyboard.map((row, rowIndex) => {
      if (!Array.isArray(row) || row.length > MAX_INLINE_BUTTONS_PER_ROW) {
        invalidInput(`replyMarkup row ${rowIndex + 1} is invalid`);
      }
      return row.map((button, buttonIndex) => {
        if (!isPlainObject(button)) invalidInput(`replyMarkup button ${buttonIndex + 1} is invalid`);
        const text = validateString(button.text, `replyMarkup button ${buttonIndex + 1} text`, { max: MAX_INLINE_BUTTON_LABEL_LENGTH });
        if (button.url !== undefined) {
          if (!/^https:\/\/\S+$/i.test(button.url)) invalidInput('replyMarkup URL is invalid');
          return { text, url: button.url };
        }
        if (typeof button.callback_data !== 'string' || Buffer.byteLength(button.callback_data, 'utf8') > MAX_CALLBACK_DATA_BYTES || !button.callback_data.trim()) {
          invalidInput('replyMarkup callback is invalid');
        }
        return { text, callback_data: button.callback_data };
      });
    })
  };
}

function validateQuery(value) {
  return validateString(value, 'query', { max: MAX_QUERY_LENGTH });
}

function validateSchedulePayload(value) {
  if (!isPlainObject(value)) {
    invalidInput('schedule payload must be an object');
  }

  return {
    chatId: validateChatId(value.chatId),
    message: validateMessage(value.message),
    entities: validateFormattingEntities(value.entities, value.message.length),
    targetTimestamp: validateTimestamp(value.targetTimestamp),
    attachments: validateAttachments(value.attachments),
    replyMarkup: validateReplyMarkup(value.replyMarkup),
    silent: value.silent === true,
    effect: validateEffect(value.effect)
  };
}

function validateHistoryPayload(value) {
  if (!isPlainObject(value)) {
    invalidInput('history payload must be an object');
  }

  const limit = value.limit === undefined ? 50 : value.limit;

  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    invalidInput('history limit has an invalid range');
  }

  return {
    chatId: validateChatId(value.chatId),
    limit
  };
}

function validateAttachments(value) {
  if (value === undefined) return [];

  if (!Array.isArray(value) || value.length > MAX_ATTACHMENTS) {
    invalidInput('attachments must be an array');
  }

  return value.map((attachment, index) =>
    validateString(attachment, `attachments[${index}]`, {
      max: MAX_ATTACHMENT_PATH_LENGTH
    })
  );
}

function validateCancelPayload(value) {
  if (!isPlainObject(value)) {
    invalidInput('cancel payload must be an object');
  }

  const chatId = validateChatId(value.chatId);
  const telegramMessageId = value.telegramMessageId;

  if (
    !(
      (typeof telegramMessageId === 'number' && Number.isSafeInteger(telegramMessageId)) ||
      (typeof telegramMessageId === 'string' && /^\d{1,20}$/.test(telegramMessageId))
    )
  ) {
    invalidInput('telegramMessageId has an invalid format');
  }

  return { chatId, telegramMessageId };
}

function validateSendPayload(value) {
  if (!isPlainObject(value)) {
    invalidInput('send payload must be an object');
  }

  return {
    chatId: validateChatId(value.chatId),
    message: validateMessage(value.message),
    entities: validateFormattingEntities(value.entities, value.message.length),
    attachments: validateAttachments(value.attachments),
    replyMarkup: validateReplyMarkup(value.replyMarkup),
    silent: value.silent === true,
    effect: validateEffect(value.effect)
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

function validateGeminiGeneratePayload(value) {
  if (!isPlainObject(value)) {
    invalidInput('Gemini payload must be an object');
  }

  const prompt = validateString(value.prompt, 'prompt', { max: 12000 });
  const context = value.context;

  if (!isPlainObject(context)) {
    invalidInput('Gemini context must be an object');
  }

  const currentDate = validateString(context.currentDate, 'currentDate', { max: 32 });
  const currentTime = validateString(context.currentTime, 'currentTime', { max: 32 });

  if (!Array.isArray(context.chats) || context.chats.length > 1000) {
    invalidInput('chats must be an array');
  }

  const chats = context.chats.map((chat) => {
    if (!isPlainObject(chat)) {
      invalidInput('chat context must be an object');
    }

    return {
      id: validateChatId(chat.id),
      name: validateString(chat.name, 'chat name', { max: 256 })
    };
  });

  return {
    prompt,
    context: { currentDate, currentTime, chats }
  };
}

function validateGeminiKey(value) {
  return validateString(value, 'Gemini API key', { max: 512 });
}

function validateEnabled(value) {
  if (typeof value !== 'boolean') {
    invalidInput('enabled must be a boolean');
  }

  return value;
}

function assertTrustedRenderer(event, expectedWebContents, allowedFileUrl) {
  const senderUrl = event?.senderFrame?.url || '';
  const sender = event?.sender;
  const trustedUrl =
    senderUrl === allowedFileUrl ||
    senderUrl.startsWith(`${allowedFileUrl}#`) ||
    senderUrl.startsWith('http://localhost:5173/') ||
    senderUrl.startsWith('http://127.0.0.1:5173/');

  if (!expectedWebContents || sender !== expectedWebContents || !trustedUrl) {
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
  validateHistoryPayload,
  validateCancelPayload,
  validateSendPayload,
  validateLoginPayload,
  validateTelegramCredentialsPayload,
  validateGeminiGeneratePayload,
  validateGeminiKey,
  validateEnabled,
  assertTrustedRenderer
};
