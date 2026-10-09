import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { createPortal } from 'react-dom';
import { ChatAvatar } from '../components/ChatAvatar';
import { ChatRemoveModal } from '../components/ChatRemoveModal';
import { ChatPreviewStand, type ChatWallpaper } from '../components/ChatPreviewStand';
import { DraftColorPicker } from '../components/DraftColorPicker';
import { RichTextEditor } from '../components/RichTextEditor';
import { WorkspaceTextStage } from '../components/WorkspaceTextStage';
import { NOTIFICATION_DURATION_MS } from '../hooks/useNotifications';
import { useStudioDrafts } from '../hooks/useStudioDrafts';
import { createTemplate, deleteTemplate, insertTextAtSelection, updateTemplate } from '../lib/templates';
import { createSavedDraft, deleteSavedDraft, updateSavedDraft } from '../lib/drafts';
import { inferAttachmentMimeType, normalizeAttachments } from '../lib/draftAttachments';
import {
  DEFAULT_DRAFT_BODY,
  DEFAULT_DRAFT_NAME,
  getDraftStorageApi,
  hasDraftContent,
  readInitialWorkspaceDraft,
  readWorkspaceDraftStoreFallback,
} from '../lib/draftStore';
import type { WorkspaceDraft } from '../lib/draftStore';
import { normalizeRichTextEntities } from '../lib/richText';
import { sliceRichText } from '../lib/richText';
import { getMessageMaxLength } from '../lib/messageLimits';
import { appendPreviewMessage } from '../lib/preview';
import { toInlineKeyboardMarkup } from '../lib/inlineKeyboard';
import { useLocale } from '@/lib/i18n';
import type { InlineButtonRow } from '../lib/inlineKeyboard';
import { loadTemplates, saveTemplates } from '../lib/storage';
import { formatScheduleSummary, isFutureSchedule, MAX_SCHEDULE_OCCURRENCES, type ScheduleRepeatOptions } from '../lib/scheduling';
import type {
  Chat,
  DraftAttachment,
  DraftColor,
  PreviewChatHistory,
  RichTextEntity,
  ScheduledMessage,
  SavedDraft,
  Template,
} from '../types';
import './WorkspacePage.css';

export { normalizeAttachments } from '../lib/draftAttachments';
export { hasDraftContent, readWorkspaceDraftStoreFallback, writeWorkspaceDraftStoreFallback } from '../lib/draftStore';

type WorkspacePageProps = {
  connected: boolean;
  chats: Chat[];
  selectedChat: Chat | null;
  setSelectedChat: React.Dispatch<React.SetStateAction<Chat | null>>;
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
  notification: import('@/types').NotificationState;
  closeNotification: () => void;
  setDate: React.Dispatch<React.SetStateAction<string>>;
  setTime: React.Dispatch<React.SetStateAction<string>>;
  handleSchedule: (payload?: {
    chatId: string;
    message: string;
    date: string;
    time: string;
    attachments?: string[];
    entities?: RichTextEntity[];
    replyMarkup?: ReturnType<typeof toInlineKeyboardMarkup>;
    replaceMessage?: ScheduledMessage;
  }, repeat?: ScheduleRepeatOptions) => void;
  handleCancelMessage: (message: ScheduledMessage) => void;
  handleCancelMessages?: (messages: ScheduledMessage[]) => Promise<boolean>;
  handleSendDraftNow: (chat: Chat, text: string, attachments?: string[], entities?: RichTextEntity[], replyMarkup?: ReturnType<typeof toInlineKeyboardMarkup>) => Promise<boolean>;
  publishingDraft: boolean;
  onRegisterHistoryDraftOpener?: (opener: ((draft: SavedDraft) => void) | null) => void;
  onRegisterHistoryDraftUseHandler?: (handler: ((draft: SavedDraft) => void) | null) => void;
  onRegisterHistoryDraftClearHandler?: (handler: (() => Promise<boolean>) | null) => void;
  onRegisterHistoryDraftDeleteHandler?: (handler: ((draftId: string) => Promise<boolean>) | null) => void;
  onRegisterHistoryRescheduleHandler?: (handler: ((message: ScheduledMessage) => void) | null) => void;
};

type PublishAction = 'send' | 'schedule' | 'draft';
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

