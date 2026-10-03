const SCHEDULE_STATUSES = new Set(['pending', 'scheduled', 'confirmed', 'sending', 'sent', 'failed']);

function normalizeScheduleMessages(messages, { recoverInterrupted = false } = {}) {
  if (!Array.isArray(messages) || messages.length > 2000) {
    throw new Error('Schedule history has an invalid message list.');
  }
  const serialized = JSON.stringify(messages);
  if (Buffer.byteLength(serialized, 'utf8') > 8 * 1024 * 1024) {
    throw new Error('Schedule history exceeds the supported size.');
  }

  return messages.map((message) => {
    if (!message || typeof message !== 'object' || Array.isArray(message)
      || typeof message.id !== 'string'
      || typeof message.chatId !== 'string'
      || typeof message.text !== 'string'
      || typeof message.when !== 'string'
      || !Number.isFinite(Date.parse(message.when))
      || typeof message.createdAt !== 'string') {
      throw new Error('Schedule history contains an invalid message.');
    }

    const unknownStatus = !SCHEDULE_STATUSES.has(message.status);
    const legacyPending = message.status === 'pending';
    const status = unknownStatus || (recoverInterrupted && legacyPending)
      ? 'failed'
      : message.status === 'confirmed'
        ? 'scheduled'
        : message.status;
    const interrupted = recoverInterrupted && (legacyPending || status === 'sending');

    return {
      ...message,
      status: interrupted ? 'failed' : status,
      ...((unknownStatus || interrupted) ? {
        lastError: message.lastError || (legacyPending
          ? 'This schedule was interrupted before Telegram confirmed it.'
          : status === 'sending'
            ? 'The app closed while this message was sending. Check Telegram before retrying.'
            : 'This message had an unknown saved status and needs review.'),
        retryAction: message.retryAction || (legacyPending ? 'schedule' : 'send'),
      } : {}),
    };
  });
}

function findRecentSentMessage(messages, text, targetTimestamp, toleranceSeconds = 180) {
  if (!Array.isArray(messages) || typeof text !== 'string' || !Number.isFinite(targetTimestamp)) return null;
  return messages.find((message) => {
    if (!message || message.out !== true || (message.message ?? message.text) !== text) return false;
    const messageTimestamp = message.date instanceof Date
      ? Math.floor(message.date.getTime() / 1000)
      : Number(message.date);
    return Number.isFinite(messageTimestamp) && Math.abs(messageTimestamp - targetTimestamp) <= toleranceSeconds;
  }) ?? null;
}

module.exports = { findRecentSentMessage, normalizeScheduleMessages };