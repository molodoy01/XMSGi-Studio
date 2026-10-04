const crypto = require('node:crypto');

function createTelegramRandomId(idempotencyKey, part = 0) {
  if (String(idempotencyKey).startsWith('stable:')) {
    const stableId = crypto.createHash('sha256')
      .update(`${idempotencyKey}:${part}`)
      .digest()
      .readBigUInt64BE(0) & 0x7fffffffffffffffn;
    return stableId || 1n;
  }

  const timestampMilliseconds = Number(String(idempotencyKey).split(':', 1)[0]);
  const timestampSeconds = Number.isFinite(timestampMilliseconds)
    ? Math.max(1, Math.floor(timestampMilliseconds / 1000))
    : Math.floor(Date.now() / 1000);
  const randomPart = crypto.createHash('sha256')
    .update(`${idempotencyKey}:${part}`)
    .digest()
    .readUInt32BE(0);
  return (BigInt(timestampSeconds) << 32n) | BigInt(randomPart);
}

function applyTelegramIdempotency(request, idempotencyKey) {
  if (!request || typeof request !== 'object' || !idempotencyKey) return request;

  const setRandomId = (target, part) => {
    if (!target || typeof target.randomId !== 'object' || typeof target.randomId.constructor !== 'function') return;
    target.randomId = target.randomId.constructor(createTelegramRandomId(idempotencyKey, part).toString());
  };

  if (Array.isArray(request.multiMedia)) {
    request.multiMedia.forEach((media, index) => setRandomId(media, index));
  } else {
    setRandomId(request, 0);
  }

  return request;
}

module.exports = { applyTelegramIdempotency, createTelegramRandomId };