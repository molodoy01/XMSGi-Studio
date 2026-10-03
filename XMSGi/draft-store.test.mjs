import { afterEach, describe, expect, it } from 'vitest';
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

  it('reports missing source files without an attachment result', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'xmsgi-draft-store-'));
    temporaryDirectories.push(directory);

    const result = createDraftStore({ directory }).copyAttachment(path.join(directory, 'missing.jpg'));

    expect(result).toEqual({ success: false, error: 'Source file does not exist.' });
  });
});
