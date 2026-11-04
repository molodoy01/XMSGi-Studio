function toPreviewNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function getPreviewMediaDataBytes(media) {
  const dataUrls = [media?.dataUrl, media?.thumbnailDataUrl].filter((value) => typeof value === 'string');
  return dataUrls.reduce((total, dataUrl) => {
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
    return total + Math.max(0, Math.floor(base64.length * 3 / 4) - padding);
  }, 0);
}

function getPreviewFileProperty(file, property) {
  try {
    return file?.[property];
  } catch (error) {
    console.error(`Telegram preview file ${property} unavailable:`, error?.name || 'unknown');
    return undefined;
  }
}

async function getPreviewMedia(
  message,
  includeOriginalPhoto = false,
  maxPreviewBytes = 4 * 1024 * 1024,
  runMediaDownload = (request) => request,
) {
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
    name: getPreviewFileProperty(file, 'name') || '',
    mimeType: getPreviewFileProperty(file, 'mimeType') || '',
    size: toPreviewNumber(getPreviewFileProperty(file, 'size')),
    duration: toPreviewNumber(getPreviewFileProperty(file, 'duration')),
    width: toPreviewNumber(getPreviewFileProperty(file, 'width')),
    height: toPreviewNumber(getPreviewFileProperty(file, 'height'))
  };
  if (maxPreviewBytes <= 0) return result;
  const downloadMedia = (options) => runMediaDownload(message.downloadMedia(options));

  if (media.kind === 'photo' || media.kind === 'video') {
    try {
      const useOriginalPhoto = media.kind === 'photo'
        && includeOriginalPhoto
        && result.size !== undefined
        && result.size <= 8 * 1024 * 1024
        && result.size <= maxPreviewBytes;
      const downloadedMedia = await downloadMedia(
        useOriginalPhoto ? undefined : { thumb: 1 },
      );

      if (downloadedMedia
        && (Buffer.isBuffer(downloadedMedia) || downloadedMedia instanceof Uint8Array)
        && downloadedMedia.byteLength <= maxPreviewBytes) {
        const mimeType = media.kind === 'photo' ? 'image/jpeg' : 'video/jpeg';
        const dataUrl = `data:${mimeType};base64,${Buffer.from(downloadedMedia).toString('base64')}`;
        if (useOriginalPhoto) {
          result.dataUrl = dataUrl;
        } else {
          result.thumbnailDataUrl = dataUrl;
        }
      } else if (media.kind === 'photo' && useOriginalPhoto) {
        const thumbnail = await downloadMedia({ thumb: 1 });
        if (thumbnail
          && (Buffer.isBuffer(thumbnail) || thumbnail instanceof Uint8Array)
          && thumbnail.byteLength <= maxPreviewBytes) {
          result.thumbnailDataUrl = `data:image/jpeg;base64,${Buffer.from(thumbnail).toString('base64')}`;
        }
      }
    } catch (error) {
      console.error('Telegram media thumbnail unavailable:', error?.code || error?.name || 'unknown');
    }
  }

  if (media.kind === 'audio' && result.size && result.size <= 1024 * 1024 && result.size <= maxPreviewBytes) {
    try {
      const audio = await downloadMedia();

      if (audio
        && (Buffer.isBuffer(audio) || audio instanceof Uint8Array)
        && audio.byteLength <= maxPreviewBytes) {
        result.dataUrl = `data:${result.mimeType || 'audio/mpeg'};base64,${Buffer.from(audio).toString('base64')}`;
      }
    } catch (error) {
      console.error('Telegram audio preview unavailable:', error?.code || error?.name || 'unknown');
    }
  }

  return result;
}

module.exports = { toPreviewNumber, getPreviewMedia, getPreviewMediaDataBytes };