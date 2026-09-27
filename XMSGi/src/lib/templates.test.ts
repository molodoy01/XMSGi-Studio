import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createTemplate,
  deleteTemplate,
  insertTextAtSelection,
  updateTemplate,
} from './templates';
import { loadTemplates, saveTemplates } from './storage';
import type { Template } from '@/types';

const TEMPLATES_STORAGE_KEY = 'awaitmsg_templates';

function createMemoryStorage() {
  const data = new Map<string, string>();

  return {
    getItem(key: string) {
      return data.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      data.set(key, value);
    },
    removeItem(key: string) {
      data.delete(key);
    },
    clear() {
      data.clear();
    },
  };
}

function makeTemplate(id = 'template-1'): Template {
  return {
    id,
    name: 'Announcement',
    body: 'Hello from XMSGi',
    createdAt: '2030-01-01T10:00:00.000Z',
    updatedAt: '2030-01-01T10:00:00.000Z',
  };
}

describe('Templates', () => {
  let storage: ReturnType<typeof createMemoryStorage>;

  beforeEach(() => {
    storage = createMemoryStorage();
    vi.stubGlobal('localStorage', storage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates a template with timestamps and its exact body', () => {
    const template = createTemplate(
      { name: '  Announcement  ', body: 'Line one\nLine two' },
      '2030-01-01T10:00:00.000Z',
    );

    expect(template).toMatchObject({
      name: 'Announcement',
      body: 'Line one\nLine two',
      createdAt: '2030-01-01T10:00:00.000Z',
      updatedAt: '2030-01-01T10:00:00.000Z',
    });
    expect(template.id).toBeTruthy();
  });

  it('persists and restores templates independently', () => {
    const template = makeTemplate();

    saveTemplates([template]);

    expect(storage.getItem(TEMPLATES_STORAGE_KEY)).toBe(JSON.stringify([template]));
    expect(loadTemplates()).toEqual([template]);
  });

  it('falls back safely for malformed template storage', () => {
    storage.setItem(TEMPLATES_STORAGE_KEY, '{broken');
    expect(loadTemplates()).toEqual([]);

    storage.setItem(
      TEMPLATES_STORAGE_KEY,
      JSON.stringify([makeTemplate(), { id: 'invalid', body: 'missing name' }]),
    );
    expect(loadTemplates()).toEqual([makeTemplate()]);
  });

  it('updates and deletes templates without changing the original object', () => {
    const original = makeTemplate();
    const updated = updateTemplate(
      original,
      { name: 'Updated', body: 'Updated body' },
      '2030-01-02T10:00:00.000Z',
    );

    expect(updated).toEqual({
      ...original,
      name: 'Updated',
      body: 'Updated body',
      updatedAt: '2030-01-02T10:00:00.000Z',
    });
    expect(original.name).toBe('Announcement');
    expect(deleteTemplate([original, makeTemplate('template-2')], original.id)).toEqual([
      makeTemplate('template-2'),
    ]);
  });

  it('inserts at the cursor and places the caret after the inserted body', () => {
    expect(insertTextAtSelection('Hello world', 'Telegram ', 6, 6)).toEqual({
      body: 'Hello Telegram world',
      caretPosition: 15,
    });
  });

  it('replaces the current selection without adding spacing', () => {
    expect(insertTextAtSelection('Hello old world', 'new', 6, 9)).toEqual({
      body: 'Hello new world',
      caretPosition: 9,
    });
  });

  it('keeps the inserted draft body as the Preview source', () => {
    const inserted = insertTextAtSelection('', 'A ready post', 0, 0).body;
    const previewBody = inserted.trim() || 'Your draft preview will appear here.';

    expect(previewBody).toBe('A ready post');
  });
});
