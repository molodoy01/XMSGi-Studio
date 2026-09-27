import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const scheduleSource = fs.readFileSync(path.join(projectRoot, 'SchedulePage.tsx'), 'utf8');

describe('attachment hover preview contract', () => {
  it('opens the existing preview only from the image thumbnail target', () => {
    expect(scheduleSource).toContain('className="message-attachment-thumb-target"');
    expect(scheduleSource).toContain('onPointerEnter={(event) => {');
    expect(scheduleSource).toContain('}, 600);');
    expect(scheduleSource).toContain('setPreviewAttachmentIndex(index);');
  });

  it('closes the preview when the pointer leaves the thumbnail', () => {
    expect(scheduleSource).toContain('onPointerLeave={closeAttachmentPreview}');
  });

  it('renders the selected attachment through a body portal and keeps delete separate', () => {
    expect(scheduleSource).toContain('createPortal(');
    expect(scheduleSource).toContain('document.body');
    expect(scheduleSource).toContain('attachments[previewAttachmentIndex].path');
    expect(scheduleSource).toContain('onPointerDown={(event) => event.stopPropagation()}');
    expect(scheduleSource).toContain('draggable={false}');
  });
});