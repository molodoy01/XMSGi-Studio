import { describe, expect, it } from 'vitest';
import type { PersistedWorkspaceDocumentHistories } from '@shared/types';
import type { WorkspaceDraft } from './draftStore';
import {
  appendWorkspaceDocumentVersion,
  areWorkspaceSnapshotsEqual,
  MAX_WORKSPACE_DOCUMENT_VERSIONS,
  normalizeWorkspaceDocumentHistories,
} from './documentHistory';

function snapshot(documentId: string, body: string, savedAt = '12:00'): WorkspaceDraft {
  return {
    documentId,
    body,
    entities: [],
    attachments: [],
    savedAt,
    inlineButtons: [],
    date: '',
    time: '',
    repeatMode: 'none',
    repeatDays: [],
    repeatOccurrences: 1,
  };
}

describe('workspace document history', () => {
  it('compares document content without treating autosave timestamps as edits', () => {
    expect(areWorkspaceSnapshotsEqual(
      snapshot('document-1', 'Same post', '12:00'),
      snapshot('document-1', 'Same post', '12:05'),
    )).toBe(true);
  });

  it('does not append an identical version twice', () => {
    const previous: PersistedWorkspaceDocumentHistories = {};
    const first = appendWorkspaceDocumentVersion(previous, 'document-1', snapshot('document-1', 'Previous post'), 'edit');
    const repeated = appendWorkspaceDocumentVersion(first, 'document-1', snapshot('document-1', 'Previous post', '12:01'), 'edit');

    expect(first['document-1']).toHaveLength(1);
    expect(repeated).toBe(first);
  });

  it('keeps the newest 30 versions independently for each document', () => {
    let histories: PersistedWorkspaceDocumentHistories = {};
    for (let index = 0; index <= MAX_WORKSPACE_DOCUMENT_VERSIONS; index += 1) {
      histories = appendWorkspaceDocumentVersion(
        histories,
        'document-1',
        snapshot('document-1', `Post ${index}`),
        'edit',
        new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
      );
    }
    histories = appendWorkspaceDocumentVersion(histories, 'document-2', snapshot('document-2', 'Other post'), 'edit');

    expect(histories['document-1']).toHaveLength(30);
    expect((histories['document-1']?.[0].snapshot as WorkspaceDraft).body).toBe('Post 1');
    expect((histories['document-1']?.[histories['document-1'].length - 1].snapshot as WorkspaceDraft).body).toBe('Post 30');
    expect(histories['document-2']).toHaveLength(1);
  });

  it('normalizes stored history and caps legacy lists without mixing IDs', () => {
    const history: PersistedWorkspaceDocumentHistories = {};
    let versions: PersistedWorkspaceDocumentHistories = history;
    for (let index = 0; index < 31; index += 1) {
      versions = appendWorkspaceDocumentVersion(versions, 'document-1', snapshot('document-1', `Post ${index}`), 'edit');
    }
    const normalized = normalizeWorkspaceDocumentHistories({
      ...versions,
      'document-2': [{ ...versions['document-1']![0], documentId: 'document-1' }],
      invalid: [{ id: '', documentId: 'invalid', createdAt: 'bad', reason: 'edit', snapshot: {} }],
    });

    expect(normalized['document-1']).toHaveLength(30);
    expect(normalized['document-2']).toBeUndefined();
    expect(normalized.invalid).toBeUndefined();
  });
});