import { memo, startTransition, useCallback, useDeferredValue, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { AlertTriangle, ImagePlus } from 'lucide-react';
import { createPortal } from 'react-dom';
import { ChatAvatar } from '../components/ChatAvatar';
import { useConfirm } from '@/components/useConfirm';
import { ChatRemoveModal } from '../components/ChatRemoveModal';
import { ChatPreviewStand, type ChatWallpaper } from '../components/ChatPreviewStand';
import { DraftColorPicker } from '../components/DraftColorPicker';
import { DocumentHistoryDialog } from '../components/editor/DocumentHistoryDialog';
import { RichTextEditor } from '../components/RichTextEditor';
import { WorkspaceTextStage } from '../components/WorkspaceTextStage';
import { useStudioDrafts } from '../hooks/useStudioDrafts';
import { createTemplate, deleteTemplate, insertTextAtSelection, updateTemplate } from '../lib/templates';
import { BUILT_IN_TEMPLATES } from '../lib/builtInTemplates';
import { createSavedDraft, deleteSavedDraft, updateSavedDraft } from '../lib/drafts';
import { convertWebpToTelegramPhoto, inferAttachmentMimeType, isSupportedPhotoAlbumSource, isTelegramPhotoAlbumImage, normalizeAttachments } from '../lib/draftAttachments';
import {
  DEFAULT_DRAFT_BODY,
  DEFAULT_DRAFT_NAME,
  getDraftStorageApi,
  hasDraftContent,
  readInitialWorkspaceDraft,
  readWorkspaceDraftStoreFallback,
} from '../lib/draftStore';
import type { WorkspaceDraft } from '../lib/draftStore';
import { normalizeRichTextEntities, richTextToHtml } from '../lib/richText';
import { sliceRichText } from '../lib/richText';
import { getMessageMaxLength } from '../lib/messageLimits';
import { appendPreviewMessage } from '../lib/preview';
import { toInlineKeyboardMarkup } from '../lib/inlineKeyboard';
import { useLocale } from '@studio/lib/i18n';
import { hasChatHistoryBridge, telegramGetChatHistory } from '@/services/chatAppService';
import type { InlineButtonRow } from '../lib/inlineKeyboard';
import { loadTemplates, saveTemplates } from '../lib/storage';
import { uid } from '@shared/utils';
import {
  EDITOR_APPEARANCE_UPDATED_EVENT,
  getEditorAppearanceCssTokens,
  readEditorAppearancePreferences,
} from '@shared/editorAppearance';
import type { PersistedWorkspaceDocumentVersion } from '@shared/types';
import { areWorkspaceSnapshotsEqual, hasWorkspaceDocumentContent } from '../lib/documentHistory';
import { formatScheduleSummary, getScheduleDateTimeAfter, isFutureSchedule, MAX_SCHEDULE_OCCURRENCES, type ScheduleRepeatOptions } from '../lib/scheduling';
import type {
  Chat,
  DraftAttachment,
  DraftColor,
  PreviewChatHistory,
  RichTextEntity,
  ScheduledMessage,
  SavedDraft,
  Template,
  NotificationType,
} from '../types';
import type { BridgeErrorDetails, StudioPlannerTextPayload } from '@shared/bridge';
import './WorkspacePage.css';

const MemoizedChatPreviewStand = memo(ChatPreviewStand);

function ChatPickerChevron() {
  return (
    <svg className="workspace-page-chat-trigger-chevron" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="workspace-chat-chevron-metal" x1="6" y1="8" x2="18" y2="16" gradientUnits="userSpaceOnUse">
          <stop stopColor="#f5fbff" />
          <stop offset="0.4" stopColor="#c2d8e5" />
          <stop offset="0.72" stopColor="#819aaa" />
          <stop offset="1" stopColor="#e0edf4" />
        </linearGradient>
      </defs>
      <path d="M6 8.8 12 15l6-6.2" fill="none" stroke="rgba(5, 11, 17, 0.86)" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 8.8 12 15l6-6.2" fill="none" stroke="url(#workspace-chat-chevron-metal)" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6.4 8.4 12 14.2l5.6-5.8" fill="none" stroke="rgba(250, 253, 255, 0.5)" strokeWidth="0.65" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export { normalizeAttachments } from '../lib/draftAttachments';
export { hasDraftContent, readWorkspaceDraftStoreFallback, writeWorkspaceDraftStoreFallback } from '../lib/draftStore';

type WorkspacePageProps = {
  connected: boolean;
  connectionRecoveryStatus?: 'reconnecting' | 'offline' | null;
  chats: Chat[];
  selectedChat: Chat | null;
  setSelectedChat: React.Dispatch<React.SetStateAction<Chat | null>>;
  selectedChatControlled?: boolean;
  onAddChat: (chat: Chat) => void;
  onRemoveChat: (chat: Chat) => void;
  removeModal: { show: boolean; chat: Chat | null };
  setRemoveModal: React.Dispatch<React.SetStateAction<{ show: boolean; chat: Chat | null }>>;
  confirmRemoveChat: () => void;
  upcoming: ScheduledMessage[];
  date: string;
  time: string;
  scheduling: boolean;
  successPulse: boolean;
  lastAction: 'sent' | 'scheduled' | null;
  setDate: React.Dispatch<React.SetStateAction<string>>;
  setTime: React.Dispatch<React.SetStateAction<string>>;
  handleSchedule: (payload?: {
    chatId: string;
    message: string;
    date: string;
    time: string;
    attachments?: string[];
    attachmentGroups?: string[][];
    entities?: RichTextEntity[];
    replyMarkup?: ReturnType<typeof toInlineKeyboardMarkup>;
    effect?: string;
    replaceMessage?: ScheduledMessage;
  }, repeat?: ScheduleRepeatOptions) => void | Promise<void | boolean | 'sent-history-failed'>;
  handleCancelMessage: (message: ScheduledMessage) => void;
  handleCancelMessages?: (messages: ScheduledMessage[]) => Promise<boolean>;
  handleSendDraftNow: (chat: Chat, text: string, attachments?: string[], entities?: RichTextEntity[], replyMarkup?: ReturnType<typeof toInlineKeyboardMarkup>, attachmentGroups?: string[][], onAttachmentGroupResult?: (groupIndex: number, sent: boolean) => void, effect?: string, suppressNotifications?: boolean) => Promise<boolean | 'sent-history-failed'>;
  publishingDraft: boolean;
  showNotification?: (
    message: string,
    type: NotificationType,
    title: string,
    errorDetails?: BridgeErrorDetails,
    durationMs?: number,
  ) => void;
  onRegisterPlannerTextOpener?: (opener: ((payload: StudioPlannerTextPayload) => Promise<boolean>) | null) => void;
  onRegisterBeforeLeaveStudio?: (flush: (() => Promise<boolean>) | null) => void;
  onRegisterHistoryDraftOpener?: (opener: ((draft: SavedDraft) => void) | null) => void;
  onRegisterHistoryDraftUseHandler?: (handler: ((draft: SavedDraft) => Promise<boolean>) | null) => void;
  onRegisterHistoryDraftClearHandler?: (handler: (() => Promise<boolean>) | null) => void;
  onRegisterHistoryDraftDeleteHandler?: (handler: ((draftId: string) => Promise<boolean>) | null) => void;
  onRegisterHistoryRescheduleHandler?: (handler: ((message: ScheduledMessage) => void) | null) => void;
};

type PublishAction = 'send' | 'schedule' | 'draft';
type TelegramConnectionState = 'connected' | 'connecting' | 'reconnecting' | 'disconnected';
type PublishFooterStatus = {
  message: string;
  detail?: string;
  kind: 'error' | 'progress' | 'warning' | 'success' | 'notice';
  transient: boolean;
  duration: number | null;
};
type PendingDraftReplacement = {
  previousSnapshot: WorkspaceDraft;
};
type IconRimMotion = {
  currentAngle: number;
  targetAngle: number;
  lastFrameTime: number | null;
  frameId: number | null;
  fadeFrameId: number | null;
  currentGlowStrength: number;
  currentBeamSpread: number;
};

const iconRimMotions = new WeakMap<HTMLButtonElement, IconRimMotion>();
const ICON_RIM_MAX_SPEED = 420;
const ICON_RIM_CENTER_DEAD_ZONE = 3;
const ICON_GLOW_ACTIVATION_DISTANCE = 8;

function savedDraftToWorkspaceSnapshot(draft: SavedDraft): WorkspaceDraft {
  return {
    documentId: draft.documentId ?? draft.id,
    body: draft.body,
    entities: draft.entities ?? [],
    attachments: normalizeAttachments(draft.attachments),
    selectedChat: draft.selectedChat ?? null,
    inlineButtons: draft.inlineButtons ?? [],
    date: draft.date ?? '',
    time: draft.time ?? '',
    repeatMode: draft.repeatMode ?? 'none',
    repeatDays: draft.repeatDays ?? [],
    repeatOccurrences: draft.repeatOccurrences ?? 1,
    savedAt: draft.updatedAt,
  };
}

function updateGlassPointer(event: React.PointerEvent<HTMLButtonElement>) {
  if (event.pointerType === 'touch') return;
  const bounds = event.currentTarget.getBoundingClientRect();
  event.currentTarget.style.setProperty('--pointer-x', `${event.clientX - bounds.left}px`);
  event.currentTarget.style.setProperty('--pointer-y', `${event.clientY - bounds.top}px`);
}

function clearGlassPointer(event: React.PointerEvent<HTMLButtonElement>) {
  event.currentTarget.style.removeProperty('--pointer-x');
  event.currentTarget.style.removeProperty('--pointer-y');
  event.currentTarget.style.removeProperty('--beam-x');
  event.currentTarget.style.removeProperty('--beam-y');
  event.currentTarget.style.removeProperty('--beam-shift-x');
  event.currentTarget.style.removeProperty('--beam-shift-y');
  event.currentTarget.style.setProperty('--glow-strength', '0');
  event.currentTarget.style.setProperty('--beam-spread', '0.35');
  event.currentTarget.style.setProperty('--rim-angle', '0deg');
}

function clearIconRimPointer(event: React.PointerEvent<HTMLButtonElement>) {
  if (event.pointerType === 'touch') return;

  const button = event.currentTarget;
  let motion = iconRimMotions.get(button);

  if (!motion) {
    motion = {
      currentAngle: 0,
      targetAngle: 0,
      lastFrameTime: null,
      frameId: null,
      fadeFrameId: null,
      currentGlowStrength: 0,
      currentBeamSpread: 0.35,
    };
    iconRimMotions.set(button, motion);
  }

  if (motion.frameId !== null) {
    window.cancelAnimationFrame(motion.frameId);
    motion.frameId = null;
    motion.lastFrameTime = null;
  }

  if (motion.fadeFrameId !== null) {
    window.cancelAnimationFrame(motion.fadeFrameId);
    motion.fadeFrameId = null;
  }

  motion.currentGlowStrength = Number(button.style.getPropertyValue('--glow-strength') || motion.currentGlowStrength || 0);
  motion.currentBeamSpread = Number(button.style.getPropertyValue('--beam-spread') || motion.currentBeamSpread || 0.35);

  const fadeDurationMs = 520;
  let fadeStartTime: number | null = null;

  const animateFadeOut = (timestamp: number) => {
    if (fadeStartTime === null) {
      fadeStartTime = timestamp;
    }

    const elapsed = timestamp - fadeStartTime;
    const progress = Math.min(elapsed / fadeDurationMs, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const glowStrength = motion!.currentGlowStrength * (1 - eased);
    const beamSpread = motion!.currentBeamSpread + (0.35 - motion!.currentBeamSpread) * (1 - eased);

    button.style.setProperty('--glow-strength', glowStrength.toFixed(3));
    button.style.setProperty('--beam-spread', beamSpread.toFixed(3));
    button.style.setProperty('--rim-opacity', (Math.max(glowStrength, 0) * 0.9).toFixed(3));

    if (progress < 1) {
      motion!.fadeFrameId = window.requestAnimationFrame(animateFadeOut);
      return;
    }

    button.style.setProperty('--glow-strength', '0');
    button.style.setProperty('--beam-spread', '0.35');
    button.style.setProperty('--rim-angle', '0deg');
    button.style.setProperty('--rim-opacity', '0');
    motion!.fadeFrameId = null;
  };

  motion.fadeFrameId = window.requestAnimationFrame(animateFadeOut);
}

function updateIconRimPointer(event: React.PointerEvent<HTMLButtonElement>) {
  if (event.pointerType === 'touch') return;

  const button = event.currentTarget;
  const bounds = button.getBoundingClientRect();
  const x = event.clientX - bounds.left;
  const y = event.clientY - bounds.top;
  const pointerX = clamp(x, 0, bounds.width);
  const pointerY = clamp(y, 0, bounds.height);
  const offsetX = pointerX - bounds.width / 2;
  const offsetY = pointerY - bounds.height / 2;

  const distanceToEdge = Math.min(
    pointerX,
    bounds.width - pointerX,
    pointerY,
    bounds.height - pointerY,
  );
  const glowStrength = clamp(
    (ICON_GLOW_ACTIVATION_DISTANCE - Math.max(distanceToEdge, 0)) / ICON_GLOW_ACTIVATION_DISTANCE,
    0,
    1,
  );
  const beamSpread = 0.7 + glowStrength * 1.8;
  event.currentTarget.style.setProperty('--pointer-x', `${pointerX}px`);
  event.currentTarget.style.setProperty('--pointer-y', `${pointerY}px`);
  event.currentTarget.style.setProperty('--glow-strength', glowStrength.toFixed(3));
  event.currentTarget.style.setProperty('--beam-spread', beamSpread.toFixed(3));
  event.currentTarget.style.setProperty('--rim-opacity', (glowStrength * 0.9).toFixed(3));

  if (Math.hypot(offsetX, offsetY) < ICON_RIM_CENTER_DEAD_ZONE) return;

  const rimAngle = Math.atan2(offsetY, offsetX) * 180 / Math.PI + 90;
  let motion = iconRimMotions.get(button);

  if (!motion) {
    motion = {
      currentAngle: rimAngle,
      targetAngle: rimAngle,
      lastFrameTime: null,
      frameId: null,
      fadeFrameId: null,
      currentGlowStrength: glowStrength,
      currentBeamSpread: beamSpread,
    };
    iconRimMotions.set(button, motion);
    button.style.setProperty('--rim-angle', `${rimAngle}deg`);
    return;
  }

  motion.targetAngle = rimAngle;
  motion.currentGlowStrength = glowStrength;
  motion.currentBeamSpread = beamSpread;

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    if (motion.frameId !== null) window.cancelAnimationFrame(motion.frameId);
    motion.currentAngle = motion.targetAngle;
    motion.lastFrameTime = null;
    motion.frameId = null;
    button.style.setProperty('--rim-angle', `${motion.currentAngle}deg`);
    return;
  }

  if (motion.frameId !== null) return;

  const animateRim = (timestamp: number) => {
    const elapsed = motion?.lastFrameTime === null
      ? 16
      : Math.min(timestamp - motion.lastFrameTime, 18);
    motion!.lastFrameTime = timestamp;

    const rawDifference = motion!.targetAngle - motion!.currentAngle;
    const difference = ((rawDifference + 540) % 360) - 180;
    const easedStep = difference * (1 - Math.exp(-elapsed / 26));
    const maxStep = ICON_RIM_MAX_SPEED * elapsed / 1000;
    const step = Math.sign(difference || 1) * Math.min(Math.abs(easedStep), maxStep);
    motion!.currentAngle += step;

    if (Math.abs(difference) < 0.45) {
      motion!.currentAngle = motion!.targetAngle;
      motion!.frameId = null;
      motion!.lastFrameTime = null;
    } else {
      motion!.frameId = window.requestAnimationFrame(animateRim);
    }

    button.style.setProperty('--rim-angle', `${motion!.currentAngle}deg`);
  };

  motion.frameId = window.requestAnimationFrame(animateRim);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

const FOOTER_STATUS_DURATION_MS = {
  attachmentError: 3360,
  publishWarning: 5000,
  publishSuccess: 3360,
  sendError: 8000,
  draftStoreError: 12000,
  textFileError: 7000,
  chatLookupError: 7000,
  previewHistoryError: 10000,
} as const;

function getPreviewHistoryErrorPresentation(
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

function getPreviewHistoryMediaDataUrlChars(history: PreviewChatHistory) {
  return history.messages.reduce((total, message) => (
    total
    + (message.media?.dataUrl?.length ?? 0)
    + (message.media?.thumbnailDataUrl?.length ?? 0)
  ), 0);
}

function useTimedStatus(
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

type WorkspaceAttachment = DraftAttachment;

export function remapAttachmentPositions(
  attachments: WorkspaceAttachment[],
  previousText: string,
  nextText: string,
): WorkspaceAttachment[] {
  if (previousText === nextText || attachments.length === 0) return attachments;

  let prefixLength = 0;
  while (
    prefixLength < previousText.length
    && prefixLength < nextText.length
    && previousText[prefixLength] === nextText[prefixLength]
  ) prefixLength += 1;

  let suffixLength = 0;
  while (
    suffixLength < previousText.length - prefixLength
    && suffixLength < nextText.length - prefixLength
    && previousText[previousText.length - suffixLength - 1] === nextText[nextText.length - suffixLength - 1]
  ) suffixLength += 1;

  const previousEditEnd = previousText.length - suffixLength;
  const nextEditEnd = nextText.length - suffixLength;
  const lengthDelta = nextText.length - previousText.length;

  let positionsChanged = false;
  const remappedAttachments = attachments.map((attachment) => {
    const position = attachment.position < prefixLength
      ? attachment.position
      : attachment.position >= previousEditEnd
        ? attachment.position + lengthDelta
        : nextEditEnd;
    if (position === attachment.position) return attachment;
    positionsChanged = true;
    return { ...attachment, position: Math.max(0, position) };
  });
  return positionsChanged ? remappedAttachments : attachments;
}

const PREVIEW_LAYOUT_KEY = 'xmsgi-preview-layout';
const LEGACY_PREVIEW_LAYOUT_KEY = 'awaitmsg-preview-layout';
const CHAT_WALLPAPER_STORAGE_KEY = 'xmsgi-chat-preview-wallpaper';
const LEGACY_CHAT_WALLPAPER_STORAGE_KEY = 'awaitmsg-chat-preview-wallpaper';
const DEFAULT_TEMPLATE_SEEDED_KEY = 'xmsgi-default-template-seeded-v1';
const BUILT_IN_TEMPLATES_SEEDED_KEY = 'xmsgi-built-in-templates-seeded-v1';
const MAX_ALBUMS = 3;
const MAX_PHOTOS_PER_ALBUM = 10;
const MAX_ATTACHMENTS = MAX_ALBUMS * MAX_PHOTOS_PER_ALBUM;
const MAX_ATTACHMENT_SIZE = 50 * 1024 * 1024;
const MAX_ATTACHMENTS_TOTAL_SIZE = 200 * 1024 * 1024;
const PREVIEW_HISTORY_LIMIT = 50;
const PREVIEW_HISTORY_CACHE_TTL_MS = 20_000;
const PREVIEW_HISTORY_CACHE_SIZE = 2;
const PREVIEW_HISTORY_CACHE_MAX_MEDIA_DATA_URL_CHARS = 4 * 1024 * 1024;

type PreviewLayout = {
  collapsed?: boolean;
  visible?: boolean;
};

const DEFAULT_PREVIEW_LAYOUT: PreviewLayout = { visible: true };

function loadTemplatesWithDefault(): { templates: Template[]; storageError: boolean } {
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

function isLivePreviewSurface() {
  const portMatches = ['4175', '4176'].includes(window.location.port);
  return portMatches || document.body?.dataset?.livePreview === 'true';
}

function readPreviewLayout(): PreviewLayout | null {
  try {
    const primaryRaw = window.localStorage.getItem(PREVIEW_LAYOUT_KEY);
    const raw = primaryRaw ?? window.localStorage.getItem(LEGACY_PREVIEW_LAYOUT_KEY);
    if (!raw) return null;
    if (!primaryRaw) {
      window.localStorage.setItem(PREVIEW_LAYOUT_KEY, raw);
    }

    const parsed = JSON.parse(raw) as Partial<PreviewLayout>;
    return {
      collapsed: parsed.collapsed === true,
      visible: typeof parsed.visible === 'boolean' ? parsed.visible : true,
    };
  } catch {
    // ignore invalid preview layout
  }

  return null;
}

function readChatWallpaper(): ChatWallpaper {
  try {
    const primaryRaw = window.localStorage.getItem(CHAT_WALLPAPER_STORAGE_KEY);
    const raw = primaryRaw ?? window.localStorage.getItem(LEGACY_CHAT_WALLPAPER_STORAGE_KEY);
    if (!raw) return { theme: 'telegram', image: '', accent: '' };
    if (!primaryRaw) {
      window.localStorage.setItem(CHAT_WALLPAPER_STORAGE_KEY, raw);
    }

    const parsed = JSON.parse(raw) as Partial<ChatWallpaper>;
    return {
      theme: parsed.theme === 'custom' ? 'custom' : parsed.theme === 'graphite' ? 'graphite' : 'telegram',
      image: typeof parsed.image === 'string' ? parsed.image : '',
      accent: typeof parsed.accent === 'string' ? parsed.accent : '',
    };
  } catch {
    return { theme: 'telegram', image: '', accent: '' };
  }
}

function createAttachmentId() {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `attachment-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isImageAttachment(attachment: WorkspaceAttachment) {
  return attachment.type === 'image' || attachment.mimeType.startsWith('image/');
}

type PhotoAlbumDisplayItem = {
  kind: 'album';
  albumId: string;
  position: number;
  attachments: WorkspaceAttachment[];
};

type AttachmentDisplayItem = PhotoAlbumDisplayItem | { kind: 'file'; attachment: WorkspaceAttachment };

function getAttachmentDisplayItems(attachments: WorkspaceAttachment[]): AttachmentDisplayItem[] {
  const items: AttachmentDisplayItem[] = [];
  const albums = new Map<string, PhotoAlbumDisplayItem>();

  attachments.slice().sort((left, right) => left.position - right.position).forEach((attachment) => {
    if (!attachment.albumId) {
      items.push({ kind: 'file', attachment });
      return;
    }

    let album = albums.get(attachment.albumId);
    if (!album) {
      album = {
        kind: 'album',
        albumId: attachment.albumId,
        position: attachment.position,
        attachments: [],
      };
      albums.set(attachment.albumId, album);
      items.push(album);
    }
    album.attachments.push(attachment);
  });

  return items;
}

function getAttachmentTransportItems(attachments: WorkspaceAttachment[]) {
  return getAttachmentDisplayItems(attachments)
    .map((item) => {
      const itemAttachments = item.kind === 'album' ? item.attachments : [item.attachment];
      return {
        attachments: itemAttachments,
        paths: itemAttachments.map((attachment) => attachment.path || attachment.previewUrl || attachment.name).filter(Boolean),
      };
    })
    .filter((group) => group.paths.length > 0);
}

function getAttachmentTransportGroups(attachments: WorkspaceAttachment[]): string[][] {
  return getAttachmentTransportItems(attachments).map((group) => group.paths);
}

function formatAttachmentSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }
      reject(new Error(`The selected file could not be converted to a data URL: ${file.name}`));
    };
    reader.onerror = () => reject(new Error(`The selected file could not be read: ${file.name}`));
    reader.readAsDataURL(file);
  });
}

function toFileUrl(filePath: string) {
  if (/^(?:blob:|data:|https?:|file:)/i.test(filePath)) return filePath;

  const normalizedPath = filePath.replace(/\\/g, '/');
  const encodedPath = normalizedPath
    .split('/')
    .map((segment, index) => (index === 0 ? segment : encodeURIComponent(segment)))
    .join('/');

  return `file:///${encodedPath}`;
}

export function WorkspacePage({
  connected,
  connectionRecoveryStatus = null,
  chats,
  selectedChat,
  setSelectedChat,
  selectedChatControlled = false,
  onAddChat,
  onRemoveChat,
  removeModal,
  setRemoveModal,
  confirmRemoveChat,
  upcoming,
  date,
  time,
  scheduling,
  successPulse,
  lastAction,
  setDate,
  setTime,
  handleSchedule,
  handleSendDraftNow,
  publishingDraft,
  onRegisterPlannerTextOpener,
  onRegisterBeforeLeaveStudio,
  onRegisterHistoryDraftOpener,
  onRegisterHistoryDraftUseHandler,
  onRegisterHistoryDraftClearHandler,
  onRegisterHistoryDraftDeleteHandler,
  onRegisterHistoryRescheduleHandler,
}: WorkspacePageProps) {
  const { locale, t } = useLocale();
  const confirm = useConfirm();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const albumFileInputRef = useRef<HTMLInputElement | null>(null);
  const albumAttachmentPositionRef = useRef(0);
  const albumAttachmentTargetIdRef = useRef<string | null>(null);
  const attachmentPreviewUrlsRef = useRef(new Set<string>());
  const attachmentItemsRef = useRef<HTMLDivElement | null>(null);
  const bodyInputRef = useRef<HTMLDivElement | null>(null);
  const focusRescheduledEditorAtEndRef = useRef(false);
  const focusPlannerEditorAtEndRef = useRef(false);
  const focusEditorAfterStageEscapeRef = useRef(false);
  const restorePlannerDocumentRef = useRef<() => Promise<boolean>>(async () => false);
  const historyDraftOpenerRef = useRef<(draft: SavedDraft) => void>(() => undefined);
  const historyDraftUseRef = useRef<(draft: SavedDraft) => Promise<boolean>>(async () => false);
  const historyDraftClearerRef = useRef<() => Promise<boolean>>(async () => false);
  const historyDraftDeleterRef = useRef<(draftId: string) => Promise<boolean>>(async () => false);
  const historyRescheduleHandlerRef = useRef<(message: ScheduledMessage) => void>(() => undefined);
  const previewFeedRef = useRef<HTMLDivElement | null>(null);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const initialPreviewLayoutRef = useRef<PreviewLayout | null>(null);
  const initialDraftRef = useRef<Partial<WorkspaceDraft> | null>(null);
  const initialDraftLoadErrorRef = useRef('');

  if (initialPreviewLayoutRef.current === null) {
    initialPreviewLayoutRef.current = readPreviewLayout();
  }

  if (initialDraftRef.current === null) {
    try {
      initialDraftRef.current = readInitialWorkspaceDraft();
    } catch (error) {
      initialDraftRef.current = {};
      initialDraftLoadErrorRef.current = error instanceof Error
        ? error.message
        : 'Saved workspace draft could not be read.';
    }
  }

  const [workspaceDocumentId, setWorkspaceDocumentIdState] = useState(
    () => initialDraftRef.current?.documentId || uid(),
  );
  const workspaceDocumentIdRef = useRef(workspaceDocumentId);
  workspaceDocumentIdRef.current = workspaceDocumentId;
  const setWorkspaceDocumentId = (documentId: string) => {
    workspaceDocumentIdRef.current = documentId;
    setWorkspaceDocumentIdState(documentId);
  };

  const [draftBody, setDraftBody] = useState(() => initialDraftRef.current?.body ?? '');
  const draftBodyRef = useRef(draftBody);
  useEffect(() => {
    draftBodyRef.current = draftBody;
  }, [draftBody]);
  const [draftEntities, setDraftEntities] = useState<RichTextEntity[]>(
    () => initialDraftRef.current?.entities ?? [],
  );
  const [messageEffectId, setMessageEffectId] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<WorkspaceAttachment[]>(
    () => normalizeAttachments(initialDraftRef.current?.attachments),
  );
  const attachmentUsageRef = useRef({
    count: attachments.length,
    size: attachments.reduce((total, attachment) => total + (attachment.size ?? 0), 0),
    albumIds: new Set(attachments.flatMap((attachment) => attachment.albumId ? [attachment.albumId] : [])),
  });
  const pendingAttachmentUsageRef = useRef(new Map<number, { count: number; size: number }>());
  const pendingAlbumIdsRef = useRef(new Set<string>());
  const pendingAlbumPhotoCountsRef = useRef(new Map<string, number>());
  const attachmentSelectionGenerationRef = useRef(0);
  const replaceAttachments = (nextAttachments: WorkspaceAttachment[]) => {
    attachmentUsageRef.current = {
      count: nextAttachments.length,
      size: nextAttachments.reduce((total, attachment) => total + (attachment.size ?? 0), 0),
      albumIds: new Set(nextAttachments.flatMap((attachment) => attachment.albumId ? [attachment.albumId] : [])),
    };
    setAttachments(nextAttachments);
  };
  const [attachmentPreview, setAttachmentPreview] = useState<{
    src: string;
    name: string;
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const attachmentPreviewTimerRef = useRef<number | null>(null);
  const [attachmentError, setAttachmentError] = useState('');
  const [textFileError, setTextFileError] = useState('');
  const [inlineButtons, setInlineButtons] = useState<InlineButtonRow[]>(
    () => initialDraftRef.current?.inlineButtons ?? [],
  );
  const [initialTemplateState] = useState(loadTemplatesWithDefault);
  const [templates, setTemplates] = useState<Template[]>(initialTemplateState.templates);
  const [templateStorageError, setTemplateStorageError] = useState(initialTemplateState.storageError);
  const [stageMode, setStageMode] = useState<'editor' | 'schedule' | 'template' | 'draft' | 'chat' | 'buttons'>(() => {
    return isLivePreviewSurface() ? 'schedule' : 'editor';
  });
  const [scheduleFocus, setScheduleFocus] = useState<'repeat' | 'time' | null>(() => {
    return isLivePreviewSurface() ? 'time' : null;
  });
  const [followCurrentTime, setFollowCurrentTime] = useState(true);
  const [scheduleClockNow, setScheduleClockNow] = useState(() => Date.now());
  const publishFeedbackTimerRef = useRef<number | null>(null);
  const [scheduleSelectionConfirmed, setScheduleSelectionConfirmed] = useState(false);
  const [, setStageTab] = useState<'editor' | 'templates' | 'drafts' | 'buttons'>('editor');
  const [workspaceSelectedChats, setWorkspaceSelectedChats] = useState<Chat[]>([]);
  const workspaceChatOriginRef = useRef<Chat | null>(null);
  const [repeatMode, setRepeatMode] = useState<ScheduleRepeatOptions['mode']>('none');
  const [repeatDays, setRepeatDays] = useState<string[]>([]);
  const [repeatOccurrences, setRepeatOccurrences] = useState(5);
  const [templateEditingId, setTemplateEditingId] = useState<string | null>(null);
  const [templateDraftName, setTemplateDraftName] = useState('');
  const [templateDraftBody, setTemplateDraftBody] = useState('');
  const [draftEditingId, setDraftEditingId] = useState<string | null>(null);
  const draftEditingSourceRef = useRef<SavedDraft | null>(null);
  const [draftColor, setDraftColor] = useState<DraftColor>('gray');
  const [draftEditorColor, setDraftEditorColor] = useState<DraftColor>('gray');
  const [draftName, setDraftName] = useState('');
  const [draftBodyText, setDraftBodyText] = useState('');
  const [draftBodyEntities, setDraftBodyEntities] = useState<RichTextEntity[]>([]);
  const [previewHistory, setPreviewHistory] = useState<PreviewChatHistory | null>(null);
  const [previewHistoryLoading, setPreviewHistoryLoading] = useState(false);
  const [previewHistoryError, setPreviewHistoryError] = useState('');
  const [previewHistoryErrorRetryable, setPreviewHistoryErrorRetryable] = useState(false);
  const [previewHistoryRetry, setPreviewHistoryRetry] = useState(0);
  const previewHistoryCacheRef = useRef(new Map<string, { history: PreviewChatHistory; cachedAt: number }>());
  const [chatLookupError, setChatLookupError] = useState('');
  const [, setChatWallpaper] = useState<ChatWallpaper>(() => readChatWallpaper());
  const [chatListOpen, setChatListOpen] = useState(false);
  const [publishMenuOpen, setPublishMenuOpen] = useState(false);
  const [sendInFlight, setSendInFlight] = useState(false);
  const [sendError, setSendError] = useState('');
  const [publishFeedback, setPublishFeedback] = useState('');
  const [publishFeedbackDetail, setPublishFeedbackDetail] = useState('');
  const [publishFeedbackKind, setPublishFeedbackKind] = useState<'warning' | 'success'>('warning');
  const [publishFeedbackOverridesProgress, setPublishFeedbackOverridesProgress] = useState(false);
  const [publishFeedbackInstance, setPublishFeedbackInstance] = useState(0);
  const pendingDraftReplacementRef = useRef<PendingDraftReplacement | null>(null);
  const suppressDraftReplacementSuccessClearRef = useRef(false);
  const draftReplacementCompletionRef = useRef<Promise<boolean> | null>(null);
  const completeDraftReplacementRef = useRef<() => Promise<boolean>>(async () => false);
  const [retriggeredPublishFeedback, setRetriggeredPublishFeedback] = useState<{ message: string; kind: string } | null>(null);
  const lastPublishFeedbackRef = useRef<{ message: string; kind: string } | null>(null);
  const [telegramConnectionState, setTelegramConnectionState] = useState<TelegramConnectionState>(
    connected ? 'connected' : 'disconnected',
  );
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const [selectedHistoryDocumentId, setSelectedHistoryDocumentId] = useState<string | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [isRestoringVersion, setIsRestoringVersion] = useState(false);
  const [versionRestoreError, setVersionRestoreError] = useState('');

  useEffect(() => {
    if (stageMode !== 'schedule' || scheduleFocus === 'repeat') return undefined;

    let timeoutId = 0;
    const refreshScheduleClock = () => {
      setScheduleClockNow(Date.now());
      if (followCurrentTime) {
        const nextSchedule = getScheduleDateTimeAfter(0);
        setDate((current) => current === nextSchedule.date ? current : nextSchedule.date);
        setTime((current) => current === nextSchedule.time ? current : nextSchedule.time);
      }
      timeoutId = window.setTimeout(refreshScheduleClock, 60_000 - (Date.now() % 60_000) + 25);
    };

    refreshScheduleClock();
    return () => window.clearTimeout(timeoutId);
  }, [followCurrentTime, scheduleFocus, setDate, setTime, stageMode]);
  const sendInFlightRef = useRef(false);
  const [publishAction, setPublishAction] = useState<PublishAction>('send');
  const [editorAppearance, setEditorAppearance] = useState(readEditorAppearancePreferences);
  useEffect(() => {
    const refreshEditorAppearance = () => setEditorAppearance(readEditorAppearancePreferences());
    window.addEventListener(EDITOR_APPEARANCE_UPDATED_EVENT, refreshEditorAppearance);
    window.addEventListener('storage', refreshEditorAppearance);
    return () => {
      window.removeEventListener(EDITOR_APPEARANCE_UPDATED_EVENT, refreshEditorAppearance);
      window.removeEventListener('storage', refreshEditorAppearance);
    };
  }, []);
  useEffect(() => {
    const productShell = workspaceRef.current?.closest<HTMLElement>('.product-shell');
    if (!productShell) return undefined;

    const outline = getEditorAppearanceCssTokens(editorAppearance, publishAction)['--editor-outline'];
    productShell.style.setProperty('--studio-title-icon-color', `rgb(${outline})`);
    return () => {
      productShell.style.removeProperty('--studio-title-icon-color');
    };
  }, [editorAppearance, publishAction]);
  const [rescheduleSource, setRescheduleSource] = useState<ScheduledMessage | null>(null);
  const rescheduleSourceRef = useRef<ScheduledMessage | null>(null);
  // Previous Studio document auto-saved when a Planner note is opened in the editor.
  // Restored after the Planner note is saved, sent, or scheduled so the user never loses
  // what was already in the editor before opening the Planner text.
  const plannerRestoreRef = useRef<{ draft: SavedDraft | null } | null>(null);
  const scheduleSubmissionPendingRef = useRef(false);
  const scheduleSubmissionStartedRef = useRef(false);
  const publishMenuRef = useRef<HTMLDivElement | null>(null);
  const publishMenuToggleRef = useRef<HTMLButtonElement | null>(null);
  const [previewLayout, setPreviewLayout] = useState<PreviewLayout>(() => {
    const layout = initialPreviewLayoutRef.current ?? DEFAULT_PREVIEW_LAYOUT;
    return {
      collapsed: layout.collapsed === true,
      visible: layout.visible ?? true,
    };
  });
  const previewCollapsed = previewLayout.collapsed === true;
  const maxDraftLength = getMessageMaxLength(attachments.length > 0);

  useLayoutEffect(() => {
    const attachmentItems = attachmentItemsRef.current;
    if (!attachmentItems) return undefined;

    const updateOverflow = () => {
      attachmentItems.classList.toggle(
        'has-overflow',
        attachmentItems.scrollWidth > attachmentItems.clientWidth + 1,
      );
    };

    updateOverflow();
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(updateOverflow);
    resizeObserver?.observe(attachmentItems);

    return () => resizeObserver?.disconnect();
  }, [attachments]);

  useLayoutEffect(() => {
    const workspace = workspaceRef.current;
    const editor = workspace?.querySelector<HTMLElement>('.workspace-page-editor-shell');
    const previewPanel = workspace?.querySelector<HTMLElement>('.workspace-page-preview-panel');
    const previewWindow = previewPanel?.querySelector<HTMLElement>('.chat-preview-window');
    const workspaceMain = workspace?.querySelector<HTMLElement>('.workspace-page-main');
    if (!editor || !previewPanel || !previewWindow || !workspaceMain) return undefined;

    const offsetProperty = '--workspace-page-preview-horizontal-offset';
    let animationFrame = 0;
    const alignPreview = () => {
      animationFrame = 0;
      if (previewPanel.dataset.visible === 'false' || previewPanel.dataset.collapsed === 'true') return;

      const editorBounds = editor.getBoundingClientRect();
      const previewBounds = previewWindow.getBoundingClientRect();
      const previewPanelBounds = previewPanel.getBoundingClientRect();
      const workspaceBounds = workspaceMain.getBoundingClientRect();
      if (!editorBounds.width || !previewBounds.width) return;

      const offset = Number.parseFloat(previewPanel.style.getPropertyValue(offsetProperty)) || 0;
      const previewWidthReserve = Number.parseFloat(getComputedStyle(previewPanel).getPropertyValue('--workspace-page-preview-window-width-reserve')) || 0;
      const previewShell = previewPanel.querySelector<HTMLElement>('.chat-preview-window-shell');
      const previewScale = previewPanel.offsetWidth > 0 ? previewPanelBounds.width / previewPanel.offsetWidth : 1;
      const alignedPreviewWidth = previewWidthReserve > 0 && previewShell
        ? Math.min(previewWindow.offsetWidth, Math.max(0, previewShell.clientWidth - previewWidthReserve))
        : previewWindow.offsetWidth;
      const editorGap = previewBounds.left - editorBounds.right;
      const viewportGap = workspaceBounds.right - previewBounds.right
        + (previewWindow.offsetWidth - alignedPreviewWidth) * previewScale;
      const nextOffset = offset - (editorGap - viewportGap) / 2;
      if (Math.abs(nextOffset - offset) > 0.25) {
        previewPanel.style.setProperty(offsetProperty, `${nextOffset}px`);
      }
    };
    const scheduleAlignment = () => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(alignPreview);
    };

    const resizeObserver = new ResizeObserver(scheduleAlignment);
    resizeObserver.observe(workspaceMain);
    resizeObserver.observe(editor);
    resizeObserver.observe(previewPanel);
    resizeObserver.observe(previewWindow);
    window.addEventListener('resize', scheduleAlignment);
    scheduleAlignment();

    return () => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      window.removeEventListener('resize', scheduleAlignment);
      previewPanel.style.removeProperty(offsetProperty);
    };
  }, [previewLayout.collapsed, previewLayout.visible]);

  const applyWorkspaceDraft = (workspaceDraft: Partial<WorkspaceDraft> | null) => {
    if (rescheduleSourceRef.current) return;
    const documentId = workspaceDraft?.documentId || workspaceDocumentIdRef.current || uid();
    setWorkspaceDocumentId(documentId);
    initialDraftRef.current = {
      ...(workspaceDraft ?? {}),
      documentId,
      body: workspaceDraft?.body ?? '',
      entities: normalizeRichTextEntities(workspaceDraft?.entities, workspaceDraft?.body?.length ?? 0),
      attachments: normalizeAttachments(workspaceDraft?.attachments),
      selectedChat: workspaceDraft?.selectedChat ?? selectedChat,
      savedAt: workspaceDraft?.savedAt ?? '',
      inlineButtons: workspaceDraft?.inlineButtons ?? [],
      date: workspaceDraft?.date || date,
      time: workspaceDraft?.time || time,
      repeatMode: workspaceDraft?.repeatMode || repeatMode,
      repeatDays: workspaceDraft?.repeatDays ?? [],
      repeatOccurrences: workspaceDraft?.repeatOccurrences || repeatOccurrences,
    };
    attachmentSelectionGenerationRef.current += 1;
    if (workspaceDraft) {
      setDraftBody(workspaceDraft.body ?? '');
      setDraftEntities(normalizeRichTextEntities(workspaceDraft.entities, workspaceDraft.body?.length ?? 0));
      replaceAttachments(normalizeAttachments(workspaceDraft.attachments));
      setInlineButtons(workspaceDraft.inlineButtons ?? []);
      if (workspaceDraft.date || workspaceDraft.time) setFollowCurrentTime(false);
      if (workspaceDraft.date) setDate(workspaceDraft.date);
      if (workspaceDraft.time) setTime(workspaceDraft.time);
      if (workspaceDraft.repeatMode) setRepeatMode(workspaceDraft.repeatMode);
      setRepeatDays(workspaceDraft.repeatDays ?? []);
      if (workspaceDraft.repeatOccurrences) setRepeatOccurrences(workspaceDraft.repeatOccurrences);
    } else {
      setDraftBody('');
      setDraftEntities([]);
      replaceAttachments([]);
      setInlineButtons([]);
    }
  };

  const draftLifecycle = useStudioDrafts({
    initialWorkspaceDraftRef: initialDraftRef,
    initialWorkspaceDraftError: initialDraftLoadErrorRef.current,
    workspace: {
      documentId: workspaceDocumentId,
      body: draftBody,
      entities: draftEntities,
      attachments,
      selectedChat,
      inlineButtons,
      date,
      time,
      repeatMode,
      repeatDays,
      repeatOccurrences,
    },
    chats,
    setSelectedChat,
    preserveSelectedChat: selectedChatControlled,
    setDate,
    setTime,
    rescheduleSourceRef,
    onWorkspaceDraftLoaded: applyWorkspaceDraft,
  });
  const {
    savedDrafts,
    savedDraftsRef,
    replaceSavedDrafts,
    documentHistories,
    draftStoreReady,
    draftStateHydrated,
    draftStoreSaving,
    draftStoreError,
    setDraftStoreError,
    draftStoreBackups,
    savedAt,
    setSavedAt,
    persistDraftStore,
    cancelPendingAutosave,
    flushWorkspaceDraftNow,
    createWorkspaceDraftSnapshot,
    prepareWorkspaceVersionSnapshot,
    recordWorkspaceVersion,
    handleRestoreDraftBackup: restoreDraftBackup,
    handleExportDrafts: exportDrafts,
    handleImportDrafts: importDrafts,
  } = draftLifecycle;
  const recordWorkspaceVersionRef = useRef(recordWorkspaceVersion);
  recordWorkspaceVersionRef.current = recordWorkspaceVersion;

  useLayoutEffect(() => {
    if (stageMode !== 'editor' || (!focusRescheduledEditorAtEndRef.current && !focusPlannerEditorAtEndRef.current && !focusEditorAfterStageEscapeRef.current)) return;

    const editor = bodyInputRef.current;
    if (editor && (focusRescheduledEditorAtEndRef.current || focusPlannerEditorAtEndRef.current)) {
      const nextHtml = richTextToHtml(draftBody, draftEntities);
      if (editor.innerHTML !== nextHtml) editor.innerHTML = nextHtml;
    }

    const frameId = window.requestAnimationFrame(() => {
      const editor = bodyInputRef.current;
      if (!editor) return;

      editor.focus({ preventScroll: true });
      const selection = window.getSelection();
      if (selection) {
        const range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
      }

      const caretPosition = draftBody.length;
      editor.dataset.selectionStart = String(caretPosition);
      editor.dataset.selectionEnd = String(caretPosition);
      editor.scrollTop = Math.max(0, editor.scrollHeight - editor.clientHeight);
      focusRescheduledEditorAtEndRef.current = false;
      focusPlannerEditorAtEndRef.current = false;
      focusEditorAfterStageEscapeRef.current = false;
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [draftBody, draftEntities, stageMode]);

  useEffect(() => {
    if (!scheduleSubmissionPendingRef.current) return;
    if (stageMode !== 'schedule') {
      scheduleSubmissionPendingRef.current = false;
      scheduleSubmissionStartedRef.current = false;
      return;
    }
    if (scheduling) {
      scheduleSubmissionStartedRef.current = true;
      return;
    }
    if (!scheduleSubmissionStartedRef.current) return;

    const scheduledSuccessfully = lastAction === 'scheduled';
    scheduleSubmissionPendingRef.current = false;
    scheduleSubmissionStartedRef.current = false;
    if (!scheduledSuccessfully) return;

    setScheduleFocus(null);
    setStageMode('editor');
  }, [lastAction, scheduling, stageMode]);

  useTimedStatus(attachmentError, setAttachmentError, FOOTER_STATUS_DURATION_MS.attachmentError);
  useTimedStatus(textFileError, setTextFileError, FOOTER_STATUS_DURATION_MS.textFileError);
  useTimedStatus(sendError, setSendError, FOOTER_STATUS_DURATION_MS.sendError);
  useTimedStatus(draftStoreError, setDraftStoreError, FOOTER_STATUS_DURATION_MS.draftStoreError, draftStoreBackups.length > 0);
  useTimedStatus(chatLookupError, setChatLookupError, FOOTER_STATUS_DURATION_MS.chatLookupError);
  useTimedStatus(previewHistoryError, setPreviewHistoryError, FOOTER_STATUS_DURATION_MS.previewHistoryError);

  useEffect(() => () => {
    if (publishFeedbackTimerRef.current !== null) {
      window.clearTimeout(publishFeedbackTimerRef.current);
    }
    if (attachmentPreviewTimerRef.current !== null) {
      window.clearTimeout(attachmentPreviewTimerRef.current);
    }
    attachmentPreviewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    attachmentPreviewUrlsRef.current.clear();
  }, []);

  useEffect(() => {
    setTelegramConnectionState(connected ? 'connected' : 'disconnected');
  }, [connected]);

  useEffect(() => {
    const unsubscribe = window.telegram?.onStatus((status) => {
      const nextStatus = typeof status === 'string'
        ? status
        : status && typeof status === 'object' && 'status' in status
          ? status.status
          : undefined;
      if (
        nextStatus === 'connected'
        || nextStatus === 'connecting'
        || nextStatus === 'reconnecting'
        || nextStatus === 'disconnected'
      ) {
        setTelegramConnectionState(nextStatus);
      }
    });
    return unsubscribe;
  }, []);

  const showPublishFeedback = useCallback((message: string, kind: 'warning' | 'success' = 'warning', detail = '', durationMs?: number) => {
    if (publishFeedbackTimerRef.current !== null) {
      window.clearTimeout(publishFeedbackTimerRef.current);
    }
    const identity = { message, kind };
    const previousIdentity = lastPublishFeedbackRef.current;
    setRetriggeredPublishFeedback(
      previousIdentity?.message === identity.message && previousIdentity.kind === identity.kind
        ? identity
        : null,
    );
    lastPublishFeedbackRef.current = identity;
    setPublishFeedbackInstance((instance) => instance + 1);
    setPublishFeedback(message);
    setPublishFeedbackDetail(detail);
    setPublishFeedbackKind(kind);
    setPublishFeedbackOverridesProgress(true);
    publishFeedbackTimerRef.current = window.setTimeout(() => {
      setPublishFeedback('');
      setPublishFeedbackDetail('');
      setPublishFeedbackOverridesProgress(false);
      publishFeedbackTimerRef.current = null;
      if (lastPublishFeedbackRef.current?.message === identity.message && lastPublishFeedbackRef.current.kind === identity.kind) {
        lastPublishFeedbackRef.current = null;
        setRetriggeredPublishFeedback(null);
      }
    }, durationMs ?? (kind === 'warning' ? FOOTER_STATUS_DURATION_MS.publishWarning : FOOTER_STATUS_DURATION_MS.publishSuccess));
  }, []);

  const flushBeforeLeaveStudio = useCallback(async () => {
    try {
      const result = await flushWorkspaceDraftNow();
      if (!result.success) showPublishFeedback(result.error, 'warning');
      return result.success;
    } catch {
      showPublishFeedback(t('studio.draftsCouldNotSave'), 'warning');
      return false;
    }
  }, [flushWorkspaceDraftNow, showPublishFeedback, t]);

  useLayoutEffect(() => {
    if (!onRegisterBeforeLeaveStudio) return;
    onRegisterBeforeLeaveStudio(flushBeforeLeaveStudio);
    return () => onRegisterBeforeLeaveStudio(null);
  }, [flushBeforeLeaveStudio, onRegisterBeforeLeaveStudio]);

  const createWorkspaceDraftSnapshotRef = useRef(createWorkspaceDraftSnapshot);
  createWorkspaceDraftSnapshotRef.current = createWorkspaceDraftSnapshot;

  useEffect(() => {
    if (draftBody.length <= maxDraftLength) return;

    const limited = sliceRichText(draftBody, draftEntities, 0, maxDraftLength);
    setDraftBody(limited.text);
    setDraftEntities(limited.entities);
  }, [attachments.length, draftBody, draftEntities, maxDraftLength]);

  useEffect(() => {
    const serialized = JSON.stringify(previewLayout);
    window.localStorage.setItem(PREVIEW_LAYOUT_KEY, serialized);
    window.localStorage.setItem(LEGACY_PREVIEW_LAYOUT_KEY, serialized);
  }, [previewLayout]);

  useEffect(() => {
    const preventEditorReload = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'r') return;
      const workspace = workspaceRef.current;
      if (!workspace || workspace.closest('[aria-hidden="true"]')) return;
      const editorShell = workspace.querySelector('.workspace-page-editor-shell');
      const targetIsInEditor = event.target instanceof Node && editorShell?.contains(event.target);
      const focusIsInEditor = editorShell?.contains(document.activeElement);
      if (!targetIsInEditor && !focusIsInEditor) return;

      event.preventDefault();
      event.stopPropagation();
    };

    window.addEventListener('keydown', preventEditorReload, true);
    return () => window.removeEventListener('keydown', preventEditorReload, true);
  }, []);

  const togglePreviewVisibility = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    setPreviewLayout((current) => {
      const nextVisible = current.visible ?? true;
      return {
        ...current,
        visible: !nextVisible,
        collapsed: nextVisible ? current.collapsed : false,
      };
    });
  };

  useEffect(() => {
    if (stageMode === 'editor') return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (stageMode === 'chat') {
          setSelectedChat(workspaceChatOriginRef.current);
          workspaceChatOriginRef.current = null;
          setWorkspaceSelectedChats([]);
        }
        focusEditorAfterStageEscapeRef.current = true;
        setStageMode('editor');
        setStageTab('editor');
        setTemplateEditingId(null);
        setTemplateDraftName('');
        setTemplateDraftBody('');
        setDraftEditingId(null);
        setDraftName('');
        setDraftBodyText('');
        setDraftBodyEntities([]);
      }
    };

    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [setSelectedChat, stageMode]);

  useEffect(() => {
    if (!publishMenuOpen) return;

    const closePublishMenu = (event: MouseEvent) => {
      if (publishMenuRef.current && !publishMenuRef.current.contains(event.target as Node)) {
        setPublishMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setPublishMenuOpen(false);
        publishMenuToggleRef.current?.focus();
      }
    };

    document.addEventListener('mousedown', closePublishMenu);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closePublishMenu);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [publishMenuOpen]);

  useEffect(() => {
    if (stageMode !== 'editor' || publishMenuOpen) return;

    const returnToSchedule = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;

      event.preventDefault();
      if (chatListOpen) {
        setChatListOpen(false);
        return;
      }
      window.location.hash = '#/';
    };

    document.addEventListener('keydown', returnToSchedule);
    return () => document.removeEventListener('keydown', returnToSchedule);
  }, [chatListOpen, publishMenuOpen, stageMode]);

  useEffect(() => {
    if (!successPulse || suppressDraftReplacementSuccessClearRef.current) return;
    if (pendingDraftReplacementRef.current) {
      void completeDraftReplacementRef.current();
      return;
    }
    const currentSnapshot = createWorkspaceDraftSnapshotRef.current();
    attachmentSelectionGenerationRef.current += 1;
    void (async () => {
      const checkpoint = await recordWorkspaceVersionRef.current(currentSnapshot, 'publish');
      if (!checkpoint.success && !plannerRestoreRef.current) {
        showPublishFeedback(t('studio.historyCouldNotSave'), 'warning');
        return;
      }

      attachmentPreviewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      attachmentPreviewUrlsRef.current.clear();
      if (plannerRestoreRef.current?.draft) {
        void restorePlannerDocumentRef.current();
        return;
      }
      plannerRestoreRef.current = null;
      if (bodyInputRef.current) {
        bodyInputRef.current.innerHTML = '';
        bodyInputRef.current.dataset.selectionStart = '0';
        bodyInputRef.current.dataset.selectionEnd = '0';
      }
      setDraftBody('');
      setDraftEntities([]);
      replaceAttachments([]);
      setInlineButtons([]);
      setWorkspaceDocumentId(uid());
    })();
  }, [showPublishFeedback, successPulse, t]);

  useEffect(() => {
    if (templateStorageError) {
      showPublishFeedback(t('studio.templateStorageError'), 'warning');
      return;
    }

    try {
      saveTemplates(templates);
    } catch {
      setTemplateStorageError(true);
    }
  }, [showPublishFeedback, t, templateStorageError, templates]);

  const selectedChatId = selectedChat?.id;

  useEffect(() => {
    let cancelled = false;

    if (!connected) {
      previewHistoryCacheRef.current.clear();
    }

    if (!connected || !selectedChatId) {
      setPreviewHistory(null);
      setPreviewHistoryLoading(false);
      setPreviewHistoryError('');
      setPreviewHistoryErrorRetryable(false);
      return () => {
        cancelled = true;
      };
    }

    if (!hasChatHistoryBridge()) {
      setPreviewHistory(null);
      setPreviewHistoryLoading(false);
      setPreviewHistoryError('');
      setPreviewHistoryErrorRetryable(false);
      return () => {
        cancelled = true;
      };
    }

    const cachedEntry = previewHistoryCacheRef.current.get(selectedChatId);
    if (cachedEntry && Date.now() - cachedEntry.cachedAt < PREVIEW_HISTORY_CACHE_TTL_MS) {
      const cache = previewHistoryCacheRef.current;
      cache.delete(selectedChatId);
      cache.set(selectedChatId, cachedEntry);
      setPreviewHistory(cachedEntry.history);
      setPreviewHistoryLoading(false);
      setPreviewHistoryError('');
      setPreviewHistoryErrorRetryable(false);
      return () => {
        cancelled = true;
      };
    }
    if (cachedEntry) previewHistoryCacheRef.current.delete(selectedChatId);

    setPreviewHistory(null);
    setPreviewHistoryLoading(true);
    setPreviewHistoryError('');
    setPreviewHistoryErrorRetryable(false);
    telegramGetChatHistory({ chatId: selectedChatId, limit: PREVIEW_HISTORY_LIMIT })
      .then((result) => {
        if (cancelled) return;

        if (result.success) {
          const history = result.history ?? null;
          setPreviewHistory(history);
          if (history && getPreviewHistoryMediaDataUrlChars(history) <= PREVIEW_HISTORY_CACHE_MAX_MEDIA_DATA_URL_CHARS) {
            const cache = previewHistoryCacheRef.current;
            cache.delete(selectedChatId);
            cache.set(selectedChatId, { history, cachedAt: Date.now() });
            while (cache.size > PREVIEW_HISTORY_CACHE_SIZE) {
              const oldestChatId = cache.keys().next().value;
              if (oldestChatId === undefined) break;
              cache.delete(oldestChatId);
            }
          }
          setPreviewHistoryError('');
          setPreviewHistoryErrorRetryable(false);
        } else {
          const errorPresentation = getPreviewHistoryErrorPresentation(result.error, {
            noAccess: t('studio.previewHistoryNoAccess'),
            unavailable: t('studio.previewHistoryFailed'),
          });
          setPreviewHistory(null);
          setPreviewHistoryError(errorPresentation.message);
          setPreviewHistoryErrorRetryable(errorPresentation.retryable);
        }
        setPreviewHistoryLoading(false);
      })
      .catch((error) => {
        if (cancelled) return;

        const errorPresentation = getPreviewHistoryErrorPresentation(error, {
          noAccess: t('studio.previewHistoryNoAccess'),
          unavailable: t('studio.previewHistoryFailed'),
        });
        setPreviewHistory(null);
        setPreviewHistoryError(errorPresentation.message);
        setPreviewHistoryErrorRetryable(errorPresentation.retryable);
        setPreviewHistoryLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [connected, selectedChatId, previewHistoryRetry, t]);

  const previewText = stageMode === 'template' && templateEditingId
    ? templateDraftBody
    : stageMode === 'draft' && draftEditingId
      ? draftBodyText
      : draftBody;
  const previewEntities = stageMode === 'template' && templateEditingId
    ? []
    : stageMode === 'draft' && draftEditingId
      ? draftBodyEntities
      : draftEntities;
  const deferredPreviewText = useDeferredValue(previewText);
  const deferredPreviewEntities = useDeferredValue(previewEntities);
  const toggleChatList = useCallback(() => setChatListOpen((current) => !current), []);
  const selectPreviewChat = useCallback((chat: Chat) => {
    setSelectedChat(chat);
    setChatListOpen(false);
  }, [setSelectedChat]);

  useEffect(() => {
    if (previewHistoryLoading || previewCollapsed) return;

    const frameId = window.requestAnimationFrame(() => {
      if (previewFeedRef.current) {
        previewFeedRef.current.scrollTop = previewFeedRef.current.scrollHeight;
      }
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [
    previewHistory?.chat.id,
    previewHistory?.messages.length,
    previewHistoryLoading,
    deferredPreviewText,
    deferredPreviewEntities.length,
    attachments.length,
    inlineButtons.length,
    chatListOpen,
    previewCollapsed,
    selectedChat?.id,
  ]);

  const previewTime = new Date().toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
  const hasDraftContentState = hasDraftContent(draftBody, attachments);
  const hasSelectedTarget = Boolean(selectedChat);
  const hasValidScheduleDate = Boolean(date && !Number.isNaN(new Date(`${date}T12:00:00`).getTime()));
  const hasValidScheduleTime = Boolean(time && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time));
  const hasFutureSchedule = isFutureSchedule(date, time, new Date(scheduleClockNow));
  const hasValidRepeatConfig = repeatMode === 'none'
    || ((repeatMode === 'weekly' || repeatMode === 'biweekly') ? repeatDays.length > 0 : true)
    && repeatOccurrences > 0
    && repeatOccurrences <= MAX_SCHEDULE_OCCURRENCES;
  const hasUnsupportedPhotoAlbumImage = attachments.some((attachment) => (
    Boolean(attachment.albumId) && !isTelegramPhotoAlbumImage(attachment.name)
  ));
  const canSendNow = hasSelectedTarget && hasDraftContentState && !attachmentError && !hasUnsupportedPhotoAlbumImage && !publishingDraft && !sendInFlight && !scheduling;
  const canSaveDraft = hasDraftContentState && !publishingDraft;
  const canSchedule = hasSelectedTarget && hasDraftContentState && !hasUnsupportedPhotoAlbumImage && !scheduling && hasValidScheduleDate && hasValidScheduleTime && hasValidRepeatConfig && hasFutureSchedule;

  let publishActionBlocker = '';
  if (publishAction === 'draft') {
    if (!hasDraftContentState) {
      publishActionBlocker = t('studio.enterMessage');
    } else if (!draftStoreReady) {
      publishActionBlocker = draftStoreError || t('studio.waitForDrafts');
    }
  } else if (publishAction === 'schedule') {
    if (!hasDraftContentState) {
      publishActionBlocker = t('studio.enterMessage');
    } else if (!hasSelectedTarget) {
      publishActionBlocker = t('studio.selectChat');
    } else if (hasUnsupportedPhotoAlbumImage) {
      publishActionBlocker = t('studio.photoAlbumReaddUnsupported');
    } else if (!hasValidScheduleDate) {
      publishActionBlocker = t('studio.invalidDate');
    } else if (!hasValidScheduleTime) {
      publishActionBlocker = t('studio.invalidTime');
    } else if (!hasValidRepeatConfig) {
      publishActionBlocker = t('studio.invalidRepeat');
    } else if (!hasFutureSchedule) {
      publishActionBlocker = t('studio.futureDateTime');
    }
  } else if (!hasDraftContentState) {
    publishActionBlocker = t('studio.enterMessage');
  } else if (!hasSelectedTarget) {
    publishActionBlocker = t('studio.selectChat');
  } else if (hasUnsupportedPhotoAlbumImage) {
    publishActionBlocker = t('studio.photoAlbumReaddUnsupported');
  } else if (attachmentError) {
    publishActionBlocker = t('studio.fixAttachment');
  }
  const publishScheduleSummary = formatScheduleSummary(date, time, {
    mode: repeatMode,
    days: repeatDays,
    occurrences: repeatOccurrences,
  }, locale);
  const reconnectingForSend = publishingDraft
    && (telegramConnectionState === 'connecting' || telegramConnectionState === 'reconnecting');
  const localizeChatName = (name: string) => name === 'Saved Messages' ? t('studio.savedMessagesType') : name;
  const selectedChatSubtitle = selectedChat
    ? selectedChat.name === 'Saved Messages'
      ? t('studio.privateChat')
      : selectedChat.type === 'private'
        ? selectedChat.username
          ? `@${selectedChat.username.replace(/^@/, '')}`
          : t('studio.privateChat')
        : selectedChat.type === 'group'
          ? t('studio.groupChat')
          : selectedChat.type === 'channel'
            ? t('studio.channelType')
            : t('studio.chatType')
    : '';
  const currentModeSummary = rescheduleSource
    ? t('studio.replaceScheduled', { chat: localizeChatName(rescheduleSource.chatName) })
    : publishAction === 'schedule'
      ? (date && time ? publishScheduleSummary : t('studio.chooseDateTime'))
        : publishAction === 'draft'
          ? savedAt ? t('studio.draftModeSummary', { time: savedAt }) : t('studio.draftMenuOption')
        : selectedChat
          ? selectedChat.name === 'Saved Messages'
            ? t('studio.sendToSavedSummary')
            : t('studio.sendToChatSummary', { chat: localizeChatName(selectedChat.name) })
          : t('studio.sendChooseChatSummary');
  const publishFooterStatus: PublishFooterStatus | null = sendError
    ? { message: sendError, kind: 'error', transient: false, duration: FOOTER_STATUS_DURATION_MS.sendError }
    : connectionRecoveryStatus === 'offline'
      ? { message: t('telegramStatus.offlineMessage'), kind: 'error', transient: false, duration: null }
      : connectionRecoveryStatus === 'reconnecting'
        ? { message: t('telegramStatus.networkMessage'), kind: 'progress', transient: false, duration: null }
        : publishFeedbackOverridesProgress && publishFeedback
          ? {
              message: publishFeedback,
              detail: publishFeedbackDetail || undefined,
              kind: publishFeedbackKind,
              transient: true,
              duration: publishFeedbackKind === 'warning'
                ? FOOTER_STATUS_DURATION_MS.publishWarning
                : FOOTER_STATUS_DURATION_MS.publishSuccess,
            }
          : sendInFlight || publishingDraft
        ? { message: t(reconnectingForSend ? 'studio.reconnectingProgress' : 'studio.sentProgress'), kind: 'progress', transient: false, duration: null }
        : publishFeedback && publishFeedbackKind === 'success'
          ? {
        message: publishFeedback,
        detail: publishFeedbackDetail || undefined,
        kind: publishFeedbackKind,
        transient: true,
        duration: FOOTER_STATUS_DURATION_MS.publishSuccess,
          }
        : publishFeedback
          ? {
        message: publishFeedback,
        detail: publishFeedbackDetail || undefined,
        kind: publishFeedbackKind,
        transient: true,
        duration: FOOTER_STATUS_DURATION_MS.publishWarning,
          }
        : draftStoreError
          ? { message: draftStoreError, kind: 'error', transient: false, duration: FOOTER_STATUS_DURATION_MS.draftStoreError }
          : attachmentError
            ? { message: attachmentError, kind: 'error', transient: true, duration: FOOTER_STATUS_DURATION_MS.attachmentError }
            : textFileError
              ? { message: textFileError, kind: 'error', transient: false, duration: FOOTER_STATUS_DURATION_MS.textFileError }
              : chatLookupError
                ? { message: chatLookupError, kind: 'error', transient: false, duration: FOOTER_STATUS_DURATION_MS.chatLookupError }
                : previewHistoryError
                ? { message: previewHistoryError, kind: 'error', transient: false, duration: FOOTER_STATUS_DURATION_MS.previewHistoryError }
                  : null;

  const sendDraftNow = async () => {
    if (!selectedChat || !canSendNow || sendInFlightRef.current) return;
    const isDraftReplacementSend = pendingDraftReplacementRef.current !== null;
    const chat = selectedChat;
    const text = draftBody;
    const replyMarkup = toInlineKeyboardMarkup(inlineButtons);
    const attachmentTransportItems = getAttachmentTransportItems(attachments);
    const attachmentGroups = attachmentTransportItems.map((item) => item.paths);
    const failedAttachmentIds = new Set<string>();
    let successfulGroupCount = 0;
    let firstGroupSent = false;
    sendInFlightRef.current = true;
    setSendInFlight(true);
    setSendError('');
    setPublishMenuOpen(false);
    suppressDraftReplacementSuccessClearRef.current = isDraftReplacementSend;
    try {
      const sent = await handleSendDraftNow(
        chat,
        text,
        attachmentGroups.flat(),
        draftEntities,
        replyMarkup,
        attachmentGroups,
        (groupIndex, sentGroup) => {
          if (groupIndex === 0) firstGroupSent = sentGroup;
          const group = attachmentTransportItems[groupIndex];
          if (sentGroup) {
            successfulGroupCount += 1;
            return;
          }
          group?.attachments.forEach((attachment) => failedAttachmentIds.add(attachment.id));
        },
        messageEffectId ?? undefined,
        true,
      );
      if (!sent) {
        suppressDraftReplacementSuccessClearRef.current = false;
        if (failedAttachmentIds.size > 0) {
          const returnedAttachments = attachments.filter((attachment) => failedAttachmentIds.has(attachment.id));
          const returnedAttachmentIds = new Set(returnedAttachments.map((attachment) => attachment.id));
          attachments.forEach((attachment) => {
            if (returnedAttachmentIds.has(attachment.id)) return;
            const previewUrl = attachment.previewUrl;
            if (previewUrl && attachmentPreviewUrlsRef.current.delete(previewUrl)) {
              URL.revokeObjectURL(previewUrl);
            }
          });
          replaceAttachments(returnedAttachments);

          if (firstGroupSent) {
            if (bodyInputRef.current) {
              bodyInputRef.current.innerHTML = '';
              bodyInputRef.current.dataset.selectionStart = '0';
              bodyInputRef.current.dataset.selectionEnd = '0';
            }
            setDraftBody('');
            setDraftEntities([]);
            setInlineButtons([]);
            setWorkspaceDocumentId(uid());
            if (text.trim()) {
              setPreviewHistory((current) => {
                if (!current || current.chat.id !== chat.id) return current;
                const nextHistory = appendPreviewMessage(current, chat.id, text, replyMarkup);
                const cache = previewHistoryCacheRef.current;
                if (cache.has(chat.id)) {
                  cache.delete(chat.id);
                  if (getPreviewHistoryMediaDataUrlChars(nextHistory) <= PREVIEW_HISTORY_CACHE_MAX_MEDIA_DATA_URL_CHARS) {
                    cache.set(chat.id, { history: nextHistory, cachedAt: Date.now() });
                  }
                }
                return nextHistory;
              });
            }
          }
        }
        setSendError(successfulGroupCount > 0 ? '' : t('studio.sendFailed'));
        return;
      }

      setSendError('');
      if (sent === 'sent-history-failed' && !isDraftReplacementSend) {
        suppressDraftReplacementSuccessClearRef.current = false;
      }
      if (sent !== 'sent-history-failed') {
        if (!pendingDraftReplacementRef.current) {
          if (bodyInputRef.current) {
            bodyInputRef.current.innerHTML = '';
            bodyInputRef.current.dataset.selectionStart = '0';
            bodyInputRef.current.dataset.selectionEnd = '0';
          }
          setDraftBody('');
          setDraftEntities([]);
        }
        setMessageEffectId(null);
      }
      showPublishFeedback(
        sent === 'sent-history-failed'
          ? 'Telegram sent the message, but local history could not be saved. Do not resend this message.'
          : t('studio.messageSent'),
        sent === 'sent-history-failed' ? 'warning' : 'success',
        '',
        sent === 'sent-history-failed'
          ? FOOTER_STATUS_DURATION_MS.publishWarning
          : FOOTER_STATUS_DURATION_MS.publishSuccess,
      );

      setPreviewHistory((current) => {
        if (!current || current.chat.id !== chat.id) return current;

        const nextHistory = appendPreviewMessage(current, chat.id, text, replyMarkup);
        const cache = previewHistoryCacheRef.current;
        if (cache.has(chat.id)) {
          cache.delete(chat.id);
          if (getPreviewHistoryMediaDataUrlChars(nextHistory) <= PREVIEW_HISTORY_CACHE_MAX_MEDIA_DATA_URL_CHARS) {
            cache.set(chat.id, { history: nextHistory, cachedAt: Date.now() });
          }
        }
        return nextHistory;
      });
      if (isDraftReplacementSend && pendingDraftReplacementRef.current) {
        await new Promise<void>((resolve) => {
          window.setTimeout(
            resolve,
            sent === 'sent-history-failed'
              ? FOOTER_STATUS_DURATION_MS.publishWarning
              : FOOTER_STATUS_DURATION_MS.publishSuccess,
          );
        });
        await completePendingDraftReplacement();
      }
    } catch {
      suppressDraftReplacementSuccessClearRef.current = false;
      setSendError(t('studio.sendFailed'));
    } finally {
      sendInFlightRef.current = false;
      setSendInFlight(false);
    }
  };

  const openScheduleStage = (focus: 'repeat' | 'time' | null = null) => {
    const isSameFocusOpen = stageMode === 'schedule' && scheduleFocus === focus;

    setScheduleSelectionConfirmed(false);
    setPublishAction('schedule');
    setPublishMenuOpen(false);

    if (isSameFocusOpen) {
      setScheduleFocus(null);
      changeStageMode('editor');
      return;
    }

    const workspaceMain = workspaceRef.current?.querySelector<HTMLElement>('.workspace-page-main');
    if (workspaceMain) workspaceMain.scrollTop = 0;

    setScheduleFocus(focus);
    changeStageMode('schedule');
  };

  const scheduleDraft = () => {
    if (!selectedChat || !canSchedule) return;

    setScheduleSelectionConfirmed(false);
    scheduleSubmissionPendingRef.current = true;
    scheduleSubmissionStartedRef.current = false;
    handleSchedule({
      chatId: selectedChat.id,
      message: draftBody,
      date,
      time,
      attachments: attachments.map((attachment) => attachment.path || attachment.previewUrl || attachment.name).filter(Boolean),
      attachmentGroups: getAttachmentTransportGroups(attachments),
      entities: draftEntities,
      replyMarkup: toInlineKeyboardMarkup(inlineButtons),
      effect: messageEffectId ?? undefined,
      ...(rescheduleSource ? { replaceMessage: rescheduleSource } : {}),
    }, {
      mode: repeatMode,
      days: repeatDays,
      occurrences: repeatOccurrences,
    });
  };

  const saveCurrentDraft = async () => {
    if (!hasDraftContentState) return;

    const nextDraft = createWorkspaceDraftSnapshot();
    if (!nextDraft) return;
    const savedDraft = createSavedDraft({
      ...nextDraft,
      name: `Draft ${nextDraft.savedAt}`,
      documentId: workspaceDocumentId,
      color: draftColor,
    });
    const nextSavedDrafts = [savedDraft, ...savedDraftsRef.current];
    if (!await persistDraftStore(nextSavedDrafts, nextDraft, () => {
      replaceSavedDrafts(nextSavedDrafts);
      setSavedAt(nextDraft.savedAt);
    })) return;
    showPublishFeedback(t('studio.draftSavedNotice'), 'success');
    setScheduleSelectionConfirmed(false);
    setPublishAction('draft');
    setPublishMenuOpen(false);
    if (plannerRestoreRef.current?.draft) {
      const checkpoint = await recordWorkspaceVersion(createWorkspaceDraftSnapshot(), 'publish');
      if (!checkpoint.success) {
        showPublishFeedback(t('studio.historyCouldNotSave'), 'warning');
        return;
      }
      await restorePlannerDocumentRef.current();
      return;
    }
    attachmentSelectionGenerationRef.current += 1;
    attachmentPreviewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    attachmentPreviewUrlsRef.current.clear();
    if (bodyInputRef.current) {
      bodyInputRef.current.innerHTML = '';
      bodyInputRef.current.dataset.selectionStart = '0';
      bodyInputRef.current.dataset.selectionEnd = '0';
    }
    setDraftBody('');
    setDraftEntities([]);
    replaceAttachments([]);
    setInlineButtons([]);
    setWorkspaceDocumentId(uid());
  };

  const choosePublishAction = (action: PublishAction) => {
    setPublishAction(action);
    setScheduleSelectionConfirmed(false);
    if (action !== 'schedule') {
      rescheduleSourceRef.current = null;
      setRescheduleSource(null);
    }
    setPublishMenuOpen(false);
    setPublishFeedback('');
    if (action !== 'schedule' && stageMode === 'schedule') {
      setScheduleFocus(null);
      changeStageMode('editor');
    }
  };

  const handlePrimaryPublish = () => {
    if (publishAction === 'schedule') {
      if (!hasDraftContentState) {
        showPublishFeedback(t('studio.enterMessage'));
        return;
      }
      if (!hasSelectedTarget) {
        showPublishFeedback(t('studio.selectChat'));
        return;
      }
      if (!canSchedule) {
        if (stageMode !== 'schedule') {
          openScheduleStage();
        }
        if (hasDraftContentState && hasSelectedTarget && hasValidScheduleDate && hasValidScheduleTime && hasValidRepeatConfig && !hasFutureSchedule) {
          showPublishFeedback(t('studio.futureDateTime'));
        }
        return;
      }
      if (stageMode === 'schedule') {
        scheduleDraft();
      } else if (scheduleSelectionConfirmed) {
        scheduleDraft();
      } else {
        openScheduleStage();
      }
      return;
    }

    if (publishActionBlocker) {
      showPublishFeedback(publishActionBlocker);
      return;
    }

    if (publishAction === 'draft') {
      if (!canSaveDraft) return;
      saveCurrentDraft();
      return;
    }

    if (!canSendNow) return;
    void sendDraftNow();
  };

  const insertTextAtCursor = (insertedText: string) => {
    const editor = bodyInputRef.current;
    const selectionStart = Number(editor?.dataset.selectionStart);
    const selectionEnd = Number(editor?.dataset.selectionEnd);
    const hasSelection = Number.isFinite(selectionStart) && Number.isFinite(selectionEnd);
    const start = hasSelection ? selectionStart : draftBody.length;
    const end = hasSelection ? selectionEnd : draftBody.length;
    const { body: nextValue, caretPosition } = insertTextAtSelection(
      draftBody,
      insertedText,
      start,
      end,
    );

    setDraftBody(nextValue);
    setDraftEntities([]);

    if (!editor) return;

    editor.dataset.selectionStart = String(caretPosition);
    editor.dataset.selectionEnd = String(caretPosition);
    setTimeout(() => {
      editor.focus();
      const range = editor.ownerDocument.createRange();
      const walker = editor.ownerDocument.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
      let remaining = caretPosition;
      let node = walker.nextNode();

      while (node) {
        const length = node.textContent?.length ?? 0;
        if (remaining <= length) {
          range.setStart(node, remaining);
          range.collapse(true);
          const selection = editor.ownerDocument.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
          break;
        }
        remaining -= length;
        node = walker.nextNode();
      }
    }, 0);
  };

  const handleCreateTemplate = (input: Pick<Template, 'name' | 'body'>) => {
    setTemplates((current) => [
      createTemplate(input),
      ...current,
    ]);
  };

  const handleUpdateTemplate = (
    id: string,
    input: Pick<Template, 'name' | 'body'>,
  ) => {
    setTemplates((current) =>
      current.map((template) =>
        template.id === id ? updateTemplate(template, input) : template,
      ),
    );
  };

  const handleDeleteTemplate = async (template: Template) => {
    if (!await confirm({
      message: t('studio.confirmDeleteTemplate', { name: template.name }),
      confirmLabel: t('common.remove'),
      cancelLabel: t('common.cancel'),
      destructive: true,
    })) return;

    setTemplates((current) => deleteTemplate(current, template.id));
    showPublishFeedback(t('studio.templateDeleted'), 'success');
  };

  const openTemplateEditor = (template?: Template) => {
    setStageMode('template');
    setTemplateEditingId(template?.id ?? 'new');
    setTemplateDraftName(template?.name ?? '');
    setTemplateDraftBody(template?.body ?? '');
  };

  const closeTemplateEditor = useCallback(() => {
    setTemplateEditingId(null);
    setTemplateDraftName('');
    setTemplateDraftBody('');
  }, []);

  const openDraftEditor = (draft?: SavedDraft) => {
    draftEditingSourceRef.current = draft ?? null;
    setDraftEditingId(draft?.id ?? 'new');
    setDraftEditorColor(draft?.color ?? 'gray');
    setDraftName(draft?.name ?? '');
    setDraftBodyText(draft?.body ?? '');
    setDraftBodyEntities(draft?.entities ?? []);
    setStageTab('drafts');
    setStageMode('draft');
  };

  const useDraftInComposer = async (draft: SavedDraft): Promise<boolean> => {
    cancelPendingAutosave();
    const previousSnapshot = createWorkspaceDraftSnapshot();
    const checkpoint = await recordWorkspaceVersion(previousSnapshot, 'before-replacement');
    if (!checkpoint.success) {
      showPublishFeedback(t('studio.historyCouldNotSave'), 'warning');
      return false;
    }

    const draftChat = draft.selectedChat && chats.find((chat) => chat.id === draft.selectedChat?.id);
    const nextSavedDrafts = deleteSavedDraft(savedDraftsRef.current, draft.id);
    const nextWorkspaceDraft: WorkspaceDraft = {
      documentId: draft.documentId ?? draft.id,
      body: draft.body,
      entities: draft.entities ?? [],
      attachments: normalizeAttachments(draft.attachments),
      selectedChat: draftChat ?? draft.selectedChat ?? null,
      inlineButtons: draft.inlineButtons ?? [],
      date: draft.date ?? '',
      time: draft.time ?? '',
      repeatMode: draft.repeatMode ?? 'none',
      repeatDays: draft.repeatDays ?? [],
      repeatOccurrences: draft.repeatOccurrences ?? 1,
      savedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    const persisted = await persistDraftStore(nextSavedDrafts, nextWorkspaceDraft, () => {
      replaceSavedDrafts(nextSavedDrafts);
    });
    if (!persisted) {
      showPublishFeedback(t('studio.draftsCouldNotSave'), 'warning');
      return false;
    }

    if (draftChat) setSelectedChat(draftChat);
    setDraftBody(draft.body);
    setDraftEntities(draft.entities ?? []);
    replaceAttachments(normalizeAttachments(draft.attachments));
    setInlineButtons(draft.inlineButtons ?? []);
    if (draft.date || draft.time) setFollowCurrentTime(false);
    if (draft.date) setDate(draft.date);
    if (draft.time) setTime(draft.time);
    setRepeatMode(draft.repeatMode ?? 'none');
    setRepeatDays(draft.repeatDays ?? []);
    setRepeatOccurrences(draft.repeatOccurrences ?? 1);
    rescheduleSourceRef.current = null;
    setRescheduleSource(null);
    setScheduleSelectionConfirmed(false);
    setPublishAction('send');
    setStageTab('editor');
    focusRescheduledEditorAtEndRef.current = true;
    changeStageMode('editor');
    pendingDraftReplacementRef.current = hasWorkspaceDocumentContent(previousSnapshot)
      ? { previousSnapshot }
      : null;
    showPublishFeedback(t('studio.draftMovedToEditor'), 'success');
    return true;
  };

  const restorePreviousDraftAfterReplacement = async () => {
    const pending = pendingDraftReplacementRef.current;
    if (!pending) return false;
    cancelPendingAutosave();
    const { previousSnapshot } = pending;
    const restoredEntities = normalizeRichTextEntities(previousSnapshot.entities, previousSnapshot.body.length);
    const restoredAttachments = normalizeAttachments(previousSnapshot.attachments);
    const restoredSnapshot = {
      ...previousSnapshot,
      entities: restoredEntities,
      attachments: restoredAttachments,
      inlineButtons: previousSnapshot.inlineButtons ?? [],
      savedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    const persisted = await persistDraftStore(savedDraftsRef.current, restoredSnapshot);
    if (!persisted) {
      showPublishFeedback(t('studio.draftsCouldNotSave'), 'warning');
      return false;
    }

    pendingDraftReplacementRef.current = null;
    suppressDraftReplacementSuccessClearRef.current = false;
    attachmentSelectionGenerationRef.current += 1;
    setWorkspaceDocumentId(restoredSnapshot.documentId ?? workspaceDocumentId);
    if (bodyInputRef.current) {
      bodyInputRef.current.innerHTML = richTextToHtml(restoredSnapshot.body, restoredEntities);
    }
    setDraftBody(restoredSnapshot.body);
    setDraftEntities(restoredEntities);
    replaceAttachments(restoredAttachments);
    setInlineButtons(restoredSnapshot.inlineButtons);
    setSelectedChat(restoredSnapshot.selectedChat ?? null);
    setDate(restoredSnapshot.date ?? '');
    setTime(restoredSnapshot.time ?? '');
    setFollowCurrentTime(!restoredSnapshot.date && !restoredSnapshot.time);
    setRepeatMode(restoredSnapshot.repeatMode ?? 'none');
    setRepeatDays(restoredSnapshot.repeatDays ?? []);
    setRepeatOccurrences(restoredSnapshot.repeatOccurrences ?? 1);
    rescheduleSourceRef.current = null;
    setRescheduleSource(null);
    setScheduleSelectionConfirmed(false);
    setPublishAction('send');
    setStageTab('editor');
    focusRescheduledEditorAtEndRef.current = true;
    changeStageMode('editor');
    showPublishFeedback(t('studio.previousTextRestored'), 'success');
    return true;
  };

  const completePendingDraftReplacement = () => {
    if (draftReplacementCompletionRef.current) return draftReplacementCompletionRef.current;
    if (!pendingDraftReplacementRef.current) return Promise.resolve(false);

    suppressDraftReplacementSuccessClearRef.current = true;
    const completion = (async () => {
      const checkpoint = await recordWorkspaceVersion(createWorkspaceDraftSnapshot(), 'publish');
      const restored = await restorePreviousDraftAfterReplacement();
      if (!checkpoint.success) showPublishFeedback(t('studio.historyCouldNotSave'), 'warning');
      return restored;
    })();
    draftReplacementCompletionRef.current = completion;
    void completion.finally(() => {
      if (draftReplacementCompletionRef.current === completion) {
        draftReplacementCompletionRef.current = null;
      }
    });
    return completion;
  };
  completeDraftReplacementRef.current = completePendingDraftReplacement;

  const rescheduleMessage = (message: ScheduledMessage) => {
    const chat = chats.find((item) => item.id === message.chatId);
    const scheduledAt = new Date(message.when);
    if (!chat || Number.isNaN(scheduledAt.getTime())) return;

    const nextDate = `${scheduledAt.getFullYear()}-${String(scheduledAt.getMonth() + 1).padStart(2, '0')}-${String(scheduledAt.getDate()).padStart(2, '0')}`;
    const nextTime = `${String(scheduledAt.getHours()).padStart(2, '0')}:${String(scheduledAt.getMinutes()).padStart(2, '0')}`;
    setSelectedChat(chat);
    attachmentSelectionGenerationRef.current += 1;
    rescheduleSourceRef.current = message;
    setRescheduleSource(message);
    focusRescheduledEditorAtEndRef.current = true;
    setScheduleSelectionConfirmed(false);
    setPublishAction('schedule');
    setDraftBody(message.text);
    setDraftEntities(message.entities ?? []);
    replaceAttachments(normalizeAttachments(message.attachments ?? []));
    setInlineButtons((message.replyMarkup?.inline_keyboard ?? []).map((row) => row.map((button) => ({
      id: crypto.randomUUID(),
      label: button.text,
      action: button.url !== undefined
        ? { type: 'url' as const, value: button.url }
        : { type: 'callback' as const, value: button.callback_data ?? '' },
    }))));
    setDate(nextDate);
    setTime(nextTime);
    setFollowCurrentTime(false);
    setRepeatMode('none');
    setRepeatDays([]);
    setRepeatOccurrences(1);
    // Keep the original scheduled post intact until the user explicitly saves a replacement.
    // The editor must remain active so the user can continue editing and the schedule fields stay populated.
    changeStageMode('editor');
  };

  historyDraftOpenerRef.current = openDraftEditor;
  historyDraftUseRef.current = useDraftInComposer;
  historyRescheduleHandlerRef.current = rescheduleMessage;

  useEffect(() => {
    if (!rescheduleSource) return;
    const original = upcoming.find((message) => message.id === rescheduleSource.id);
    if (!original || original.status === 'failed') {
      rescheduleSourceRef.current = null;
      setRescheduleSource(null);
    }
  }, [rescheduleSource, upcoming]);

  useEffect(() => {
    if (!onRegisterHistoryDraftOpener) return;
    onRegisterHistoryDraftOpener((draft) => historyDraftOpenerRef.current(draft));
    return () => onRegisterHistoryDraftOpener(null);
  }, [onRegisterHistoryDraftOpener]);

  useEffect(() => {
    if (!onRegisterHistoryDraftUseHandler) return;
    onRegisterHistoryDraftUseHandler((draft) => historyDraftUseRef.current(draft));
    return () => onRegisterHistoryDraftUseHandler(null);
  }, [onRegisterHistoryDraftUseHandler]);

  useEffect(() => {
    if (!onRegisterHistoryDraftClearHandler) return;
    onRegisterHistoryDraftClearHandler(() => historyDraftClearerRef.current());
    return () => onRegisterHistoryDraftClearHandler(null);
  }, [onRegisterHistoryDraftClearHandler]);

  useEffect(() => {
    if (!onRegisterHistoryDraftDeleteHandler) return;
    onRegisterHistoryDraftDeleteHandler((draftId) => historyDraftDeleterRef.current(draftId));
    return () => onRegisterHistoryDraftDeleteHandler(null);
  }, [onRegisterHistoryDraftDeleteHandler]);

  useEffect(() => {
    if (!onRegisterHistoryRescheduleHandler) return;
    onRegisterHistoryRescheduleHandler((message) => historyRescheduleHandlerRef.current(message));
    return () => onRegisterHistoryRescheduleHandler(null);
  }, [onRegisterHistoryRescheduleHandler]);

  const closeDraftEditor = useCallback(() => {
    draftEditingSourceRef.current = null;
    setDraftEditingId(null);
    setDraftEditorColor('gray');
    setDraftName('');
    setDraftBodyText('');
    setDraftBodyEntities([]);
  }, []);

  const handleDeleteDraft = async (draft: SavedDraft) => {
    if (!await confirm({
      message: t('studio.confirmDeleteDraft', { name: draft.name }),
      confirmLabel: t('common.remove'),
      cancelLabel: t('common.cancel'),
      destructive: true,
    })) return;

    const checkpoint = await recordWorkspaceVersion(savedDraftToWorkspaceSnapshot(draft), 'before-delete', false);
    if (!checkpoint.success) {
      showPublishFeedback(t('studio.historyCouldNotSave'), 'warning');
      return;
    }
    const nextSavedDrafts = deleteSavedDraft(savedDraftsRef.current, draft.id);
    const deleted = await persistDraftStore(nextSavedDrafts, createWorkspaceDraftSnapshot(), () => {
      replaceSavedDrafts(nextSavedDrafts);
    });
    if (deleted) showPublishFeedback(checkpoint.error || t('studio.draftDeleted'), checkpoint.error ? 'warning' : 'success');
  };

  const handleRenameDraft = async (draft: SavedDraft, name: string) => {
    const trimmedName = name.trim();
    if (!trimmedName) return false;
    const currentSavedDrafts = savedDraftsRef.current;
    const currentDraft = currentSavedDrafts.find((item) => item.id === draft.id);
    if (!currentDraft) return false;
    if (currentDraft.name === trimmedName) return true;

    const nextSavedDrafts = currentSavedDrafts.map((item) => (
      item.id === draft.id
        ? { ...item, name: trimmedName, updatedAt: new Date().toISOString() }
        : item
    ));
    const saved = await persistDraftStore(nextSavedDrafts, createWorkspaceDraftSnapshot(), () => {
      replaceSavedDrafts(nextSavedDrafts);
    });
    if (saved) showPublishFeedback(t('studio.draftRenamed'), 'success');
    return saved;
  };

  historyDraftClearerRef.current = async () => {
    cancelPendingAutosave();
    let historyWarning = '';
    for (const draft of savedDraftsRef.current) {
      const checkpoint = await recordWorkspaceVersion(savedDraftToWorkspaceSnapshot(draft), 'before-delete', false);
      if (!checkpoint.success) return false;
      historyWarning ||= checkpoint.error;
    }
    const nextSavedDrafts: SavedDraft[] = [];
    return persistDraftStore(nextSavedDrafts, createWorkspaceDraftSnapshot(), () => {
      replaceSavedDrafts(nextSavedDrafts);
      showPublishFeedback(historyWarning || t('studio.draftsDeleted'), historyWarning ? 'warning' : 'success');
    });
  };

  historyDraftDeleterRef.current = async (draftId) => {
    const currentSavedDrafts = savedDraftsRef.current;
    const targetDraft = currentSavedDrafts.find((draft) => draft.id === draftId);
    if (!targetDraft) return false;
    const checkpoint = await recordWorkspaceVersion(savedDraftToWorkspaceSnapshot(targetDraft), 'before-delete', false);
    if (!checkpoint.success) return false;
    const nextSavedDrafts = deleteSavedDraft(currentSavedDrafts, draftId);
    if (nextSavedDrafts.length === currentSavedDrafts.length) return false;

    const deleted = await persistDraftStore(nextSavedDrafts, createWorkspaceDraftSnapshot(), () => {
      replaceSavedDrafts(nextSavedDrafts);
    });
    if (!deleted) return false;

    if (draftEditingId === draftId) {
      setDraftEditingId(null);
      setDraftEditorColor('gray');
      setDraftName('');
      setDraftBodyText('');
      setDraftBodyEntities([]);
    }
    showPublishFeedback(checkpoint.error || t('studio.draftDeleted'), checkpoint.error ? 'warning' : 'success');
    return true;
  };

  const saveDraftStage = async () => {
    if (!draftName.trim() || !draftBodyText.trim()) return;

    const existingDraft = draftEditingSourceRef.current;
    const input = {
      name: draftName,
      body: draftBodyText,
      documentId: existingDraft?.documentId ?? existingDraft?.id,
      color: draftEditorColor,
      entities: draftBodyEntities,
      attachments: existingDraft?.attachments ?? [],
      selectedChat: existingDraft?.selectedChat ?? null,
      inlineButtons: existingDraft?.inlineButtons ?? [],
      date: existingDraft?.date ?? '',
      time: existingDraft?.time ?? '',
      repeatMode: existingDraft?.repeatMode ?? 'none',
      repeatDays: existingDraft?.repeatDays ?? [],
      repeatOccurrences: existingDraft?.repeatOccurrences ?? 1,
    };
    let nextSavedDrafts: SavedDraft[];
    if (draftEditingId === 'new') {
      nextSavedDrafts = [createSavedDraft(input), ...savedDraftsRef.current];
    } else if (draftEditingId) {
      if (existingDraft) {
        const previousDraftSnapshot: WorkspaceDraft = {
          documentId: existingDraft.documentId ?? existingDraft.id,
          body: existingDraft.body,
          entities: existingDraft.entities ?? [],
          attachments: normalizeAttachments(existingDraft.attachments),
          selectedChat: existingDraft.selectedChat ?? null,
          inlineButtons: existingDraft.inlineButtons ?? [],
          date: existingDraft.date ?? '',
          time: existingDraft.time ?? '',
          repeatMode: existingDraft.repeatMode ?? 'none',
          repeatDays: existingDraft.repeatDays ?? [],
          repeatOccurrences: existingDraft.repeatOccurrences ?? 1,
          savedAt: existingDraft.updatedAt,
        };
        const checkpoint = await recordWorkspaceVersion(previousDraftSnapshot, 'before-replacement');
        if (!checkpoint.success) {
          showPublishFeedback(t('studio.historyCouldNotSave'), 'warning');
          return;
        }
      }
      nextSavedDrafts = savedDraftsRef.current.map((draft) => (
        draft.id === draftEditingId ? updateSavedDraft(draft, input) : draft
      ));
    } else {
      return;
    }

    if (!await persistDraftStore(nextSavedDrafts, createWorkspaceDraftSnapshot(), () => {
      replaceSavedDrafts(nextSavedDrafts);
    })) return;
    showPublishFeedback(t('studio.draftSavedNotice'), 'success');
    closeDraftEditor();
  };

  const useSavedDraft = async (draft: SavedDraft) => {
    const previousSnapshot = createWorkspaceDraftSnapshot();
    const checkpoint = await recordWorkspaceVersion(previousSnapshot, 'before-replacement');
    if (!checkpoint.success) {
      showPublishFeedback(t('studio.historyCouldNotSave'), 'warning');
      return;
    }

    attachmentSelectionGenerationRef.current += 1;
    setWorkspaceDocumentId(draft.documentId ?? draft.id);
    setDraftBody(draft.body);
    setDraftEntities(draft.entities ?? []);
    replaceAttachments(normalizeAttachments(draft.attachments));
    setInlineButtons(draft.inlineButtons ?? []);
    if (draft.selectedChat) setSelectedChat(draft.selectedChat);
    if (draft.date || draft.time) setFollowCurrentTime(false);
    if (draft.date) setDate(draft.date);
    if (draft.time) setTime(draft.time);
    setRepeatMode(draft.repeatMode ?? 'none');
    setRepeatDays(draft.repeatDays ?? []);
    setRepeatOccurrences(draft.repeatOccurrences ?? 1);
    changeStageMode('editor');
  };

  const openChatSelection = () => {
    if (stageMode === 'chat') {
      backFromChatSelection();
      return;
    }

    workspaceChatOriginRef.current = selectedChat;
    setWorkspaceSelectedChats((current) => current.length > 0 ? current : selectedChat ? [selectedChat] : []);
    setStageMode('chat');
  };

  const backFromChatSelection = () => {
    setSelectedChat(workspaceChatOriginRef.current);
    workspaceChatOriginRef.current = null;
    setWorkspaceSelectedChats([]);
    setStageMode('editor');
    setStageTab('editor');
  };

  const completeChatSelection = (chosenChat?: Chat) => {
    const selectedChats = chosenChat ? [chosenChat] : workspaceSelectedChats;
    const availableChats = selectedChats.filter((chat) => chats.some((item) => item.id === chat.id));
    setWorkspaceSelectedChats(availableChats);
    setSelectedChat(availableChats[0] ?? null);
    workspaceChatOriginRef.current = null;
    setStageMode('editor');
  };

  const changeStageMode = useCallback((nextMode: 'editor' | 'schedule' | 'template' | 'draft' | 'chat' | 'buttons') => {
    if (nextMode !== 'schedule') setScheduleFocus(null);
    if (stageMode === 'chat' && nextMode !== 'chat') {
      setSelectedChat(workspaceChatOriginRef.current);
      workspaceChatOriginRef.current = null;
      setWorkspaceSelectedChats([]);
    }
    if (nextMode !== 'template') closeTemplateEditor();
    if (nextMode !== 'draft') closeDraftEditor();
    setStageTab(nextMode === 'template' ? 'templates' : nextMode === 'draft' ? 'drafts' : nextMode === 'buttons' ? 'buttons' : 'editor');
    setStageMode(nextMode);
  }, [closeDraftEditor, closeTemplateEditor, setSelectedChat, stageMode]);

  const openPlannerTextInEditor = useCallback(async (payload: StudioPlannerTextPayload) => {
    const text = payload.text;
    const rawIncomingAttachments = normalizeAttachments(payload.attachments);
    const sameAttachments = attachments.length === rawIncomingAttachments.length
      && attachments.every((attachment, index) => (
        attachment.path === rawIncomingAttachments[index].path
        || attachment.sourcePath === rawIncomingAttachments[index].path
      ));
    if ((!text.trim() && rawIncomingAttachments.length === 0) || !draftStoreReady || !draftStateHydrated) return false;
    if (draftEditingId || rescheduleSourceRef.current) return false;

    if (draftBody === text && sameAttachments) {
      setDraftEntities(normalizeRichTextEntities(payload.entities, text.length));
      setMessageEffectId(payload.effect ?? null);
      if (hasDraftContent(draftBody, attachments) || inlineButtons.length > 0) {
        plannerRestoreRef.current ??= {
          draft: createSavedDraft({
            name: 'Studio document before Planner',
            documentId: workspaceDocumentId,
            color: draftColor,
            body: draftBody,
            entities: draftEntities,
            attachments,
            selectedChat,
            inlineButtons,
            date,
            time,
            repeatMode,
            repeatDays,
            repeatOccurrences,
          }),
        };
      }
      changeStageMode('editor');
      bodyInputRef.current?.focus({ preventScroll: true });
      showPublishFeedback(t('studio.draftMovedToEditor'), 'success');
      return true;
    }

    const draftStorage = getDraftStorageApi();
    const incomingAttachments = await Promise.all(rawIncomingAttachments.map(async (attachment) => {
      if (!attachment.path || !draftStorage?.copyAttachmentPath) {
        return { ...attachment, path: '', sourcePath: attachment.path, unavailable: true };
      }
      try {
        const copied = await draftStorage.copyAttachmentPath(attachment.path);
        if (!copied.success || !copied.attachment) {
          showPublishFeedback(t('studio.historyAttachmentCopyFailed', { name: attachment.name }), 'warning');
          return { ...attachment, sourcePath: attachment.path, unavailable: true };
        }
        return {
          ...attachment,
          path: copied.attachment.path,
          sourcePath: attachment.path,
          size: copied.attachment.size,
          unavailable: undefined,
        };
      } catch {
        showPublishFeedback(t('studio.historyAttachmentCopyFailed', { name: attachment.name }), 'warning');
        return { ...attachment, sourcePath: attachment.path, unavailable: true };
      }
    }));

    const currentSnapshot = createWorkspaceDraftSnapshot() ?? {
      documentId: workspaceDocumentId,
      body: draftBody,
      entities: draftEntities,
      attachments,
      selectedChat,
      inlineButtons,
      date,
      time,
      repeatMode,
      repeatDays,
      repeatOccurrences,
      savedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    } satisfies WorkspaceDraft;
    let previousSnapshot: WorkspaceDraft = currentSnapshot;
    if (hasDraftContent(draftBody, attachments) || inlineButtons.length > 0) {
      const checkpoint = await recordWorkspaceVersion(currentSnapshot, 'before-replacement');
      if (!checkpoint.success) {
        showPublishFeedback(t('studio.historyCouldNotSave'), 'warning');
        return false;
      }
      if (checkpoint.snapshot) previousSnapshot = checkpoint.snapshot;
    }

    const previousDocument = createSavedDraft({
      name: 'Studio document before Planner',
      documentId: previousSnapshot.documentId ?? workspaceDocumentId,
      color: draftColor,
      body: previousSnapshot.body,
      entities: previousSnapshot.entities,
      attachments: previousSnapshot.attachments,
      selectedChat: previousSnapshot.selectedChat,
      inlineButtons: previousSnapshot.inlineButtons,
      date: previousSnapshot.date,
      time: previousSnapshot.time,
      repeatMode: previousSnapshot.repeatMode,
      repeatDays: previousSnapshot.repeatDays,
      repeatOccurrences: previousSnapshot.repeatOccurrences,
    });
    plannerRestoreRef.current = {
      draft: hasDraftContent(previousDocument.body, normalizeAttachments(previousDocument.attachments))
        || (previousDocument.inlineButtons?.length ?? 0) > 0
        ? previousDocument
        : null,
    };

    attachmentSelectionGenerationRef.current += 1;
    setWorkspaceDocumentId(uid());
    setDraftBody(text);
    setDraftEntities(normalizeRichTextEntities(payload.entities, text.length));
    setMessageEffectId(payload.effect ?? null);
    attachmentUsageRef.current = {
      count: incomingAttachments.length,
      size: incomingAttachments.reduce((total, attachment) => total + attachment.size, 0),
      albumIds: new Set(incomingAttachments.flatMap((attachment) => attachment.albumId ? [attachment.albumId] : [])),
    };
    setAttachments(incomingAttachments);
    setInlineButtons([]);
    setPublishAction('send');
    focusPlannerEditorAtEndRef.current = true;
    changeStageMode('editor');
    showPublishFeedback(t('studio.draftMovedToEditor'), 'success');
    return true;
  }, [
    attachments,
    changeStageMode,
    createWorkspaceDraftSnapshot,
    date,
    draftBody,
    draftColor,
    draftEditingId,
    draftEntities,
    draftStateHydrated,
    draftStoreReady,
    inlineButtons,
    repeatDays,
    repeatMode,
    repeatOccurrences,
    recordWorkspaceVersion,
    selectedChat,
    showPublishFeedback,
    t,
    time,
    workspaceDocumentId,
  ]);

  const plannerTextOpenerHandlerRef = useRef(openPlannerTextInEditor);
  plannerTextOpenerHandlerRef.current = openPlannerTextInEditor;

  useEffect(() => {
    if (!onRegisterPlannerTextOpener || !draftStoreReady || !draftStateHydrated) return;
    onRegisterPlannerTextOpener((payload) => plannerTextOpenerHandlerRef.current(payload));
    return () => onRegisterPlannerTextOpener(null);
  }, [draftStateHydrated, draftStoreReady, onRegisterPlannerTextOpener]);

  // Restore the previous Studio document after a Planner note is completed.
  const restorePlannerDocument = async () => {
    const pending = plannerRestoreRef.current;
    if (!pending?.draft) return false;

    cancelPendingAutosave();
    const { draft } = pending;
    const draftChat = draft.selectedChat && chats.find((chat) => chat.id === draft.selectedChat?.id);
    if (draftStoreReady) {
      const restoredAttachments = normalizeAttachments(draft.attachments);
      const restoredSnapshot: WorkspaceDraft | null = hasDraftContent(draft.body, restoredAttachments)
        || (draft.inlineButtons?.length ?? 0) > 0
        ? {
          documentId: draft.documentId ?? workspaceDocumentId,
            body: draft.body,
            entities: draft.entities,
            attachments: restoredAttachments,
            selectedChat: draftChat ?? draft.selectedChat ?? null,
            inlineButtons: draft.inlineButtons ?? [],
            date: draft.date,
            time: draft.time,
            repeatMode: draft.repeatMode,
            repeatDays: draft.repeatDays,
            repeatOccurrences: draft.repeatOccurrences,
            savedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          }
        : null;
      const restored = await persistDraftStore(savedDraftsRef.current, restoredSnapshot);
      if (!restored) return false;
    }

    plannerRestoreRef.current = null;
    focusPlannerEditorAtEndRef.current = true;
    setWorkspaceDocumentId(draft.documentId ?? workspaceDocumentId);
    const restoredEntities = normalizeRichTextEntities(draft.entities, draft.body.length);
    if (bodyInputRef.current) {
      bodyInputRef.current.innerHTML = richTextToHtml(draft.body, restoredEntities);
    }
    if (draftChat) setSelectedChat(draftChat);
    attachmentSelectionGenerationRef.current += 1;
    setDraftBody(draft.body);
    setDraftEntities(restoredEntities);
    replaceAttachments(normalizeAttachments(draft.attachments));
    setInlineButtons(draft.inlineButtons ?? []);
    if (draft.date || draft.time) setFollowCurrentTime(false);
    if (draft.date) setDate(draft.date);
    if (draft.time) setTime(draft.time);
    setRepeatMode(draft.repeatMode ?? 'none');
    setRepeatDays(draft.repeatDays ?? []);
    setRepeatOccurrences(draft.repeatOccurrences ?? 1);
    rescheduleSourceRef.current = null;
    setRescheduleSource(null);
    setScheduleSelectionConfirmed(false);
    setPublishAction('send');
    setStageTab('editor');
    setStageMode('editor');
    showPublishFeedback(t('studio.previousTextRestored'), 'success');
    return true;
  };

  const openVersionHistory = () => {
    const documentIds = Object.entries(documentHistories)
      .filter(([, versions]) => versions.length > 0)
      .sort((left, right) => (
        Date.parse(right[1][right[1].length - 1].createdAt)
        - Date.parse(left[1][left[1].length - 1].createdAt)
      ));
    const selectedDocumentId = documentHistories[workspaceDocumentId]?.length
      ? workspaceDocumentId
      : documentIds[0]?.[0] ?? workspaceDocumentId;
    const versions = documentHistories[selectedDocumentId] ?? [];
    setSelectedHistoryDocumentId(selectedDocumentId);
    setSelectedVersionId((current) => (
      current && versions.some((version) => version.id === current)
        ? current
        : versions[versions.length - 1]?.id ?? null
    ));
    setVersionRestoreError('');
    setVersionHistoryOpen(true);
  };

  const restoreWorkspaceVersion = async (version: PersistedWorkspaceDocumentVersion, openCopy = false) => {
    if (isRestoringVersion) return;
    const timestamp = new Date(version.createdAt).toLocaleString(locale === 'ru' ? 'ru-RU' : 'en-US');
    const confirmationKey = openCopy ? 'studio.openVersionCopyConfirm' : 'studio.restoreVersionConfirm';
    if (!await confirm({
      message: t(confirmationKey, { time: timestamp }),
      confirmLabel: openCopy ? t('studio.openVersionCopy') : t('common.apply'),
      cancelLabel: t('common.cancel'),
    })) return;

    setIsRestoringVersion(true);
    setVersionRestoreError('');
    try {
      const sourceSnapshot = version.snapshot as unknown as WorkspaceDraft;
      const prepared = await prepareWorkspaceVersionSnapshot(sourceSnapshot);
      if (!prepared.snapshot) {
        setVersionRestoreError(prepared.error || t('studio.historyRestoreFailed'));
        return;
      }

      const currentSnapshot = createWorkspaceDraftSnapshot();
      if (openCopy || !areWorkspaceSnapshotsEqual(currentSnapshot, prepared.snapshot)) {
        const checkpoint = await recordWorkspaceVersion(currentSnapshot, 'restore');
        if (!checkpoint.success) {
          setVersionRestoreError(checkpoint.error || t('studio.historyCouldNotSave'));
          return;
        }
      }

      const restoredSnapshot: WorkspaceDraft = {
        ...prepared.snapshot,
        documentId: openCopy ? uid() : version.documentId,
        entities: normalizeRichTextEntities(prepared.snapshot.entities, prepared.snapshot.body.length),
        attachments: normalizeAttachments(prepared.snapshot.attachments),
        inlineButtons: prepared.snapshot.inlineButtons ?? [],
        savedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      const persisted = await persistDraftStore(
        () => savedDraftsRef.current,
        hasWorkspaceDocumentContent(restoredSnapshot) ? restoredSnapshot : null,
      );
      if (!persisted) {
        setVersionRestoreError(draftStoreError || t('studio.historyRestoreFailed'));
        return;
      }

      focusPlannerEditorAtEndRef.current = true;
      if (bodyInputRef.current) {
        bodyInputRef.current.innerHTML = richTextToHtml(restoredSnapshot.body, restoredSnapshot.entities ?? []);
      }
      setWorkspaceDocumentId(restoredSnapshot.documentId!);
      setDraftBody(restoredSnapshot.body);
      setDraftEntities(restoredSnapshot.entities ?? []);
      replaceAttachments(restoredSnapshot.attachments);
      setInlineButtons(restoredSnapshot.inlineButtons ?? []);
      setSelectedChat(restoredSnapshot.selectedChat ?? null);
      setDate(restoredSnapshot.date ?? '');
      setTime(restoredSnapshot.time ?? '');
      setFollowCurrentTime(!restoredSnapshot.date && !restoredSnapshot.time);
      setRepeatMode(restoredSnapshot.repeatMode ?? 'none');
      setRepeatDays(restoredSnapshot.repeatDays ?? []);
      setRepeatOccurrences(restoredSnapshot.repeatOccurrences ?? 1);
      setRescheduleSource(null);
      rescheduleSourceRef.current = null;
      setScheduleSelectionConfirmed(false);
      setPublishAction('send');
      setStageTab('editor');
      setStageMode('editor');
      if (openCopy) showPublishFeedback(t('studio.versionCopyOpened'), 'success');
      setVersionHistoryOpen(false);
    } catch (error) {
      setVersionRestoreError(error instanceof Error ? error.message : t('studio.historyRestoreFailed'));
    } finally {
      setIsRestoringVersion(false);
    }
  };

  restorePlannerDocumentRef.current = restorePlannerDocument;

  const saveTemplateStage = () => {
    if (!templateDraftName.trim() || !templateDraftBody.trim()) return;

    if (templateEditingId === 'new') {
      handleCreateTemplate({ name: templateDraftName, body: templateDraftBody });
      showPublishFeedback(t('studio.templateCreated'), 'success');
    } else if (templateEditingId) {
      handleUpdateTemplate(templateEditingId, {
        name: templateDraftName,
        body: templateDraftBody,
      });
      showPublishFeedback(t('studio.templateUpdated'), 'success');
    }

    closeTemplateEditor();
  };

  const handleAddFiles = async (files: File[], position = draftBody.length, albumId?: string) => {
    if (!files.length) return 0;

    const selectionGeneration = attachmentSelectionGenerationRef.current;
    setAttachmentError('');

    const currentPendingUsage = pendingAttachmentUsageRef.current.get(selectionGeneration) ?? { count: 0, size: 0 };
    const currentCount = attachmentUsageRef.current.count + currentPendingUsage.count;
    const currentSize = attachmentUsageRef.current.size + currentPendingUsage.size;
    const acceptedFiles: File[] = [];
    let nextSize = currentSize;
    let nextError = '';

    for (const file of files) {
      if (currentCount + acceptedFiles.length >= MAX_ATTACHMENTS) {
        nextError = t('studio.fileCountLimit', { count: MAX_ATTACHMENTS });
        break;
      }

      if (file.size > MAX_ATTACHMENT_SIZE) {
        nextError = t('studio.fileSizeLimit', { name: file.name });
        continue;
      }

      if (nextSize + file.size > MAX_ATTACHMENTS_TOTAL_SIZE) {
        nextError = t('studio.totalFileSizeLimit');
        break;
      }

      acceptedFiles.push(file);
      nextSize += file.size;
    }

    const reservedSize = acceptedFiles.reduce((total, file) => total + file.size, 0);
    currentPendingUsage.count += acceptedFiles.length;
    currentPendingUsage.size += reservedSize;
    pendingAttachmentUsageRef.current.set(selectionGeneration, currentPendingUsage);

    const safePosition = Math.max(0, Math.min(position, draftBody.length));
    const copiedAttachments = await Promise.all(acceptedFiles.map(async (file) => {
      const mimeType = file.type || inferAttachmentMimeType(file.name);
      const type = mimeType.startsWith('image/') ? 'image' : 'file';
      try {
        const draftStorage = getDraftStorageApi();
        if (!draftStorage) {
          const dataUrl = await readFileAsDataUrl(file);
          return {
            id: createAttachmentId(), type, name: file.name, mimeType, path: dataUrl,
            size: file.size, previewUrl: type === 'image' ? dataUrl : undefined, position: safePosition,
            ...(albumId ? { albumId } : {}),
          };
        }

        const result = await draftStorage.copyAttachment(file);
        return result.success && result.attachment
          ? {
              id: createAttachmentId(), type, name: file.name, mimeType,
              path: result.attachment.path, size: result.attachment.size, position: safePosition,
              ...(albumId ? { albumId } : {}),
            }
          : { error: result.error || t('studio.fileStoreFailed', { name: file.name }) };
      } catch (error) {
        return { error: error instanceof Error ? error.message : `${file.name} could not be stored.` };
      }
    }));
    const storedAttachments = copiedAttachments.filter((item): item is WorkspaceAttachment => 'path' in item);
    const copyErrors = copiedAttachments.filter((item): item is { error: string } => 'error' in item);
    const pendingUsage = pendingAttachmentUsageRef.current.get(selectionGeneration);
    if (pendingUsage) {
      pendingUsage.count -= acceptedFiles.length;
      pendingUsage.size -= reservedSize;
      if (pendingUsage.count === 0 && pendingUsage.size === 0) {
        pendingAttachmentUsageRef.current.delete(selectionGeneration);
      }
    }
    if (selectionGeneration !== attachmentSelectionGenerationRef.current) return;
    attachmentUsageRef.current.count += storedAttachments.length;
    attachmentUsageRef.current.size += storedAttachments.reduce((total, attachment) => total + attachment.size, 0);
    storedAttachments.forEach((attachment) => {
      if (attachment.albumId) attachmentUsageRef.current.albumIds.add(attachment.albumId);
    });
    if (storedAttachments.length) setAttachments((current) => [...current, ...storedAttachments]);

    const errors = [nextError, ...copyErrors.map((item) => item.error)].filter(Boolean);
    if (errors.length) setAttachmentError(errors.join(' '));
    return storedAttachments.length;
  };

  const handleFileSelection = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const files = Array.from(input.files ?? []);
    await handleAddFiles(files);
    input.value = '';
  };

  const handleAlbumFileSelection = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const files = Array.from(input.files ?? []);
    const targetAlbumId = albumAttachmentTargetIdRef.current;
    albumAttachmentTargetIdRef.current = null;
    input.value = '';
    const selectedImages = files.filter((file) => (
      file.type.startsWith('image/') || inferAttachmentMimeType(file.name).startsWith('image/')
    ));
    if (selectedImages.length === 0) {
      setAttachmentError(t('studio.photoAlbumImagesOnly'));
      return;
    }
    if (selectedImages.some((file) => !isSupportedPhotoAlbumSource(file))) {
      setAttachmentError(t('studio.photoAlbumSupportedFormats'));
      return;
    }

    const existingAlbumIds = new Set([
      ...attachmentUsageRef.current.albumIds,
      ...pendingAlbumIdsRef.current,
    ]);
    if (!targetAlbumId && existingAlbumIds.size >= MAX_ALBUMS) {
      setAttachmentError(t('studio.photoAlbumCountLimit', { count: MAX_ALBUMS }));
      return;
    }

    const existingPhotoCount = targetAlbumId
      ? attachments.filter((attachment) => attachment.albumId === targetAlbumId).length
      : 0;
    const pendingPhotoCount = targetAlbumId
      ? pendingAlbumPhotoCountsRef.current.get(targetAlbumId) ?? 0
      : 0;
    const availablePhotoSlots = Math.max(0, MAX_PHOTOS_PER_ALBUM - existingPhotoCount - pendingPhotoCount);
    if (availablePhotoSlots === 0) {
      setAttachmentError(t('studio.photoAlbumPhotoLimit', { count: MAX_PHOTOS_PER_ALBUM }));
      return;
    }

    const albumId = targetAlbumId ?? createAttachmentId();
    const selectedAlbumImages = selectedImages.slice(0, availablePhotoSlots);
    const exceededAlbumLimit = selectedImages.length > availablePhotoSlots;
    if (targetAlbumId) {
      pendingAlbumPhotoCountsRef.current.set(albumId, pendingPhotoCount + selectedAlbumImages.length);
    } else {
      pendingAlbumIdsRef.current.add(albumId);
    }
    try {
      const telegramPhotos = await Promise.all(
        selectedAlbumImages.map(convertWebpToTelegramPhoto),
      );
      await handleAddFiles(
        telegramPhotos,
        albumAttachmentPositionRef.current,
        albumId,
      );
    } catch {
      setAttachmentError(t('studio.photoAlbumConversionFailed'));
    } finally {
      if (targetAlbumId) {
        const remainingPending = (pendingAlbumPhotoCountsRef.current.get(albumId) ?? 0) - selectedAlbumImages.length;
        if (remainingPending > 0) pendingAlbumPhotoCountsRef.current.set(albumId, remainingPending);
        else pendingAlbumPhotoCountsRef.current.delete(albumId);
      } else {
        pendingAlbumIdsRef.current.delete(albumId);
      }
    }
    if (exceededAlbumLimit) {
      setAttachmentError(t('studio.photoAlbumPhotoLimit', { count: MAX_PHOTOS_PER_ALBUM }));
    }
  };

  const handleBeforeClearEditorText = async () => {
    if (pendingDraftReplacementRef.current) {
      await restorePreviousDraftAfterReplacement();
      return false;
    }
    const checkpoint = await recordWorkspaceVersion(createWorkspaceDraftSnapshot(), 'before-clear');
    if (!checkpoint.success) {
      showPublishFeedback(t('studio.historyCouldNotSave'), 'warning');
      return false;
    }
    if (!attachments.length && !inlineButtons.length) setWorkspaceDocumentId(uid());
    return true;
  };

  const handleRemoveAttachment = async (attachmentId: string) => {
    const checkpoint = await recordWorkspaceVersion(createWorkspaceDraftSnapshot(), 'before-attachment-removal');
    if (!checkpoint.success) {
      showPublishFeedback(t('studio.historyCouldNotSave'), 'warning');
      return;
    }
    const currentAttachments = checkpoint.snapshot?.attachments ?? attachments;
    const removedAttachment = currentAttachments.find((attachment) => attachment.id === attachmentId);
    const previewUrl = removedAttachment?.previewUrl;
    if (previewUrl && attachmentPreviewUrlsRef.current.delete(previewUrl)) {
      URL.revokeObjectURL(previewUrl);
    }
    replaceAttachments(currentAttachments.filter((attachment) => attachment.id !== attachmentId));
  };

  const handleRemoveAlbum = async (albumId: string) => {
    const checkpoint = await recordWorkspaceVersion(createWorkspaceDraftSnapshot(), 'before-attachment-removal');
    if (!checkpoint.success) {
      showPublishFeedback(t('studio.historyCouldNotSave'), 'warning');
      return;
    }
    const currentAttachments = checkpoint.snapshot?.attachments ?? attachments;
    currentAttachments
      .filter((attachment) => attachment.albumId === albumId)
      .forEach((attachment) => {
        const previewUrl = attachment.previewUrl;
        if (previewUrl && attachmentPreviewUrlsRef.current.delete(previewUrl)) {
          URL.revokeObjectURL(previewUrl);
        }
      });
    replaceAttachments(currentAttachments.filter((attachment) => attachment.albumId !== albumId));
  };

  const showAttachmentPreview = (image: HTMLImageElement, name: string, src: string) => {
    const bounds = image.getBoundingClientRect();
    const width = Math.min(320, window.innerWidth - 24);
    const height = Math.min(260, window.innerHeight - 24);
    const rightPosition = bounds.right + 12;
    const left = rightPosition + width <= window.innerWidth - 12
      ? rightPosition
      : Math.max(12, bounds.left - width - 12);
    const top = Math.max(12, Math.min(
      bounds.top + bounds.height / 2 - height / 2,
      window.innerHeight - height - 12,
    ));

    setAttachmentPreview({ src, name, left, top, width, height });
  };

  const scheduleAttachmentPreview = (image: HTMLImageElement, name: string, src: string) => {
    if (attachmentPreviewTimerRef.current !== null) {
      window.clearTimeout(attachmentPreviewTimerRef.current);
    }
    attachmentPreviewTimerRef.current = window.setTimeout(() => {
      attachmentPreviewTimerRef.current = null;
      showAttachmentPreview(image, name, src);
    }, 1000);
  };

  const hideAttachmentPreview = () => {
    if (attachmentPreviewTimerRef.current !== null) {
      window.clearTimeout(attachmentPreviewTimerRef.current);
      attachmentPreviewTimerRef.current = null;
    }
    setAttachmentPreview(null);
  };

  const handleExportEditorText = async (editorText: string, format: 'txt' | 'json') => {
    if (!editorText.trim()) {
      showPublishFeedback(t('studio.textExportEmpty'));
      return;
    }

    const draftStorage = getDraftStorageApi();
    if (!draftStorage || typeof draftStorage.exportText !== 'function') {
      setTextFileError(t('studio.textExportFailed'));
      return;
    }

    const payload = format === 'json'
      ? JSON.stringify({ exportedAt: new Date().toISOString(), text: editorText }, null, 2)
      : editorText;

    try {
      const result = await draftStorage.exportText(payload, format);
      if (result.cancelled) return;
      if (!result.success) {
        setTextFileError(result.error || t('studio.textExportFailed'));
        return;
      }
      setTextFileError('');
      showPublishFeedback(t('studio.textExported'), 'success');
    } catch (error) {
      setTextFileError(error instanceof Error ? error.message : t('studio.textExportFailed'));
    }
  };

  const handleImportEditorText = async () => {
    setTextFileError('');
    try {
      const draftStorage = getDraftStorageApi();
      if (!draftStorage) {
        const fallback = readWorkspaceDraftStoreFallback();
        const body = fallback?.workspaceDraft && typeof fallback.workspaceDraft === 'object' && typeof (fallback.workspaceDraft as { body?: unknown }).body === 'string'
          ? (fallback.workspaceDraft as { body: string }).body
          : '';
        if (!body) {
          setTextFileError(t('studio.textImportUnavailable'));
          return;
        }
        const checkpoint = await recordWorkspaceVersion(createWorkspaceDraftSnapshot(), 'before-replacement');
        if (!checkpoint.success) {
          showPublishFeedback(t('studio.historyCouldNotSave'), 'warning');
          return;
        }
        setDraftBody(body);
        setDraftEntities([]);
        setTextFileError('');
        changeStageMode('editor');
        showPublishFeedback(t('studio.textImported'), 'success');
        return;
      }

      const result = await draftStorage.importText();
      if (!result.success) {
        if (!result.cancelled) setTextFileError(result.error || t('studio.textFileReadFailed'));
        return;
      }
      if (typeof result.text !== 'string') {
        setTextFileError(t('studio.textFileEmpty'));
        return;
      }
      if (result.text.length > maxDraftLength) {
        setTextFileError(t('studio.textImportLimit', { limit: maxDraftLength }));
        return;
      }
      if (draftBody.length > 0 && result.text !== draftBody && !await confirm({
        message: t('studio.confirmReplaceText'),
        confirmLabel: t('common.apply'),
        cancelLabel: t('common.cancel'),
        destructive: true,
      })) return;
      if (result.text !== draftBody) {
        const checkpoint = await recordWorkspaceVersion(createWorkspaceDraftSnapshot(), 'before-replacement');
        if (!checkpoint.success) {
          showPublishFeedback(t('studio.historyCouldNotSave'), 'warning');
          return;
        }
      }

      setDraftBody(result.text);
      setDraftEntities([]);
      setTextFileError('');
      changeStageMode('editor');
      showPublishFeedback(t('studio.textImported'), 'success');
    } catch (error) {
      setTextFileError(error instanceof Error ? error.message : t('studio.textFileReadFailed'));
    }
  };

  return (
    <div
      ref={workspaceRef}
      aria-label={t('studio.workspace')}
      className="workspace-page"
    >
      {attachmentPreview && createPortal(
        <div
          className="workspace-page-attachment-preview"
          style={{ left: attachmentPreview.left, top: attachmentPreview.top, width: attachmentPreview.width, height: attachmentPreview.height }}
          role="tooltip"
          aria-label={t('studio.previewFile', { name: attachmentPreview.name })}
        >
          <img src={attachmentPreview.src} alt={attachmentPreview.name} />
        </div>,
        document.body,
      )}
      <div className="workspace-page-shell">
        <main className="workspace-page-main">
          <section className="workspace-page-panel workspace-page-editor-panel">
                <div className="workspace-page-editor-heading">
                  <div className="workspace-page-editor-title">
                    <span className="workspace-page-editor-title-text">{t('studio.createPost')}</span>
                  </div>
                </div>

                <div
                  className={`workspace-page-editor-shell${publishAction === 'schedule' ? ' is-scheduled' : publishAction === 'draft' ? ' is-draft' : ''}`}
                  data-editor-appearance={editorAppearance.style}
                  style={getEditorAppearanceCssTokens(editorAppearance, publishAction) as CSSProperties}
                >
                  <div className="workspace-page-mode-summary" aria-live="polite">
                    <span className="workspace-page-mode-summary-label">{t('studio.currentAction')}</span>
                    <strong>{currentModeSummary}</strong>
                  </div>
              <div className="workspace-page-editor-canvas">
                <div className="workspace-page-form-row">
                  <label className="workspace-page-field-label" aria-label={t('studio.channelSelector')} />
                  <div className="workspace-page-channel-picker">
                    <button type="button" className="workspace-page-chat-trigger" onClick={openChatSelection} aria-label={t('studio.chooseChat')} aria-expanded={stageMode === 'chat'} title={t('studio.chooseChatOrChannel')}>
                      {selectedChat ? (
                        <>
                          <ChatAvatar name={selectedChat.name} src={selectedChat.avatarDataUrl} className="workspace-page-chat-trigger-avatar" />
                          <span className="workspace-page-chat-trigger-copy">
                            <strong>{localizeChatName(selectedChat.name)}</strong>
                            <span>{selectedChatSubtitle}</span>
                          </span>
                          <ChatPickerChevron />
                        </>
                      ) : (
                        <>
                          <span>{t('studio.chooseChat')}</span>
                          <ChatPickerChevron />
                        </>
                      )}
                    </button>
                  </div>
                </div>

                <div className="workspace-page-form-row workspace-page-form-row-body">
                  <RichTextEditor
                    inputRef={bodyInputRef}
                    text={draftBody}
                    entities={draftEntities}
                    selectedEffectId={messageEffectId}
                    onEffectChange={setMessageEffectId}
                    maxLength={maxDraftLength}
                    stageMode={stageMode}
                    albumDisabled={attachmentUsageRef.current.albumIds.size >= MAX_ALBUMS}
                    onOpenAlbum={(position) => {
                      albumAttachmentTargetIdRef.current = null;
                      albumAttachmentPositionRef.current = position;
                      albumFileInputRef.current?.click();
                    }}
                    onBeforeClear={handleBeforeClearEditorText}
                    onOpenVersionHistory={openVersionHistory}
                    onAddFiles={(files, position) => void handleAddFiles(files, position)}
                    onExportText={(editorText, format) => void handleExportEditorText(editorText, format)}
                    onChange={(nextText, nextEntities) => {
                      const limited = nextText.length > maxDraftLength
                        ? sliceRichText(nextText, nextEntities, 0, maxDraftLength)
                        : { text: nextText, entities: nextEntities };
                      const previousText = draftBodyRef.current;
                      draftBodyRef.current = limited.text;
                      startTransition(() => {
                        setAttachments((current) => remapAttachmentPositions(current, previousText, limited.text));
                        setDraftBody(limited.text);
                        setDraftEntities((current) => (
                          current.length === limited.entities.length
                          && current.every((entity, index) => {
                            const next = limited.entities[index];
                            return entity.type === next.type
                              && entity.offset === next.offset
                              && entity.length === next.length
                              && entity.url === next.url;
                          })
                            ? current
                            : limited.entities
                        ));
                      });
                    }}
                    stageContent={(
                      <WorkspaceTextStage
                        mode={stageMode}
                        scheduleFocus={scheduleFocus}
                        onModeChange={changeStageMode}
                        onScheduleDone={() => setScheduleSelectionConfirmed(true)}
                        selectedChat={selectedChat}
                        chats={chats}
                        selectedChats={workspaceSelectedChats}
                        onChatSelectionChange={setWorkspaceSelectedChats}
                        onChatSelectionDone={completeChatSelection}
                        onChatSelectionBack={backFromChatSelection}
                        onChatError={setChatLookupError}
                        onAddChat={onAddChat}
                        onRemoveChat={onRemoveChat}
                        draftBody={draftBody}
                        draftEntities={draftEntities}
                        date={date}
                        time={time}
                        setDate={setDate}
                        setTime={setTime}
                        followCurrentTime={followCurrentTime}
                        setFollowCurrentTime={setFollowCurrentTime}
                        scheduling={scheduling}
                        canSchedule={canSchedule}
                        onSchedule={(entities, repeat) => {
                          if (!selectedChat) return;
                          const attachmentGroups = getAttachmentTransportGroups(attachments);
                          handleSchedule({
                            chatId: selectedChat.id,
                            message: draftBody,
                            date,
                            time,
                            entities,
                            attachments: attachmentGroups.flat(),
                            attachmentGroups,
                            replyMarkup: toInlineKeyboardMarkup(inlineButtons),
                            ...(rescheduleSource ? { replaceMessage: rescheduleSource } : {}),
                          }, repeat);
                          setStageMode('editor');
                        }}
                        repeatMode={repeatMode}
                        setRepeatMode={setRepeatMode}
                        repeatDays={repeatDays}
                        setRepeatDays={setRepeatDays}
                        repeatOccurrences={repeatOccurrences}
                        setRepeatOccurrences={setRepeatOccurrences}
                        templates={templates}
                        savedDrafts={savedDrafts}
                        onInsertDraft={useSavedDraft}
                        onRenameDraft={handleRenameDraft}
                        draftEditingId={draftEditingId}
                        draftColor={draftEditorColor}
                        setDraftColor={setDraftEditorColor}
                        draftName={draftName}
                        setDraftName={setDraftName}
                        draftBodyText={draftBodyText}
                        setDraftBodyText={(value) => {
                          setDraftBodyText(value);
                          setDraftBodyEntities([]);
                        }}
                        openDraftEditor={openDraftEditor}
                        onDeleteDraft={handleDeleteDraft}
                        closeDraftEditor={closeDraftEditor}
                        saveDraftStage={saveDraftStage}
                        draftStoreReady={draftStoreReady}
                        draftStoreSaving={draftStoreSaving}
                        onExportDrafts={() => { void exportDrafts(showPublishFeedback); }}
                        onImportDrafts={() => { void importDrafts(showPublishFeedback); }}
                        onImportEditorText={() => void handleImportEditorText()}
                        onInsertTemplate={insertTextAtCursor}
                        templateEditingId={templateEditingId}
                        templateDraftName={templateDraftName}
                        setTemplateDraftName={setTemplateDraftName}
                        templateDraftBody={templateDraftBody}
                        setTemplateDraftBody={setTemplateDraftBody}
                        openTemplateEditor={openTemplateEditor}
                        onDeleteTemplate={handleDeleteTemplate}
                        closeTemplateEditor={closeTemplateEditor}
                        saveTemplateStage={saveTemplateStage}
                        inlineButtons={inlineButtons}
                        setInlineButtons={setInlineButtons}
                      />
                    )}
                  />
                </div>

              </div>

                <div
                  className={`workspace-page-attachment-tray ${attachments.length === 0 ? 'is-empty' : ''}`}
                  aria-label={t('studio.attachedFiles')}
                  aria-hidden={attachments.length === 0}
                >
                  <div className="workspace-page-media-items" ref={attachmentItemsRef}>
                    {getAttachmentDisplayItems(attachments).map((item) => {
                      if (item.kind === 'album') {
                        return (
                          <div
                            key={`album-${item.albumId}`}
                            className="workspace-page-attachment-card workspace-page-photo-album-card"
                            data-album-id={item.albumId}
                            data-position={item.position}
                            role="group"
                            aria-label={`${t('studio.photoAlbum')} · ${t('studio.photoAlbumCount', { count: item.attachments.length })}`}
                          >
                            <div className="workspace-page-photo-album-preview">
                              {item.attachments.slice(0, 4).map((file) => (
                                file.unavailable ? (
                                  <span key={file.id}><AlertTriangle size={10} aria-hidden="true" /></span>
                                ) : (
                                  <img
                                    key={file.id}
                                    src={file.previewUrl || toFileUrl(file.path)}
                                    alt=""
                                    tabIndex={0}
                                    aria-label={t('studio.previewFile', { name: file.name })}
                                    onMouseEnter={(event) => scheduleAttachmentPreview(
                                      event.currentTarget,
                                      file.name,
                                      file.previewUrl || toFileUrl(file.path),
                                    )}
                                    onMouseLeave={hideAttachmentPreview}
                                    onFocus={(event) => showAttachmentPreview(
                                      event.currentTarget,
                                      file.name,
                                      file.previewUrl || toFileUrl(file.path),
                                    )}
                                    onBlur={hideAttachmentPreview}
                                  />
                                )
                              ))}
                              {item.attachments.length > 4 && (
                                <span className="workspace-page-photo-album-preview-more">+{item.attachments.length - 4}</span>
                              )}
                            </div>
                            <span className="workspace-page-attachment-copy">
                              <span className="workspace-page-attachment-name">{t('studio.photoAlbum')}</span>
                              <span className="workspace-page-attachment-metadata">
                                {t('studio.photoAlbumCount', { count: item.attachments.length })}
                              </span>
                            </span>
                            <button
                              type="button"
                              className="workspace-page-photo-album-add"
                              disabled={item.attachments.length >= MAX_PHOTOS_PER_ALBUM}
                              onClick={() => {
                                albumAttachmentTargetIdRef.current = item.albumId;
                                albumAttachmentPositionRef.current = item.position;
                                albumFileInputRef.current?.click();
                              }}
                              aria-label={t('studio.addPhotosToAlbum')}
                              title={t('studio.addPhotosToAlbum')}
                            >
                              <ImagePlus size={13} strokeWidth={1.8} aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              className="workspace-page-attachment-remove"
                              onClick={() => handleRemoveAlbum(item.albumId)}
                              aria-label={t('studio.removePhotoAlbum')}
                              title={t('studio.removePhotoAlbum')}
                            >
                              ×
                            </button>
                          </div>
                        );
                      }

                      const file = item.attachment;
                      return (
                        <div
                          key={file.id}
                          className={`workspace-page-attachment-card ${file.unavailable ? 'is-unavailable' : ''}`}
                          data-position={file.position}
                          title={file.unavailable || !isImageAttachment(file)
                            ? `${file.name} · ${file.mimeType} · ${formatAttachmentSize(file.size)}${file.unavailable ? ` · ${t('studio.historyAttachmentUnavailable', { name: file.name })}` : ''}`
                            : undefined}
                          aria-label={file.unavailable ? t('studio.historyAttachmentUnavailable', { name: file.name }) : undefined}
                        >
                          {file.unavailable ? (
                            <div className="workspace-page-attachment-file-mark is-unavailable">
                              <AlertTriangle size={15} aria-hidden="true" />
                            </div>
                          ) : isImageAttachment(file) ? (
                            <img
                              src={file.previewUrl || toFileUrl(file.path)}
                              alt=""
                              className="workspace-page-attachment-thumbnail"
                              tabIndex={0}
                              aria-label={t('studio.previewFile', { name: file.name })}
                              onMouseEnter={(event) => scheduleAttachmentPreview(event.currentTarget, file.name, file.previewUrl || toFileUrl(file.path))}
                              onMouseLeave={hideAttachmentPreview}
                              onFocus={(event) => showAttachmentPreview(event.currentTarget, file.name, file.previewUrl || toFileUrl(file.path))}
                              onBlur={hideAttachmentPreview}
                            />
                          ) : (
                            <div className="workspace-page-attachment-file-mark">
                              {file.name.split('.').pop()?.slice(0, 4).toUpperCase() || 'FILE'}
                            </div>
                          )}
                          <span className="workspace-page-attachment-copy">
                            <span className="workspace-page-attachment-name">{file.name}</span>
                            <span className="workspace-page-attachment-metadata">
                              {file.mimeType} · {formatAttachmentSize(file.size)}
                            </span>
                          </span>
                          <button
                            type="button"
                            className="workspace-page-attachment-remove"
                            onClick={() => handleRemoveAttachment(file.id)}
                            aria-label={t('composer.removeAttachment', { name: file.name })}
                            title={t('composer.removeAttachment', { name: file.name })}
                          >
                            ×
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>

              <div className={`workspace-page-action-row workspace-page-schedule-row ${publishMenuOpen ? 'is-publish-menu-open' : ''}`}>
                <div className="workspace-page-media-row">
                  <button
                    type="button"
                    className="workspace-page-preview-toggle workspace-page-attachment-toggle"
                    onClick={() => fileInputRef.current?.click()}
                    onPointerMove={updateIconRimPointer}
                    onPointerLeave={clearIconRimPointer}
                    aria-label={t('studio.addFile')}
                    title={t('studio.addAttachment')}
                  >
                    <svg className="workspace-page-attachment-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                      <defs>
                        <linearGradient id="workspace-attachment-metal" x1="3" y1="3" x2="21" y2="21" gradientUnits="userSpaceOnUse">
                          <stop stopColor="#f5fbff" />
                          <stop offset="0.38" stopColor="#c2d8e5" />
                          <stop offset="0.72" stopColor="#819aaa" />
                          <stop offset="1" stopColor="#e0edf4" />
                        </linearGradient>
                      </defs>
                      <path d="M9.6 12.4 16.7 5.3a3.7 3.7 0 1 1 5.2 5.2l-9.4 9.4a5.9 5.9 0 1 1-8.4-8.4l9.9-9.9" transform="translate(0 0.65)" fill="none" stroke="rgba(5, 11, 17, 0.86)" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M9.6 12.4 16.7 5.3a3.7 3.7 0 1 1 5.2 5.2l-9.4 9.4a5.9 5.9 0 1 1-8.4-8.4l9.9-9.9" fill="none" stroke="url(#workspace-attachment-metal)" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M9.6 12.4 16.7 5.3a3.7 3.7 0 1 1 5.2 5.2l-9.4 9.4a5.9 5.9 0 1 1-8.4-8.4l9.9-9.9" transform="translate(-0.12 -0.18)" fill="none" stroke="rgba(250, 253, 255, 0.48)" strokeWidth="0.65" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    onChange={handleFileSelection}
                    className="workspace-page-hidden-file-input"
                  />
                  <input
                    ref={albumFileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
                    multiple
                    onChange={handleAlbumFileSelection}
                    className="workspace-page-hidden-file-input"
                  />
                </div>
                <div className="workspace-page-action-left-group">
                  <button
                    type="button"
                    className="workspace-page-preview-toggle"
                    onClick={togglePreviewVisibility}
                    onPointerMove={updateIconRimPointer}
                    onPointerLeave={clearIconRimPointer}
                    aria-label={t(previewLayout.visible === false ? 'studio.showPreview' : 'studio.hidePreview')}
                    title={t(previewLayout.visible === false ? 'studio.showPreview' : 'studio.hidePreview')}
                    aria-pressed={previewLayout.visible !== false}
                  >
                    {previewLayout.visible === false ? (
                      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                        <defs>
                          <linearGradient id="workspace-preview-metal" x1="4" y1="6" x2="20" y2="18" gradientUnits="userSpaceOnUse">
                            <stop stopColor="#f5fbff" />
                            <stop offset="0.4" stopColor="#c2d8e5" />
                            <stop offset="0.72" stopColor="#819aaa" />
                            <stop offset="1" stopColor="#e0edf4" />
                          </linearGradient>
                        </defs>
                        <path d="M2.2 12c2.6-3.5 6.2-5.8 9.8-5.8s7.2 2.3 9.8 5.8c-2.6 3.5-6.2 5.8-9.8 5.8S4.8 15.5 2.2 12Z" fill="none" stroke="rgba(5, 11, 17, 0.86)" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M2.2 12c2.6-3.5 6.2-5.8 9.8-5.8s7.2 2.3 9.8 5.8c-2.6 3.5-6.2 5.8-9.8 5.8S4.8 15.5 2.2 12Z" fill="none" stroke="url(#workspace-preview-metal)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                        <circle cx="12" cy="12" r="2.65" fill="none" stroke="url(#workspace-preview-metal)" strokeWidth="1.22" />
                        <path className="workspace-page-preview-pupil" d="M12 10.8a1.2 1.2 0 1 0 0 2.4a1.2 1.2 0 1 0 0-2.4Z" fill="#275d78" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                        <defs>
                          <linearGradient id="workspace-preview-metal" x1="4" y1="6" x2="20" y2="18" gradientUnits="userSpaceOnUse">
                            <stop stopColor="#f5fbff" />
                            <stop offset="0.4" stopColor="#c2d8e5" />
                            <stop offset="0.72" stopColor="#819aaa" />
                            <stop offset="1" stopColor="#e0edf4" />
                          </linearGradient>
                        </defs>
                        <path d="M2.2 12c2.6-3.5 6.2-5.8 9.8-5.8s7.2 2.3 9.8 5.8c-2.6 3.5-6.2 5.8-9.8 5.8S4.8 15.5 2.2 12Z" fill="none" stroke="rgba(5, 11, 17, 0.86)" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M2.2 12c2.6-3.5 6.2-5.8 9.8-5.8s7.2 2.3 9.8 5.8c-2.6 3.5-6.2 5.8-9.8 5.8S4.8 15.5 2.2 12Z" fill="none" stroke="url(#workspace-preview-metal)" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
                        <circle cx="12" cy="12" r="2.8" fill="none" stroke="url(#workspace-preview-metal)" strokeWidth="1.2" />
                        <path className="workspace-page-preview-pupil" d="M12 10.8a1.2 1.2 0 1 0 0 2.4a1.2 1.2 0 1 0 0-2.4Z" fill="#275d78" />
                      </svg>
                    )}
                  </button>
                  <button
                    type="button"
                    className={`workspace-page-mode-button workspace-page-mode-button-template ${stageMode === 'template' ? 'is-active' : ''}`}
                    onClick={() => {
                      if (stageMode === 'template') {
                        closeTemplateEditor();
                        setStageTab('editor');
                        setStageMode('editor');
                      } else {
                        changeStageMode('template');
                      }
                    }}
                    aria-pressed={stageMode === 'template'}
                    title={t('studio.manageTemplates')}
                  >
                    {t('studio.templates')}
                  </button>
                  {(publishAction !== 'schedule' && stageMode !== 'schedule') && (
                    <button
                      type="button"
                      className={`workspace-page-mode-button workspace-page-mode-button-template workspace-page-mode-button-draft ${stageMode === 'draft' ? 'is-active' : ''}`}
                      onClick={() => stageMode === 'draft' ? changeStageMode('editor') : changeStageMode('draft')}
                      aria-pressed={stageMode === 'draft'}
                      title={t('studio.openDrafts')}
                    >
                      {t('studio.draftModeButton')}
                    </button>
                  )}
                  {(publishAction === 'schedule' || stageMode === 'schedule') && (
                    <div className="workspace-page-schedule-compact-group" aria-label={t('studio.scheduleTools')}>
                      <button
                        type="button"
                        className={`workspace-page-mode-button workspace-page-schedule-compact-button ${stageMode === 'schedule' && scheduleFocus === 'time' ? 'is-active' : ''}`}
                        onClick={() => openScheduleStage('time')}
                        aria-pressed={stageMode === 'schedule' && scheduleFocus === 'time'}
                        title={t('studio.setDateTime')}
                      >
                        {t('studio.time')}
                      </button>
                      <button
                        type="button"
                        className={`workspace-page-mode-button workspace-page-schedule-compact-button ${stageMode === 'schedule' && scheduleFocus === 'repeat' ? 'is-active' : ''}`}
                        onClick={() => openScheduleStage('repeat')}
                        aria-pressed={stageMode === 'schedule' && scheduleFocus === 'repeat'}
                        title={t('studio.configureRepeat')}
                      >
                        {t('studio.repeat')}
                      </button>
                    </div>
                  )}
                </div>

                <div className="workspace-page-submit-actions" ref={publishMenuRef}>
                  <button
                    type="button"
                    className={`workspace-page-action-button workspace-page-publish-trigger workspace-page-publish-main ${publishAction === 'schedule' ? 'is-scheduled' : publishAction === 'draft' ? 'is-draft' : 'is-send'} ${successPulse && lastAction === 'sent' ? 'is-active' : ''}`}
                    onClick={handlePrimaryPublish}
                    onPointerMove={updateIconRimPointer}
                    onPointerLeave={clearIconRimPointer}
                    disabled={sendInFlight || publishingDraft || scheduling || (publishAction === 'draft' && draftStoreSaving)}
                  >
                    <span className="workspace-page-publish-trigger-main">
                      {publishAction === 'schedule'
                        ? (scheduling ? t('studio.scheduling') : successPulse && lastAction === 'scheduled' ? t('studio.scheduled') : t('studio.schedule'))
                        : publishAction === 'draft'
                          ? t('studio.saveAction')
                          : (publishingDraft ? t(reconnectingForSend ? 'studio.reconnecting' : 'studio.sending') : successPulse && lastAction === 'sent' ? t('studio.sent') : t('studio.sendAction'))}
                    </span>
                  </button>
                  <button
                    type="button"
                    className={`workspace-page-publish-trigger workspace-page-publish-menu-toggle ${publishMenuOpen ? 'is-active' : ''}`}
                    ref={publishMenuToggleRef}
                    onClick={() => setPublishMenuOpen((current) => !current)}
                    aria-label={t('studio.morePublishOptions')}
                    title={t('studio.choosePublishAction')}
                    aria-expanded={publishMenuOpen}
                    aria-haspopup="menu"
                    aria-pressed={publishMenuOpen}
                    onPointerMove={updateIconRimPointer}
                    onPointerLeave={clearIconRimPointer}
                    onKeyDown={(event) => {
                      if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setPublishMenuOpen(true);
                      }
                    }}
                  >
                    <span className="workspace-page-publish-trigger-arrow" aria-hidden="true">
                      <svg viewBox="0 0 24 24" width="18" height="18" focusable="false">
                        <defs>
                          <linearGradient id="workspace-menu-metal" x1="6" y1="8" x2="18" y2="16" gradientUnits="userSpaceOnUse">
                            <stop stopColor="#f5fbff" />
                            <stop offset="0.4" stopColor="#c2d8e5" />
                            <stop offset="0.72" stopColor="#819aaa" />
                            <stop offset="1" stopColor="#e0edf4" />
                          </linearGradient>
                        </defs>
                        <path d="M6 8.8 12 15l6-6.2" fill="none" stroke="rgba(5, 11, 17, 0.86)" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M6 8.8 12 15l6-6.2" fill="none" stroke="url(#workspace-menu-metal)" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M6.4 8.4 12 14.2l5.6-5.8" fill="none" stroke="rgba(250, 253, 255, 0.5)" strokeWidth="0.65" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                  </button>

                  {publishMenuOpen && (
                    <div className="workspace-page-publish-menu workspace-page-publish-menu-compact" role="menu" aria-label={t('studio.publishAction')}>
                      <button
                        type="button"
                        className={`workspace-page-publish-option is-send ${publishAction === 'send' ? 'is-selected' : ''}`}
                        autoFocus={publishAction === 'send'}
                        onClick={() => choosePublishAction('send')}
                        role="menuitemradio"
                        aria-checked={publishAction === 'send'}
                        onPointerMove={updateGlassPointer}
                        onPointerLeave={clearGlassPointer}
                      >
                        <span>{t('studio.sendNow')}</span>
                      </button>
                      <button
                        type="button"
                        className={`workspace-page-publish-option is-scheduled ${publishAction === 'schedule' ? 'is-selected' : ''}`}
                        autoFocus={publishAction === 'schedule'}
                        onClick={() => choosePublishAction('schedule')}
                        role="menuitemradio"
                        aria-checked={publishAction === 'schedule'}
                        onPointerMove={updateGlassPointer}
                        onPointerLeave={clearGlassPointer}
                      >
                        <span>{scheduling ? t('studio.scheduling') : successPulse && lastAction === 'scheduled' ? t('studio.scheduled') : t('studio.schedule')}</span>
                      </button>
                      <button
                        type="button"
                        className={`workspace-page-publish-option is-draft ${publishAction === 'draft' ? 'is-selected' : ''}`}
                        autoFocus={publishAction === 'draft'}
                        onClick={() => choosePublishAction('draft')}
                        role="menuitemradio"
                        aria-checked={publishAction === 'draft'}
                        onPointerMove={updateGlassPointer}
                        onPointerLeave={clearGlassPointer}
                      >
                        <span>{t('studio.draftMenuOption')}</span>
                      </button>
                    </div>
                  )}
                </div>

              </div>

              <div className={`workspace-page-action-row workspace-page-draft-footer${publishFooterStatus?.kind === 'warning' && publishFooterStatus.message === t('schedule.massWarningTitle') ? ' has-mass-warning' : ''}`}>
                <div className={`workspace-page-schedule-summary ${publishAction === 'draft' ? 'has-draft-color-picker' : ''}`}>
                  <div
                    className={`workspace-page-publish-footer-content${publishFooterStatus ? ' is-feedback-hidden' : ''}`}
                    aria-hidden={Boolean(publishFooterStatus)}
                  >
                    {publishAction === 'schedule'
                      ? publishScheduleSummary
                      : publishAction === 'draft'
                        ? <DraftColorPicker color={draftColor} onChange={setDraftColor} ariaLabel={t('studio.colorNewDraft')} />
                        : ''}
                  </div>
                </div>
                {publishFooterStatus && (
                  <div
                    key={`${publishFeedbackInstance}-${publishFooterStatus.kind}-${publishFooterStatus.message}`}
                    className={`workspace-page-publish-transient-feedback is-${publishFooterStatus.kind}${publishFooterStatus.transient ? ' is-notice' : ''}${publishFooterStatus.kind === 'warning' && publishFooterStatus.message === t('schedule.massWarningTitle') ? ' is-mass-warning' : ''}${publishFooterStatus.detail ? ' has-detail' : ''}${retriggeredPublishFeedback?.message === publishFooterStatus.message && retriggeredPublishFeedback.kind === publishFooterStatus.kind ? ' is-retriggered' : ''}${connectionRecoveryStatus === 'reconnecting' && publishFooterStatus.message === t('telegramStatus.networkMessage') ? ' is-connection-recovering' : ''}${connectionRecoveryStatus === 'offline' && publishFooterStatus.message === t('telegramStatus.offlineMessage') ? ' is-connection-offline' : ''}`}
                    style={publishFooterStatus.duration === null
                      ? undefined
                      : { '--status-duration': `${publishFooterStatus.duration}ms` } as React.CSSProperties}
                    role={publishFooterStatus.kind === 'error' ? 'alert' : 'status'}
                    aria-live={publishFooterStatus.kind === 'error' ? 'assertive' : 'polite'}
                  >
                    <span
                      className="workspace-page-publish-transient-feedback-status"
                      title={[publishFooterStatus.message, publishFooterStatus.detail].filter(Boolean).join(' ')}
                      aria-label={[publishFooterStatus.message, publishFooterStatus.detail].filter(Boolean).join(' ')}
                    >
                      {connectionRecoveryStatus === 'reconnecting' && publishFooterStatus.message === t('telegramStatus.networkMessage') && (
                        <span className="workspace-page-connection-spinner" aria-hidden="true" />
                      )}
                      {publishFooterStatus.message}
                    </span>
                    {publishFooterStatus.detail && (
                      <span className="workspace-page-publish-transient-feedback-detail">{publishFooterStatus.detail}</span>
                    )}
                    {sendError && (
                      <button type="button" className="workspace-page-send-retry" onClick={() => void sendDraftNow()} disabled={sendInFlight}>
                        {t('studio.retry')}
                      </button>
                    )}
                    {previewHistoryError && previewHistoryErrorRetryable && publishFooterStatus.message === previewHistoryError && (
                      <button type="button" className="workspace-page-send-retry" onClick={() => setPreviewHistoryRetry((retry) => retry + 1)} disabled={previewHistoryLoading}>
                        {t('studio.retry')}
                      </button>
                    )}
                    {draftStoreError && publishFooterStatus.message === draftStoreError && draftStoreBackups.map((index) => (
                      <button key={index} type="button" className="workspace-page-send-retry" onClick={() => void restoreDraftBackup(index)}>
                        {t('studio.restoreBackup', { number: index })}
                      </button>
                    ))}
                    {draftStoreError && publishFooterStatus.message === draftStoreError && (
                      <button type="button" className="workspace-page-send-retry" onClick={() => window.location.reload()}>
                        {t('studio.retry')}
                      </button>
                    )}
                  </div>
                )}
              </div>

            </div>
          </section>

          <section
            className="workspace-page-panel workspace-page-preview-panel"
            data-collapsed={previewCollapsed ? 'true' : 'false'}
            data-visible={previewLayout.visible === false ? 'false' : 'true'}
          >
            <MemoizedChatPreviewStand
              chats={chats}
              selectedChat={selectedChat}
              previewHistory={previewHistory}
              previewHistoryLoading={previewHistoryLoading}
              previewFeedRef={previewFeedRef}
              draftText={deferredPreviewText}
              draftEntities={deferredPreviewEntities}
              inlineButtons={inlineButtons}
              attachments={attachments}
              previewTime={previewTime}
              collapsed={previewCollapsed}
              chatListOpen={chatListOpen}
              onToggleChatList={toggleChatList}
              onSelectChat={selectPreviewChat}
              onWallpaperChange={setChatWallpaper}
            />
          </section>
        </main>
      </div>

      <ChatRemoveModal
        show={removeModal.show}
        chatName={removeModal.chat?.name || ''}
        onConfirm={confirmRemoveChat}
        onCancel={() => setRemoveModal({ show: false, chat: null })}
      />
      {versionHistoryOpen && (
        <DocumentHistoryDialog
          accentChannels={getEditorAppearanceCssTokens(editorAppearance, publishAction)['--editor-outline']}
          histories={documentHistories}
          selectedDocumentId={selectedHistoryDocumentId}
          selectedVersionId={selectedVersionId}
          restoring={isRestoringVersion}
          restoreError={versionRestoreError}
          onClose={() => setVersionHistoryOpen(false)}
          onSelectDocument={(documentId) => {
            const versions = documentHistories[documentId] ?? [];
            setSelectedHistoryDocumentId(documentId);
            setSelectedVersionId(versions[versions.length - 1]?.id ?? null);
            setVersionRestoreError('');
          }}
          onSelect={(versionId) => {
            setSelectedVersionId(versionId);
            setVersionRestoreError('');
          }}
          onRestore={(version) => { void restoreWorkspaceVersion(version); }}
          onOpenCopy={(version) => { void restoreWorkspaceVersion(version, true); }}
        />
      )}
    </div>
  );
}
