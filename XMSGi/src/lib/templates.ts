import type { Template } from '@/types';
import { uid } from './utils';

export type TemplateInput = Pick<Template, 'name' | 'body'>;

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
