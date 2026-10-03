const fs = require('fs');
const path = require('path');

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

function readStore(directory) {
  const filePath = getStoreFilePath(directory);

  if (!fs.existsSync(filePath)) {
    return { version: 1, drafts: [], backups: [] };
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return normalizeStore(parsed);
  } catch {
    return { version: 1, drafts: [], backups: [] };
  }
}

function writeStore(directory, payload) {
  const filePath = getStoreFilePath(directory);
  const normalized = normalizeStore(payload);
  fs.writeFileSync(filePath, JSON.stringify(normalized, null, 2));
  return normalized;
}

function createDraftStore({ directory } = {}) {
  const storeDirectory = ensureDirectory(directory);

  return {
    load() {
      return readStore(storeDirectory);
    },

    migrate(legacy) {
      const existing = readStore(storeDirectory);
      const incoming = legacy && typeof legacy === 'object' ? legacy : existing;
      const migrated = normalizeStore(incoming);
      writeStore(storeDirectory, migrated);
      return migrated;
    },

    saveSync(data) {
      return writeStore(storeDirectory, data ?? {});
    },

    async save(data) {
      return this.saveSync(data);
    },

    restoreBackup(index) {
      const store = readStore(storeDirectory);
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

      const destination = path.join(storeDirectory, path.basename(sourcePath));
      fs.copyFileSync(sourcePath, destination);
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
      const current = readStore(storeDirectory);
      const merged = mode === 'replace'
        ? incoming
        : {
            ...current,
            ...incoming,
            drafts: Array.isArray(incoming.drafts) && incoming.drafts.length > 0 ? incoming.drafts : current.drafts,
            backups: Array.isArray(incoming.backups) && incoming.backups.length > 0 ? incoming.backups : current.backups,
          };

      writeStore(storeDirectory, merged);
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
