function normalizePeerIdentifier(value) {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') {
    return String(value);
  }

  if (typeof value === 'object') {
    if (typeof value.userId !== 'undefined') return normalizePeerIdentifier(value.userId);
    if (typeof value.id !== 'undefined') return normalizePeerIdentifier(value.id);
    if (typeof value.peerId !== 'undefined') return normalizePeerIdentifier(value.peerId);
    if (typeof value._id !== 'undefined') return normalizePeerIdentifier(value._id);
    if (typeof value.toJSON === 'function') {
      try {
        return normalizePeerIdentifier(value.toJSON());
      } catch {
        return '';
      }
    }
  }

  return '';
}

function resolveMessageDirection(message, currentUserId = '') {
  if (!message || typeof message !== 'object') {
    return false;
  }

  if (message.out === true || message.outgoing === true || message.self === true) {
    return true;
  }

  const currentUser = normalizePeerIdentifier(currentUserId);
  const senderIds = [
    normalizePeerIdentifier(message.senderId),
    normalizePeerIdentifier(message.fromId),
    normalizePeerIdentifier(message.sender && message.sender.id),
    normalizePeerIdentifier(message.sender && message.sender.userId),
    normalizePeerIdentifier(message.sender && message.sender._id),
    normalizePeerIdentifier(message.fromUser && message.fromUser.id),
    normalizePeerIdentifier(message.fromUser && message.fromUser.userId),
    normalizePeerIdentifier(message.fromUser && message.fromUser._id),
  ];

  if (Boolean(currentUser) && senderIds.some((value) => value && value === currentUser)) {
    return true;
  }

  if (typeof message.out === 'boolean') {
    return message.out;
  }

  if (typeof message.outgoing === 'boolean') {
    return message.outgoing;
  }

  return false;
}

function normalizeHistoryMessage(message, currentUserId = '') {
  const rawDate = message && message.date instanceof Date
    ? message.date
    : new Date(Number(message && (message.date ?? 0)) * 1000 || 0);

  const text = String(message?.message ?? message?.text ?? '');
  const date = Number.isNaN(rawDate.getTime()) ? new Date(0).toISOString() : rawDate.toISOString();

  return {
    ...message,
    id: String(message?.id ?? message?.messageId ?? 'unknown'),
    text,
    date,
    outgoing: resolveMessageDirection(message, currentUserId),
    senderName: typeof message?.senderName === 'string' ? message.senderName : '',
  };
}

module.exports = {
  normalizePeerIdentifier,
  resolveMessageDirection,
  normalizeHistoryMessage,
};
