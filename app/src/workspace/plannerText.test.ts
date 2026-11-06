import { describe, expect, it } from 'vitest';
import { getPlannerAttachmentPaths, hasPlannerPayloadContent } from './plannerText';

describe('hasPlannerPayloadContent', () => {
  it('accepts text-only and attachment-only planner payloads', () => {
    expect(hasPlannerPayloadContent({ text: 'A note', attachments: [] })).toBe(true);
    expect(hasPlannerPayloadContent({ text: '  ', attachments: ['C:/notes/image.png'] })).toBe(true);
  });

  describe('getPlannerAttachmentPaths', () => {
    it('prefers managed draft paths and falls back to the source path when needed', () => {
      expect(getPlannerAttachmentPaths([
        { path: '/managed/copied.pdf', sourcePath: 'C:/original/copied.pdf' },
        { path: '', sourcePath: 'C:/original/unavailable.pdf' },
        { path: '', sourcePath: '' },
      ])).toEqual(['/managed/copied.pdf', 'C:/original/unavailable.pdf']);
    });
  });

  it('rejects payloads without text or a usable attachment', () => {
    expect(hasPlannerPayloadContent({ text: '  ', attachments: [] })).toBe(false);
    expect(hasPlannerPayloadContent({ text: '', attachments: ['  '] })).toBe(false);
  });
});