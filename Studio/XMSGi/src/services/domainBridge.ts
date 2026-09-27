import { resolveAccountId } from '../domain/accountContext';
import type { SavedDraft, Template as LegacyTemplate } from '../types';
import type { Draft as DomainDraft, Template as DomainTemplate } from '../domain/types';

export function convertLegacyTemplateToDomain(
  template: LegacyTemplate,
  accountId?: string,
): DomainTemplate {
  return {
    id: template.id,
    accountId: resolveAccountId(accountId),
    name: template.name,
    body: template.body,
    fields: template.entities?.map((entity) => `${entity.type}:${entity.offset}:${entity.length}`),
    tags: [],
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
  };
}

export function convertDomainTemplateToLegacy(
  template: DomainTemplate,
): LegacyTemplate {
  return {
    id: template.id,
    name: template.name,
    body: template.body,
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
  };
}

export function convertLegacyDraftToDomain(draft: SavedDraft, authorAccountId?: string): DomainDraft {
  return {
    id: draft.id,
    authorAccountId: resolveAccountId(authorAccountId),
    postId: undefined,
    contentBody: draft.body,
    richText: draft.body,
    attachments: draft.attachments ?? [],
    metadata: {
      name: draft.name,
      color: draft.color,
      date: draft.date,
      time: draft.time,
      repeatMode: draft.repeatMode,
      repeatDays: draft.repeatDays,
      repeatOccurrences: draft.repeatOccurrences,
      selectedChat: draft.selectedChat,
      inlineButtons: draft.inlineButtons,
    },
    lastSavedAt: draft.updatedAt,
  };
}

export function convertDomainDraftToLegacy(draft: DomainDraft): SavedDraft {
  return {
    id: draft.id,
    name: draft.metadata?.name as string ?? 'Untitled draft',
    body: draft.contentBody,
    color: (draft.metadata?.color as SavedDraft['color']) ?? 'gray',
    entities: [],
    attachments: draft.attachments ?? [],
    selectedChat: (draft.metadata?.selectedChat as SavedDraft['selectedChat']) ?? null,
    inlineButtons: (draft.metadata?.inlineButtons as SavedDraft['inlineButtons']) ?? [],
    date: (draft.metadata?.date as string | undefined) ?? '',
    time: (draft.metadata?.time as string | undefined) ?? '',
    repeatMode: (draft.metadata?.repeatMode as SavedDraft['repeatMode']) ?? 'none',
    repeatDays: (draft.metadata?.repeatDays as string[] | undefined) ?? [],
    repeatOccurrences: (draft.metadata?.repeatOccurrences as number | undefined) ?? 1,
    createdAt: draft.lastSavedAt,
    updatedAt: draft.lastSavedAt,
  };
}
