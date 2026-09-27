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

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/'/g, '&#39;');
}

export function richTextToHtml(text: string, entities: RichTextEntity[]): string {
  if (!text) return '';

  const normalized = normalizeRichTextEntities(entities, text.length);
  const boundaries = new Set([0, text.length]);
  normalized.forEach((entity) => {
    boundaries.add(entity.offset);
    boundaries.add(entity.offset + entity.length);
  });

  const points = [...boundaries].sort((left, right) => left - right);
  return points.slice(0, -1).map((start, index) => {
    const end = points[index + 1];
    let html = escapeHtml(text.slice(start, end)).replace(/\n/g, '<br>');
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

export function editorHtmlToRichText(root: HTMLElement): {
  text: string;
  entities: RichTextEntity[];
} {
  let text = '';
  const entities: RichTextEntity[] = [];
  const entityStack: { type: RichTextEntityType; url?: string; offset: number }[] = [];

  const appendText = (value: string) => {
    text += value;
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
  return { text, entities: mergeRichTextEntities(entities) };
}