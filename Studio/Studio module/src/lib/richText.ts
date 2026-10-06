import type { RichTextEntity, RichTextEntityType } from '@/types';

const ENTITY_TYPES: RichTextEntityType[] = [
  'bold',
  'italic',
  'underline',
  'strikethrough',
  'text_url',
];

function isEntityType(value: unknown): value is RichTextEntityType {
  return typeof value === 'string' && ENTITY_TYPES.includes(value as RichTextEntityType);
}

function isValidUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false;

  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'tg:';
  } catch {
    return false;
  }
}

export function normalizeRichTextEntities(value: unknown, textLength: number): RichTextEntity[] {
  if (!Array.isArray(value) || textLength < 1) return [];

  return value
    .filter((entity): entity is Partial<RichTextEntity> => Boolean(entity) && typeof entity === 'object')
    .map((entity) => {
      const offset = Number(entity.offset);
      const length = Number(entity.length);
      const type = entity.type;

      if (!isEntityType(type) || !Number.isInteger(offset) || !Number.isInteger(length)) {
        return null;
      }

      const start = Math.max(0, offset);
      const end = Math.min(textLength, offset + length);
      if (end <= start || (type === 'text_url' && !isValidUrl(entity.url))) return null;

      return {
        type,
        offset: start,
        length: end - start,
        ...(type === 'text_url' ? { url: entity.url } : {}),
      } satisfies RichTextEntity;
    })
    .filter((entity): entity is RichTextEntity => entity !== null)
    .sort((left, right) =>
      left.offset - right.offset || right.length - left.length || left.type.localeCompare(right.type),
    );
}

export function mergeRichTextEntities(entities: RichTextEntity[]): RichTextEntity[] {
  const normalized = normalizeRichTextEntities(entities, Number.MAX_SAFE_INTEGER);
  const merged: RichTextEntity[] = [];

  for (const entity of normalized) {
    const previous = merged[merged.length - 1];
    if (
      previous &&
      previous.type === entity.type &&
      previous.url === entity.url &&
      previous.offset + previous.length >= entity.offset
    ) {
      previous.length = Math.max(
        previous.length,
        entity.offset + entity.length - previous.offset,
      );
    } else {
      merged.push({ ...entity });
    }
  }

  return merged;
}

export function sliceRichText(
  text: string,
  entities: RichTextEntity[],
  start: number,
  end: number,
): { text: string; entities: RichTextEntity[] } {
  const safeStart = Math.max(0, Math.min(start, text.length));
  const safeEnd = Math.max(safeStart, Math.min(end, text.length));

  return {
    text: text.slice(safeStart, safeEnd),
    entities: normalizeRichTextEntities(
      entities.flatMap((entity) => {
        const entityStart = Math.max(entity.offset, safeStart);
        const entityEnd = Math.min(entity.offset + entity.length, safeEnd);
        return entityEnd > entityStart
          ? [{ ...entity, offset: entityStart - safeStart, length: entityEnd - entityStart }]
          : [];
      }),
      safeEnd - safeStart,
    ),
  };
}

