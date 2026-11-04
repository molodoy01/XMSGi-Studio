function createTelegramSender({
  connectTelegram,
  getClient,
  getTelegramRequestTimeout,
  logTelegramOperation,
  normalizeTelegramMessage,
  prepareInlineKeyboard,
  telegramRequest,
  toTelegramFormattingEntities,
  observeTelegramResponse,
  trackSendAttempt,
  withTelegramInvokeDiagnostics,
  withTimeout,
}) {
  return async function sendMessageInternal(
    chatId,
    message,
    attachments = [],
    entities = [],
    replyMarkup,
    silent = false,
    effect,
    idempotencyKey
  ) {
    const normalized = normalizeTelegramMessage(message, entities);
    message = normalized.message;
    entities = normalized.entities;
    trackSendAttempt?.(idempotencyKey, attachments.length);

    const currentClient = getClient();
    if (!currentClient || !currentClient.connected) {
      await connectTelegram();
    }

    const target = chatId === 'me' ? 'me' : chatId;
    const clientAtStart = getClient();

    try {
      const sendOptions = { message };

      if (silent) {
        sendOptions.silent = true;
      }

      if (effect !== undefined) {
        sendOptions.effect = BigInt(effect);
      }

      if (entities.length > 0) {
        sendOptions.formattingEntities = toTelegramFormattingEntities(entities);
      }

      if (attachments.length > 0) {
        sendOptions.file = attachments.length === 1 ? attachments[0] : attachments;
      }

      const preparedMarkup = prepareInlineKeyboard(replyMarkup);

      if (preparedMarkup) sendOptions.buttons = preparedMarkup;

      const sendOperation = () => clientAtStart.sendMessage(target, sendOptions);

      logTelegramOperation('send', message, attachments, replyMarkup);

      const result = await withTelegramInvokeDiagnostics(clientAtStart, 'send', () => telegramRequest(() => withTimeout(
        sendOperation(),
        getTelegramRequestTimeout(attachments),
        attachments.length > 0 ? 'Sending Telegram media' : 'Sending Telegram message'
      )), idempotencyKey, (response, request) => {
        observeTelegramResponse?.(response, request, idempotencyKey);
      });

      if (getClient() !== clientAtStart) {
        throw new Error('Telegram send was cancelled.');
      }

      const messages = Array.isArray(result) ? result : [result];
      const validMessages = messages.filter((item) => item && typeof item === 'object');
      const ids = validMessages
        .map((item) => item.id)
        .filter((id) => (typeof id === 'number' && Number.isSafeInteger(id) && id > 0)
          || (typeof id === 'string' && /^\d{1,20}$/.test(id) && Number(id) > 0));
      const expectedMessageCount = Math.max(1, attachments.length);
      if (ids.length !== expectedMessageCount || new Set(ids.map(String)).size !== ids.length) {
        throw new Error('Telegram confirmed the send without returning every sent message ID.');
      }
      const sentDate = validMessages.map((item) => {
        if (item.date instanceof Date && Number.isFinite(item.date.getTime())) return item.date;
        if (typeof item.date === 'number' && Number.isFinite(item.date) && item.date > 0) {
          return new Date(item.date * 1000);
        }
        return null;
      }).find((date) => date && Number.isFinite(date.getTime()));

      return {
        success: true,
        ...(ids.length ? {
          telegramMessageId: ids[0],
          telegramMessageIds: ids,
        } : {}),
        ...(sentDate ? { sentAt: sentDate.toISOString() } : {}),
      };
    } catch (error) {
      console.error('Telegram send failed:', {
        errorCode: error?.code || 'UNKNOWN',
        errorType: error?.name || 'Error',
        waitSeconds: Number.isFinite(error?.waitSeconds) ? error.waitSeconds : undefined,
      });

      throw error;
    }
  };
}

module.exports = { createTelegramSender };