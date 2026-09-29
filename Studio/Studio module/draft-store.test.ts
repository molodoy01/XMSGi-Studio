import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { DRAFT_STORE_SCHEMA_VERSION } from './src/lib/draftStoreVersion';

const require = createRequire(import.meta.url);
const { createDraftStore, SCHEMA_VERSION } = require('./draft-store.cjs') as {
  SCHEMA_VERSION: number;
  createDraftStore: (options: { directory: string; backupCount?: number }) => {
    load: () => { success: boolean; store?: any; needsMigration?: boolean; schemaMigrated?: boolean; backupIndexes?: number[] };
    save: (store: any) => Promise<any>;
    migrate: (legacy: any) => any;
    restoreBackup: (index: number) => any;
    exportTo: (target: string) => any;
    exportTextTo: (target: string, text: string) => any;
    importTextFrom: (source: string) => any;
    importFrom: (source: string, strategy: 'merge' | 'replace') => any;
    copyAttachment: (source: string) => any;
    filePath: string;
    backupPath: (index: number) => string;
  };
};

const directories: string[] = [];

function createTempStore() {
  const directory = mkdtempSync(join(tmpdir(), 'awaitmsg-drafts-'));
  directories.push(directory);
  return { directory, store: createDraftStore({ directory }) };
}

