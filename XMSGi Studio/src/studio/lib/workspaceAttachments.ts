import type { DraftAttachment } from '../domain/types';
import { inferAttachmentMimeType } from './draftAttachments';

export type WorkspaceAttachment = DraftAttachment;

export const MAX_ALBUMS = 3;
export const MAX_PHOTOS_PER_ALBUM = 10;
export const MAX_ATTACHMENTS = MAX_ALBUMS * MAX_PHOTOS_PER_ALBUM;
export const MAX_STANDALONE_ATTACHMENTS = 10;
export const MAX_ATTACHMENT_SIZE = 50 * 1024 * 1024;
export const MAX_ATTACHMENTS_TOTAL_SIZE = 200 * 1024 * 1024;

export function remapAttachmentPositions(
  attachments: WorkspaceAttachment[],
  previousText: string,
  nextText: string,
): WorkspaceAttachment[] {
  if (previousText === nextText || attachments.length === 0) return attachments;

  let prefixLength = 0;
  while (
    prefixLength < previousText.length
    && prefixLength < nextText.length
    && previousText[prefixLength] === nextText[prefixLength]
  ) prefixLength += 1;

  let suffixLength = 0;
  while (
    suffixLength < previousText.length - prefixLength
    && suffixLength < nextText.length - prefixLength
    && previousText[previousText.length - suffixLength - 1] === nextText[nextText.length - suffixLength - 1]
  ) suffixLength += 1;

  const previousEditEnd = previousText.length - suffixLength;
  const nextEditEnd = nextText.length - suffixLength;
  const lengthDelta = nextText.length - previousText.length;

  let positionsChanged = false;
  const remappedAttachments = attachments.map((attachment) => {
    const position = attachment.position < prefixLength
      ? attachment.position
      : attachment.position >= previousEditEnd
        ? attachment.position + lengthDelta
        : nextEditEnd;
    if (position === attachment.position) return attachment;
    positionsChanged = true;
    return { ...attachment, position: Math.max(0, position) };
  });
  return positionsChanged ? remappedAttachments : attachments;
}

export function createAttachmentId() {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `attachment-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function isImageAttachment(attachment: WorkspaceAttachment) {
  return attachment.type === 'image'
    || attachment.mimeType.startsWith('image/')
    || inferAttachmentMimeType(attachment.name).startsWith('image/');
}

export type PhotoAlbumDisplayItem = {
  kind: 'album';
  albumId: string;
  position: number;
  attachments: WorkspaceAttachment[];
};

export type AttachmentDisplayItem = PhotoAlbumDisplayItem | { kind: 'file'; attachment: WorkspaceAttachment };

export function getAttachmentDisplayItems(attachments: WorkspaceAttachment[]): AttachmentDisplayItem[] {
  const items: AttachmentDisplayItem[] = [];
  const albums = new Map<string, PhotoAlbumDisplayItem>();

  attachments.slice().sort((left, right) => left.position - right.position).forEach((attachment) => {
    if (!attachment.albumId) {
      items.push({ kind: 'file', attachment });
      return;
    }

    let album = albums.get(attachment.albumId);
    if (!album) {
      album = {
        kind: 'album',
        albumId: attachment.albumId,
        position: attachment.position,
        attachments: [],
      };
      albums.set(attachment.albumId, album);
      items.push(album);
    }
    album.attachments.push(attachment);
  });

  return items;
}

export function getAttachmentTransportItems(attachments: WorkspaceAttachment[]) {
  return getAttachmentDisplayItems(attachments)
    .map((item) => {
      const itemAttachments = item.kind === 'album' ? item.attachments : [item.attachment];
      return {
        attachments: itemAttachments,
        paths: itemAttachments.map((attachment) => attachment.path || attachment.previewUrl || attachment.name).filter(Boolean),
      };
    })
    .filter((group) => group.paths.length > 0);
}

export function getAttachmentTransportGroups(attachments: WorkspaceAttachment[]): string[][] {
  return getAttachmentTransportItems(attachments).map((group) => group.paths);
}

export function formatAttachmentSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export function readFileAsDataUrl(file: File, mimeType = file.type) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(mimeType
          ? reader.result.replace(/^data:[^;,]+/i, `data:${mimeType}`)
          : reader.result);
        return;
      }
      reject(new Error(`The selected file could not be converted to a data URL: ${file.name}`));
    };
    reader.onerror = () => reject(new Error(`The selected file could not be read: ${file.name}`));
    reader.readAsDataURL(file);
  });
}

export function getAttachmentPreviewUrl(filePath: string, previewUrl?: string) {
  if (previewUrl && /^(?:blob:|data:|https?:)/i.test(previewUrl)) return previewUrl;
  if (/^(?:blob:|data:|https?:)/i.test(filePath)) return filePath;
  return '';
}
