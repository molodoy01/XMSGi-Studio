const MAX_TRACKED_SEND_ATTEMPTS = 2000;

function createTelegramSendRecovery({ createRandomId, onConfirmed } = {}) {
  const attempts = new Map();
  const randomIds = new Map();

  function trackSendAttempt(idempotencyKey, attachmentCount = 0) {
    if (typeof idempotencyKey !== 'string' || !idempotencyKey) return;

    const partCount = Math.max(1, attachmentCount);
    const existingAttempt = attempts.get(idempotencyKey);
    if (existingAttempt && existingAttempt.partCount !== partCount) {
      const error = new Error('A send attempt cannot be tracked with a different attachment count.');
      error.code = 'RANDOM_ID_ATTEMPT_MISMATCH';
      throw error;
    }

    const registration = new Map();
    const randomIdByPart = new Map();
    for (let part = 0; part < partCount; part += 1) {
      const randomId = String(createRandomId(idempotencyKey, part));
      const existingMapping = randomIds.get(randomId);
      const pendingMapping = registration.get(randomId);
      const mapping = { idempotencyKey, part };
      const previousRandomId = existingAttempt?.randomIds.get(part);
      const conflictsWithExisting = existingMapping
        && (existingMapping.idempotencyKey !== idempotencyKey || existingMapping.part !== part);
      const conflictsWithinAttempt = pendingMapping
        && (pendingMapping.idempotencyKey !== idempotencyKey || pendingMapping.part !== part);

      if (previousRandomId !== undefined && previousRandomId !== randomId) {
        const error = new Error('A send attempt cannot change its Telegram random_id.');
        error.code = 'RANDOM_ID_ATTEMPT_MISMATCH';
        throw error;
      }
      if (conflictsWithExisting || conflictsWithinAttempt) {
        const error = new Error('Telegram random_id conflicts with another tracked send attempt.');
        error.code = 'RANDOM_ID_COLLISION';
        throw error;
      }
      registration.set(randomId, mapping);
      randomIdByPart.set(part, randomId);
    }

    const attempt = existingAttempt ?? { partCount, messages: new Map(), randomIds: new Map() };
    attempt.randomIds = randomIdByPart;
    attempts.set(idempotencyKey, attempt);
    for (const [randomId, mapping] of registration) randomIds.set(randomId, mapping);

    while (attempts.size > MAX_TRACKED_SEND_ATTEMPTS) {
      const oldestKey = attempts.keys().next().value;
      attempts.delete(oldestKey);
      for (const [randomId, mapping] of randomIds) {
        if (mapping.idempotencyKey === oldestKey) randomIds.delete(randomId);
      }
    }
  }

  function rememberMessageId(idempotencyKey, part, id, sentAt) {
    if (id === undefined || id === null) return;
    const attempt = attempts.get(idempotencyKey);
    if (!attempt) return;

    const previous = attempt.messages.get(part);
    attempt.messages.set(part, {
      id,
      ...(typeof sentAt === 'string' && Number.isFinite(Date.parse(sentAt))
        ? { sentAt }
        : previous?.sentAt ? { sentAt: previous.sentAt } : {}),
    });

    if (attempt.messages.size < attempt.partCount) return;

    const messages = [...attempt.messages.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, message]) => message);
    if (new Set(messages.map(({ id }) => String(id))).size !== messages.length) return;
    onConfirmed?.(idempotencyKey, {
      telegramMessageId: messages[0].id,
      telegramMessageIds: messages.map(({ id: messageId }) => messageId),
      ...(messages[0].sentAt ? { sentAt: messages[0].sentAt } : {}),
    });
  }

  function observeUpdate(update, sentAt) {
    if (!update || typeof update !== 'object') return;

    if (update.className === 'UpdateMessageID' && update.randomId !== undefined) {
      const mapping = randomIds.get(String(update.randomId));
      if (mapping) {
        rememberMessageId(mapping.idempotencyKey, mapping.part, update.id, sentAt);
      }
    }
  }

  function observeResponse(response, request, idempotencyKey) {
    const updates = Array.isArray(response?.updates)
      ? response.updates
      : response?.update
        ? [response.update]
        : [response];

    const messageDates = new Map();
    for (const update of updates) {
      if (update?.className !== 'UpdateNewMessage' && update?.className !== 'UpdateNewChannelMessage') continue;
      const message = update.message;
      if (message?.id === undefined) continue;
      const sentAt = message.date instanceof Date && Number.isFinite(message.date.getTime())
        ? message.date.toISOString()
        : Number.isFinite(message.date) && message.date > 0
          ? new Date(message.date * 1000).toISOString()
          : undefined;
      if (!sentAt) continue;

      const messageId = String(message.id);
      messageDates.set(messageId, messageDates.has(messageId) ? null : sentAt);
    }

    for (const update of updates) {
      const sentAt = update?.className === 'UpdateMessageID'
        ? messageDates.get(String(update.id)) ?? undefined
        : undefined;
      observeUpdate(update, sentAt);
    }

    if (response?.className === 'UpdateShortSentMessage' && request?.randomId !== undefined) {
      const mapping = randomIds.get(String(request.randomId));
      if (mapping) {
        const sentAt = Number.isFinite(response.date)
          ? new Date(response.date * 1000).toISOString()
          : undefined;
        rememberMessageId(mapping.idempotencyKey, mapping.part, response.id, sentAt);
      }
    }

    if (idempotencyKey && request?.randomId !== undefined && response?.id !== undefined) {
      const mapping = randomIds.get(String(request.randomId));
      if (mapping) rememberMessageId(mapping.idempotencyKey, mapping.part, response.id);
    }
  }

  function getResult(idempotencyKey, attachmentCount = 0) {
    trackSendAttempt(idempotencyKey, attachmentCount);
    const attempt = attempts.get(idempotencyKey);
    if (!attempt || attempt.messages.size < attempt.partCount) return null;

    const messages = [...attempt.messages.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, message]) => message);
    if (new Set(messages.map(({ id }) => String(id))).size !== messages.length) return null;
    return {
      telegramMessageId: messages[0].id,
      telegramMessageIds: messages.map(({ id }) => id),
      ...(messages[0].sentAt ? { sentAt: messages[0].sentAt } : {}),
    };
  }

  return { trackSendAttempt, observeUpdate, observeResponse, getResult };
}

module.exports = { createTelegramSendRecovery };
