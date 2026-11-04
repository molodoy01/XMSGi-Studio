import type { Repository } from '../domain/types';

function getStorageErrorMessage(error: unknown, fallback: string): string {
  return typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
    ? error.message
    : fallback;
}

export function createLocalStorageRepository<T extends { id: string }>(
  key: string,
  legacyKey?: string,
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

    if (primaryRaw !== null) return parseEntityList<T>(primaryRaw, key);

    if (!legacyKey) return [];

    let legacyRaw: string | null;
    try {
      legacyRaw = storage.getItem(legacyKey);
    } catch (error) {
      throw new Error(getStorageErrorMessage(error, 'Legacy local storage could not be read.'));
    }
    if (legacyRaw === null) return [];
    return parseEntityList<T>(legacyRaw, legacyKey);
  };

  const writeAll = (items: T[]) => {
    const serialized = JSON.stringify(items);
    let storage: Storage;
    try {
      storage = globalThis.localStorage;
    } catch (error) {
      throw new Error(getStorageErrorMessage(error, 'Local storage is unavailable.'));
    }
    storage.setItem(key, serialized);
    if (legacyKey) {
      storage.setItem(legacyKey, serialized);
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
