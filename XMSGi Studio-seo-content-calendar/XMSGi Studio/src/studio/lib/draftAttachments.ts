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
      const unavailable = attachment.unavailable === true;
      if (!path && !unavailable) return [];

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
        sourcePath: typeof attachment.sourcePath === 'string' ? attachment.sourcePath : undefined,
        size: typeof attachment.size === 'number' && attachment.size >= 0 ? attachment.size : 0,
        previewUrl: typeof attachment.previewUrl === 'string' ? attachment.previewUrl : undefined,
        position: typeof attachment.position === 'number' && Number.isFinite(attachment.position)
          ? Math.max(0, attachment.position)
          : 0,
        albumId: typeof attachment.albumId === 'string' && attachment.albumId ? attachment.albumId : undefined,
        ...(unavailable ? { unavailable: true } : {}),
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

export function isTelegramPhotoAlbumImage(name: string) {
  return /\.(?:jpe?g|png)$/i.test(name);
}

export function isSupportedPhotoAlbumSource(file: Pick<File, 'name' | 'type'>) {
  return isTelegramPhotoAlbumImage(file.name)
    || file.type.toLowerCase() === 'image/webp'
    || /\.webp$/i.test(file.name);
}

export async function convertWebpToTelegramPhoto(file: File): Promise<File> {
  if (file.type.toLowerCase() !== 'image/webp' && !/\.webp$/i.test(file.name)) return file;
  if (typeof createImageBitmap !== 'function') throw new Error('WebP conversion is unavailable.');

  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('WebP conversion is unavailable.');
    context.drawImage(bitmap, 0, 0);

    const png = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('WebP conversion failed.'));
      }, 'image/png');
    });
    const baseName = file.name.replace(/\.[^.]+$/, '') || 'photo';
    return new File([png], `${baseName}.png`, { type: 'image/png', lastModified: file.lastModified });
  } finally {
    bitmap.close();
  }
}