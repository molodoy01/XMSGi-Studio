const fs = require('fs');
const path = require('path');
const crypto = require('node:crypto');

const DOCUMENT_HISTORY_REASONS = new Set([
  'edit',
  'before-clear',
  'before-delete',
  'before-replacement',
  'before-attachment-removal',
  'restore',
  'publish',
]);

function isPersistedSavedDraft(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && typeof value.id === 'string'
    && typeof value.name === 'string'
    && typeof value.body === 'string'
    && typeof value.createdAt === 'string'
    && typeof value.updatedAt === 'string');
}

function isPersistedDocumentVersion(version, documentId) {
  return Boolean(version
    && typeof version === 'object'
    && !Array.isArray(version)
    && version.documentId === documentId
    && typeof version.id === 'string'
    && version.id.length > 0
    && typeof version.createdAt === 'string'
    && Number.isFinite(Date.parse(version.createdAt))
    && DOCUMENT_HISTORY_REASONS.has(version.reason)
    && version.snapshot
    && typeof version.snapshot === 'object'
    && !Array.isArray(version.snapshot)
    && typeof version.snapshot.body === 'string'
    && Array.isArray(version.snapshot.attachments)
    && (!version.snapshot.documentId || version.snapshot.documentId === documentId));
}

function normalizeDocumentHistories(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const normalized = {};
  for (const [documentId, rawVersions] of Object.entries(value)) {
    if (!documentId || !Array.isArray(rawVersions)) continue;
    const versions = rawVersions.filter((version) => isPersistedDocumentVersion(version, documentId));
    if (versions.length) normalized[documentId] = versions.slice(-30);
  }
  return normalized;
}

function isValidDocumentHistories(value) {
  return value === undefined || Boolean(value
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.entries(value).every(([documentId, versions]) => (
      documentId.length > 0
      && Array.isArray(versions)
      && versions.every((version) => isPersistedDocumentVersion(version, documentId))
    )));
}

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

function mergeDocumentHistories(existing = {}, incoming = {}) {
  const merged = { ...(existing && typeof existing === 'object' ? existing : {}) };
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return merged;

  for (const [documentId, incomingVersions] of Object.entries(incoming)) {
    if (!documentId || !Array.isArray(incomingVersions)) continue;
    const currentVersions = Array.isArray(merged[documentId]) ? merged[documentId] : [];
    const byId = new Map();
    [...currentVersions, ...incomingVersions].forEach((version) => {
      if (version && typeof version.id === 'string' && version.documentId === documentId) {
        byId.set(version.id, version);
      }
    });
    const versions = [...byId.values()].sort((left, right) => (
      Date.parse(left.createdAt) - Date.parse(right.createdAt)
    ));
    merged[documentId] = versions.slice(-30);
  }
  return merged;
}

function ensureDirectory(directory) {
  const target = directory || path.join(process.cwd(), 'drafts');
  fs.mkdirSync(target, { recursive: true });
  return target;
}

function getStoreFilePath(directory) {
  return path.join(ensureDirectory(directory), 'drafts.json');
}

function validateStore(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const error = new Error('Draft store must contain a JSON object.');
    error.code = 'DRAFT_STORE_INVALID';
    throw error;
  }
  if (Object.prototype.hasOwnProperty.call(parsed, 'drafts') && !Array.isArray(parsed.drafts)) {
    const error = new Error('Draft store drafts must be an array.');
    error.code = 'DRAFT_STORE_INVALID';
    throw error;
  }
  if (Object.prototype.hasOwnProperty.call(parsed, 'backups') && !Array.isArray(parsed.backups)) {
    const error = new Error('Draft store backups must be an array.');
    error.code = 'DRAFT_STORE_INVALID';
    throw error;
  }
  if (Array.isArray(parsed.drafts)
    && parsed.drafts.some((draft) => !draft || typeof draft !== 'object' || Array.isArray(draft))) {
    const error = new Error('Draft store drafts have an invalid structure.');
    error.code = 'DRAFT_STORE_INVALID';
    throw error;
  }
  if (Object.prototype.hasOwnProperty.call(parsed, 'savedDrafts')
    && (!Array.isArray(parsed.savedDrafts) || parsed.savedDrafts.some((draft) => !isPersistedSavedDraft(draft)))) {
    const error = new Error('Draft store saved drafts have an invalid structure.');
    error.code = 'DRAFT_STORE_INVALID';
    throw error;
  }
  if (Object.prototype.hasOwnProperty.call(parsed, 'workspaceDraft')
    && parsed.workspaceDraft !== null
    && (typeof parsed.workspaceDraft !== 'object' || Array.isArray(parsed.workspaceDraft))) {
    const error = new Error('Draft store workspace draft has an invalid structure.');
    error.code = 'DRAFT_STORE_INVALID';
    throw error;
  }
  if (!isValidDocumentHistories(parsed.documentHistories)) {
    const error = new Error('Draft store document histories have an invalid structure.');
    error.code = 'DRAFT_STORE_INVALID';
    throw error;
  }
}

