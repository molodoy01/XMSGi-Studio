import { describe, expect, it } from 'vitest';
import { readFileAsDataUrl } from './workspaceAttachments';

describe('readFileAsDataUrl', () => {
  it('uses the normalized image MIME type when the browser reports a generic type', async () => {
    const file = new File(['image'], 'photo.jfif', { type: 'application/octet-stream' });

    await expect(readFileAsDataUrl(file, 'image/jpeg'))
      .resolves.toMatch(/^data:image\/jpeg;base64,/);
  });
});
