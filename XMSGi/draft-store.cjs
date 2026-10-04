const fs = require('fs');
const path = require('path');
const crypto = require('node:crypto');

function normalizeStore(data = {}) {
  const draftList = Array.isArray(data.drafts) ? data.drafts : [];
  const backupList = Array.isArray(data.backups) ? data.backups : [];

  return {
    version: 1,
    drafts: draftList,
    backups: backupList,
    ...data,
    drafts: draftList,
    backups: backupList,
  };
}

function ensureDirectory(directory) {
  const target = directory || path.join(process.cwd(), 'drafts');
  fs.mkdirSync(target, { recursive: true });
  return target;
}

function getStoreFilePath(directory) {
  return path.join(ensureDirectory(directory), 'drafts.json');
}

function readStoreFile(filePath, fileSystem) {
  const raw = fileSystem.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw);

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Draft store must contain a JSON object.');
  }
  if (Object.prototype.hasOwnProperty.call(parsed, 'drafts') && !Array.isArray(parsed.drafts)) {
    throw new Error('Draft store drafts must be an array.');
  }
  if (Object.prototype.hasOwnProperty.call(parsed, 'backups') && !Array.isArray(parsed.backups)) {
    throw new Error('Draft store backups must be an array.');
  }

  return { raw, store: normalizeStore(parsed) };
}

function writeFileAtomically(filePath, contents, fileSystem) {
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  let fileDescriptor;

  try {
    fileDescriptor = fileSystem.openSync(temporaryPath, 'wx', 0o600);
    fileSystem.writeFileSync(fileDescriptor, contents, 'utf8');
    fileSystem.fsyncSync(fileDescriptor);
    fileSystem.closeSync(fileDescriptor);
    fileDescriptor = undefined;
    fileSystem.renameSync(temporaryPath, filePath);

    try {
      const directoryDescriptor = fileSystem.openSync(path.dirname(filePath), 'r');
      try {
        fileSystem.fsyncSync(directoryDescriptor);
      } finally {
        fileSystem.closeSync(directoryDescriptor);
      }
    } catch {
      // Some platforms do not support syncing directory handles.
    }
  } catch (error) {
    if (fileDescriptor !== undefined) {
      try { fileSystem.closeSync(fileDescriptor); } catch { /* Preserve the original write error. */ }
    }
    try { fileSystem.unlinkSync(temporaryPath); } catch { /* The temp file may already have been renamed. */ }
    throw error;
  }
}

function createRecoveryError(mainError, backupError) {
  const error = new Error('Draft store is corrupt or unreadable and no valid backup is available.');
  error.code = 'DRAFT_STORE_CORRUPT';
  error.cause = mainError;
  error.backupError = backupError;
  return error;
}

function readStore(directory, fileSystem = fs) {
  const filePath = getStoreFilePath(directory);
  const backupPath = `${filePath}.bak`;

  try {
    return readStoreFile(filePath, fileSystem).store;
  } catch (mainError) {
    let backup;
    try {
      backup = readStoreFile(backupPath, fileSystem);
    } catch (backupError) {
      if (mainError.code === 'ENOENT' && backupError.code === 'ENOENT') {
        return { version: 1, drafts: [], backups: [] };
      }
      throw createRecoveryError(mainError, backupError);
    }

    try {
      writeFileAtomically(filePath, backup.raw, fileSystem);
    } catch (error) {
      const recoveryError = new Error('Draft store backup is valid but could not restore the primary file.');
      recoveryError.code = 'DRAFT_STORE_RECOVERY_FAILED';
      recoveryError.cause = error;
      throw recoveryError;
    }
    return backup.store;
  }
}

function writeStore(directory, payload, fileSystem = fs) {
  const filePath = getStoreFilePath(directory);
  const backupPath = `${filePath}.bak`;
  const normalized = normalizeStore(payload);
  const serialized = JSON.stringify(normalized, null, 2);

  if (fileSystem.existsSync(filePath) || fileSystem.existsSync(backupPath)) {
    readStore(directory, fileSystem);
  }

  writeFileAtomically(filePath, serialized, fileSystem);
  try {
    writeFileAtomically(backupPath, serialized, fileSystem);
  } catch (error) {
    console.warn('Draft store backup update failed:', error?.code || error?.name || 'unknown');
  }
  return normalized;
}

function createDraftStore({ directory, fileSystem = fs } = {}) {
  const storeDirectory = ensureDirectory(directory);

  return {
    load() {
      return readStore(storeDirectory, fileSystem);
    },

    migrate(legacy) {
      const existing = readStore(storeDirectory, fileSystem);
      const incoming = legacy && typeof legacy === 'object' ? legacy : existing;
      const migrated = normalizeStore(incoming);
      writeStore(storeDirectory, migrated, fileSystem);
      return migrated;
    },

    saveSync(data) {
      return writeStore(storeDirectory, data ?? {}, fileSystem);
    },

    async save(data) {
      return this.saveSync(data);
    },

    restoreBackup(index) {
      const store = readStore(storeDirectory, fileSystem);
      const targetIndex = Number(index);
      const backup = store.backups?.[targetIndex];

      if (!backup) {
        throw new Error('Backup not found.');
      }

      return this.saveSync(backup);
    },

    copyAttachment(sourcePath) {
      if (!sourcePath) {
        return { success: false, error: 'Source path is missing.' };
      }

      if (!fs.existsSync(sourcePath)) {
        return { success: false, error: 'Source file does not exist.' };
      }

      const sourceName = path.basename(sourcePath);
      const parsedName = path.parse(sourceName);
      let destination;
      let collisionIndex = 0;

      while (!destination) {
        const fileName = collisionIndex === 0
          ? sourceName
          : `${parsedName.name} (${collisionIndex})${parsedName.ext}`;
        const candidate = path.join(storeDirectory, fileName);
        try {
          fs.copyFileSync(sourcePath, candidate, fs.constants.COPYFILE_EXCL);
          destination = candidate;
        } catch (error) {
          if (error?.code !== 'EEXIST') throw error;
          collisionIndex += 1;
        }
      }

      return {
        success: true,
        sourcePath,
        destinationPath: destination,
        attachment: {
          name: path.basename(destination),
          path: destination,
          size: fs.statSync(destination).size,
        },
      };
    },

    exportTo(filePath) {
      const store = readStore(storeDirectory);
      fs.writeFileSync(filePath, JSON.stringify(store, null, 2));
      return { success: true, filePath, store };
    },

    importFrom(filePath, mode = 'merge') {
      const raw = fs.readFileSync(filePath, 'utf8');
      const incoming = normalizeStore(JSON.parse(raw));
      const current = readStore(storeDirectory, fileSystem);
      const merged = mode === 'replace'
        ? incoming
        : {
            ...current,
            ...incoming,
            drafts: Array.isArray(incoming.drafts) && incoming.drafts.length > 0 ? incoming.drafts : current.drafts,
            backups: Array.isArray(incoming.backups) && incoming.backups.length > 0 ? incoming.backups : current.backups,
          };

      writeStore(storeDirectory, merged, fileSystem);
      return { success: true, store: merged };
    },

    exportTextTo(filePath, text) {
      fs.writeFileSync(filePath, String(text ?? ''));
      return { success: true, filePath };
    },

    importTextFrom(filePath) {
      return fs.readFileSync(filePath, 'utf8');
    },
  };
}

module.exports = { createDraftStore };
