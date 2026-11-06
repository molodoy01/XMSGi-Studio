import type { SavedDraft } from '@studio/types';
import { uid } from '@shared/utils';

export type SavedDraftInput = Pick<SavedDraft, 'name' | 'body'> & Partial<Omit<SavedDraft, 'id' | 'name' | 'body' | 'createdAt' | 'updatedAt'>>;

export function createSavedDraft(
  input: SavedDraftInput,
  now = new Date().toISOString(),
): SavedDraft {
  return {
    id: uid(),
    documentId: input.documentId ?? uid(),
    postId: input.postId,
    name: input.name.trim(),
    body: input.body,
    color: input.color ?? 'gray',
    entities: input.entities ?? [],
    attachments: input.attachments ?? [],
    selectedChat: input.selectedChat ?? null,
    date: input.date ?? '',
    time: input.time ?? '',
    repeatMode: input.repeatMode ?? 'none',
    repeatDays: input.repeatDays ?? [],
    repeatOccurrences: input.repeatOccurrences ?? 1,
    createdAt: now,
    updatedAt: now,
  };
}

export function updateSavedDraft(
  draft: SavedDraft,
  input: SavedDraftInput,
  now = new Date().toISOString(),
): SavedDraft {
  return {
    ...draft,
    documentId: input.documentId ?? draft.documentId ?? draft.id,
    postId: input.postId ?? draft.postId,
    name: input.name.trim(),
    body: input.body,
    color: input.color ?? draft.color ?? 'gray',
    entities: input.entities ?? [],
    attachments: input.attachments ?? draft.attachments ?? [],
    selectedChat: input.selectedChat ?? draft.selectedChat ?? null,
    date: input.date ?? draft.date ?? '',
    time: input.time ?? draft.time ?? '',
    repeatMode: input.repeatMode ?? draft.repeatMode ?? 'none',
    repeatDays: input.repeatDays ?? draft.repeatDays ?? [],
    repeatOccurrences: input.repeatOccurrences ?? draft.repeatOccurrences ?? 1,
    updatedAt: now,
  };
}

export function deleteSavedDraft(drafts: SavedDraft[], draftId: string): SavedDraft[] {
  return drafts.filter((draft) => draft.id !== draftId);
}