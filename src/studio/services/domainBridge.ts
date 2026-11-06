import { resolveAccountId } from '../domain/accountContext';
import { normalizeAttachments } from '../lib/draftAttachments';
import type { SavedDraft, Template as LegacyTemplate } from '../types';
import type { Draft as DomainDraft, Template as DomainTemplate } from '../domain/types';

function serializeTemplateField(entity: NonNullable<LegacyTemplate['entities']>[number]): string {
  if (entity.type === 'text_url') {
    return `${entity.type}:${entity.offset}:${entity.length}:${entity.url ?? ''}`;
  }
  return `${entity.type}:${entity.offset}:${entity.length}`;
}

function parseTemplateField(field: string): NonNullable<LegacyTemplate['entities']>[number] | null {
  const [type, offsetText, lengthText, ...urlParts] = field.split(':');
  if (!type || !offsetText || !lengthText) return null;

  const offset = Number(offsetText);
  const length = Number(lengthText);
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(length) || length < 0) {
    return null;
  }

  const entity: NonNullable<LegacyTemplate['entities']>[number] = {
    type: type as NonNullable<LegacyTemplate['entities']>[number]['type'],
    offset,
    length,
  };

  if (type === 'text_url') {
    const url = urlParts.join(':');
    if (url.length === 0) return null;
    entity.url = url;
  }

  return entity;
}

export function convertLegacyTemplateToDomain(
  template: LegacyTemplate,
  accountId?: string,
): DomainTemplate {
  return {
    id: template.id,
    accountId: resolveAccountId(accountId),
    name: template.name,
    body: template.body,
    fields: template.entities?.map((entity) => serializeTemplateField(entity)),
    tags: template.tags ?? [],
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
  };
}

export function convertDomainTemplateToLegacy(
  template: DomainTemplate,
): LegacyTemplate {
  const entities = (template.fields ?? [])
    .map((field) => parseTemplateField(field))
    .filter((entity): entity is NonNullable<LegacyTemplate['entities']>[number] => entity !== null);

  return {
    id: template.id,
    name: template.name,
    body: template.body,
    ...(entities.length > 0 ? { entities } : {}),
    ...(template.tags && template.tags.length > 0 ? { tags: template.tags } : {}),
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
  };
}

export function convertLegacyDraftToDomain(draft: SavedDraft, authorAccountId?: string): DomainDraft {
  return {
    id: draft.id,
    authorAccountId: resolveAccountId(authorAccountId),
    postId: draft.postId,
    contentBody: draft.body,
    richText: draft.body,
    attachments: normalizeAttachments(draft.attachments),
    metadata: {
      name: draft.name,
      color: draft.color,
      date: draft.date,
      time: draft.time,
      repeatMode: draft.repeatMode,
      repeatDays: draft.repeatDays,
      repeatOccurrences: draft.repeatOccurrences,
      selectedChat: draft.selectedChat,
    },
    lastSavedAt: draft.updatedAt,
  };
}

export function convertDomainDraftToLegacy(draft: DomainDraft): SavedDraft {
  return {
    id: draft.id,
    postId: draft.postId,
    name: draft.metadata?.name as string ?? 'Untitled draft',
    body: draft.contentBody,
    color: (draft.metadata?.color as SavedDraft['color']) ?? 'gray',
    entities: [],
    attachments: draft.attachments ?? [],
    selectedChat: (draft.metadata?.selectedChat as SavedDraft['selectedChat']) ?? null,
    date: (draft.metadata?.date as string | undefined) ?? '',
    time: (draft.metadata?.time as string | undefined) ?? '',
    repeatMode: (draft.metadata?.repeatMode as SavedDraft['repeatMode']) ?? 'none',
    repeatDays: (draft.metadata?.repeatDays as string[] | undefined) ?? [],
    repeatOccurrences: (draft.metadata?.repeatOccurrences as number | undefined) ?? 1,
    createdAt: draft.lastSavedAt,
    updatedAt: draft.lastSavedAt,
  };
}
