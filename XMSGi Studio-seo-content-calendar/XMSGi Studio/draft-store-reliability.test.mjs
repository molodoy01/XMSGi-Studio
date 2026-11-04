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

  it('does not restore a syntactically valid backup with an invalid draft structure', () => {
    const directory = createDirectory();
    const filePath = path.join(directory, 'drafts.json');
    const backupPath = `${filePath}.bak`;
    const damagedPrimary = '{"drafts":[';
    const invalidBackup = JSON.stringify({
      schemaVersion: 3,
      savedDrafts: [{ id: 'incomplete', name: 'Draft' }],
      workspaceDraft: null,
      documentHistories: {},
    });
    fs.writeFileSync(filePath, damagedPrimary, 'utf8');
    fs.writeFileSync(backupPath, invalidBackup, 'utf8');

    expect(() => createDraftStore({ directory }).load()).toThrow(/corrupt|recover/i);
    expect(fs.readFileSync(filePath, 'utf8')).toBe(damagedPrimary);
    expect(fs.readFileSync(backupPath, 'utf8')).toBe(invalidBackup);
  });

  it('does not overwrite an unreadable primary with an older backup', () => {
    const directory = createDirectory();
    const filePath = path.join(directory, 'drafts.json');
    const store = createDraftStore({ directory });
    store.saveSync({ version: 1, drafts: [{ id: 'primary' }], backups: [] });
    const originalPrimary = fs.readFileSync(filePath, 'utf8');
    const originalBackup = fs.readFileSync(`${filePath}.bak`, 'utf8');
    const failingFileSystem = new Proxy(fs, {
      get(target, property) {
        if (property === 'readFileSync') {
          return (file, ...args) => {
            if (file === filePath) {
              const error = new Error('Simulated read permission failure');
              error.code = 'EACCES';
              throw error;
            }
            return target.readFileSync(file, ...args);
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });

    expect(() => createDraftStore({ directory, fileSystem: failingFileSystem }).load())
      .toThrow(expect.objectContaining({ code: 'DRAFT_STORE_READ_FAILED' }));
    expect(fs.readFileSync(filePath, 'utf8')).toBe(originalPrimary);
    expect(fs.readFileSync(`${filePath}.bak`, 'utf8')).toBe(originalBackup);
  });

  it('preserves the source backup when restoring it to the primary fails', () => {
    const directory = createDirectory();
    const filePath = path.join(directory, 'drafts.json');
    const backupPath = `${filePath}.bak`;
    const store = createDraftStore({ directory });
    store.saveSync({ version: 1, drafts: [{ id: 'recoverable' }], backups: [] });
    const originalBackup = fs.readFileSync(backupPath, 'utf8');
    fs.writeFileSync(filePath, '{"drafts":[', 'utf8');
    const failingFileSystem = new Proxy(fs, {
      get(target, property) {
        if (property === 'renameSync') {
          return (source, destination) => {
            if (destination === filePath) throw new Error('Simulated recovery replace failure');
            return target.renameSync(source, destination);
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });

    expect(() => createDraftStore({ directory, fileSystem: failingFileSystem }).load())
      .toThrow(expect.objectContaining({ code: 'DRAFT_STORE_RECOVERY_FAILED' }));
    expect(fs.readFileSync(filePath, 'utf8')).toBe('{"drafts":[');
    expect(fs.readFileSync(backupPath, 'utf8')).toBe(originalBackup);
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

  it('reports backup update failures without hiding the successfully saved primary', () => {
    const directory = createDirectory();
    const filePath = path.join(directory, 'drafts.json');
    const backupPath = `${filePath}.bak`;
    const original = { version: 1, drafts: [{ id: 'original' }], backups: [] };
    const updated = { version: 1, drafts: [{ id: 'updated' }], backups: [] };
    createDraftStore({ directory }).saveSync(original);
    const originalBackup = fs.readFileSync(backupPath, 'utf8');
    const failingFileSystem = new Proxy(fs, {
      get(target, property) {
        if (property === 'renameSync') {
          return (source, destination) => {
            if (destination === backupPath) throw new Error('Simulated backup replace failure');
            return target.renameSync(source, destination);
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });

    let saveError;
    try {
      createDraftStore({ directory, fileSystem: failingFileSystem }).saveSync(updated);
    } catch (error) {
      saveError = error;
    }

    expect(saveError).toMatchObject({
      code: 'DRAFT_STORE_BACKUP_UPDATE_FAILED',
      message: 'Drafts were saved, but the backup could not be updated.',
    });
    expect(JSON.parse(fs.readFileSync(filePath, 'utf8'))).toEqual(updated);
    expect(fs.readFileSync(backupPath, 'utf8')).toBe(originalBackup);
    expect(createDraftStore({ directory }).load()).toEqual(updated);
    expect(fs.readdirSync(directory).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('reports initial backup creation failures after preserving the primary write', () => {
    const directory = createDirectory();
    const filePath = path.join(directory, 'drafts.json');
    const backupPath = `${filePath}.bak`;
    const data = { version: 1, drafts: [{ id: 'saved-primary' }], backups: [] };
    const failingFileSystem = new Proxy(fs, {
      get(target, property) {
        if (property === 'renameSync') {
          return (source, destination) => {
            if (destination === backupPath) throw new Error('Simulated backup creation failure');
            return target.renameSync(source, destination);
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });

    expect(() => createDraftStore({ directory, fileSystem: failingFileSystem }).saveSync(data))
      .toThrow(expect.objectContaining({ code: 'DRAFT_STORE_BACKUP_UPDATE_FAILED' }));
    expect(JSON.parse(fs.readFileSync(filePath, 'utf8'))).toEqual(data);
    expect(fs.existsSync(backupPath)).toBe(false);
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

  it('reuses an attachment already inside the persistent draft directory', () => {
    const root = createDirectory();
    const sourcePath = path.join(root, 'source.pdf');
    const storeDirectory = path.join(root, 'drafts');
    fs.writeFileSync(sourcePath, 'persistent attachment bytes');
    const store = createDraftStore({ directory: storeDirectory });
    const copied = store.copyAttachment(sourcePath);
    if (!copied.attachment) throw new Error('Initial attachment copy failed.');

    const verified = store.copyAttachment(copied.attachment.path);

    expect(verified.attachment?.path).toBe(copied.attachment.path);
    expect(fs.readdirSync(storeDirectory).filter((name) => name.startsWith('source'))).toEqual(['source.pdf']);
    expect(fs.readFileSync(copied.attachment.path, 'utf8')).toBe('persistent attachment bytes');
  });

  it('persists document histories across reload and never deletes their attachment copies', () => {
    const root = createDirectory();
    const sourcePath = path.join(root, 'original.png');
    const storeDirectory = path.join(root, 'drafts');
    fs.writeFileSync(sourcePath, 'image history bytes');
    const store = createDraftStore({ directory: storeDirectory });
    const copied = store.copyAttachment(sourcePath);
    if (!copied.attachment) throw new Error('Attachment copy failed.');
    const version = {
      id: 'version-1',
      documentId: 'document-1',
      createdAt: '2026-10-01T12:00:00.000Z',
      reason: 'edit',
      snapshot: {
        documentId: 'document-1',
        body: 'Post with image',
        entities: [],
        attachments: [{ name: 'original.png', path: copied.attachment.path, position: 0 }],
      },
    };
    store.saveSync({
      schemaVersion: 3,
      migrationVersion: 1,
      savedDrafts: [],
      workspaceDraft: null,
      documentHistories: { 'document-1': [version] },
    });

    const reloadedStore = createDraftStore({ directory: storeDirectory });
    expect(reloadedStore.load().documentHistories['document-1']).toEqual([version]);
    reloadedStore.saveSync({
      ...reloadedStore.load(),
      documentHistories: { 'document-1': [] },
    });

    expect(fs.existsSync(copied.attachment.path)).toBe(true);
    expect(fs.readFileSync(copied.attachment.path, 'utf8')).toBe('image history bytes');
  });

  it('merges imported document histories without replacing other document IDs', () => {
    const root = createDirectory();
    const store = createDraftStore({ directory: path.join(root, 'drafts') });
    const version = (id, documentId, body, createdAt) => ({
      id,
      documentId,
      createdAt,
      reason: 'edit',
      snapshot: { documentId, body, attachments: [] },
    });
    store.saveSync({
      schemaVersion: 3,
      migrationVersion: 1,
      drafts: [],
      backups: [],
      documentHistories: {
        first: [version('first-1', 'first', 'Local first', '2026-10-01T10:00:00.000Z')],
        second: [version('second-1', 'second', 'Local second', '2026-10-01T11:00:00.000Z')],
      },
    });
    const backupPath = path.join(root, 'history-backup.json');
    fs.writeFileSync(backupPath, JSON.stringify({
      schemaVersion: 3,
      migrationVersion: 1,
      drafts: [],
      backups: [],
      documentHistories: {
        first: [version('first-2', 'first', 'Imported first', '2026-10-01T12:00:00.000Z')],
        third: [version('third-1', 'third', 'Imported third', '2026-10-01T13:00:00.000Z')],
      },
    }));

    const imported = store.importFrom(backupPath, 'merge');

    expect(imported.store.documentHistories.first.map(({ id }) => id)).toEqual(['first-1', 'first-2']);
    expect(imported.store.documentHistories.second.map(({ id }) => id)).toEqual(['second-1']);
    expect(imported.store.documentHistories.third.map(({ id }) => id)).toEqual(['third-1']);
  });

  it('marks imported attachments outside the app store as unavailable', () => {
    const root = createDirectory();
    const storeDirectory = path.join(root, 'drafts');
    const sourcePath = path.join(root, 'private.txt');
    const backupPath = path.join(root, 'backup.json');
    fs.writeFileSync(sourcePath, 'private content');
    fs.writeFileSync(backupPath, JSON.stringify({
      schemaVersion: 3,
      savedDrafts: [{
        id: 'imported',
        name: 'Imported draft',
        body: '',
        createdAt: '2026-10-01T10:00:00.000Z',
        updatedAt: '2026-10-01T10:00:00.000Z',
        attachments: [
          { name: 'private.txt', path: sourcePath },
          'data:image/png;base64,ZmFrZQ==',
        ],
      }],
      workspaceDraft: null,
      documentHistories: {},
    }));

    const imported = createDraftStore({ directory: storeDirectory }).importFrom(backupPath, 'replace');

    expect(imported.store.savedDrafts[0].attachments[0]).toMatchObject({
      name: 'private.txt',
      path: '',
      unavailable: true,
    });
    expect(imported.store.savedDrafts[0].attachments[1]).toMatchObject({
      path: '',
      unavailable: true,
    });
    expect(fs.readdirSync(storeDirectory)).toEqual(['drafts.json', 'drafts.json.bak']);
    expect(fs.readFileSync(sourcePath, 'utf8')).toBe('private content');
  });

  it('preserves imported attachment paths that resolve inside the app store', () => {
    const root = createDirectory();
    const storeDirectory = path.join(root, 'drafts');
    fs.mkdirSync(storeDirectory);
    const sourcePath = path.join(storeDirectory, 'photo.png');
    const backupPath = path.join(root, 'backup.json');
    fs.writeFileSync(sourcePath, 'image bytes');
    fs.writeFileSync(backupPath, JSON.stringify({
      schemaVersion: 3,
      savedDrafts: [{
        id: 'imported',
        name: 'Imported draft',
        body: '',
        createdAt: '2026-10-01T10:00:00.000Z',
        updatedAt: '2026-10-01T10:00:00.000Z',
        attachments: [{ name: 'photo.png', path: sourcePath }],
      }],
      workspaceDraft: null,
      documentHistories: {},
    }));

    const imported = createDraftStore({ directory: storeDirectory }).importFrom(backupPath, 'replace');

    expect(imported.store.savedDrafts[0].attachments[0]).toMatchObject({
      name: 'photo.png',
      path: fs.realpathSync(sourcePath),
    });
    expect(imported.store.savedDrafts[0].attachments[0]).not.toHaveProperty('unavailable');
  });
});