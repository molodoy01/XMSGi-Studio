import { useEffect } from 'react';
import type { SavedDraft, Template } from '../types';
import type { PreviewChatHistory } from '../types';
import { createTemplate } from '../lib/templates';
import { BUILT_IN_TEMPLATES } from '../lib/builtInTemplates';
import { normalizeAttachments } from '../lib/draftAttachments';
import {
  DEFAULT_DRAFT_BODY,
  DEFAULT_DRAFT_NAME,
} from '../lib/draftStore';
import type { WorkspaceDraft } from '../lib/draftStore';
import { loadTemplates, saveTemplates } from '../lib/storage';

export const FOOTER_STATUS_DURATION_MS = {
  attachmentError: 3360,
  publishWarning: 5000,
  publishSuccess: 3360,
  sendError: 8000,
  draftStoreError: 12000,
  textFileError: 7000,
  chatLookupError: 7000,
  previewHistoryError: 10000,
} as const;

const DEFAULT_TEMPLATE_SEEDED_KEY = 'xmsgi-default-template-seeded-v1';
const BUILT_IN_TEMPLATES_SEEDED_KEY = 'xmsgi-built-in-templates-seeded-v1';

export function savedDraftToWorkspaceSnapshot(draft: SavedDraft): WorkspaceDraft {
  return {
    documentId: draft.documentId ?? draft.id,
    body: draft.body,
    entities: draft.entities ?? [],
    attachments: normalizeAttachments(draft.attachments),
    selectedChat: draft.selectedChat ?? null,
    date: draft.date ?? '',
    time: draft.time ?? '',
    repeatMode: draft.repeatMode ?? 'none',
    repeatDays: draft.repeatDays ?? [],
    repeatOccurrences: draft.repeatOccurrences ?? 1,
    savedAt: draft.updatedAt,
  };
}

export function getPreviewHistoryErrorPresentation(
  error: unknown,
  messages: { noAccess: string; unavailable: string },
) {
  const errorRecord = error !== null && typeof error === 'object'
    ? error as Record<string, unknown>
    : null;
  const errorText = typeof error === 'string'
    ? error
    : [errorRecord?.code, errorRecord?.error, errorRecord?.message]
      .filter((value): value is string => typeof value === 'string')
      .join(' ');

  if (/CHAT_(?:WRITE_)?FORBIDDEN|CHAT_ADMIN_REQUIRED|CHAT_RESTRICTED|CHANNEL_(?:PRIVATE|FORBIDDEN)|USER_(?:IS_)?BLOCKED|USER_BANNED|RIGHTS_FORBIDDEN|PERMISSION/i.test(errorText)) {
    return {
      message: messages.noAccess,
      retryable: false,
    };
  }

  return {
    message: messages.unavailable,
    retryable: true,
  };
}

export function getPreviewHistoryMediaDataUrlChars(history: PreviewChatHistory) {
  return history.messages.reduce((total, message) => (
    total
    + (message.media?.dataUrl?.length ?? 0)
    + (message.media?.thumbnailDataUrl?.length ?? 0)
  ), 0);
}

export function useTimedStatus(
  message: string,
  clearMessage: React.Dispatch<React.SetStateAction<string>>,
  duration: number,
  persistent = false,
) {
  useEffect(() => {
    if (!message || persistent) return;
    const timer = window.setTimeout(() => clearMessage(''), duration);
    return () => window.clearTimeout(timer);
  }, [clearMessage, duration, message, persistent]);
}

export function loadTemplatesWithDefault(): { templates: Template[]; storageError: boolean } {
  let templates: Template[];
  try {
    templates = loadTemplates();
  } catch {
    return { templates: [], storageError: true };
  }

  try {
    let templatesChanged = false;
    if (window.localStorage.getItem(DEFAULT_TEMPLATE_SEEDED_KEY) !== '1') {
      if (!templates.some((template) => template.name === DEFAULT_DRAFT_NAME && template.body === DEFAULT_DRAFT_BODY)) {
        templates.push(createTemplate({ name: DEFAULT_DRAFT_NAME, body: DEFAULT_DRAFT_BODY }));
        templatesChanged = true;
      }
      window.localStorage.setItem(DEFAULT_TEMPLATE_SEEDED_KEY, '1');
    }

    if (window.localStorage.getItem(BUILT_IN_TEMPLATES_SEEDED_KEY) !== '1') {
      const missingTemplates = BUILT_IN_TEMPLATES
        .filter((builtIn) => !templates.some((template) => template.name === builtIn.name && template.body === builtIn.body))
        .map((template) => createTemplate(template));
      if (missingTemplates.length > 0) {
        templates = [...missingTemplates, ...templates];
        templatesChanged = true;
      }
      if (templatesChanged) saveTemplates(templates);
      window.localStorage.setItem(BUILT_IN_TEMPLATES_SEEDED_KEY, '1');
    } else if (templatesChanged) {
      saveTemplates(templates);
    }
  } catch {
    return { templates, storageError: true };
  }

  return { templates, storageError: false };
}
