const ENTITY_TYPES = new Set(['bold', 'italic', 'underline', 'strikethrough', 'text_url']);

function isValidUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:' || protocol === 'tg:';
  } catch {
    return false;
  }
}

function mergeEntities(entities) {
  const normalized = entities
    .filter((entity) => entity && ENTITY_TYPES.has(entity.type)
      && Number.isInteger(entity.offset) && Number.isInteger(entity.length)
      && entity.offset >= 0 && entity.length > 0
      && (entity.type !== 'text_url' || isValidUrl(entity.url)))
    .map((entity) => ({
      type: entity.type,
      offset: entity.offset,
      length: entity.length,
      ...(entity.type === 'text_url' ? { url: entity.url } : {}),
    }))
    .sort((left, right) => left.offset - right.offset || right.length - left.length || left.type.localeCompare(right.type));
  const merged = [];

  for (const entity of normalized) {
    const previous = merged[merged.length - 1];
    if (previous && previous.type === entity.type && previous.url === entity.url
      && previous.offset + previous.length >= entity.offset) {
      previous.length = Math.max(previous.length, entity.offset + entity.length - previous.offset);
    } else {
      merged.push({ ...entity });
    }
  }
  return merged;
}

function markdownToRichText(source) {
  const removed = new Uint8Array(source.length);
  const escaped = new Uint8Array(source.length);
  const stack = [];
  const pairs = [];

  for (let index = 0; index < source.length;) {
    if (source[index] === '\\') {
      const start = index;
      while (source[index] === '\\') index += 1;
      const slashCount = index - start;
      if (source[index] === '*' || source[index] === '~') {
        for (let pair = 0; pair < Math.floor(slashCount / 2); pair += 1) removed[start + pair * 2 + 1] = 1;
        if (slashCount % 2 === 1) {
          removed[index - 1] = 1;
          escaped[index] = 1;
        }
      }
      continue;
    }

    const character = source[index];
    if (character !== '*' && character !== '~') {
      index += 1;
      continue;
    }

    let runEnd = index + 1;
    while (source[runEnd] === character) runEnd += 1;
    const runLength = runEnd - index;
    if (escaped[index] || (character === '~' && runLength < 2)) {
      index = runEnd;
      continue;
    }

    let remaining = runLength;
    let consumed = 0;
    const previousCharacter = source[index - 1];
    const nextCharacter = source[runEnd];
    const canClose = previousCharacter !== undefined && !/\s/u.test(previousCharacter);
    const canOpen = nextCharacter !== undefined && !/\s/u.test(nextCharacter);

    if (canClose) {
      while (stack.length > 0) {
        const opener = stack[stack.length - 1];
        if (opener.marker[0] !== character || opener.marker.length > remaining) break;
        const closeStart = index + consumed;
        pairs.push({ opener, closeStart, closeEnd: closeStart + opener.marker.length });
        stack.pop();
        consumed += opener.marker.length;
        remaining -= opener.marker.length;
      }
    }

    if (canOpen) {
      while (remaining > 0) {
        const marker = character === '~' ? (remaining >= 2 ? '~~' : '*') : (remaining >= 2 ? '**' : '*');
        if (character === '~' && remaining < 2) break;
        const type = marker === '**' ? 'bold' : marker === '~~' ? 'strikethrough' : 'italic';
        const start = index + consumed;
        stack.push({ marker, type, start, end: start + marker.length });
        consumed += marker.length;
        remaining -= marker.length;
      }
    }

    index = runEnd;
  }

  pairs.forEach(({ opener, closeStart, closeEnd }) => {
    for (let index = opener.start; index < opener.end; index += 1) removed[index] = 1;
    for (let index = closeStart; index < closeEnd; index += 1) removed[index] = 1;
  });

  const output = [];
  let outputLength = 0;
  const sourceOffsetMap = new Array(source.length + 1);
  for (let index = 0; index < source.length; index += 1) {
    sourceOffsetMap[index] = outputLength;
    if (!removed[index]) {
      output.push(source[index]);
      outputLength += 1;
    }
  }
  sourceOffsetMap[source.length] = outputLength;
  const text = output.join('');
  const entities = pairs.flatMap(({ opener, closeStart }) => {
    const offset = sourceOffsetMap[opener.end];
    const end = sourceOffsetMap[closeStart];
    return end > offset ? [{ type: opener.type, offset, length: end - offset }] : [];
  });

  return { text, entities: mergeEntities(entities), sourceOffsetMap, changed: removed.some((marker) => marker === 1) };
}

function normalizeTelegramText(message) {
  if (typeof message !== 'string') return message;
  return message
    .replace(/\u00A0/g, ' ')
    .replace(/[\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '');
}

function normalizeTelegramMessage(message, entities = []) {
  if (typeof message !== 'string') return { message, entities };

  const markdown = markdownToRichText(message);
  const mappedEntities = Array.isArray(entities)
    ? entities.flatMap((entity) => {
      const start = entity?.offset;
      const end = start + entity?.length;
      if (!Number.isInteger(start) || !Number.isInteger(entity?.length) || start < 0 || end > message.length) return [];
      const offset = markdown.sourceOffsetMap[start];
      const length = markdown.sourceOffsetMap[end] - offset;
      return length > 0 ? [{ ...entity, offset, length }] : [];
    })
    : [];
  const cleanEntities = mergeEntities([...markdown.entities, ...mappedEntities]);
  let normalizedMessage = '';
  const offsets = new Array(markdown.text.length + 1);
  offsets[0] = 0;

  for (let index = 0; index < markdown.text.length; index += 1) {
    const character = markdown.text[index];
    if (character === '\u00A0') normalizedMessage += ' ';
    else if (!/[\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/.test(character)) normalizedMessage += character;
    offsets[index + 1] = normalizedMessage.length;
  }

  const normalizedEntities = cleanEntities.flatMap((entity) => {
    const start = entity.offset;
    const end = start + entity.length;
    if (start < 0 || end > markdown.text.length) return [];
    const offset = offsets[start];
    const length = offsets[end] - offset;
    return length > 0 ? [{ ...entity, offset, length }] : [];
  });

  return { message: normalizedMessage, entities: mergeEntities(normalizedEntities) };
}

module.exports = { markdownToRichText, normalizeTelegramMessage, normalizeTelegramText };