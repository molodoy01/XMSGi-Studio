import { describe, expect, it } from 'vitest';
import {
  mergeTemplateBackup,
  parseTemplateBackup,
  serializeTemplateBackup,
  TEMPLATE_BACKUP_FORMAT,
  TEMPLATE_BACKUP_VERSION,
} from './templates';
import type { Template } from '@studio/types';

const template: Template = {
  id: 'template-1',
  name: 'Welcome',
  body: 'Hello there',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

describe('template backup', () => {
  it('round-trips templates using a versioned backup format', () => {
    const exportedAt = '2026-01-03T00:00:00.000Z';

    expect(JSON.parse(serializeTemplateBackup([template], exportedAt))).toEqual({
      format: TEMPLATE_BACKUP_FORMAT,
      version: TEMPLATE_BACKUP_VERSION,
      exportedAt,
      templates: [template],
    });
    expect(parseTemplateBackup(serializeTemplateBackup([template], exportedAt))).toEqual([template]);
  });

  it('rejects unsupported formats, invalid records, and duplicate IDs', () => {
    expect(() => parseTemplateBackup(JSON.stringify({ format: 'other', version: 1, templates: [] }))).toThrow('not supported');
    expect(() => parseTemplateBackup(JSON.stringify({
      format: TEMPLATE_BACKUP_FORMAT,
      version: TEMPLATE_BACKUP_VERSION + 1,
      templates: [],
    }))).toThrow('not supported');
    expect(() => parseTemplateBackup(JSON.stringify({
      format: TEMPLATE_BACKUP_FORMAT,
      version: TEMPLATE_BACKUP_VERSION,
      templates: [{ ...template, body: ' ' }],
    }))).toThrow('valid name, body, or ID');
    expect(() => parseTemplateBackup(serializeTemplateBackup([template, template]))).toThrow('duplicate ID');
  });

  it('rejects backups that exceed the size limit on import and export', () => {
    const oversizedText = 'x'.repeat(5 * 1024 * 1024 + 1);
    expect(() => parseTemplateBackup(oversizedText)).toThrow('5 MB limit');
    expect(() => serializeTemplateBackup([{ ...template, body: oversizedText }])).toThrow('5 MB limit');
  });

  it('merges by ID, updates matching records, and preserves unrelated templates', () => {
    const updated = { ...template, name: 'Updated welcome' };
    const newTemplate = { ...template, id: 'template-2', name: 'Follow-up' };

    expect(mergeTemplateBackup([template], [updated, newTemplate])).toEqual([updated, newTemplate]);
  });
});
