import type { DraftAttachment } from '../domain/types';

export function normalizeAttachments(value: unknown): DraftAttachment[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((attachment, index) => {
    if (typeof attachment === 'string') {
      const name = attachment.split(/[\\/]/).pop() || attachment;
      const mimeType = inferAttachmentMimeType(name);
      return [{
        id: `legacy-${index}-${name}`,
        type: mimeType.startsWith('image/') ? 'image' : 'file',
        name,
        mimeType,
        path: attachment,
        size: 0,
        position: 0,
      }];
    }

    if (
      attachment
      && typeof attachment === 'object'
      && typeof attachment.name === 'string'
    ) {
      const path = typeof attachment.path === 'string'
        ? attachment.path
        : typeof attachment.previewUrl === 'string' ? attachment.previewUrl : '';
      if (!path) return [];

      const mimeType = typeof attachment.mimeType === 'string' && attachment.mimeType
        ? attachment.mimeType
        : inferAttachmentMimeType(attachment.name);
      const type = attachment.type === 'image' || attachment.type === 'file'
        ? attachment.type
        : mimeType.startsWith('image/') ? 'image' : 'file';

      return [{
        id: typeof attachment.id === 'string' && attachment.id ? attachment.id : `legacy-${index}-${attachment.name}`,
        type,
        name: attachment.name,
        mimeType,
        path,
        size: typeof attachment.size === 'number' && attachment.size >= 0 ? attachment.size : 0,
        previewUrl: typeof attachment.previewUrl === 'string' ? attachment.previewUrl : undefined,
        position: typeof attachment.position === 'number' && Number.isFinite(attachment.position)
          ? Math.max(0, attachment.position)
          : 0,
      }];
    }

    return [];
  });
}

export function inferAttachmentMimeType(name: string) {
  const extension = name.split('.').pop()?.toLowerCase();
  const imageMimeTypes: Record<string, string> = {
    avif: 'image/avif',
    gif: 'image/gif',
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
  };
  return extension ? imageMimeTypes[extension] ?? 'application/octet-stream' : 'application/octet-stream';
}