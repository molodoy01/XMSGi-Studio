import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLocalStorageRepository } from './localStorageRepository';

type Entity = { id: string; name: string };

describe('localStorage repository read safety', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('returns an empty list only when both repository keys are absent', () => {
    const repository = createLocalStorageRepository<Entity>('primary', 'legacy');
    expect(repository.list()).toEqual([]);
  });

  it('reads a valid legacy copy without rewriting or deleting it', () => {
    const legacy = JSON.stringify([{ id: 'draft-1', name: 'Legacy draft' }]);
    localStorage.setItem('legacy', legacy);
    const repository = createLocalStorageRepository<Entity>('primary', 'legacy');

    expect(repository.list()).toEqual([{ id: 'draft-1', name: 'Legacy draft' }]);
    expect(localStorage.getItem('primary')).toBeNull();
    expect(localStorage.getItem('legacy')).toBe(legacy);
  });

  it.each([
    ['invalid JSON', '{invalid'],
    ['invalid structure', '{"id":"draft-1"}'],
    ['invalid record', '[{"id":3}]'],
  ])('does not replace primary data after %s', (_label, contents) => {
    localStorage.setItem('primary', contents);
    const repository = createLocalStorageRepository<Entity>('primary', 'legacy');

    expect(() => repository.list()).toThrow();
    expect(() => repository.save({ id: 'new', name: 'New draft' })).toThrow();
    expect(() => repository.remove('draft-1')).toThrow();
    expect(localStorage.getItem('primary')).toBe(contents);
  });

  it('surfaces read access errors instead of treating them as missing data', () => {
    const repository = createLocalStorageRepository<Entity>('primary', 'legacy');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Storage access denied', 'SecurityError');
    });

    expect(() => repository.list()).toThrow('Storage access denied');
  });

  it('surfaces write and quota errors without reporting a successful repository operation', () => {
    localStorage.setItem('primary', JSON.stringify([{ id: 'existing', name: 'Keep' }]));
    const repository = createLocalStorageRepository<Entity>('primary', 'legacy');
    const originalSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === 'primary') throw new DOMException('Storage quota exceeded', 'QuotaExceededError');
      originalSetItem.call(this, key, value);
    });

    expect(() => repository.save({ id: 'new', name: 'New draft' })).toThrow('Storage quota exceeded');
    expect(localStorage.getItem('primary')).toBe(JSON.stringify([{ id: 'existing', name: 'Keep' }]));
  });

  it('keeps primary and legacy copies usable when the second mirror write fails', () => {
    const previous = JSON.stringify([{ id: 'old', name: 'Old record' }]);
    localStorage.setItem('primary', previous);
    localStorage.setItem('legacy', previous);
    const repository = createLocalStorageRepository<Entity>('primary', 'legacy');
    const originalSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === 'legacy') throw new DOMException('Legacy mirror unavailable', 'QuotaExceededError');
      originalSetItem.call(this, key, value);
    });

    expect(() => repository.save({ id: 'new', name: 'New record' })).toThrow('Legacy mirror unavailable');
    expect(localStorage.getItem('primary')).toBe(JSON.stringify([
      { id: 'old', name: 'Old record' },
      { id: 'new', name: 'New record' },
    ]));
    expect(localStorage.getItem('legacy')).toBe(previous);
  });

  it('reports an unavailable localStorage getter', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    try {
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        get: () => { throw new DOMException('Storage unavailable', 'SecurityError'); },
      });
      const repository = createLocalStorageRepository<Entity>('primary');
      expect(() => repository.list()).toThrow('Storage unavailable');
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    }
  });
});
