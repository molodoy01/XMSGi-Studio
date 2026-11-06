const { applyTelegramIdempotency } = require('./telegram-idempotency.cjs');

function logTelegramOperation(label, message, attachments = []) {
  console.info(`[Telegram ${label}] started`, {
    messageLength: typeof message === 'string' ? message.length : 0,
    attachmentCount: attachments.length,
  });
}

async function withTelegramInvokeDiagnostics(clientAtStart, label, operation, idempotencyKey, onResponse) {
  const originalInvoke = clientAtStart.invoke;
  const hadOwnInvoke = Object.prototype.hasOwnProperty.call(clientAtStart, 'invoke');

  clientAtStart.invoke = async function invokeWithDiagnostics(request, ...args) {
    applyTelegramIdempotency(request, idempotencyKey);
    console.info(`[Telegram ${label}] request`, {
      requestType: request?.className || request?.constructor?.name || 'unknown',
      mediaType: request?.media?.className || request?.media?.constructor?.name || null,
      scheduleDate: request?.scheduleDate ?? null,
      mediaCount: Array.isArray(request?.multiMedia) ? request.multiMedia.length : null,
    });
    const response = await originalInvoke.call(this, request, ...args);
    const updates = Array.isArray(response?.updates)
      ? response.updates
      : response?.update
        ? [response.update]
        : [response];
    console.info(`[Telegram ${label}] response`, {
      requestType: request?.className || request?.constructor?.name || 'unknown',
      scheduledUpdateCount: updates.filter((update) => update?.className === 'UpdateNewScheduledMessage').length,
      immediateMessageUpdateCount: updates.filter((update) => (
        update?.className === 'UpdateNewMessage'
        || update?.className === 'UpdateNewChannelMessage'
      )).length,
    });
    onResponse?.(response, request);
    return response;
  };
  try {
    return await operation();
  } finally {
    if (hadOwnInvoke) {
      clientAtStart.invoke = originalInvoke;
    } else {
      delete clientAtStart.invoke;
    }
  }
}

module.exports = { logTelegramOperation, withTelegramInvokeDiagnostics };