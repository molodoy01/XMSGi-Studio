const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SCHEMA_VERSION = 2;
const MIGRATION_VERSION = 1;
const REPEAT_MODES = new Set(['none', 'daily', 'weekly', 'biweekly', 'monthly']);
const ENTITY_TYPES = new Set(['bold', 'italic', 'underline', 'strikethrough', 'text_url']);
const DRAFT_COLORS = new Set(['gray', 'coral', 'amber', 'green', 'teal', 'blue']);
const MAX_TEXT_DOCUMENT_BYTES = 2 * 1024 * 1024;

function defaultStore() {
  return {
    schemaVersion: SCHEMA_VERSION,
    migrationVersion: 0,
    savedDrafts: [],
    workspaceDraft: null,
  };
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function migrateV1ToV2(value) {
  return { ...value, schemaVersion: 2 };
}

const SCHEMA_MIGRATIONS = new Map([
  [1, migrateV1ToV2],
]);

function migrateSchema(value) {
  if (!isRecord(value) || !Number.isInteger(value.schemaVersion)) {
    throw new Error('Draft store has an invalid schema version.');
  }
  if (value.schemaVersion < 1 || value.schemaVersion > SCHEMA_VERSION) {
    throw new Error(`Draft store schema version ${value.schemaVersion} is unsupported.`);
  }

  let migrated = value;
  while (migrated.schemaVersion < SCHEMA_VERSION) {
    const migration = SCHEMA_MIGRATIONS.get(migrated.schemaVersion);
    if (!migration) {
      throw new Error(`Draft store schema version ${migrated.schemaVersion} cannot be migrated.`);
    }
    migrated = migration(migrated);
  }
  return migrated;
}

function normalizeEntities(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('Draft entities must be an array.');

  return value.map((entity) => {
    if (!isRecord(entity)
      || !ENTITY_TYPES.has(entity.type)
      || !Number.isInteger(entity.offset)
      || entity.offset < 0
      || !Number.isInteger(entity.length)
      || entity.length < 0
      || (entity.url !== undefined && typeof entity.url !== 'string')) {
      throw new Error('Draft contains invalid rich-text formatting.');
    }
    return { type: entity.type, offset: entity.offset, length: entity.length, ...(entity.url ? { url: entity.url } : {}) };
  });
}

function normalizeAttachments(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('Draft attachments must be an array.');

  return value.map((attachment) => {
    if (!isRecord(attachment)
      || typeof attachment.name !== 'string'
      || typeof attachment.path !== 'string'
      || (attachment.size !== undefined && (!Number.isFinite(attachment.size) || attachment.size < 0))) {
      throw new Error('Draft contains an invalid attachment reference.');
    }
    const extension = attachment.name.split('.').pop()?.toLowerCase();
    const imageMimeTypes = {
      avif: 'image/avif',
      gif: 'image/gif',
      jpeg: 'image/jpeg',
      jpg: 'image/jpeg',
      png: 'image/png',
      webp: 'image/webp',
    };
    const mimeType = typeof attachment.mimeType === 'string' && attachment.mimeType
      ? attachment.mimeType
      : imageMimeTypes[extension] || 'application/octet-stream';
    return {
      id: typeof attachment.id === 'string' && attachment.id ? attachment.id : crypto.randomUUID(),
      type: attachment.type === 'image' || attachment.type === 'file'
        ? attachment.type
        : mimeType.startsWith('image/') ? 'image' : 'file',
      name: attachment.name,
      mimeType,
      path: attachment.path,
      size: attachment.size === undefined ? 0 : attachment.size,
      ...(typeof attachment.previewUrl === 'string' ? { previewUrl: attachment.previewUrl } : {}),
      position: Number.isFinite(attachment.position) ? Math.max(0, attachment.position) : 0,
    };
  });
}

function normalizeChat(value) {
  if (value === undefined || value === null) return null;
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string') {
    throw new Error('Draft contains an invalid chat reference.');
  }
  return {
    id: value.id,
    name: value.name,
    ...(typeof value.username === 'string' ? { username: value.username } : {}),
    ...(typeof value.type === 'string' ? { type: value.type } : {}),
    ...(typeof value.avatarDataUrl === 'string' ? { avatarDataUrl: value.avatarDataUrl } : {}),
  };
}

