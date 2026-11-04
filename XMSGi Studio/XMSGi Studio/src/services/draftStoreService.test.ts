import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createActiveDraftSnapshot,
  readActiveDraftState,
  readDraftStore,
  writeActiveDraft,
  writeDraftStore,
} from './draftStoreService';

describe('browser draft storage error handling', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('distinguishes absent active draft from malformed saved draft data', () => {
    expect(readActiveDraftState()).toMatchObject({ available: true, exists: false, draft: null });
    localStorage.setItem('xmsgi:active-draft:v1', '{broken');
    expect(readActiveDraftState()).toMatchObject({
      available: false,
      exists: true,
      draft: null,
    });
    expect(readActiveDraftState().error).toContain('JSON');
  });

  it('does not overwrite malformed draft storage with a new empty store', () => {
    const original = '{damaged saved drafts';
    localStorage.setItem('xmsgi:saved-drafts:v1', original);

    expect(() => readDraftStore()).toThrow();
    expect(writeDraftStore({ activeDraft: null, savedDrafts: [] })).toBe(false);
    expect(localStorage.getItem('xmsgi:saved-drafts:v1')).toBe(original);
  });

  it('refuses to replace a damaged active draft', () => {
    const original = '{"message":';
    localStorage.setItem('xmsgi:active-draft:v1', original);

    expect(writeActiveDraft(null)).toBe(false);
    expect(localStorage.getItem('xmsgi:active-draft:v1')).toBe(original);
  });

  it('surfaces localStorage access errors as unavailable state', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Storage access denied', 'SecurityError');
    });

    expect(readActiveDraftState()).toMatchObject({
      available: false,
      error: 'Storage access denied',
    });
    expect(() => readDraftStore()).toThrow('Storage access denied');
  });

  it('keeps old drafts when a quota error prevents the next write', () => {
    const oldDrafts = JSON.stringify([]);
    localStorage.setItem('xmsgi:saved-drafts:v1', oldDrafts);
    const originalSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === 'xmsgi:active-draft:v1') {
        throw new DOMException('Storage quota exceeded', 'QuotaExceededError');
      }
      originalSetItem.call(this, key, value);
    });

    expect(writeDraftStore({ activeDraft: null, savedDrafts: [] })).toBe(false);
    expect(localStorage.getItem('xmsgi:saved-drafts:v1')).toBe(oldDrafts);
  });

  it('preserves schedule and button metadata in the active draft round-trip', () => {
    const draft = createActiveDraftSnapshot({
      message: 'Scheduled update',
      entities: [{ type: 'bold', offset: 0, length: 8 }],
      attachments: [{ name: 'photo.png', path: '/tmp/photo.png' }],
      selectedChatId: 'chat-42',
      date: '2026-02-14',
      time: '18:30',
      repeatMode: 'weekly',
      repeatDays: ['Sat'],
      repeatOccurrences: 3,
      id: 'active-meta-test',
    });

    expect(writeActiveDraft(draft)).toBe(true);
    expect(readActiveDraftState().draft).toMatchObject({
      id: 'active-meta-test',
      message: 'Scheduled update',
      date: '2026-02-14',
      time: '18:30',
      repeatMode: 'weekly',
      repeatDays: ['Sat'],
      repeatOccurrences: 3,
    });
  });
});
