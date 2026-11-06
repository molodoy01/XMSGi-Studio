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
