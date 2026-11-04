import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  readWorkspaceDraftStoreFallback,
  SAVED_STUDIO_DRAFTS_UPDATED_EVENT,
  updateSavedStudioDrafts,
  writeWorkspaceDraftStoreFallback,
} from './draftStore';
import type { PersistedDraftStore } from '@studio/types';

const PRIMARY_KEY = 'xmsgi-draft-store-fallback';
const LEGACY_KEY = 'awaitmsg-draft-store-fallback';

function store(body = 'Saved content'): PersistedDraftStore {
  return {
    schemaVersion: 3,
    migrationVersion: 1,
    savedDrafts: [{
      id: 'draft-1',
      name: 'Saved draft',
      body,
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
    }],
    workspaceDraft: null,
    documentHistories: {},
  };
}

describe('browser draft-store fallback', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('returns null and allows initialization only when both fallback keys are absent', () => {
    expect(readWorkspaceDraftStoreFallback()).toBeNull();
    expect(writeWorkspaceDraftStoreFallback(store())).toBe(true);
    expect(readWorkspaceDraftStoreFallback()).toMatchObject({
      savedDrafts: [{ id: 'draft-1', body: 'Saved content' }],
    });
  });

  it('validates and migrates the legacy key without deleting its source', () => {
    const raw = JSON.stringify(store('Legacy data'));
    localStorage.setItem(LEGACY_KEY, raw);

    expect(readWorkspaceDraftStoreFallback()).toMatchObject({
      savedDrafts: [{ id: 'draft-1', body: 'Legacy data' }],
    });
    expect(localStorage.getItem(PRIMARY_KEY)).toBe(raw);
    expect(localStorage.getItem(LEGACY_KEY)).toBe(raw);
  });

  it.each([
    ['invalid JSON', '{broken'],
    ['invalid structure', JSON.stringify({ savedDrafts: 'not-an-array' })],
    ['invalid record', JSON.stringify({ savedDrafts: [{ id: 2, name: 'Bad', body: '' }] })],
  ])('does not replace a damaged primary store after %s', (_label, raw) => {
    localStorage.setItem(PRIMARY_KEY, raw);
    localStorage.setItem(LEGACY_KEY, JSON.stringify(store('Legacy remains untouched')));

    expect(() => readWorkspaceDraftStoreFallback()).toThrow();
    expect(writeWorkspaceDraftStoreFallback(store('Replacement'))).toBe(false);
    expect(localStorage.getItem(PRIMARY_KEY)).toBe(raw);
    expect(localStorage.getItem(LEGACY_KEY)).toBe(JSON.stringify(store('Legacy remains untouched')));
  });

  it('preserves valid legacy data when migrating primary storage fails', () => {
    const raw = JSON.stringify(store('Keep legacy'));
    localStorage.setItem(LEGACY_KEY, raw);
    const originalSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === PRIMARY_KEY) throw new DOMException('Storage quota exceeded', 'QuotaExceededError');
      originalSetItem.call(this, key, value);
    });

    expect(() => readWorkspaceDraftStoreFallback()).toThrow('Storage quota exceeded');
    expect(localStorage.getItem(PRIMARY_KEY)).toBeNull();
    expect(localStorage.getItem(LEGACY_KEY)).toBe(raw);
  });

  it('surfaces localStorage read failures and refuses to write after them', () => {
    const originalGetItem = Storage.prototype.getItem;
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key) {
      if (key === PRIMARY_KEY) throw new DOMException('Storage access denied', 'SecurityError');
      return originalGetItem.call(this, key);
    });

    expect(() => readWorkspaceDraftStoreFallback()).toThrow('Storage access denied');
    expect(writeWorkspaceDraftStoreFallback(store())).toBe(false);
  });

  it('does not claim a save succeeded when primary storage write fails', () => {
    const originalSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === PRIMARY_KEY) throw new DOMException('Storage quota exceeded', 'QuotaExceededError');
      originalSetItem.call(this, key, value);
    });

    expect(writeWorkspaceDraftStoreFallback(store())).toBe(false);
    expect(localStorage.getItem(PRIMARY_KEY)).toBeNull();
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it('updates saved Studio drafts through browser fallback storage', async () => {
    expect(writeWorkspaceDraftStoreFallback(store())).toBe(true);
    const onUpdated = vi.fn();
    window.addEventListener(SAVED_STUDIO_DRAFTS_UPDATED_EVENT, onUpdated);

    try {
      expect(await updateSavedStudioDrafts((drafts) => drafts.filter(({ id }) => id !== 'draft-1'))).toBe(true);
      expect(readWorkspaceDraftStoreFallback()?.savedDrafts).toEqual([]);
      expect(onUpdated).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(SAVED_STUDIO_DRAFTS_UPDATED_EVENT, onUpdated);
    }
  });

  it('clears all saved Studio drafts through browser fallback storage', async () => {
    expect(writeWorkspaceDraftStoreFallback({
      ...store(),
      savedDrafts: [
        ...store().savedDrafts,
        { ...store().savedDrafts[0], id: 'draft-2', name: 'Second draft' },
      ],
    })).toBe(true);

    expect(await updateSavedStudioDrafts(() => [])).toBe(true);
    expect(readWorkspaceDraftStoreFallback()?.savedDrafts).toEqual([]);
  });

  it('reports when access to the localStorage object itself is denied', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    try {
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        get: () => { throw new DOMException('Storage unavailable', 'SecurityError'); },
      });
      expect(() => readWorkspaceDraftStoreFallback()).toThrow('Storage unavailable');
      expect(writeWorkspaceDraftStoreFallback(store())).toBe(false);
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    }
  });
});
