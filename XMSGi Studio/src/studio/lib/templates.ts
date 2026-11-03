import type { Template } from '@studio/types';
import { uid } from '@shared/utils';

export type TemplateInput = Pick<Template, 'name' | 'body'>;

export const TEMPLATE_BACKUP_FORMAT = 'xmsgi-templates';
export const TEMPLATE_BACKUP_VERSION = 1;
export const TEMPLATE_IMPORT_MAX_BYTES = 5 * 1024 * 1024;
const MAX_TEMPLATE_COUNT = 5000;
const MAX_TEMPLATE_NAME_LENGTH = 500;
const MAX_TEMPLATE_BODY_LENGTH = 100_000;

export function serializeTemplateBackup(templates: Template[], exportedAt = new Date().toISOString()): string {
  if (templates.length > MAX_TEMPLATE_COUNT) {
    throw new Error(`Template backup cannot contain more than ${MAX_TEMPLATE_COUNT} templates.`);
  }
  const serialized = JSON.stringify({
    format: TEMPLATE_BACKUP_FORMAT,
    version: TEMPLATE_BACKUP_VERSION,
    exportedAt,
    templates,
  }, null, 2);
  if (new TextEncoder().encode(serialized).byteLength > TEMPLATE_IMPORT_MAX_BYTES) {
    throw new Error('Template backup exceeds the 5 MB limit.');
  }
  return serialized;
}

export function parseTemplateBackup(raw: string): Template[] {
  if (new TextEncoder().encode(raw).byteLength > TEMPLATE_IMPORT_MAX_BYTES) {
    throw new Error('Template backup exceeds the 5 MB limit.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Template backup is not valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Template backup has an invalid structure.');
  }

  const backup = parsed as { format?: unknown; version?: unknown; templates?: unknown };
  if (backup.format !== TEMPLATE_BACKUP_FORMAT || backup.version !== TEMPLATE_BACKUP_VERSION || !Array.isArray(backup.templates)) {
    throw new Error('Template backup format or version is not supported.');
  }
  if (backup.templates.length > MAX_TEMPLATE_COUNT) {
    throw new Error(`Template backup cannot contain more than ${MAX_TEMPLATE_COUNT} templates.`);
  }

  const ids = new Set<string>();
  return backup.templates.map((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`Template ${index + 1} has an invalid structure.`);
    }

    const template = value as Partial<Template>;
    if (typeof template.id !== 'string' || !template.id.trim()
      || typeof template.name !== 'string' || !template.name.trim()
      || template.name.length > MAX_TEMPLATE_NAME_LENGTH
      || typeof template.body !== 'string' || !template.body.trim()
      || template.body.length > MAX_TEMPLATE_BODY_LENGTH) {
      throw new Error(`Template ${index + 1} is missing a valid name, body, or ID.`);
    }
    if (ids.has(template.id)) throw new Error(`Template backup contains duplicate ID "${template.id}".`);
    ids.add(template.id);

    const timestamp = new Date().toISOString();
    return {
      id: template.id,
      name: template.name.trim(),
      body: template.body,
      createdAt: typeof template.createdAt === 'string' && !Number.isNaN(Date.parse(template.createdAt))
        ? template.createdAt
        : timestamp,
      updatedAt: typeof template.updatedAt === 'string' && !Number.isNaN(Date.parse(template.updatedAt))
        ? template.updatedAt
        : timestamp,
    };
  });
}

export function mergeTemplateBackup(current: Template[], imported: Template[]): Template[] {
  const merged = new Map(current.map((template) => [template.id, template]));
  imported.forEach((template) => merged.set(template.id, template));
  return [...merged.values()];
}

export function createTemplate(
  input: TemplateInput,
  now = new Date().toISOString()
): Template {
  return {
    id: uid(),
    name: input.name.trim(),
    body: input.body,
    createdAt: now,
    updatedAt: now,
  };
}

export function updateTemplate(
  template: Template,
  input: TemplateInput,
  now = new Date().toISOString()
): Template {
  return {
    ...template,
    name: input.name.trim(),
    body: input.body,
    updatedAt: now,
  };
}

export function deleteTemplate(
  templates: Template[],
  templateId: string
): Template[] {
  return templates.filter((template) => template.id !== templateId);
}

export function insertTextAtSelection(
  body: string,
  insertedText: string,
  selectionStart: number,
  selectionEnd: number
): { body: string; caretPosition: number } {
  const start = Math.max(0, Math.min(selectionStart, body.length));
  const end = Math.max(start, Math.min(selectionEnd, body.length));
  const nextBody = `${body.slice(0, start)}${insertedText}${body.slice(end)}`;

  return {
    body: nextBody,
    caretPosition: start + insertedText.length,
  };
}
