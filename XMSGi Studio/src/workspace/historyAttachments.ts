export function toAttachmentUrl(filePath: string) {
  if (/^(?:data:|https?:|file:)/i.test(filePath)) return filePath;
  const normalizedPath = filePath.replace(/\\/g, '/');
  const encodedPath = normalizedPath
    .split('/')
    .map((segment, index) => (index === 0 ? segment : encodeURIComponent(segment)))
    .join('/');
  return `file:///${encodedPath}`;
}

export function getLocalAttachmentPath(filePath: string) {
  if (!/^file:/i.test(filePath)) return filePath;

  try {
    const url = new URL(filePath);
    const decodedPath = decodeURIComponent(url.pathname);
    return decodedPath.replace(/^\/([a-z]:\/)/i, '$1');
  } catch {
    return filePath;
  }
}

export function isImageAttachment(filePath: string) {
  return /^data:image\//i.test(filePath) || /\.(?:avif|gif|jpe?g|jfif|png|webp)$/i.test(filePath);
}

export function getImageBlob(dataUrl: string) {
  const [metadata, content] = dataUrl.split(',', 2);
  const mimeType = /^data:([^;,]+)/i.exec(metadata)?.[1];
  if (!mimeType || !content) throw new Error('The attachment is not a valid image data URL.');

  const bytes = /^data:[^,]*;base64/i.test(metadata)
    ? Uint8Array.from(atob(content), (character) => character.charCodeAt(0))
    : new TextEncoder().encode(decodeURIComponent(content));
  return new Blob([bytes], { type: mimeType });
}

export async function getImagePngBlob(sourceBlob: Blob) {
  if (sourceBlob.type.toLowerCase() === 'image/png') return sourceBlob;
  const bitmap = await createImageBitmap(sourceBlob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Unable to prepare the image for the clipboard.');
    context.drawImage(bitmap, 0, 0);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Unable to encode the image for the clipboard.'));
      }, 'image/png');
    });
  } finally {
    bitmap.close();
  }
}