export function entityTagName(type: RichTextEntityType): 'strong' | 'em' | 'u' | 's' {
  switch (type) {
    case 'bold': return 'strong';
    case 'italic': return 'em';
    case 'underline': return 'u';
    case 'strikethrough': return 's';
    case 'text_url': return 'u';
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function normalizeEditorText(value: string): string {
  return value
    .replace(/\u00A0/g, ' ')
    .replace(/[\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '');
}

export function sanitizeEditorDom(root: Node): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];

  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (node.nodeValue && /[\u00A0\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/.test(node.nodeValue)) {
      textNodes.push(node);
    }
  }

  for (const textNode of textNodes) {
    const nextValue = normalizeEditorText(textNode.nodeValue ?? '');
    if (nextValue !== textNode.nodeValue) {
      textNode.nodeValue = nextValue;
    }
  }
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/'/g, '&#39;');
}

export function richTextToHtml(text: string, entities: RichTextEntity[]): string {
  const safeText = normalizeEditorText(text);
  if (!safeText) return '';

  const normalized = normalizeRichTextEntities(entities, safeText.length);
  const boundaries = new Set([0, safeText.length]);
  normalized.forEach((entity) => {
    boundaries.add(entity.offset);
    boundaries.add(entity.offset + entity.length);
  });

  const points = [...boundaries].sort((left, right) => left - right);
  return points.slice(0, -1).map((start, index) => {
    const end = points[index + 1];
    let html = escapeHtml(safeText.slice(start, end)).replace(/\n/g, '<br>');
    const active = normalized
      .filter((entity) => entity.offset <= start && entity.offset + entity.length >= end)
      .sort((left, right) => left.length - right.length);

    for (const entity of active) {
      if (entity.type === 'text_url') {
        html = `<a href="${escapeAttribute(entity.url || '')}" data-rich-text-url="true">${html}</a>`;
      } else {
        html = `<${entityTagName(entity.type)}>${html}</${entityTagName(entity.type)}>`;
      }
    }

    return html;
  }).join('');
}

type MarkdownDelimiter = {
  marker: '*' | '**' | '~~';
  type: RichTextEntityType;
  start: number;
  end: number;
};

type MarkdownPair = {
  opener: MarkdownDelimiter;
  closeStart: number;
  closeEnd: number;
};

export function markdownToRichText(source: string): {
  text: string;
  entities: RichTextEntity[];
  sourceOffsetMap: number[];
  changed: boolean;
} {
  const removed = new Uint8Array(source.length);
  const escaped = new Uint8Array(source.length);
  const stack: MarkdownDelimiter[] = [];
  const pairs: MarkdownPair[] = [];

  for (let index = 0; index < source.length;) {
    if (source[index] === '\\') {
      const start = index;
      while (source[index] === '\\') index += 1;
      const slashCount = index - start;
      if (source[index] === '*' || source[index] === '~') {
        for (let pair = 0; pair < Math.floor(slashCount / 2); pair += 1) {
          removed[start + pair * 2 + 1] = 1;
        }
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
        const marker: MarkdownDelimiter['marker'] = character === '~'
          ? remaining >= 2 ? '~~' : '*'
          : remaining >= 2 ? '**' : '*';
        if (character === '~' && remaining < 2) break;

        const type: RichTextEntityType = marker === '**'
          ? 'bold'
          : marker === '~~'
            ? 'strikethrough'
            : 'italic';
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

  const output: string[] = [];
  let outputLength = 0;
  const sourceOffsetMap = new Array<number>(source.length + 1);
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

  return {
    text,
    entities: mergeRichTextEntities(entities),
    sourceOffsetMap,
    changed: removed.some((marker) => marker === 1),
  };
}

export function editorHtmlToRichText(root: HTMLElement): {
  text: string;
  entities: RichTextEntity[];
  sourceOffsetMap: number[];
  markdownChanged: boolean;
} {
  let text = '';
  const entities: RichTextEntity[] = [];
  const entityStack: { type: RichTextEntityType; url?: string; offset: number }[] = [];

  const appendText = (value: string) => {
    text += normalizeEditorText(value);
  };

  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      appendText(node.textContent || '');
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as HTMLElement;
    if (element.tagName === 'BR') {
      appendText('\n');
      return;
    }

    const additions: { type: RichTextEntityType; url?: string }[] = [];
    if (element.tagName === 'STRONG' || element.tagName === 'B') additions.push({ type: 'bold' });
    if (element.tagName === 'EM' || element.tagName === 'I') additions.push({ type: 'italic' });
    if (element.tagName === 'U') additions.push({ type: 'underline' });
    if (element.tagName === 'S' || element.tagName === 'STRIKE' || element.tagName === 'DEL') {
      additions.push({ type: 'strikethrough' });
    }
    if (element.tagName === 'A' && isValidUrl(element.getAttribute('href'))) {
      additions.push({ type: 'text_url', url: element.getAttribute('href') || undefined });
    }

    const offset = text.length;
    additions.forEach((addition) => entityStack.push({ ...addition, offset }));
    element.childNodes.forEach(visit);
    const end = text.length;

    additions.reverse().forEach((addition) => {
      const stackIndex = entityStack.findIndex(
        (entry) => entry.type === addition.type && entry.offset === offset && entry.url === addition.url,
      );
      if (stackIndex < 0) return;
      entityStack.splice(stackIndex, 1);
      if (end > offset) {
        entities.push({ type: addition.type, offset, length: end - offset, ...(addition.url ? { url: addition.url } : {}) });
      }
    });
  };

  root.childNodes.forEach(visit);
  const markdown = markdownToRichText(text);
  const mappedEntities = entities.flatMap((entity) => {
    const offset = markdown.sourceOffsetMap[entity.offset];
    const end = markdown.sourceOffsetMap[entity.offset + entity.length];
    return end > offset ? [{ ...entity, offset, length: end - offset }] : [];
  });

  return {
    text: markdown.text,
    entities: mergeRichTextEntities([...mappedEntities, ...markdown.entities]),
    sourceOffsetMap: markdown.sourceOffsetMap,
    markdownChanged: markdown.changed,
  };
}