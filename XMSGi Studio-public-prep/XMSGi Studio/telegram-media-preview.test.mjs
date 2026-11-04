import { Buffer } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';
import { getPreviewMedia, toPreviewNumber } from './telegram-media-preview.cjs';

describe('Telegram history media previews', () => {
  it('normalizes finite preview numbers and rejects invalid values', () => {
    expect(toPreviewNumber('12.5')).toBe(12.5);
    expect(toPreviewNumber(Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(toPreviewNumber('not-a-number')).toBeUndefined();
  });

  it('returns undefined when the message has no supported media', async () => {
    await expect(getPreviewMedia({ message: 'text only' })).resolves.toBeUndefined();
  });

  it('uses a thumbnail by default for photo previews', async () => {
    const downloadMedia = vi.fn().mockResolvedValue(Buffer.from('photo-thumb'));
    const result = await getPreviewMedia({
      photo: true,
      file: { name: 'photo.jpg', size: '1024', width: '80', height: '60' },
      downloadMedia,
    });

    expect(downloadMedia).toHaveBeenCalledWith({ thumb: 1 });
    expect(result).toMatchObject({ kind: 'photo', name: 'photo.jpg', size: 1024, width: 80, height: 60 });
    expect(result.thumbnailDataUrl).toBe(`data:image/jpeg;base64,${Buffer.from('photo-thumb').toString('base64')}`);
  });

  it('uses the original photo only when explicitly requested and within the size limit', async () => {
    const downloadMedia = vi.fn().mockResolvedValue(Buffer.from('photo-original'));
    const result = await getPreviewMedia({ photo: true, file: { size: 1024 }, downloadMedia }, true);

    expect(downloadMedia).toHaveBeenCalledWith(undefined);
    expect(result.dataUrl).toBe(`data:image/jpeg;base64,${Buffer.from('photo-original').toString('base64')}`);
  });

  it('keeps document metadata without downloading its contents', async () => {
    const downloadMedia = vi.fn();
    const result = await getPreviewMedia({
      document: true,
      file: { name: 'report.pdf', mimeType: 'application/pdf', size: 4096 },
      downloadMedia,
    });

    expect(result).toMatchObject({ kind: 'document', name: 'report.pdf', mimeType: 'application/pdf', size: 4096 });
    expect(downloadMedia).not.toHaveBeenCalled();
  });

  it('downloads small audio previews with their source MIME type', async () => {
    const downloadMedia = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));
    const result = await getPreviewMedia({
      audio: true,
      file: { mimeType: 'audio/ogg', size: 3, duration: 2.5 },
      downloadMedia,
    });

    expect(downloadMedia).toHaveBeenCalledOnce();
    expect(result.duration).toBe(2.5);
    expect(result.dataUrl).toBe(`data:audio/ogg;base64,${Buffer.from([1, 2, 3]).toString('base64')}`);
  });
});