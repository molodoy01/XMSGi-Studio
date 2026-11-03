import type { Repository } from '../domain/types';

function getStorageErrorMessage(error: unknown, fallback: string): string {
  return typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
    ? error.message
    : fallback;
}

export function createLocalStorageRepository<T extends { id: string }>(
  key: string,
  legacyKey?: string,
  backupKey?: string,
): Repository<T> {
  const readAll = (): T[] => {
    let storage: Storage;
    try {
      storage = globalThis.localStorage;
    } catch (error) {
      throw new Error(getStorageErrorMessage(error, 'Local storage is unavailable.'));
    }

    let primaryRaw: string | null;
    try {
      primaryRaw = storage.getItem(key);
    } catch (error) {
      throw new Error(getStorageErrorMessage(error, 'Local storage could not be read.'));
    }

    let primaryError: unknown;
    if (primaryRaw !== null) {
      try {
        return parseEntityList<T>(primaryRaw, key);
      } catch (error) {
        if (!backupKey) throw error;
        primaryError = error;
      }
    }

    if (legacyKey) {
      let legacyRaw: string | null;
      try {
        legacyRaw = storage.getItem(legacyKey);
      } catch (error) {
        throw new Error(getStorageErrorMessage(error, 'Legacy local storage could not be read.'));
      }
      if (legacyRaw !== null) {
        try {
          return parseEntityList<T>(legacyRaw, legacyKey);
        } catch (error) {
          if (!backupKey) throw error;
          primaryError ??= error;
        }
      }
    }

    if (backupKey) {
      let backupRaw: string | null;
      try {
        backupRaw = storage.getItem(backupKey);
      } catch (error) {
        throw new Error(getStorageErrorMessage(error, 'Backup local storage could not be read.'));
      }
      if (backupRaw !== null) {
        try {
          return parseEntityList<T>(backupRaw, backupKey);
        } catch (error) {
          primaryError ??= error;
        }
      }
    }

    if (primaryError) throw primaryError;
    return [];
  };

  const writeAll = (items: T[]) => {
    const serialized = JSON.stringify(items);
    let storage: Storage;
    try {
      storage = globalThis.localStorage;
    } catch (error) {
      throw new Error(getStorageErrorMessage(error, 'Local storage is unavailable.'));
    }
    if (backupKey) {
      const currentItems = readAll();
      storage.setItem(backupKey, JSON.stringify(currentItems));
      if (storage.getItem(backupKey) !== JSON.stringify(currentItems)) {
        throw new Error('Local storage backup could not be verified.');
      }
    }
    storage.setItem(key, serialized);
    if (storage.getItem(key) !== serialized) {
      throw new Error('Local storage write could not be verified.');
    }
    if (legacyKey) {
      storage.setItem(legacyKey, serialized);
      if (storage.getItem(legacyKey) !== serialized) {
        throw new Error('Legacy local storage write could not be verified.');
      }
    }
  };

  return {
    list() {
      return readAll();
    },

    getById(id: string) {
      return readAll().find((item) => item.id === id) ?? null;
    },

    save(entity: T) {
      const items = readAll();
      const index = items.findIndex((item) => item.id === entity.id);

      if (index >= 0) {
        items[index] = entity;
      } else {
        items.push(entity);
      }

      writeAll(items);
      return entity;
    },

    replaceAll(items: T[]) {
      writeAll(items);
    },

    remove(id: string) {
      const items = readAll().filter((item) => item.id !== id);
      writeAll(items);
    },
  };
}

function parseEntityList<T extends { id: string }>(raw: string, key: string): T[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Local storage data for "${key}" is invalid JSON: ${getStorageErrorMessage(error, 'parse failed')}`);
  }
  if (!Array.isArray(parsed)
    || parsed.some((item) => !item || typeof item !== 'object' || Array.isArray(item)
      || typeof item.id !== 'string' || !item.id)) {
    throw new Error(`Local storage data for "${key}" has an invalid structure.`);
  }
  return parsed as T[];
}