function getPreviewHistoryErrorPresentation(error: unknown) {
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
      message: "You don't have access to this chat. Check your Telegram permissions or choose another chat.",
      retryable: false,
    };
  }

  return {
    message: "The chat preview couldn't load history. Check your connection and try again.",
    retryable: true,
  };
}

function useTimedStatus(
  message: string,
  clearMessage: React.Dispatch<React.SetStateAction<string>>,
  duration: number,
) {
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => clearMessage(''), duration);
    return () => window.clearTimeout(timer);
  }, [clearMessage, duration, message]);
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

  return attachments.map((attachment) => {
    const position = attachment.position < prefixLength
      ? attachment.position
      : attachment.position >= previousEditEnd
        ? attachment.position + lengthDelta
        : nextEditEnd;
    return position === attachment.position ? attachment : { ...attachment, position: Math.max(0, position) };
  });
}

const PREVIEW_LAYOUT_KEY = 'xmsgi-preview-layout';
const LEGACY_PREVIEW_LAYOUT_KEY = 'awaitmsg-preview-layout';
const CHAT_WALLPAPER_STORAGE_KEY = 'xmsgi-chat-preview-wallpaper';
const LEGACY_CHAT_WALLPAPER_STORAGE_KEY = 'awaitmsg-chat-preview-wallpaper';
const DEFAULT_TEMPLATE_SEEDED_KEY = 'xmsgi-default-template-seeded-v1';
const MAX_ATTACHMENTS = 10;
const MAX_ATTACHMENT_SIZE = 50 * 1024 * 1024;
const MAX_ATTACHMENTS_TOTAL_SIZE = 200 * 1024 * 1024;

type PreviewLayout = {
  collapsed?: boolean;
  visible?: boolean;
};

const DEFAULT_PREVIEW_LAYOUT: PreviewLayout = { visible: true };

