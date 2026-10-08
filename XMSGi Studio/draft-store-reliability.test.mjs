import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createDraftStore } = require('./draft-store.cjs');
const temporaryDirectories = [];

function createDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'xmsgi-draft-reliability-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('draft store reliability', () => {
  it('saves and reads the existing draft store format', async () => {
    const directory = createDirectory();
    const store = createDraftStore({ directory });
    const data = {
      version: 2,
      drafts: [{ id: 'draft-1', name: 'Launch', body: 'Prepare announcement' }],
      backups: [],
      workspaceDraft: { body: 'Next post' },
    };

    await expect(store.save(data)).resolves.toEqual(data);
    expect(store.load()).toEqual(data);
  });

  it('recovers the latest committed data when the primary JSON is damaged', () => {
    const directory = createDirectory();
    const store = createDraftStore({ directory });
    const latest = {
      version: 1,
      drafts: [{ id: 'draft-1' }, { id: 'draft-2' }],
      backups: [],
    };
    store.saveSync({ version: 1, drafts: [{ id: 'draft-1' }], backups: [] });
    store.saveSync(latest);
    fs.writeFileSync(path.join(directory, 'drafts.json'), '{"drafts":[', 'utf8');

    expect(store.load()).toEqual(latest);
    expect(JSON.parse(fs.readFileSync(path.join(directory, 'drafts.json'), 'utf8'))).toEqual(latest);
  });

  it('does not turn unrecoverable corruption into an empty store', () => {
    const directory = createDirectory();
    const filePath = path.join(directory, 'drafts.json');
    fs.writeFileSync(filePath, '{"drafts":[', 'utf8');

    expect(() => createDraftStore({ directory }).load()).toThrow(/corrupt|recover/i);
    expect(fs.readFileSync(filePath, 'utf8')).toBe('{"drafts":[');
  });

  it('writes complete JSON through temporary files and leaves no partial temp file', () => {
    const directory = createDirectory();
    const store = createDraftStore({ directory });
    const data = { version: 1, drafts: [{ id: 'draft-safe' }], backups: [] };

    store.saveSync(data);

    expect(JSON.parse(fs.readFileSync(path.join(directory, 'drafts.json'), 'utf8'))).toEqual(data);
    expect(JSON.parse(fs.readFileSync(path.join(directory, 'drafts.json.bak'), 'utf8'))).toEqual(data);
    expect(fs.readdirSync(directory).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('keeps the current store intact when replacing the primary file fails', () => {
    const directory = createDirectory();
    const filePath = path.join(directory, 'drafts.json');
    const original = { version: 1, drafts: [{ id: 'kept' }], backups: [] };
    createDraftStore({ directory }).saveSync(original);

    const failingFileSystem = new Proxy(fs, {
      get(target, property) {
        if (property === 'renameSync') {
          return (source, destination) => {
            if (destination === filePath) throw new Error('Simulated atomic replace failure');
            return target.renameSync(source, destination);
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const failingStore = createDraftStore({ directory, fileSystem: failingFileSystem });

    expect(() => failingStore.saveSync({ version: 1, drafts: [{ id: 'lost' }], backups: [] }))
      .toThrow('Simulated atomic replace failure');
    expect(createDraftStore({ directory }).load()).toEqual(original);
    expect(fs.readdirSync(directory).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('preserves accumulated drafts across sequential saves', async () => {
    const store = createDraftStore({ directory: createDirectory() });
    const first = { id: 'draft-1' };
    const second = { id: 'draft-2' };
    await store.save({ version: 1, drafts: [first], backups: [] });
    await store.save({ version: 1, drafts: [first, second], backups: [] });

    expect(store.load().drafts).toEqual([first, second]);
  });

  it('preserves distinct attachments with the same basename copied in parallel', async () => {
    const root = createDirectory();
    const firstDirectory = path.join(root, 'first');
    const secondDirectory = path.join(root, 'second');
    const storeDirectory = path.join(root, 'drafts');
    fs.mkdirSync(firstDirectory);
    fs.mkdirSync(secondDirectory);
    const firstSource = path.join(firstDirectory, 'photo.png');
    const secondSource = path.join(secondDirectory, 'photo.png');
    fs.writeFileSync(firstSource, 'first image content');
    fs.writeFileSync(secondSource, 'second image content');

    const store = createDraftStore({ directory: storeDirectory });
    const [firstResult, secondResult] = await Promise.all([
      Promise.resolve().then(() => store.copyAttachment(firstSource)),
      Promise.resolve().then(() => store.copyAttachment(secondSource)),
    ]);
    expect(firstResult.success).toBe(true);
    expect(secondResult.success).toBe(true);
    if (!firstResult.attachment || !secondResult.attachment) throw new Error('Attachment copy failed.');
    const firstCopy = firstResult.attachment;
    const secondCopy = secondResult.attachment;

    expect(firstCopy.path).not.toBe(secondCopy.path);
    expect(fs.readFileSync(firstCopy.path, 'utf8')).toBe('first image content');
    expect(fs.readFileSync(secondCopy.path, 'utf8')).toBe('second image content');
  });
});