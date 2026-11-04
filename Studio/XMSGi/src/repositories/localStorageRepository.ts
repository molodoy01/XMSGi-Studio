import type { Repository } from '../domain/types';

export function createLocalStorageRepository<T extends { id: string }>(
  key: string,
  legacyKey?: string,
): Repository<T> {
  const readAll = (): T[] => {
    try {
      const primaryRaw = globalThis.localStorage.getItem(key);
      if (primaryRaw !== null) {
        const parsed = JSON.parse(primaryRaw) as T[];
        return Array.isArray(parsed) ? parsed : [];
      }

      if (!legacyKey) return [];

      const legacyRaw = globalThis.localStorage.getItem(legacyKey);
      if (legacyRaw === null) return [];

      const parsed = JSON.parse(legacyRaw) as T[];
      if (!Array.isArray(parsed)) return [];

      globalThis.localStorage.setItem(key, legacyRaw);
      return parsed;
    } catch {
      return [];
    }
  };

  const writeAll = (items: T[]) => {
    const serialized = JSON.stringify(items);
    globalThis.localStorage.setItem(key, serialized);
    if (legacyKey) {
      globalThis.localStorage.setItem(legacyKey, serialized);
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

    remove(id: string) {
      const items = readAll().filter((item) => item.id !== id);
      writeAll(items);
    },
  };
}