function loadTemplatesWithDefault(): Template[] {
  const templates = loadTemplates();

  try {
    if (window.localStorage.getItem(DEFAULT_TEMPLATE_SEEDED_KEY) === '1') return templates;

    if (!templates.some((template) => template.name === DEFAULT_DRAFT_NAME && template.body === DEFAULT_DRAFT_BODY)) {
      const defaultTemplate = createTemplate({ name: DEFAULT_DRAFT_NAME, body: DEFAULT_DRAFT_BODY });
      templates.push(defaultTemplate);
      saveTemplates(templates);
    }

    window.localStorage.setItem(DEFAULT_TEMPLATE_SEEDED_KEY, '1');
  } catch {
    // Keep the editor available if defaults cannot be written to storage.
  }

  return templates;
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
  chats,
  selectedChat,
  setSelectedChat,
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
  notification,
  closeNotification,
  setDate,
  setTime,
  handleSchedule,
  handleSendDraftNow,
  publishingDraft,
  onRegisterHistoryDraftOpener,
  onRegisterHistoryDraftUseHandler,
  onRegisterHistoryDraftClearHandler,
  onRegisterHistoryDraftDeleteHandler,
  onRegisterHistoryRescheduleHandler,
}: WorkspacePageProps) {
  const { locale, t } = useLocale();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const attachmentPreviewUrlsRef = useRef(new Set<string>());
  const bodyInputRef = useRef<HTMLDivElement | null>(null);
  const focusRescheduledEditorAtEndRef = useRef(false);
  const historyDraftOpenerRef = useRef<(draft: SavedDraft) => void>(() => undefined);
  const historyDraftUseRef = useRef<(draft: SavedDraft) => void>(() => undefined);
  const historyDraftClearerRef = useRef<() => Promise<boolean>>(async () => false);
  const historyDraftDeleterRef = useRef<(draftId: string) => Promise<boolean>>(async () => false);
  const historyRescheduleHandlerRef = useRef<(message: ScheduledMessage) => void>(() => undefined);
  const previewFeedRef = useRef<HTMLDivElement | null>(null);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const initialPreviewLayoutRef = useRef<PreviewLayout | null>(null);
  const initialDraftRef = useRef<Partial<WorkspaceDraft> | null>(null);

  if (initialPreviewLayoutRef.current === null) {
    initialPreviewLayoutRef.current = readPreviewLayout();
  }

  if (initialDraftRef.current === null) {
    initialDraftRef.current = readInitialWorkspaceDraft();
  }

  const [draftBody, setDraftBody] = useState(() => initialDraftRef.current?.body ?? '');
  const [draftEntities, setDraftEntities] = useState<RichTextEntity[]>(
    () => initialDraftRef.current?.entities ?? [],
  );
  const [attachments, setAttachments] = useState<WorkspaceAttachment[]>(
    () => normalizeAttachments(initialDraftRef.current?.attachments),
  );
  const attachmentUsageRef = useRef({
    count: attachments.length,
    size: attachments.reduce((total, attachment) => total + (attachment.size ?? 0), 0),
  });
  const pendingAttachmentUsageRef = useRef(new Map<number, { count: number; size: number }>());
  const attachmentSelectionGenerationRef = useRef(0);
  const replaceAttachments = (nextAttachments: WorkspaceAttachment[]) => {
    attachmentUsageRef.current = {
      count: nextAttachments.length,
      size: nextAttachments.reduce((total, attachment) => total + (attachment.size ?? 0), 0),
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
  const [templates, setTemplates] = useState<Template[]>(loadTemplatesWithDefault);
  const [stageMode, setStageMode] = useState<'editor' | 'schedule' | 'template' | 'draft' | 'chat' | 'buttons'>(() => {
    return isLivePreviewSurface() ? 'schedule' : 'editor';
  });
  const [scheduleFocus, setScheduleFocus] = useState<'repeat' | 'time' | null>(() => {
    return isLivePreviewSurface() ? 'time' : null;
  });
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
  const [chatLookupError, setChatLookupError] = useState('');
  const [, setChatWallpaper] = useState<ChatWallpaper>(() => readChatWallpaper());
  const [chatListOpen, setChatListOpen] = useState(false);
  const [publishMenuOpen, setPublishMenuOpen] = useState(false);
  const [sendInFlight, setSendInFlight] = useState(false);
  const [sendError, setSendError] = useState('');
  const [publishFeedback, setPublishFeedback] = useState('');
  const [publishFeedbackKind, setPublishFeedbackKind] = useState<'warning' | 'success'>('warning');
  const [publishFeedbackInstance, setPublishFeedbackInstance] = useState(0);
  const publishFeedbackTimerRef = useRef<number | null>(null);
  const sendInFlightRef = useRef(false);
  const [publishAction, setPublishAction] = useState<PublishAction>('send');
  const [rescheduleSource, setRescheduleSource] = useState<ScheduledMessage | null>(null);
  const rescheduleSourceRef = useRef<ScheduledMessage | null>(null);
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

  const applyWorkspaceDraft = (workspaceDraft: Partial<WorkspaceDraft> | null) => {
    if (rescheduleSourceRef.current) return;
    attachmentSelectionGenerationRef.current += 1;
    if (workspaceDraft) {
      setDraftBody(workspaceDraft.body ?? '');
      setDraftEntities(normalizeRichTextEntities(workspaceDraft.entities, workspaceDraft.body?.length ?? 0));
      replaceAttachments(normalizeAttachments(workspaceDraft.attachments));
      setInlineButtons(workspaceDraft.inlineButtons ?? []);
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
    workspace: {
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
    setDate,
    setTime,
    rescheduleSourceRef,
    onWorkspaceDraftLoaded: applyWorkspaceDraft,
  });
  const {
    savedDrafts,
    savedDraftsRef,
    replaceSavedDrafts,
    draftStoreReady,
    draftStoreSaving,
    draftStoreError,
    setDraftStoreError,
    draftStoreBackups,
    savedAt,
    setSavedAt,
    persistDraftStore,
    cancelPendingAutosave,
    createWorkspaceDraftSnapshot,
    handleRestoreDraftBackup: restoreDraftBackup,
    handleExportDrafts: exportDrafts,
    handleImportDrafts: importDrafts,
  } = draftLifecycle;

  useLayoutEffect(() => {
    if (stageMode !== 'editor' || !focusRescheduledEditorAtEndRef.current) return;

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
  useTimedStatus(draftStoreError, setDraftStoreError, FOOTER_STATUS_DURATION_MS.draftStoreError);
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
    if (!notification.visible) return;

    if (publishFeedbackTimerRef.current !== null) {
      window.clearTimeout(publishFeedbackTimerRef.current);
      publishFeedbackTimerRef.current = null;
      setPublishFeedback('');
    }
    setPublishFeedbackInstance((instance) => instance + 1);

    const timer = window.setTimeout(closeNotification, NOTIFICATION_DURATION_MS[notification.type]);
    return () => window.clearTimeout(timer);
  }, [closeNotification, notification.message, notification.type, notification.visible]);

  const showPublishFeedback = (message: string, kind: 'warning' | 'success' = 'warning') => {
    if (publishFeedbackTimerRef.current !== null) {
      window.clearTimeout(publishFeedbackTimerRef.current);
    }
    setPublishFeedbackInstance((instance) => instance + 1);
    setPublishFeedback(message);
    setPublishFeedbackKind(kind);
    publishFeedbackTimerRef.current = window.setTimeout(() => {
      setPublishFeedback('');
      publishFeedbackTimerRef.current = null;
    }, kind === 'warning' ? FOOTER_STATUS_DURATION_MS.publishWarning : FOOTER_STATUS_DURATION_MS.publishSuccess);
  };

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
        setStageMode('editor');
        setStageTab('editor');
        setTemplateEditingId(null);
        setTemplateDraftName('');
        setTemplateDraftBody('');
        setDraftEditingId(null);
        setDraftName('');
        setDraftBodyText('');
        setDraftBodyEntities([]);
        (document.activeElement as HTMLElement | null)?.blur();
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
    if (successPulse) {
      attachmentSelectionGenerationRef.current += 1;
      attachmentPreviewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      attachmentPreviewUrlsRef.current.clear();
      setDraftBody('');
      setDraftEntities([]);
      replaceAttachments([]);
      setInlineButtons([]);
    }
  }, [successPulse]);

  useEffect(() => {
    saveTemplates(templates);
  }, [templates]);

  useEffect(() => {
    let cancelled = false;

    if (!connected || !selectedChat) {
      setPreviewHistory(null);
      setPreviewHistoryLoading(false);
      setPreviewHistoryError('');
      setPreviewHistoryErrorRetryable(false);
      return () => {
        cancelled = true;
      };
    }

    const telegramApi = typeof window !== 'undefined' ? (window as typeof window & { telegram?: { getChatHistory?: (payload: { chatId: string; limit: number }) => Promise<{ success: boolean; history?: unknown[] | null; error?: string }> } }).telegram : undefined;

    if (!telegramApi || typeof telegramApi.getChatHistory !== 'function') {
      setPreviewHistory(null);
      setPreviewHistoryLoading(false);
      setPreviewHistoryError('');
      setPreviewHistoryErrorRetryable(false);
      return () => {
        cancelled = true;
      };
    }

    setPreviewHistory(null);
    setPreviewHistoryLoading(true);
    setPreviewHistoryError('');
    setPreviewHistoryErrorRetryable(false);
    telegramApi
      .getChatHistory({ chatId: selectedChat.id, limit: 25 })
      .then((result) => {
        if (cancelled) return;

        if (result.success) {
          setPreviewHistory(result.history ?? null);
          setPreviewHistoryError('');
          setPreviewHistoryErrorRetryable(false);
        } else {
          const errorPresentation = getPreviewHistoryErrorPresentation(result.error);
          setPreviewHistory(null);
          setPreviewHistoryError(errorPresentation.message);
          setPreviewHistoryErrorRetryable(errorPresentation.retryable);
        }
        setPreviewHistoryLoading(false);
      })
      .catch((error) => {
        if (cancelled) return;

        const errorPresentation = getPreviewHistoryErrorPresentation(error);
        setPreviewHistory(null);
        setPreviewHistoryError(errorPresentation.message);
        setPreviewHistoryErrorRetryable(errorPresentation.retryable);
        setPreviewHistoryLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [connected, selectedChat, previewHistoryRetry]);

  const previewText = stageMode === 'template' && templateEditingId
    ? templateDraftBody
    : stageMode === 'draft' && draftEditingId
      ? draftBodyText
      : draftBody;

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
    previewText,
    draftEntities.length,
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
  const hasFutureSchedule = isFutureSchedule(date, time);
  const hasValidRepeatConfig = repeatMode === 'none'
    || ((repeatMode === 'weekly' || repeatMode === 'biweekly') ? repeatDays.length > 0 : true)
    && repeatOccurrences > 0
    && repeatOccurrences <= MAX_SCHEDULE_OCCURRENCES;
  const canSendNow = hasSelectedTarget && hasDraftContentState && !attachmentError && !publishingDraft && !sendInFlight && !scheduling;
  const canSaveDraft = hasDraftContentState && !publishingDraft;
  const canSchedule = hasSelectedTarget && hasDraftContentState && !scheduling && hasValidScheduleDate && hasValidScheduleTime && hasValidRepeatConfig && hasFutureSchedule;

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
  } else if (attachmentError) {
    publishActionBlocker = t('studio.fixAttachment');
  }
  const publishScheduleSummary = formatScheduleSummary(date, time, {
    mode: repeatMode,
    days: repeatDays,
    occurrences: repeatOccurrences,
  }, locale);
  const localizeChatName = (name: string) => name === 'Saved Messages' ? t('studio.savedMessagesType') : name;
  const currentModeSummary = rescheduleSource
    ? t('studio.replaceScheduled', { chat: localizeChatName(rescheduleSource.chatName) })
    : publishAction === 'schedule'
      ? (date && time ? publishScheduleSummary : t('studio.chooseDateTime'))
      : publishAction === 'draft'
        ? t('studio.draftModeSummary', { time: savedAt || t('studio.notSaved') })
        : selectedChat
          ? t('studio.sendToChatSummary', { chat: localizeChatName(selectedChat.name) })
          : t('studio.sendChooseChatSummary');
  const publishFooterStatus = sendError
    ? { message: sendError, kind: 'error', transient: false, dismissible: false, duration: FOOTER_STATUS_DURATION_MS.sendError }
    : sendInFlight || publishingDraft
      ? { message: t('studio.sentProgress'), kind: 'progress', transient: false, dismissible: false, duration: null }
      : publishFeedback
        ? {
          message: publishFeedback,
          kind: publishFeedbackKind,
          transient: true,
          dismissible: false,
          duration: publishFeedbackKind === 'warning' ? FOOTER_STATUS_DURATION_MS.publishWarning : FOOTER_STATUS_DURATION_MS.publishSuccess,
        }
        : draftStoreError
          ? { message: draftStoreError, kind: 'error', transient: false, dismissible: false, duration: FOOTER_STATUS_DURATION_MS.draftStoreError }
          : attachmentError
            ? { message: attachmentError, kind: 'error', transient: true, dismissible: false, duration: FOOTER_STATUS_DURATION_MS.attachmentError }
            : textFileError
              ? { message: textFileError, kind: 'error', transient: false, dismissible: false, duration: FOOTER_STATUS_DURATION_MS.textFileError }
              : chatLookupError
                ? { message: chatLookupError, kind: 'error', transient: false, dismissible: false, duration: FOOTER_STATUS_DURATION_MS.chatLookupError }
                : previewHistoryError
                  ? { message: previewHistoryError, kind: 'error', transient: false, dismissible: false, duration: FOOTER_STATUS_DURATION_MS.previewHistoryError }
                  : notification.visible
                    ? {
                      message: notification.message,
                      kind: notification.type === 'info' ? 'notice' : notification.type,
                      transient: notification.type === 'info' || notification.type === 'success',
                      dismissible: true,
                      duration: NOTIFICATION_DURATION_MS[notification.type],
                    }
                    : null;

  const sendDraftNow = async () => {
    if (!selectedChat || !canSendNow || sendInFlightRef.current) return;

    if (publishFeedbackTimerRef.current !== null) {
      window.clearTimeout(publishFeedbackTimerRef.current);
      publishFeedbackTimerRef.current = null;
    }
    setPublishFeedback('');
    const chat = selectedChat;
    const text = draftBody;
    const replyMarkup = toInlineKeyboardMarkup(inlineButtons);
    sendInFlightRef.current = true;
    setSendInFlight(true);
    setSendError('');
    setPublishMenuOpen(false);
    try {
      const sent = await handleSendDraftNow(
        chat,
        text,
        attachments.map((attachment) => attachment.path || attachment.previewUrl || attachment.name).filter(Boolean),
        draftEntities,
        replyMarkup,
      );
      if (!sent) {
        setSendError(t('studio.sendFailed'));
        return;
      }

      setSendError('');
      setDraftBody('');
      setDraftEntities([]);
      showPublishFeedback(t('studio.messageSent'), 'success');

      setPreviewHistory((current) => {
        if (!current || current.chat.id !== chat.id) return current;

        return appendPreviewMessage(current, chat.id, text, replyMarkup);
      });
    } catch {
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
      entities: draftEntities,
      replyMarkup: toInlineKeyboardMarkup(inlineButtons),
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
      name: `Draft ${nextDraft.savedAt}`,
      color: draftColor,
      ...nextDraft,
    });
    const nextSavedDrafts = [...savedDraftsRef.current, savedDraft];
    if (!await persistDraftStore(nextSavedDrafts, nextDraft, () => {
      replaceSavedDrafts(nextSavedDrafts);
      setSavedAt(nextDraft.savedAt);
    })) return;
    showPublishFeedback(t('studio.draftSavedNotice'), 'success');
    setScheduleSelectionConfirmed(false);
    setPublishAction('draft');
    setPublishMenuOpen(false);
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
      ...current,
      createTemplate(input),
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

  const handleDeleteTemplate = (template: Template) => {
    if (!window.confirm(t('studio.confirmDeleteTemplate', { name: template.name }))) return;

    setTemplates((current) => deleteTemplate(current, template.id));
    showPublishFeedback(t('studio.templateDeleted'), 'success');
  };

  const openTemplateEditor = (template?: Template) => {
    setStageMode('template');
    setTemplateEditingId(template?.id ?? 'new');
    setTemplateDraftName(template?.name ?? '');
    setTemplateDraftBody(template?.body ?? '');
  };

  const closeTemplateEditor = () => {
    setTemplateEditingId(null);
    setTemplateDraftName('');
    setTemplateDraftBody('');
  };

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

  const useDraftInComposer = (draft: SavedDraft) => {
    const draftChat = draft.selectedChat && chats.find((chat) => chat.id === draft.selectedChat?.id);
    if (draftChat) setSelectedChat(draftChat);
    setDraftBody(draft.body);
    setDraftEntities(draft.entities ?? []);
    replaceAttachments(normalizeAttachments(draft.attachments));
    setInlineButtons(draft.inlineButtons ?? []);
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
  };

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
    setRepeatMode('none');
    setRepeatDays([]);
    setRepeatOccurrences(1);
    // Keep the original scheduled post intact until the user explicitly saves a replacement.
    // Canceling it here would remove the record before the reschedule flow is confirmed.
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

  const closeDraftEditor = () => {
    draftEditingSourceRef.current = null;
    setDraftEditingId(null);
    setDraftEditorColor('gray');
    setDraftName('');
    setDraftBodyText('');
    setDraftBodyEntities([]);
  };

  const handleDeleteDraft = async (draft: SavedDraft) => {
    if (!window.confirm(t('studio.confirmDeleteDraft', { name: draft.name }))) return;

    const nextSavedDrafts = deleteSavedDraft(savedDraftsRef.current, draft.id);
    const deleted = await persistDraftStore(nextSavedDrafts, createWorkspaceDraftSnapshot(), () => {
      replaceSavedDrafts(nextSavedDrafts);
    });
    if (deleted) showPublishFeedback(t('studio.draftDeleted'), 'success');
  };

  historyDraftClearerRef.current = async () => {
    cancelPendingAutosave();
    const nextSavedDrafts: SavedDraft[] = [];
    return persistDraftStore(nextSavedDrafts, createWorkspaceDraftSnapshot(), () => {
      replaceSavedDrafts(nextSavedDrafts);
      showPublishFeedback(t('studio.draftsDeleted'), 'success');
    });
  };

  historyDraftDeleterRef.current = async (draftId) => {
    const currentSavedDrafts = savedDraftsRef.current;
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
    showPublishFeedback(t('studio.draftDeleted'), 'success');
    return true;
  };

  const saveDraftStage = async () => {
    if (!draftName.trim() || !draftBodyText.trim()) return;

    const existingDraft = draftEditingSourceRef.current;
    const input = {
      name: draftName,
      body: draftBodyText,
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
      nextSavedDrafts = [...savedDraftsRef.current, createSavedDraft(input)];
    } else if (draftEditingId) {
      nextSavedDrafts = savedDraftsRef.current.map((draft) => (
        draft.id === draftEditingId ? updateSavedDraft(draft, input) : draft
      ));
    } else {
      return;
    }

    if (!await persistDraftStore(nextSavedDrafts, createWorkspaceDraftSnapshot(), () => {
      replaceSavedDrafts(nextSavedDrafts);
    })) return;
    closeDraftEditor();
  };

  const useSavedDraft = (draft: SavedDraft) => {
    attachmentSelectionGenerationRef.current += 1;
    setDraftBody(draft.body);
    setDraftEntities(draft.entities ?? []);
    replaceAttachments(normalizeAttachments(draft.attachments));
    setInlineButtons(draft.inlineButtons ?? []);
    if (draft.selectedChat) setSelectedChat(draft.selectedChat);
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

  const completeChatSelection = () => {
    const availableChats = workspaceSelectedChats.filter((chat) => chats.some((item) => item.id === chat.id));
    setWorkspaceSelectedChats(availableChats);
    setSelectedChat(availableChats[0] ?? null);
    workspaceChatOriginRef.current = null;
    setStageMode('editor');
  };

  const changeStageMode = (nextMode: 'editor' | 'schedule' | 'template' | 'draft' | 'chat' | 'buttons') => {
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
  };

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

  const handleAddFiles = async (files: File[], position = draftBody.length) => {
    if (!files.length) return;

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
          };
        }

        const result = await draftStorage.copyAttachment(file);
        return result.success && result.attachment
          ? {
              id: createAttachmentId(), type, name: file.name, mimeType,
              path: result.attachment.path, size: result.attachment.size, position: safePosition,
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
    if (storedAttachments.length) setAttachments((current) => [...current, ...storedAttachments]);

    const errors = [nextError, ...copyErrors.map((item) => item.error)].filter(Boolean);
    if (errors.length) setAttachmentError(errors.join(' '));
  };

  const handleFileSelection = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const files = Array.from(input.files ?? []);
    await handleAddFiles(files);
    input.value = '';
  };

  const handleRemoveAttachment = (attachmentId: string) => {
    const previewUrl = attachments.find((attachment) => attachment.id === attachmentId)?.previewUrl;
    if (previewUrl && attachmentPreviewUrlsRef.current.delete(previewUrl)) {
      URL.revokeObjectURL(previewUrl);
    }
    replaceAttachments(attachments.filter((attachment) => attachment.id !== attachmentId));
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
      if (draftBody.length > 0 && result.text !== draftBody && !window.confirm(t('studio.confirmReplaceText'))) return;

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

                  <div className="workspace-page-mode-summary" aria-live="polite">
                    <span className="workspace-page-mode-summary-label">{t('studio.currentAction')}</span>
                    <strong>{currentModeSummary}</strong>
                  </div>
                </div>

                <div className={`workspace-page-editor-shell${publishAction === 'schedule' ? ' is-scheduled' : publishAction === 'draft' ? ' is-draft' : ''}`}>
              <div className="workspace-page-editor-canvas">
                <div className="workspace-page-form-row">
                  <label className="workspace-page-field-label" aria-label={t('studio.channelSelector')} />
                  <div className="workspace-page-channel-picker">
                    <button type="button" className="workspace-page-chat-trigger" onClick={openChatSelection} aria-label={t('studio.chooseChat')} title={t('studio.chooseChatOrChannel')}>
                      {selectedChat ? (
                        <>
                          <ChatAvatar name={selectedChat.name} src={selectedChat.avatarDataUrl} className="workspace-page-chat-trigger-avatar" />
                          <span className="workspace-page-chat-trigger-copy">
                            <strong>{localizeChatName(selectedChat.name)}</strong>
                            <span>{selectedChat.name === 'Saved Messages' ? t('studio.savedMessagesType') : selectedChat.type || t('studio.chatType')}</span>
                          </span>
                          <ChevronDown className="workspace-page-chat-trigger-chevron" size={16} strokeWidth={1.8} aria-hidden="true" />
                        </>
                      ) : (
                        <>
                          <span>{t('studio.chooseChat')}</span>
                          <ChevronDown className="workspace-page-chat-trigger-chevron" size={16} strokeWidth={1.8} aria-hidden="true" />
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
                    maxLength={maxDraftLength}
                    stageMode={stageMode}
                    onAddFiles={(files, position) => void handleAddFiles(files, position)}
                    onChange={(nextText, nextEntities) => {
                      const limited = nextText.length > maxDraftLength
                        ? sliceRichText(nextText, nextEntities, 0, maxDraftLength)
                        : { text: nextText, entities: nextEntities };
                      setAttachments((current) => remapAttachmentPositions(current, draftBody, limited.text));
                      setDraftBody(limited.text);
                      setDraftEntities(limited.entities);
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
                        scheduling={scheduling}
                        canSchedule={canSchedule}
                        onSchedule={(entities, repeat) => {
                          if (!selectedChat) return;
                          handleSchedule({
                            chatId: selectedChat.id,
                            message: draftBody,
                            date,
                            time,
                            entities,
                            attachments: attachments.map((attachment) => attachment.path).filter(Boolean),
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
                  <div className="workspace-page-media-items">
                    {attachments
                      .slice()
                      .sort((left, right) => left.position - right.position)
                      .map((file) => (
                        <div
                          key={file.id}
                          className="workspace-page-attachment-card"
                          data-position={file.position}
                          title={`${file.name} · ${file.mimeType} · ${formatAttachmentSize(file.size)}`}
                        >
                          {isImageAttachment(file) ? (
                            <img
                              src={file.previewUrl || toFileUrl(file.path)}
                              alt=""
                              className="workspace-page-attachment-thumbnail"
                              tabIndex={0}
                              aria-label={t('studio.previewFile', { name: file.name })}
                              onMouseEnter={(event) => {
                                if (attachmentPreviewTimerRef.current !== null) {
                                  window.clearTimeout(attachmentPreviewTimerRef.current);
                                }
                                const image = event.currentTarget;
                                attachmentPreviewTimerRef.current = window.setTimeout(() => {
                                  attachmentPreviewTimerRef.current = null;
                                  showAttachmentPreview(image, file.name, file.previewUrl || toFileUrl(file.path));
                                }, 1000);
                              }}
                              onMouseLeave={() => {
                                if (attachmentPreviewTimerRef.current !== null) {
                                  window.clearTimeout(attachmentPreviewTimerRef.current);
                                  attachmentPreviewTimerRef.current = null;
                                }
                                setAttachmentPreview(null);
                              }}
                              onFocus={(event) => showAttachmentPreview(event.currentTarget, file.name, file.previewUrl || toFileUrl(file.path))}
                              onBlur={() => setAttachmentPreview(null)}
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
                      ))}
                  </div>
                </div>

              <div className="workspace-page-action-row workspace-page-schedule-row">
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
                      className={`workspace-page-mode-button workspace-page-mode-button-template ${stageMode === 'draft' ? 'is-active' : ''}`}
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
                          : (publishingDraft ? t('studio.sending') : successPulse && lastAction === 'sent' ? t('studio.sent') : t('studio.sendAction'))}
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

              <div className="workspace-page-action-row workspace-page-draft-footer">
                <div className="workspace-page-draft-meta">{savedAt ? t('studio.draftSaved', { time: savedAt }) : t('studio.draftNotSaved')}</div>
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
                    className={`workspace-page-publish-transient-feedback is-${publishFooterStatus.kind}${'transient' in publishFooterStatus && publishFooterStatus.transient ? ' is-notice' : ''}`}
                    style={publishFooterStatus.duration === null
                      ? undefined
                      : { '--status-duration': `${publishFooterStatus.duration}ms` } as React.CSSProperties}
                    role={publishFooterStatus.kind === 'error' ? 'alert' : 'status'}
                    aria-live={publishFooterStatus.kind === 'error' ? 'assertive' : 'polite'}
                  >
                    <span>{publishFooterStatus.message}</span>
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
                    {publishFooterStatus.dismissible && (
                      <button type="button" className="workspace-page-publish-status-dismiss" onClick={closeNotification} aria-label={t('studio.dismissStatus')}>
                        ×
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
            <ChatPreviewStand
              chats={chats}
              selectedChat={selectedChat}
              previewHistory={previewHistory}
              previewHistoryLoading={previewHistoryLoading}
              previewFeedRef={previewFeedRef}
              draftText={previewText}
              draftEntities={stageMode === 'template' && templateEditingId
                ? []
                : stageMode === 'draft' && draftEditingId
                  ? draftBodyEntities
                  : draftEntities}
              inlineButtons={inlineButtons}
              attachments={attachments}
              previewTime={previewTime}
              collapsed={previewCollapsed}
              chatListOpen={chatListOpen}
              onToggleChatList={() => setChatListOpen((current) => !current)}
              onSelectChat={(chat) => {
                setSelectedChat(chat);
                setChatListOpen(false);
              }}
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
    </div>
  );
}
