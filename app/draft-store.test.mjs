import { afterEach, describe, expect, it } from 'vitest';
import { Buffer } from 'node:buffer';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createDraftStore } = require('./draft-store.cjs');
const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('draft attachment storage', () => {
  it('returns imported text in the result shape expected by the Studio renderer', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'xmsgi-draft-store-'));
    temporaryDirectories.push(directory);
    const textPath = path.join(directory, 'message.txt');
    const text = 'Заголовок\nТекст сообщения';
    writeFileSync(textPath, text, 'utf8');

    const result = createDraftStore({ directory: path.join(directory, 'drafts') }).importTextFrom(textPath);

    expect(result).toEqual({ success: true, text });
  });

  it('returns the attachment metadata expected by the Studio renderer', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'xmsgi-draft-store-'));
    temporaryDirectories.push(directory);
    const sourcePath = path.join(directory, 'upload.jpg');
    const storeDirectory = path.join(directory, 'drafts');
    writeFileSync(sourcePath, 'image bytes');

    const result = createDraftStore({ directory: storeDirectory }).copyAttachment(sourcePath);

    expect(result).toMatchObject({
      success: true,
      attachment: {
        name: 'upload.jpg',
        path: path.join(storeDirectory, 'upload.jpg'),
        size: Buffer.byteLength('image bytes'),
      },
    });
    expect(readFileSync(result.attachment.path)).toEqual(readFileSync(sourcePath));
  });

  it('persists bytes for attachments created in the renderer without a source path', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'xmsgi-draft-store-'));
    temporaryDirectories.push(directory);
    const storeDirectory = path.join(directory, 'drafts');
    const bytes = Buffer.from('converted png bytes');

    const result = createDraftStore({ directory: storeDirectory }).writeAttachment('photo.png', new Uint8Array(bytes));

    expect(result).toMatchObject({
      success: true,
      attachment: {
        name: 'photo.png',
        path: path.join(storeDirectory, 'photo.png'),
        size: bytes.length,
      },
    });
    expect(readFileSync(result.attachment.path)).toEqual(bytes);
  });

  it('returns a data URL for an image stored inside the attachment directory', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'xmsgi-draft-store-'));
    temporaryDirectories.push(directory);
    const storeDirectory = path.join(directory, 'drafts');
    const bytes = Buffer.from('webp image bytes');
    const result = createDraftStore({ directory: storeDirectory }).writeAttachment('photo.webp', bytes);

    const preview = createDraftStore({ directory: storeDirectory }).readImageDataUrl(result.attachment.path);

    expect(preview).toEqual({
      success: true,
      dataUrl: `data:image/webp;base64,${bytes.toString('base64')}`,
    });
  });

  it('uses the JPEG MIME type for JFIF image previews', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'xmsgi-draft-store-'));
    temporaryDirectories.push(directory);
    const storeDirectory = path.join(directory, 'drafts');
    const bytes = Buffer.from('jfif image bytes');
    const result = createDraftStore({ directory: storeDirectory }).writeAttachment('photo.jfif', bytes);

    const preview = createDraftStore({ directory: storeDirectory }).readImageDataUrl(result.attachment.path);

    expect(preview).toEqual({
      success: true,
      dataUrl: `data:image/jpeg;base64,${bytes.toString('base64')}`,
    });
  });

  it('does not expose files outside the attachment directory as image previews', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'xmsgi-draft-store-'));
    temporaryDirectories.push(directory);
    const storeDirectory = path.join(directory, 'drafts');
    const outsideFile = path.join(directory, 'private.png');
    writeFileSync(outsideFile, 'private image bytes');

    const preview = createDraftStore({ directory: storeDirectory }).readImageDataUrl(outsideFile);

    expect(preview).toEqual({ success: false, error: 'Image is outside the app attachment store.' });
  });

  it('reports missing source files without an attachment result', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'xmsgi-draft-store-'));
    temporaryDirectories.push(directory);

    const result = createDraftStore({ directory }).copyAttachment(path.join(directory, 'missing.jpg'));

    expect(result).toEqual({ success: false, error: 'Source file does not exist.' });
  });
});