function baseStore(body = 'Hello') {
  return {
    schemaVersion: 2,
    migrationVersion: 1,
    savedDrafts: [{
      id: 'draft-1',
      name: 'Follow-up',
      color: 'teal',
      body,
      entities: [{ type: 'bold', offset: 0, length: 5 }],
      attachments: [],
      selectedChat: { id: 'chat-1', name: 'Studio' },
      inlineButtons: [],
      date: '2026-01-10',
      time: '09:00',
      repeatMode: 'none',
      repeatDays: [],
      repeatOccurrences: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }],
    workspaceDraft: {
      body: 'Unsaved editor text',
      entities: [],
      attachments: [],
      selectedChat: null,
      inlineButtons: [],
      date: '',
      time: '',
      repeatMode: 'none',
      repeatDays: [],
      repeatOccurrences: 1,
      savedAt: '12:00',
    },
  };
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('Electron draft file store', () => {
  it('starts empty and round-trips complete saved and workspace drafts', async () => {
    const { store } = createTempStore();

    expect(SCHEMA_VERSION).toBe(DRAFT_STORE_SCHEMA_VERSION);
    expect(store.load()).toMatchObject({ success: true, needsMigration: true, store: { savedDrafts: [] } });
    await store.save(baseStore());

    expect(store.load()).toMatchObject({ success: true, needsMigration: false, schemaMigrated: false, store: baseStore() });
  });

  it('migrates schema v1 to the current version once and preserves a backup', () => {
    const { store } = createTempStore();
    const previousVersion = { ...baseStore('Saved before version 2'), schemaVersion: 1 };
    const previousContents = JSON.stringify(previousVersion);
    writeFileSync(store.filePath, previousContents);

    const migrated = store.load();

    expect(migrated).toMatchObject({
      success: true,
      needsMigration: false,
      schemaMigrated: true,
      store: {
        schemaVersion: 2,
        migrationVersion: previousVersion.migrationVersion,
        savedDrafts: [{ id: 'draft-1', body: 'Saved before version 2' }],
        workspaceDraft: { body: 'Unsaved editor text' },
      },
    });
    expect(readFileSync(store.backupPath(1), 'utf8')).toBe(previousContents);

    const currentContents = readFileSync(store.filePath, 'utf8');
    expect(store.load()).toMatchObject({ success: true, schemaMigrated: false, store: { schemaVersion: 2 } });
    expect(readFileSync(store.filePath, 'utf8')).toBe(currentContents);
  });

  it.each([
    ['malformed', '2'],
    ['unknown future', 99],
  ])('preserves storage with a %s schema version', (_label, schemaVersion) => {
    const { store } = createTempStore();
    const unsupported = { ...baseStore(), schemaVersion };
    const originalContents = JSON.stringify(unsupported);
    writeFileSync(store.filePath, originalContents);

    expect(store.load()).toMatchObject({ success: false, code: 'CORRUPT' });
    expect(readFileSync(store.filePath, 'utf8')).toBe(originalContents);
  });

  it('migrates legacy data once and keeps the original data available to the caller', () => {
    const { store } = createTempStore();
    const legacy = {
      savedDrafts: [{ id: 'old-1', name: 'Old', body: 'Legacy text' }],
      workspaceDraft: { body: 'Recovered text', savedAt: '10:00' },
    };

    const migrated = store.migrate(legacy);
    const repeated = store.migrate({ savedDrafts: [], workspaceDraft: null });

    expect(migrated).toMatchObject({ success: true, migrated: true });
    expect(migrated.store.savedDrafts[0]).toMatchObject({ id: 'old-1', body: 'Legacy text', color: 'gray', attachments: [], repeatMode: 'none' });
    expect(migrated.store.workspaceDraft).toMatchObject({ body: 'Recovered text', savedAt: '10:00' });
    expect(repeated).toMatchObject({ success: true, migrated: false });
    expect(repeated.store.savedDrafts).toHaveLength(1);
  });

  it('moves legacy attachment paths into managed app storage during migration', () => {
    const { directory, store } = createTempStore();
    const legacyAttachment = join(directory, 'legacy.pdf');
    writeFileSync(legacyAttachment, 'legacy attachment');

    const migrated = store.migrate({
      savedDrafts: [],
      workspaceDraft: {
        body: 'Legacy post',
        attachments: [{ name: 'legacy.pdf', path: legacyAttachment, size: 17 }],
      },
    });

    const storedAttachment = migrated.store.workspaceDraft.attachments[0];
    expect(migrated.success).toBe(true);
    expect(storedAttachment.path).not.toBe(legacyAttachment);
    expect(storedAttachment.path.startsWith(join(directory, 'attachments'))).toBe(true);
    expect(readFileSync(storedAttachment.path, 'utf8')).toBe('legacy attachment');
  });

  it('tolerates an empty legacy workspace draft during migration', () => {
    const { store } = createTempStore();

    const migrated = store.migrate({
      savedDrafts: [{ id: 'old-1', name: 'Old', body: 'Legacy text' }],
      workspaceDraft: {},
    });

    expect(migrated.success).toBe(true);
    expect(migrated.store.workspaceDraft).toMatchObject({ body: '', savedAt: '' });
    expect(migrated.store.savedDrafts[0]).toMatchObject({ id: 'old-1', body: 'Legacy text' });
  });

  it('keeps corruption visible and restores only from a validated backup', async () => {
    const { store } = createTempStore();
    await store.save(baseStore('First version'));
    await store.save(baseStore('Second version'));
    writeFileSync(store.filePath, '{not json');

    expect(store.load()).toMatchObject({ success: false, code: 'CORRUPT', backupIndexes: [1] });
    expect(store.restoreBackup(1)).toMatchObject({ success: true, store: { savedDrafts: [{ body: 'First version' }] } });
    expect(store.load()).toMatchObject({ success: true, store: { savedDrafts: [{ body: 'First version' }] } });
  });

  it('exports and imports a validated backup with merge and replace strategies', async () => {
    const source = createTempStore();
    const target = createTempStore();
    const backupPath = join(source.directory, 'backup.json');
    await source.store.save(baseStore('Exported text'));

    expect(source.store.exportTo(backupPath)).toEqual({ success: true });
    await target.store.save(baseStore('Existing text'));
    const merged = target.store.importFrom(backupPath, 'merge');

    expect(merged.store.savedDrafts).toHaveLength(1);
    expect(merged.store.savedDrafts[0].body).toBe('Exported text');

    const replacementPath = join(source.directory, 'replacement.json');
    writeFileSync(replacementPath, JSON.stringify(baseStore('Replacement text')));
    const replaced = target.store.importFrom(replacementPath, 'replace');

    expect(replaced.store.savedDrafts[0].body).toBe('Replacement text');
    expect(readFileSync(target.store.filePath, 'utf8')).toContain('Replacement text');
  });

  it('does not silently accept an invalid import', async () => {
    const { directory, store } = createTempStore();
    await store.save(baseStore('Safe text'));
    const invalidBackup = join(directory, 'invalid.json');
    writeFileSync(invalidBackup, JSON.stringify({ schemaVersion: 999, savedDrafts: [] }));

    expect(store.importFrom(invalidBackup, 'replace')).toMatchObject({ success: false, code: 'IMPORT_FAILED' });
    expect(store.load()).toMatchObject({ success: true, store: { savedDrafts: [{ body: 'Safe text' }] } });
  });

  it('copies attachments into managed storage and includes their bytes in exported backups', async () => {
    const source = createTempStore();
    const target = createTempStore();
    const sourceFile = join(source.directory, 'photo.png');
    writeFileSync(sourceFile, 'image bytes');
    const copied = source.store.copyAttachment(sourceFile);

    expect(copied.success).toBe(true);
    expect(copied.attachment.path).not.toBe(sourceFile);
    expect(existsSync(copied.attachment.path)).toBe(true);

    const withAttachment = baseStore();
    withAttachment.savedDrafts[0].attachments = [copied.attachment];
    await source.store.save(withAttachment);
    const backupPath = join(source.directory, 'with-media.json');
    expect(source.store.exportTo(backupPath)).toEqual({ success: true });
    const imported = target.store.importFrom(backupPath, 'replace');
    const importedAttachment = imported.store.savedDrafts[0].attachments[0];

    expect(readFileSync(importedAttachment.path, 'utf8')).toBe('image bytes');
    expect(importedAttachment.path).not.toBe(copied.attachment.path);
  });

  it('reports a disk write failure without overwriting the path that blocked storage', async () => {
    const blocker = join(tmpdir(), `awaitmsg-draft-file-${Date.now()}`);
    writeFileSync(blocker, 'keep this file');
    directories.push(blocker);
    const store = createDraftStore({ directory: blocker });

    await expect(store.save(baseStore())).rejects.toThrow();
    expect(readFileSync(blocker, 'utf8')).toBe('keep this file');
  });

  it('round-trips UTF-8 text documents and strips a UTF-8 BOM on import', () => {
    const { directory, store } = createTempStore();
    const exportPath = join(directory, 'message.txt');
    const text = 'Привет, редактор!\nВторая строка';

    expect(store.exportTextTo(exportPath, text)).toEqual({ success: true });
    expect(readFileSync(exportPath, 'utf8')).toBe(text);
    expect(store.importTextFrom(exportPath)).toEqual({ success: true, text });

    const bomPath = join(directory, 'bom.txt');
    writeFileSync(bomPath, '\uFEFFText with BOM');
    expect(store.importTextFrom(bomPath)).toEqual({ success: true, text: 'Text with BOM' });
  });

  it('rejects binary content and files with non-text extensions', () => {
    const { directory, store } = createTempStore();
    const binaryPath = join(directory, 'binary.txt');
    const wrongExtensionPath = join(directory, 'message.md');
    writeFileSync(binaryPath, Buffer.from([0x41, 0x00, 0x42]));
    writeFileSync(wrongExtensionPath, 'plain text');

    expect(store.importTextFrom(binaryPath)).toMatchObject({ success: false, code: 'TEXT_IMPORT_FAILED' });
    expect(store.importTextFrom(wrongExtensionPath)).toMatchObject({ success: false, code: 'TEXT_IMPORT_FAILED' });
  });
});
