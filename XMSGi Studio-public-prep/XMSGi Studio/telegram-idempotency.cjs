const crypto = require('node:crypto');
const fs = require('node:fs');
const { fromTelegramInlineKeyboard } = require('./telegram-inline-keyboard.cjs');
const { getTelegramEntityIdentity } = require('./telegram-message-entities.cjs');

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
    if (!target) return;
    const randomId = createTelegramRandomId(idempotencyKey, part);
    if (typeof target.randomId === 'bigint') {
      target.randomId = randomId;
      return;
    }
    if (typeof target.randomId !== 'object' || typeof target.randomId.constructor !== 'function') return;
    target.randomId = target.randomId.constructor(randomId.toString());
  };

  if (Array.isArray(request.multiMedia)) {
    request.multiMedia.forEach((media, index) => setRandomId(media, index));
  } else {
    setRandomId(request, 0);
  }

  return request;
}

function getEffectIdentity(effect) {
  const effectId = effect?.effectId ?? effect;
  return effectId === undefined || effectId === null ? null : String(effectId);
}

function matchesScheduledOperation(scheduledMessage, operation) {
  const messageTimestamp = scheduledMessage.date instanceof Date
    ? Math.floor(scheduledMessage.date.getTime() / 1000)
    : Number(scheduledMessage.date);
  const mediaClassName = scheduledMessage.media?.className;
  const expectedMarkup = operation.replyMarkup?.inline_keyboard?.length
    ? operation.replyMarkup
    : null;
  const actualMarkup = fromTelegramInlineKeyboard(scheduledMessage.replyMarkup) ?? null;

  return scheduledMessage.message === operation.message
    && messageTimestamp === operation.targetTimestamp
    && mediaClassName !== 'MessageMediaPhoto'
    && mediaClassName !== 'MessageMediaDocument'
    && JSON.stringify(getTelegramEntityIdentity(scheduledMessage.entities || []))
      === JSON.stringify(operation.entities)
    && JSON.stringify(actualMarkup) === JSON.stringify(expectedMarkup)
    && (scheduledMessage.silent === true) === operation.silent
    && getEffectIdentity(scheduledMessage.effect) === getEffectIdentity(operation.effect);
}

function hashFile(filePath, hashCache) {
  if (hashCache?.has(filePath)) return hashCache.get(filePath);

  const hashPromise = new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
  hashCache?.set(filePath, hashPromise);
  return hashPromise;
}

async function createScheduleIdempotencyKey(target, operation, hashCache) {
  const attachmentHashes = await Promise.all(operation.attachments.map((filePath) => hashFile(filePath, hashCache)));
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify({
    target: String(target),
    message: operation.message,
    targetTimestamp: operation.targetTimestamp,
    attachmentHashes,
    entities: operation.entities,
    replyMarkup: operation.replyMarkup ?? null,
    silent: operation.silent,
    effect: getEffectIdentity(operation.effect),
  })).digest('hex');

  return `stable:schedule:${fingerprint}`;
}

async function getScheduleOperationIdentities(operations) {
  const hashCache = new Map();
  return Promise.all(operations.map(async (operation) => {
    try {
      return await createScheduleIdempotencyKey(operation.chatId, operation, hashCache);
    } catch {
      return null;
    }
  }));
}

module.exports = {
  applyTelegramIdempotency,
  createTelegramRandomId,
  getTelegramEntityIdentity,
  getEffectIdentity,
  matchesScheduledOperation,
  createScheduleIdempotencyKey,
  getScheduleOperationIdentities,
};