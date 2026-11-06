import { uid } from '@shared/utils';
import type { PersistedWorkspaceDocumentHistories, PersistedWorkspaceDocumentVersion } from '@shared/types';
import type { WorkspaceDraft } from './draftStore';

export const MAX_WORKSPACE_DOCUMENT_VERSIONS = 30;

function withoutSelectedChatAvatar(snapshot: Record<string, unknown>): Record<string, unknown> {
  const selectedChat = snapshot.selectedChat;
  if (!selectedChat || typeof selectedChat !== 'object' || Array.isArray(selectedChat)) return snapshot;
  const chat = { ...selectedChat as Record<string, unknown> };
  delete chat.avatarDataUrl;
  return { ...snapshot, selectedChat: chat };
}

export function hasEmbeddedWorkspaceHistoryAvatars(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value).some((rawVersions) => (
    Array.isArray(rawVersions) && rawVersions.some((rawVersion) => {
      if (!rawVersion || typeof rawVersion !== 'object' || Array.isArray(rawVersion)) return false;
      const snapshot = (rawVersion as Record<string, unknown>).snapshot;
      if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return false;
      const selectedChat = (snapshot as Record<string, unknown>).selectedChat;
      if (!selectedChat || typeof selectedChat !== 'object' || Array.isArray(selectedChat)) return false;
      const avatarDataUrl = (selectedChat as Record<string, unknown>).avatarDataUrl;
      return typeof avatarDataUrl === 'string' && avatarDataUrl.startsWith('data:');
    })
  ));
}

const VERSION_REASONS = new Set<PersistedWorkspaceDocumentVersion['reason']>([
  'edit',
  'before-clear',
  'before-delete',
  'before-replacement',
  'before-attachment-removal',
  'restore',
  'publish',
]);

export function hasWorkspaceDocumentContent(snapshot: WorkspaceDraft | null | undefined): snapshot is WorkspaceDraft {
  if (!snapshot) return false;
  return Boolean(
    snapshot.body.trim()
    || snapshot.attachments.length,
  );
}

export function areWorkspaceSnapshotsEqual(left: WorkspaceDraft | null, right: WorkspaceDraft | null): boolean {
  if (left === right) return true;
  if (!left || !right) return false;

  const comparable = (snapshot: WorkspaceDraft) => ({
    documentId: snapshot.documentId ?? '',
    body: snapshot.body,
    entities: snapshot.entities ?? [],
    attachments: snapshot.attachments.map((attachment) => ({
      id: attachment.id,
      type: attachment.type,
      name: attachment.name,
      mimeType: attachment.mimeType,
      size: attachment.size,
      path: attachment.path,
      position: attachment.position,
    })),
    selectedChat: snapshot.selectedChat
      ? withoutSelectedChatAvatar(snapshot as unknown as Record<string, unknown>).selectedChat
      : null,
    date: snapshot.date ?? '',
    time: snapshot.time ?? '',
    repeatMode: snapshot.repeatMode ?? 'none',
    repeatDays: snapshot.repeatDays ?? [],
    repeatOccurrences: snapshot.repeatOccurrences ?? 1,
  });

  return JSON.stringify(comparable(left)) === JSON.stringify(comparable(right));
}

export function normalizeWorkspaceDocumentHistories(value: unknown): PersistedWorkspaceDocumentHistories {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  const normalized: PersistedWorkspaceDocumentHistories = {};
  for (const [documentId, rawVersions] of Object.entries(value)) {
    if (!documentId || !Array.isArray(rawVersions)) continue;
    const versions = rawVersions.flatMap((rawVersion): PersistedWorkspaceDocumentVersion[] => {
      if (!rawVersion || typeof rawVersion !== 'object' || Array.isArray(rawVersion)) return [];
      const candidate = rawVersion as Partial<PersistedWorkspaceDocumentVersion>;
      const snapshot = candidate.snapshot;
      if (
        candidate.documentId !== documentId
        || typeof candidate.id !== 'string'
        || !candidate.id
        || typeof candidate.createdAt !== 'string'
        || !Number.isFinite(Date.parse(candidate.createdAt))
        || !candidate.reason
        || !VERSION_REASONS.has(candidate.reason)
        || !snapshot
        || typeof snapshot !== 'object'
        || Array.isArray(snapshot)
        || typeof snapshot.body !== 'string'
        || !Array.isArray(snapshot.attachments)
      ) return [];

      return [{
        id: candidate.id,
        documentId,
        createdAt: candidate.createdAt,
        reason: candidate.reason,
        snapshot: withoutSelectedChatAvatar(
          JSON.parse(JSON.stringify(snapshot)) as Record<string, unknown>,
        ),
      }];
    });

    if (versions.length) normalized[documentId] = versions.slice(-MAX_WORKSPACE_DOCUMENT_VERSIONS);
  }
  return normalized;
}

export function appendWorkspaceDocumentVersion(
  histories: PersistedWorkspaceDocumentHistories,
  documentId: string,
  snapshot: WorkspaceDraft,
  reason: PersistedWorkspaceDocumentVersion['reason'],
  createdAt = new Date().toISOString(),
): PersistedWorkspaceDocumentHistories {
  if (!documentId || !hasWorkspaceDocumentContent(snapshot)) return histories;

  const previousVersions = histories[documentId] ?? [];
  const lastVersion = previousVersions[previousVersions.length - 1];
  const normalizedSnapshot = {
    ...withoutSelectedChatAvatar(
      JSON.parse(JSON.stringify(snapshot)) as Record<string, unknown>,
    ),
    documentId,
  } as unknown as WorkspaceDraft;
  if (lastVersion && areWorkspaceSnapshotsEqual(lastVersion.snapshot as WorkspaceDraft, normalizedSnapshot)) {
    return histories;
  }

  const nextVersion: PersistedWorkspaceDocumentVersion = {
    id: uid(),
    documentId,
    createdAt,
    reason,
    snapshot: normalizedSnapshot as unknown as Record<string, unknown>,
  };
  return {
    ...histories,
    [documentId]: [...previousVersions, nextVersion].slice(-MAX_WORKSPACE_DOCUMENT_VERSIONS),
  };
}