function readStoreFile(filePath, fileSystem) {
  const raw = fileSystem.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw);
  validateStore(parsed);

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

function createReadError(cause) {
  const error = new Error('Draft store could not be read.');
  error.code = 'DRAFT_STORE_READ_FAILED';
  error.cause = cause;
  return error;
}

function readStore(directory, fileSystem = fs) {
  const filePath = getStoreFilePath(directory);
  const backupPath = `${filePath}.bak`;

  try {
    return readStoreFile(filePath, fileSystem).store;
  } catch (mainError) {
    if (mainError.code !== 'ENOENT'
      && mainError.code !== 'DRAFT_STORE_INVALID'
      && !(mainError instanceof SyntaxError)) {
      throw createReadError(mainError);
    }

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
  validateStore(normalized);
  const serialized = JSON.stringify(normalized, null, 2);

  readStore(directory, fileSystem);

  writeFileAtomically(filePath, serialized, fileSystem);
  try {
    writeFileAtomically(backupPath, serialized, fileSystem);
  } catch (error) {
    const backupError = new Error('Drafts were saved, but the backup could not be updated.');
    backupError.code = 'DRAFT_STORE_BACKUP_UPDATE_FAILED';
    backupError.cause = error;
    throw backupError;
  }
  return normalized;
}

function createDraftStore({ directory, fileSystem = fs } = {}) {
  const storeDirectory = path.resolve(ensureDirectory(directory));

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

      const resolvedSource = path.resolve(sourcePath);
      const relativeSource = path.relative(storeDirectory, resolvedSource);
      if (relativeSource === '' || (!relativeSource.startsWith(`..${path.sep}`) && relativeSource !== '..' && !path.isAbsolute(relativeSource))) {
        try {
          const stats = fs.statSync(resolvedSource);
          if (stats.isFile()) {
            return {
              success: true,
              sourcePath: resolvedSource,
              destinationPath: resolvedSource,
              attachment: {
                name: path.basename(resolvedSource),
                path: resolvedSource,
                size: stats.size,
              },
            };
          }
        } catch {
          return { success: false, error: 'Source file does not exist.' };
        }
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

    writeAttachment(name, data) {
      if (typeof name !== 'string' || !name.trim() || name.includes('\0')) {
        return { success: false, error: 'Attachment name is invalid.' };
      }

      if (!Buffer.isBuffer(data) && !ArrayBuffer.isView(data) && !(data instanceof ArrayBuffer)) {
        return { success: false, error: 'Attachment data is invalid.' };
      }

      const bytes = Buffer.isBuffer(data)
        ? data
        : data instanceof ArrayBuffer
          ? Buffer.from(data)
          : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
      if (bytes.length === 0 || bytes.length > 50 * 1024 * 1024) {
        return { success: false, error: 'Attachment size is not supported.' };
      }

      const sourceName = path.basename(name);
      if (!sourceName || sourceName === '.' || sourceName === '..') {
        return { success: false, error: 'Attachment name is invalid.' };
      }

      const parsedName = path.parse(sourceName);
      let destination;
      let collisionIndex = 0;

      while (!destination) {
        const fileName = collisionIndex === 0
          ? sourceName
          : `${parsedName.name} (${collisionIndex})${parsedName.ext}`;
        const candidate = path.join(storeDirectory, fileName);
        try {
          fs.writeFileSync(candidate, bytes, { flag: 'wx', mode: 0o600 });
          destination = candidate;
        } catch (error) {
          if (error?.code !== 'EEXIST') throw error;
          collisionIndex += 1;
        }
      }

      return {
        success: true,
        destinationPath: destination,
        attachment: {
          name: path.basename(destination),
          path: destination,
          size: bytes.length,
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
            documentHistories: mergeDocumentHistories(current.documentHistories, incoming.documentHistories),
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

module.exports = {
  createDraftStore,
  isPersistedSavedDraft,
  normalizeDocumentHistories,
};
