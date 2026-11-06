import { describe, expect, it } from 'vitest';
import {
  getAttachmentMimeType,
  inferAttachmentMimeType,
  isSupportedPhotoAlbumSource,
  normalizeAttachments,
} from './draftAttachments';

describe('JFIF attachments', () => {
  it('infers JPEG MIME for JFIF names even when the browser reports a generic type', () => {
    expect(inferAttachmentMimeType('photo.JFIF')).toBe('image/jpeg');
    expect(getAttachmentMimeType('photo.jfif', 'application/octet-stream')).toBe('image/jpeg');
    expect(getAttachmentMimeType('photo.jfif', 'image/jfif')).toBe('image/jpeg');
    expect(getAttachmentMimeType('photo.jpg', 'application/octet-stream')).toBe('image/jpeg');
  });

  it('restores legacy JFIF attachments as JPEG images', () => {
    expect(normalizeAttachments([{
      id: 'legacy-jfif',
      name: 'photo.jfif',
      type: 'file',
      mimeType: 'application/octet-stream',
      path: '/stored/photo.jfif',
    }])).toMatchObject([{
      id: 'legacy-jfif',
      type: 'image',
      mimeType: 'image/jpeg',
      name: 'photo.jfif',
    }]);
  });

  it('accepts JFIF files in photo albums even when the MIME type is generic', () => {
    expect(isSupportedPhotoAlbumSource({
      name: 'photo.jfif',
      type: 'application/octet-stream',
    })).toBe(true);
  });
});