function normalizeInlineButtons(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('Draft inline buttons must be an array.');

  return value.map((row) => {
    if (!Array.isArray(row)) throw new Error('Draft contains an invalid inline button row.');
    return row.map((button) => {
      if (!isRecord(button)
        || typeof button.id !== 'string'
        || typeof button.label !== 'string'
        || !isRecord(button.action)
        || !['url', 'callback'].includes(button.action.type)
        || typeof button.action.value !== 'string') {
        throw new Error('Draft contains an invalid inline button.');
      }
      return {
        id: button.id,
        label: button.label,
        action: { type: button.action.type, value: button.action.value },
      };
    });
  });
}

function normalizeComposerData(value) {
  if (!isRecord(value)) {
    throw new Error('Draft content is missing or invalid.');
  }

  const body = value.body === undefined ? '' : value.body;
  if (typeof body !== 'string') {
    throw new Error('Draft content is missing or invalid.');
  }

  const repeatMode = value.repeatMode === undefined ? 'none' : value.repeatMode;
  if (!REPEAT_MODES.has(repeatMode)) throw new Error('Draft repeat mode is invalid.');

  return {
    body,
    entities: normalizeEntities(value.entities),
    attachments: normalizeAttachments(value.attachments),
    selectedChat: normalizeChat(value.selectedChat),
    inlineButtons: normalizeInlineButtons(value.inlineButtons),
    date: typeof value.date === 'string' ? value.date : '',
    time: typeof value.time === 'string' ? value.time : '',
    repeatMode,
    repeatDays: Array.isArray(value.repeatDays) && value.repeatDays.every((day) => typeof day === 'string') ? value.repeatDays : [],
    repeatOccurrences: Number.isInteger(value.repeatOccurrences) && value.repeatOccurrences > 0 ? value.repeatOccurrences : 1,
  };
}

