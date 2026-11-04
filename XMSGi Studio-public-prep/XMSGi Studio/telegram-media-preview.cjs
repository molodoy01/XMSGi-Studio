function toPreviewNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

async function getPreviewMedia(message, includeOriginalPhoto = false) {
  const file = message.file;
  const media = message.photo
    ? { kind: 'photo' }
    : message.video
      ? { kind: 'video' }
      : message.audio
        ? { kind: 'audio' }
        : message.document
          ? { kind: 'document' }
          : null;

  if (!media) return undefined;

  const result = {
    ...media,
    name: file?.name || '',
    mimeType: file?.mimeType || '',
    size: toPreviewNumber(file?.size),
    duration: toPreviewNumber(file?.duration),
    width: toPreviewNumber(file?.width),
    height: toPreviewNumber(file?.height)
  };

  if (media.kind === 'photo' || media.kind === 'video') {
    try {
      const useOriginalPhoto = media.kind === 'photo'
        && includeOriginalPhoto
        && result.size !== undefined
        && result.size <= 8 * 1024 * 1024;
      const downloadedMedia = await message.downloadMedia(
        useOriginalPhoto ? undefined : { thumb: 1 },
      );

      if (downloadedMedia && (Buffer.isBuffer(downloadedMedia) || downloadedMedia instanceof Uint8Array)) {
        const mimeType = media.kind === 'photo' ? 'image/jpeg' : 'video/jpeg';
        const dataUrl = `data:${mimeType};base64,${Buffer.from(downloadedMedia).toString('base64')}`;
        if (useOriginalPhoto) {
          result.dataUrl = dataUrl;
        } else {
          result.thumbnailDataUrl = dataUrl;
        }
      } else if (media.kind === 'photo' && useOriginalPhoto) {
        const thumbnail = await message.downloadMedia({ thumb: 1 });
        if (thumbnail && (Buffer.isBuffer(thumbnail) || thumbnail instanceof Uint8Array)) {
          result.thumbnailDataUrl = `data:image/jpeg;base64,${Buffer.from(thumbnail).toString('base64')}`;
        }
      }
    } catch (error) {
      console.error('Telegram media thumbnail unavailable:', error?.code || error?.name || 'unknown');
    }
  }

  if (media.kind === 'audio' && result.size && result.size <= 10 * 1024 * 1024) {
    try {
      const audio = await message.downloadMedia();

      if (audio && (Buffer.isBuffer(audio) || audio instanceof Uint8Array)) {
        result.dataUrl = `data:${result.mimeType || 'audio/mpeg'};base64,${Buffer.from(audio).toString('base64')}`;
      }
    } catch (error) {
      console.error('Telegram audio preview unavailable:', error?.code || error?.name || 'unknown');
    }
  }

  return result;
}

module.exports = { toPreviewNumber, getPreviewMedia };