function normalizeSavedDraft(value) {
  if (!isRecord(value)
    || typeof value.id !== 'string'
    || typeof value.name !== 'string'
    || typeof value.createdAt !== 'string'
    || typeof value.updatedAt !== 'string') {
    throw new Error('Saved Draft entry is invalid.');
  }
  return {
    id: value.id,
    name: value.name,
    color: DRAFT_COLORS.has(value.color) ? value.color : 'gray',
    ...normalizeComposerData(value),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function normalizeWorkspaceDraft(value) {
  if (value === null || value === undefined) return null;
  const composer = normalizeComposerData(value);
  return {
    ...composer,
    savedAt: typeof value.savedAt === 'string' ? value.savedAt : '',
  };
}

function validateStore(value) {
  const current = migrateSchema(value);
  if (!Number.isInteger(current.migrationVersion)
    || current.migrationVersion < 0
    || !Array.isArray(current.savedDrafts)) {
    throw new Error('Draft store has an unsupported or invalid format.');
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    migrationVersion: current.migrationVersion,
    savedDrafts: current.savedDrafts.map(normalizeSavedDraft),
    workspaceDraft: normalizeWorkspaceDraft(current.workspaceDraft),
  };
}

function createDraftStore({ directory, fsImpl = fs, pathImpl = path, backupCount = 5 }) {
  if (!directory) throw new Error('A draft-store directory is required.');
  const root = pathImpl.resolve(directory);
  const filePath = pathImpl.join(root, 'draft-store.json');
  const attachmentsDirectory = pathImpl.join(root, 'attachments');
  const backupPath = (index) => pathImpl.join(root, `draft-store.backup.${index}.json`);
  let saveQueue = Promise.resolve();

  function isManagedAttachment(target) {
    const relative = pathImpl.relative(attachmentsDirectory, pathImpl.resolve(target));
    if (!relative || relative.startsWith('..') || pathImpl.isAbsolute(relative)) return false;
    try {
      const stats = fsImpl.lstatSync(target);
      return stats.isFile() && !stats.isSymbolicLink();
    } catch {
      return false;
    }
  }

  function copyDraftAttachments(draft) {
    if (!draft) return;
    draft.attachments = draft.attachments.map((attachment) => {
      if (isManagedAttachment(attachment.path)) return attachment;
      const copied = copyAttachment(attachment.path);
      if (!copied.success) throw new Error(`Attachment migration failed: ${copied.error}`);
      return { ...attachment, ...copied.attachment };
    });
  }

  function readFile(target) {
    return validateStore(JSON.parse(fsImpl.readFileSync(target, 'utf8')));
  }

  function validBackupIndexes() {
    const indexes = [];
    for (let index = 1; index <= backupCount; index += 1) {
      try {
        readFile(backupPath(index));
        indexes.push(index);
      } catch {
        // A bad backup is not a recovery source.
      }
    }
    return indexes;
  }

  function atomicWrite(target, contents) {
    fsImpl.mkdirSync(pathImpl.dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    let descriptor;
    try {
      descriptor = fsImpl.openSync(temporary, 'wx', 0o600);
      fsImpl.writeFileSync(descriptor, contents, 'utf8');
      fsImpl.fsyncSync(descriptor);
      fsImpl.closeSync(descriptor);
      descriptor = undefined;
      fsImpl.renameSync(temporary, target);
    } catch (error) {
      if (descriptor !== undefined) fsImpl.closeSync(descriptor);
      try { fsImpl.unlinkSync(temporary); } catch { /* Ignore temporary-file cleanup errors. */ }
      throw error;
    }
  }

  function rotateBackups() {
    if (!fsImpl.existsSync(filePath)) return;
    const contents = fsImpl.readFileSync(filePath, 'utf8');
    readFile(filePath);
    for (let index = backupCount; index > 1; index -= 1) {
      const previous = backupPath(index - 1);
      if (fsImpl.existsSync(previous)) {
        atomicWrite(backupPath(index), fsImpl.readFileSync(previous, 'utf8'));
      }
    }
    atomicWrite(backupPath(1), contents);
  }

  function writeStore(value, { rotate = true } = {}) {
    const store = validateStore(value);
    const allDrafts = [...store.savedDrafts, ...(store.workspaceDraft ? [store.workspaceDraft] : [])];
    for (const draft of allDrafts) {
      for (const attachment of draft.attachments) {
        if (!isManagedAttachment(attachment.path)) {
          throw new Error('Draft attachment is not stored in the managed data folder.');
        }
      }
    }
    const contents = JSON.stringify(store, null, 2);
    if (rotate) rotateBackups();
    atomicWrite(filePath, contents);
    return readFile(filePath);
  }

  function load() {
    if (!fsImpl.existsSync(filePath)) {
      return { success: true, store: defaultStore(), needsMigration: true, recovered: false };
    }
    try {
      const stored = JSON.parse(fsImpl.readFileSync(filePath, 'utf8'));
      const schemaMigrated = stored?.schemaVersion < SCHEMA_VERSION;
      const store = validateStore(stored);
      if (schemaMigrated) {
        try {
          const saved = writeStore(store);
          return { success: true, store: saved, needsMigration: false, schemaMigrated: true, recovered: false };
        } catch (error) {
          return {
            success: false,
            code: 'MIGRATION_FAILED',
            error: error instanceof Error ? error.message : 'Draft store migration could not be saved.',
            backupIndexes: validBackupIndexes(),
          };
        }
      }
      return { success: true, store, needsMigration: false, schemaMigrated: false, recovered: false };
    } catch (error) {
      return {
        success: false,
        code: 'CORRUPT',
        error: error instanceof Error ? error.message : 'Draft store could not be read.',
        backupIndexes: validBackupIndexes(),
      };
    }
  }

  function save(value) {
    const operation = saveQueue.then(() => writeStore(value));
    saveQueue = operation.catch(() => undefined);
    return operation;
  }

  function saveSync(value) {
    return writeStore(value);
  }

  function migrate(legacy) {
    const loaded = load();
    if (!loaded.success) return loaded;
    if (!loaded.needsMigration && loaded.store.migrationVersion >= MIGRATION_VERSION) {
      return { success: true, store: loaded.store, migrated: false };
    }

    const current = loaded.store;
    const legacyDrafts = Array.isArray(legacy?.savedDrafts) ? legacy.savedDrafts : [];
    const knownIds = new Set(current.savedDrafts.map((draft) => draft.id));
    const migratedDrafts = legacyDrafts.map((draft, index) => {
      const source = isRecord(draft) ? draft : {};
      const now = typeof source.updatedAt === 'string' ? source.updatedAt : new Date().toISOString();
      return normalizeSavedDraft({
        ...source,
        id: typeof source.id === 'string' ? source.id : `migrated-${index}-${crypto.randomBytes(4).toString('hex')}`,
        name: typeof source.name === 'string' && source.name.trim() ? source.name : `Draft ${index + 1}`,
        createdAt: typeof source.createdAt === 'string' ? source.createdAt : now,
        updatedAt: now,
      });
    }).filter((draft) => !knownIds.has(draft.id));

    const store = {
      ...current,
      migrationVersion: MIGRATION_VERSION,
      savedDrafts: [...current.savedDrafts, ...migratedDrafts],
      workspaceDraft: current.workspaceDraft ?? normalizeWorkspaceDraft(legacy?.workspaceDraft),
    };

    try {
      store.savedDrafts.forEach(copyDraftAttachments);
      copyDraftAttachments(store.workspaceDraft);
      const saved = writeStore(store, { rotate: fsImpl.existsSync(filePath) });
      return { success: true, store: saved, migrated: true };
    } catch (error) {
      return { success: false, code: 'WRITE_FAILED', error: error instanceof Error ? error.message : 'Draft migration could not be saved.' };
    }
  }

  function restoreBackup(index) {
    if (!Number.isInteger(index) || index < 1 || index > backupCount) {
      return { success: false, code: 'INVALID_BACKUP', error: 'Backup selection is invalid.' };
    }
    try {
      const store = readFile(backupPath(index));
      const restored = writeStore(store, { rotate: false });
      return { success: true, store: restored };
    } catch (error) {
      return { success: false, code: 'RESTORE_FAILED', error: error instanceof Error ? error.message : 'Backup could not be restored.' };
    }
  }

  function exportTo(target) {
    try {
      const loaded = load();
      if (!loaded.success) return loaded;
      const attachments = new Map();
      let attachmentBytes = 0;
      const collect = (draft) => {
        for (const attachment of draft?.attachments ?? []) {
          if (attachments.has(attachment.path)) continue;
          const data = fsImpl.readFileSync(attachment.path);
          attachmentBytes += data.length;
          if (data.length > 50 * 1024 * 1024 || attachmentBytes > 250 * 1024 * 1024) {
            throw new Error('Draft attachments exceed the supported backup size.');
          }
          attachments.set(attachment.path, {
            path: attachment.path,
            name: attachment.name,
            data: data.toString('base64'),
          });
        }
      };
      loaded.store.savedDrafts.forEach(collect);
      collect(loaded.store.workspaceDraft);
      const backup = {
        backupVersion: 1,
        store: loaded.store,
        attachments: [...attachments.values()],
      };
      atomicWrite(pathImpl.resolve(target), JSON.stringify(backup));
      return { success: true };
    } catch (error) {
      return { success: false, code: 'EXPORT_FAILED', error: error instanceof Error ? error.message : 'Draft backup could not be exported.' };
    }
  }

  function exportTextTo(target, text) {
    try {
      if (typeof text !== 'string') throw new Error('Editor text is invalid.');
      if (pathImpl.extname(target).toLowerCase() !== '.txt') throw new Error('Text export requires a .txt file.');
      if (Buffer.byteLength(text, 'utf8') > MAX_TEXT_DOCUMENT_BYTES) throw new Error('Text file exceeds the 2 MB limit.');
      atomicWrite(pathImpl.resolve(target), text);
      return { success: true };
    } catch (error) {
      return { success: false, code: 'TEXT_EXPORT_FAILED', error: error instanceof Error ? error.message : 'Text could not be exported.' };
    }
  }

  function importTextFrom(source) {
    try {
      if (pathImpl.extname(source).toLowerCase() !== '.txt') throw new Error('Choose a .txt file.');
      const stats = fsImpl.statSync(source);
      if (!stats.isFile() || stats.size > MAX_TEXT_DOCUMENT_BYTES) throw new Error('Text file exceeds the 2 MB limit.');
      const bytes = fsImpl.readFileSync(source);
      if (bytes.includes(0)) throw new Error('The selected file is not plain text.');
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
      return { success: true, text };
    } catch (error) {
      return { success: false, code: 'TEXT_IMPORT_FAILED', error: error instanceof Error ? error.message : 'Text file could not be imported.' };
    }
  }

  function importFrom(source, strategy) {
    try {
      if (strategy !== 'merge' && strategy !== 'replace') throw new Error('Import strategy is invalid.');
      const parsed = JSON.parse(fsImpl.readFileSync(source, 'utf8'));
      const imported = validateStore(parsed?.backupVersion === 1 ? parsed.store : parsed);
      const importedAttachments = parsed?.backupVersion === 1 ? parsed.attachments : [];
      if (!Array.isArray(importedAttachments)) throw new Error('Backup attachments are invalid.');
      const attachmentPaths = new Map();
      const bundledPaths = new Set();
      let attachmentBytes = 0;
      for (const item of importedAttachments) {
        if (!isRecord(item) || typeof item.path !== 'string' || typeof item.name !== 'string' || typeof item.data !== 'string') {
          throw new Error('Backup contains an invalid attachment.');
        }
        const bytes = Buffer.from(item.data, 'base64');
        if (bytes.toString('base64') !== item.data) throw new Error('Backup attachment encoding is invalid.');
        if (bundledPaths.has(item.path)) throw new Error('Backup contains duplicate attachment paths.');
        bundledPaths.add(item.path);
        attachmentBytes += bytes.length;
        if (bytes.length > 50 * 1024 * 1024 || attachmentBytes > 250 * 1024 * 1024) {
          throw new Error('Backup attachments exceed the supported size.');
        }
      }

      if (parsed?.backupVersion === 1) {
        for (const draft of [...imported.savedDrafts, ...(imported.workspaceDraft ? [imported.workspaceDraft] : [])]) {
          for (const attachment of draft.attachments) {
            if (!bundledPaths.has(attachment.path)) throw new Error('Backup is missing an attachment file.');
          }
        }
      }

      for (const item of importedAttachments) {
        const bytes = Buffer.from(item.data, 'base64');
        const safeName = pathImpl.basename(item.name).replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120) || 'attachment';
        fsImpl.mkdirSync(attachmentsDirectory, { recursive: true });
        const storedPath = pathImpl.join(attachmentsDirectory, `${crypto.randomUUID()}-${safeName}`);
        const temporary = `${storedPath}.tmp`;
        fsImpl.writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o600 });
        fsImpl.renameSync(temporary, storedPath);
        attachmentPaths.set(item.path, storedPath);
      }
      const rewriteAttachments = (draft) => {
        if (!draft) return;
        draft.attachments = draft.attachments.map((attachment) => ({
          ...attachment,
          path: attachmentPaths.get(attachment.path) ?? attachment.path,
        }));
      };
      imported.savedDrafts.forEach(rewriteAttachments);
      rewriteAttachments(imported.workspaceDraft);
      if (parsed?.backupVersion !== 1) {
        for (const draft of [...imported.savedDrafts, ...(imported.workspaceDraft ? [imported.workspaceDraft] : [])]) {
          if (draft.attachments.some((attachment) => !isManagedAttachment(attachment.path))) {
            throw new Error('A backup with attachments must include its bundled media files.');
          }
        }
      }
      const loaded = load();
      if (!loaded.success) return loaded;
      let nextStore = { ...imported, migrationVersion: Math.max(imported.migrationVersion, MIGRATION_VERSION) };
      if (strategy === 'merge') {
        const byId = new Map(loaded.store.savedDrafts.map((draft) => [draft.id, draft]));
        for (const draft of imported.savedDrafts) byId.set(draft.id, draft);
        nextStore = {
          ...loaded.store,
          migrationVersion: Math.max(loaded.store.migrationVersion, imported.migrationVersion),
          savedDrafts: [...byId.values()],
          workspaceDraft: imported.workspaceDraft ?? loaded.store.workspaceDraft,
        };
      }
      return { success: true, store: writeStore(nextStore) };
    } catch (error) {
      return { success: false, code: 'IMPORT_FAILED', error: error instanceof Error ? error.message : 'Draft backup is invalid.' };
    }
  }

  function copyAttachment(source) {
    try {
      if (typeof source !== 'string' || !source.trim()) throw new Error('Selected attachment path is invalid.');
      const sourcePath = pathImpl.resolve(source);
      const stats = fsImpl.statSync(sourcePath);
      if (!stats.isFile() || stats.size > 50 * 1024 * 1024) {
        throw new Error('Attachment must be a file no larger than 50 MB.');
      }

      const safeName = pathImpl.basename(sourcePath).replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120) || 'attachment';
      fsImpl.mkdirSync(attachmentsDirectory, { recursive: true });
      const storedPath = pathImpl.join(attachmentsDirectory, `${crypto.randomUUID()}-${safeName}`);
      const temporary = `${storedPath}.tmp`;
      fsImpl.copyFileSync(sourcePath, temporary, fsImpl.constants.COPYFILE_EXCL);
      fsImpl.renameSync(temporary, storedPath);
      return {
        success: true,
        attachment: { name: pathImpl.basename(sourcePath), path: storedPath, size: stats.size },
      };
    } catch (error) {
      return { success: false, code: 'ATTACHMENT_COPY_FAILED', error: error instanceof Error ? error.message : 'Attachment could not be stored.' };
    }
  }

  return {
    load,
    save,
    saveSync,
    migrate,
    restoreBackup,
    exportTo,
    exportTextTo,
    importTextFrom,
    importFrom,
    copyAttachment,
    filePath,
    backupPath,
  };
}

module.exports = {
  SCHEMA_VERSION,
  MIGRATION_VERSION,
  createDraftStore,
  validateStore,
};
