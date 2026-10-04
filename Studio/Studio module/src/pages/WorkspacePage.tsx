import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { createPortal } from 'react-dom';
import { ChatRemoveModal } from '@/components/ChatRemoveModal';
import { ChatPreviewStand, type ChatWallpaper } from '@/components/ChatPreviewStand';
import { DraftColorPicker } from '@/components/DraftColorPicker';
import { RichTextEditor } from '@/components/RichTextEditor';
import { WorkspaceTextStage } from '@/components/WorkspaceTextStage';
import { NOTIFICATION_DURATION_MS } from '@/hooks/useNotifications';
import { createTemplate, deleteTemplate, insertTextAtSelection, updateTemplate } from '@/lib/templates';
import { createSavedDraft, deleteSavedDraft, updateSavedDraft } from '@/lib/drafts';
import { DRAFT_STORE_SCHEMA_VERSION } from '@/lib/draftStoreVersion';
import { normalizeRichTextEntities } from '@/lib/richText';
import { sliceRichText } from '@/lib/richText';
import { getMessageMaxLength } from '@/lib/messageLimits';
import { appendPreviewMessage } from '@/lib/preview';
import { toInlineKeyboardMarkup } from '@/lib/inlineKeyboard';
import type { InlineButtonRow } from '@/lib/inlineKeyboard';
import { loadSavedDrafts, loadTemplates, saveTemplates } from '@/lib/storage';
import { formatScheduleSummary, isFutureSchedule, MAX_SCHEDULE_OCCURRENCES, type ScheduleRepeatOptions } from '@/lib/scheduling';
import type {
  Chat,
  DraftColor,
  PersistedDraftStore,
  PreviewChatHistory,
  RichTextEntity,
  SavedDraft,
  ScheduledMessage,
  Template,
} from '@/types';
import './WorkspacePage.css';

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

type WorkspaceDraft = {
  body: string;
  entities?: RichTextEntity[];
  attachments: WorkspaceAttachment[];
  selectedChat?: Chat | null;
  savedAt: string;
  inlineButtons?: InlineButtonRow[];
  date?: string;
  time?: string;
  repeatMode?: ScheduleRepeatOptions['mode'];
  repeatDays?: string[];
  repeatOccurrences?: number;
};

type WorkspaceAttachment = {
  name: string;
  path: string;
  size?: number;
  previewUrl?: string;
};

export function hasDraftContent(body: string, attachments: WorkspaceAttachment[] = []): boolean {
  return body.trim().length > 0 || attachments.some((attachment) => Boolean(attachment.path || attachment.previewUrl || attachment.name));
}

const WORKSPACE_DRAFT_KEY = 'xmsgi-workspace-draft';
const LEGACY_WORKSPACE_DRAFT_KEY = 'awaitmsg-workspace-draft';
const PREVIEW_LAYOUT_KEY = 'xmsgi-preview-layout';
const LEGACY_PREVIEW_LAYOUT_KEY = 'awaitmsg-preview-layout';
const CHAT_WALLPAPER_STORAGE_KEY = 'xmsgi-chat-preview-wallpaper';
const LEGACY_CHAT_WALLPAPER_STORAGE_KEY = 'awaitmsg-chat-preview-wallpaper';
const DRAFT_STORE_FALLBACK_KEY = 'xmsgi-draft-store-fallback';
const LEGACY_DRAFT_STORE_FALLBACK_KEY = 'awaitmsg-draft-store-fallback';
const MAX_ATTACHMENTS = 10;
const MAX_ATTACHMENT_SIZE = 50 * 1024 * 1024;
const MAX_ATTACHMENTS_TOTAL_SIZE = 200 * 1024 * 1024;

type PreviewLayout = {
  collapsed?: boolean;
  visible?: boolean;
};

const DEFAULT_PREVIEW_LAYOUT: PreviewLayout = { visible: true };

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

export function readWorkspaceDraftStoreFallback(): PersistedDraftStore | null {
  try {
    const primaryRaw = window.localStorage.getItem(DRAFT_STORE_FALLBACK_KEY);
    const raw = primaryRaw ?? window.localStorage.getItem(LEGACY_DRAFT_STORE_FALLBACK_KEY);
    if (!raw) return null;
    if (!primaryRaw) {
      window.localStorage.setItem(DRAFT_STORE_FALLBACK_KEY, raw);
    }

    const parsed = JSON.parse(raw) as Partial<PersistedDraftStore>;
    if (!parsed || typeof parsed !== 'object') return null;
    if (!Array.isArray(parsed.savedDrafts)) return null;
    const storedSchemaVersion = typeof parsed.schemaVersion === 'number' ? parsed.schemaVersion : 1;
    if (!Number.isInteger(storedSchemaVersion)
      || storedSchemaVersion < 1
      || storedSchemaVersion > DRAFT_STORE_SCHEMA_VERSION) return null;

    return {
      schemaVersion: DRAFT_STORE_SCHEMA_VERSION,
      migrationVersion: typeof parsed.migrationVersion === 'number' ? parsed.migrationVersion : 1,
      savedDrafts: parsed.savedDrafts,
      workspaceDraft: parsed.workspaceDraft ?? null,
    };
  } catch {
    return null;
  }
}

function isBrowserRuntimeFallback(): boolean {
  if (typeof window === 'undefined') return false;
  return window.location.protocol === 'http:' || window.location.protocol === 'https:';
}

export function writeWorkspaceDraftStoreFallback(store: PersistedDraftStore): void {
  try {
    const serialized = JSON.stringify(store);
    window.localStorage.setItem(DRAFT_STORE_FALLBACK_KEY, serialized);
    window.localStorage.setItem(LEGACY_DRAFT_STORE_FALLBACK_KEY, serialized);
  } catch {
    // ignore
  }
}

function getDraftStorageApi() {
  if (typeof window === 'undefined') return null;

  const storage = (window as typeof window & {
    draftStorage?: {
      load: () => Promise<{ success: boolean; store?: PersistedDraftStore; backupIndexes?: number[]; error?: string; needsMigration?: boolean; schemaMigrated?: boolean; migrated?: boolean; recovered?: boolean }>;
      migrate: (legacy: { savedDrafts: unknown[]; workspaceDraft: Record<string, unknown> | null }) => Promise<{ success: boolean; store?: PersistedDraftStore; error?: string }>;
      save: (store: PersistedDraftStore) => Promise<{ success: boolean; store?: PersistedDraftStore; backupIndexes?: number[]; error?: string }>;
      flush: (store: PersistedDraftStore) => { success: boolean; store?: PersistedDraftStore; error?: string };
      restoreBackup: (index: number) => Promise<{ success: boolean; store?: PersistedDraftStore; error?: string }>;
      exportBackup: () => Promise<{ success: boolean; cancelled?: boolean; error?: string }>;
      importBackup: () => Promise<{ success: boolean; cancelled?: boolean; store?: PersistedDraftStore; error?: string }>;
      copyAttachment: (file: File) => Promise<{ success: boolean; attachment?: { name: string; path: string; size: number }; error?: string }>;
      importText: () => Promise<{ success: boolean; cancelled?: boolean; text?: string; error?: string }>;
    };
  }).draftStorage;

  return storage && typeof storage.load === 'function' ? storage : null;
}

export function normalizeAttachments(value: unknown): WorkspaceAttachment[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((attachment) => {
    if (typeof attachment === 'string') {
      return [{ name: attachment, path: attachment }];
    }

    if (
      attachment &&
      typeof attachment === 'object' &&
      typeof attachment.name === 'string'
    ) {
      const path = typeof attachment.path === 'string' ? attachment.path : typeof attachment.previewUrl === 'string' ? attachment.previewUrl : '';
      if (!path) return [];

      return [{
        name: attachment.name,
        path,
        size: typeof attachment.size === 'number' && attachment.size >= 0 ? attachment.size : undefined,
        previewUrl: typeof attachment.previewUrl === 'string' ? attachment.previewUrl : undefined,
      }];
    }

    return [];
  });
}

function normalizeDraftChat(value: unknown): Chat | null {
  if (!value || typeof value !== 'object') return null;

  const chat = value as Partial<Chat>;
  if (typeof chat.id !== 'string' || typeof chat.name !== 'string') return null;

  return {
    id: chat.id,
    name: chat.name,
    username: typeof chat.username === 'string' ? chat.username : '',
    type: chat.type,
    avatarDataUrl: typeof chat.avatarDataUrl === 'string' ? chat.avatarDataUrl : '',
  };
}

function isImageAttachment(attachment: WorkspaceAttachment) {
  return /\.(?:avif|gif|jpe?g|png|webp)$/i.test(attachment.name);
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
  handleCancelMessage,
  handleSendDraftNow,
  publishingDraft,
  onRegisterHistoryDraftOpener,
  onRegisterHistoryDraftClearHandler,
  onRegisterHistoryDraftDeleteHandler,
  onRegisterHistoryRescheduleHandler,
}: WorkspacePageProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const attachmentPreviewUrlsRef = useRef(new Set<string>());
  const bodyInputRef = useRef<HTMLDivElement | null>(null);
  const focusRescheduledEditorAtEndRef = useRef(false);
  const historyDraftOpenerRef = useRef<(draft: SavedDraft) => void>(() => undefined);
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
    try {
      const primaryRaw = window.localStorage.getItem(WORKSPACE_DRAFT_KEY);
      const raw = primaryRaw ?? window.localStorage.getItem(LEGACY_WORKSPACE_DRAFT_KEY);
      const parsed = raw ? (JSON.parse(raw) as Partial<WorkspaceDraft>) : {};
      if (!primaryRaw && raw) {
        window.localStorage.setItem(WORKSPACE_DRAFT_KEY, raw);
      }
      initialDraftRef.current = {
        ...parsed,
        entities: normalizeRichTextEntities(parsed.entities, parsed.body?.length ?? 0),
        attachments: normalizeAttachments(parsed.attachments),
        selectedChat: normalizeDraftChat(parsed.selectedChat),
      };
    } catch {
      initialDraftRef.current = {};
    }
  }

  const [draftBody, setDraftBody] = useState(() => initialDraftRef.current?.body ?? '');
  const [draftEntities, setDraftEntities] = useState<RichTextEntity[]>(
    () => initialDraftRef.current?.entities ?? [],
  );
  const [attachments, setAttachments] = useState<WorkspaceAttachment[]>(
    () => normalizeAttachments(initialDraftRef.current?.attachments),
  );
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
  const [templates, setTemplates] = useState<Template[]>(() => loadTemplates());
  const [savedDrafts, setSavedDrafts] = useState<SavedDraft[]>(() => loadSavedDrafts());
  const savedDraftsRef = useRef(savedDrafts);
  const [draftStoreReady, setDraftStoreReady] = useState(false);
  const [draftStoreSaving, setDraftStoreSaving] = useState(false);
  const [draftStoreError, setDraftStoreError] = useState('');
  const [draftStoreBackups, setDraftStoreBackups] = useState<number[]>([]);
  const draftStoreQueueRef = useRef<Promise<void>>(Promise.resolve());
  const draftStorePendingRef = useRef(0);
  const [savedAt, setSavedAt] = useState(
    () => initialDraftRef.current?.savedAt ?? 'Not saved',
  );
  const [stageMode, setStageMode] = useState<'editor' | 'schedule' | 'template' | 'draft' | 'chat' | 'buttons'>(() => {
    return isLivePreviewSurface() ? 'schedule' : 'editor';
  });
  const [scheduleFocus, setScheduleFocus] = useState<'repeat' | 'time' | null>(() => {
    return isLivePreviewSurface() ? 'time' : null;
  });
  const [, setStageTab] = useState<'editor' | 'templates' | 'drafts' | 'buttons'>('editor');
  const [workspaceSelectedChats, setWorkspaceSelectedChats] = useState<Chat[]>([]);
  const workspaceChatOriginRef = useRef<Chat | null>(null);
  const [repeatMode, setRepeatMode] = useState<ScheduleRepeatOptions['mode']>('none');
  const [repeatDays, setRepeatDays] = useState<string[]>([]);
  const [repeatOccurrences, setRepeatOccurrences] = useState(5);
  const scheduleDraftHydratedRef = useRef(false);
  const draftAutosaveTimeoutRef = useRef<number | null>(null);
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
  const [previewHistoryRetry, setPreviewHistoryRetry] = useState(0);
  const [chatLookupError, setChatLookupError] = useState('');
  const [chatWallpaper, setChatWallpaper] = useState<ChatWallpaper>(() => readChatWallpaper());
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

  const createWorkspaceDraftSnapshot = (): WorkspaceDraft | null => hasDraftContent(draftBody, attachments) ? {
    body: draftBody,
    entities: draftEntities,
    attachments: attachments
      .filter((attachment) => attachment.path)
      .map(({ previewUrl: _previewUrl, ...attachment }) => attachment),
    selectedChat,
    inlineButtons,
    date,
    time,
    repeatMode,
    repeatDays,
    repeatOccurrences,
    savedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  } : null;

  const persistDraftStore = (
    getSavedDrafts: SavedDraft[] | (() => SavedDraft[]),
    workspaceDraft: WorkspaceDraft | null,
    onPersisted?: () => void,
  ) => {
    draftStorePendingRef.current += 1;
    setDraftStoreSaving(true);
    const operation = draftStoreQueueRef.current.then(async () => {
      const data: PersistedDraftStore = {
        schemaVersion: DRAFT_STORE_SCHEMA_VERSION,
        migrationVersion: 1,
        savedDrafts: typeof getSavedDrafts === 'function' ? getSavedDrafts() : getSavedDrafts,
        workspaceDraft,
      };

      const draftStorage = getDraftStorageApi();
      if (!draftStorage) {
        writeWorkspaceDraftStoreFallback(data);
        setDraftStoreError('');
        setDraftStoreBackups([]);
        onPersisted?.();
        return true;
      }

      try {
        const result = await draftStorage.save(data);
        if (!result.success) {
          setDraftStoreError(result.error || 'Drafts could not be saved.');
          setDraftStoreBackups(result.backupIndexes ?? []);
          return false;
        }
        setDraftStoreError('');
        setDraftStoreBackups([]);
        onPersisted?.();
        return true;
      } catch (error) {
        setDraftStoreError(error instanceof Error ? error.message : 'Drafts could not be saved.');
        return false;
      } finally {
        draftStorePendingRef.current -= 1;
        setDraftStoreSaving(draftStorePendingRef.current > 0);
      }
    });
    draftStoreQueueRef.current = operation.then(() => undefined, () => undefined);
    return operation;
  };

  const applyPersistedDraftStore = (store: PersistedDraftStore) => {
    setSavedDrafts(store.savedDrafts);
    savedDraftsRef.current = store.savedDrafts;
    const workspaceDraft = store.workspaceDraft as Partial<WorkspaceDraft> | null;
    initialDraftRef.current = workspaceDraft ?? {};
    if (!rescheduleSourceRef.current) {
      if (workspaceDraft) {
        setDraftBody(workspaceDraft.body ?? '');
        setDraftEntities(normalizeRichTextEntities(workspaceDraft.entities, workspaceDraft.body?.length ?? 0));
        setAttachments(normalizeAttachments(workspaceDraft.attachments));
        setInlineButtons(workspaceDraft.inlineButtons ?? []);
        setSavedAt(workspaceDraft.savedAt || 'Not saved');
        if (workspaceDraft.date) setDate(workspaceDraft.date);
        if (workspaceDraft.time) setTime(workspaceDraft.time);
        if (workspaceDraft.repeatMode) setRepeatMode(workspaceDraft.repeatMode);
        setRepeatDays(workspaceDraft.repeatDays ?? []);
        if (workspaceDraft.repeatOccurrences) setRepeatOccurrences(workspaceDraft.repeatOccurrences);
      } else {
        setDraftBody('');
        setDraftEntities([]);
        setAttachments([]);
        setInlineButtons([]);
      }
    }
    setDraftStoreBackups([]);
    setDraftStoreError('');
    setDraftStoreReady(true);
  };

  useEffect(() => {
    savedDraftsRef.current = savedDrafts;
  }, [savedDrafts]);

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
    let cancelled = false;

    const initializeDraftStore = async () => {
      const draftStorage = getDraftStorageApi();

      if (!draftStorage) {
        const fallbackStore = readWorkspaceDraftStoreFallback();
        if (fallbackStore) {
          applyPersistedDraftStore(fallbackStore);
          return;
        }

        if (isBrowserRuntimeFallback()) {
          const emptyStore: PersistedDraftStore = {
            schemaVersion: DRAFT_STORE_SCHEMA_VERSION,
            migrationVersion: 1,
            savedDrafts: [],
            workspaceDraft: null,
          };
          writeWorkspaceDraftStoreFallback(emptyStore);
          applyPersistedDraftStore(emptyStore);
          return;
        }

        setDraftStoreError('Saved drafts are unavailable in this runtime.');
        return;
      }

      try {
        let result = await draftStorage.load();
        if (!result.success) {
          const backups = result.backupIndexes ?? [];
          setDraftStoreBackups(backups);
          if (!backups.length || !window.confirm('Saved drafts are damaged. Restore the newest valid backup?')) {
            setDraftStoreError(result.error || 'Saved drafts could not be loaded.');
            return;
          }

          const restored = await draftStorage.restoreBackup(backups[0]);
          if (!restored.success) throw new Error(restored.error || 'The backup could not be restored.');
          result = await draftStorage.load();
        }
        if (!result.success || !result.store) throw new Error(result.error || 'Saved drafts could not be loaded.');

        let store = result.store;
        if (result.needsMigration || store.migrationVersion < 1) {
          const migrated = await draftStorage.migrate({
            savedDrafts: loadSavedDrafts(),
            workspaceDraft: initialDraftRef.current as Record<string, unknown> | null,
          });
          if (!migrated.success || !migrated.store) {
            throw new Error(migrated.error || 'Existing drafts could not be migrated. The original data was kept.');
          }
          store = migrated.store;
        }

        if (cancelled) return;
        window.localStorage.removeItem('xmsgi_saved_drafts');
        window.localStorage.removeItem(WORKSPACE_DRAFT_KEY);
        writeWorkspaceDraftStoreFallback(store);
        applyPersistedDraftStore(store);
      } catch (error) {
        if (!cancelled) setDraftStoreError(error instanceof Error ? error.message : 'Saved drafts could not be loaded.');
      }
    };

    void initializeDraftStore();
    return () => { cancelled = true; };
  }, [setDate, setTime]);

  useEffect(() => {
    if (!draftStoreReady || scheduleDraftHydratedRef.current) return;
    const savedDraft = initialDraftRef.current;
    if (!rescheduleSourceRef.current && savedDraft?.selectedChat && chats.some((chat) => chat.id === savedDraft.selectedChat?.id)) {
      setSelectedChat(savedDraft.selectedChat);
    }
    scheduleDraftHydratedRef.current = true;
  }, [chats, draftStoreReady, setSelectedChat]);

  useEffect(() => {
    if (!draftStoreReady || !scheduleDraftHydratedRef.current) return;
    if (draftAutosaveTimeoutRef.current) window.clearTimeout(draftAutosaveTimeoutRef.current);

    draftAutosaveTimeoutRef.current = window.setTimeout(() => {
      const workspaceDraft = createWorkspaceDraftSnapshot();
      if (workspaceDraft) setSavedAt(workspaceDraft.savedAt);
      void persistDraftStore(() => savedDraftsRef.current, workspaceDraft);
    }, 350);

    return () => {
      if (draftAutosaveTimeoutRef.current) {
        window.clearTimeout(draftAutosaveTimeoutRef.current);
        draftAutosaveTimeoutRef.current = null;
      }
    };
  }, [attachments, date, draftBody, draftEntities, draftStoreReady, inlineButtons, repeatDays, repeatMode, repeatOccurrences, selectedChat, time]);

  useEffect(() => {
    if (!draftStoreReady || !scheduleDraftHydratedRef.current) return;
    const flushDraftOnClose = (event: BeforeUnloadEvent) => {
      const draftStorage = getDraftStorageApi();
      if (!draftStorage) {
        writeWorkspaceDraftStoreFallback({
          schemaVersion: DRAFT_STORE_SCHEMA_VERSION,
          migrationVersion: 1,
          savedDrafts: savedDraftsRef.current,
          workspaceDraft: createWorkspaceDraftSnapshot(),
        });
        return;
      }

      try {
        const result = draftStorage.flush({
          schemaVersion: DRAFT_STORE_SCHEMA_VERSION,
          migrationVersion: 1,
          savedDrafts: savedDraftsRef.current,
          workspaceDraft: createWorkspaceDraftSnapshot(),
        });
        if (result.success) return;
        event.preventDefault();
        event.returnValue = 'Draft data could not be saved. Keep this page open and retry.';
        setDraftStoreError(result.error || 'The latest draft could not be saved. Keep this window open and retry.');
      } catch (error) {
        event.preventDefault();
        event.returnValue = 'Draft data could not be saved. Keep this page open and retry.';
        setDraftStoreError(error instanceof Error ? error.message : 'The latest draft could not be saved. Keep this window open and retry.');
      }
    };
    window.addEventListener('beforeunload', flushDraftOnClose);
    return () => window.removeEventListener('beforeunload', flushDraftOnClose);
  }, [attachments, date, draftBody, draftEntities, draftStoreReady, inlineButtons, repeatDays, repeatMode, repeatOccurrences, selectedChat, time]);

  useEffect(() => {
    if (successPulse) {
      attachmentPreviewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      attachmentPreviewUrlsRef.current.clear();
      setDraftBody('');
      setDraftEntities([]);
      setAttachments([]);
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
      return () => {
        cancelled = true;
      };
    }

    const telegramApi = typeof window !== 'undefined' ? (window as typeof window & { telegram?: { getChatHistory?: (payload: { chatId: string; limit: number }) => Promise<{ success: boolean; history?: unknown[] | null; error?: string }> } }).telegram : undefined;

    if (!telegramApi || typeof telegramApi.getChatHistory !== 'function') {
      setPreviewHistory(null);
      setPreviewHistoryLoading(false);
      setPreviewHistoryError('');
      return () => {
        cancelled = true;
      };
    }

    setPreviewHistory(null);
    setPreviewHistoryLoading(true);
    setPreviewHistoryError('');
    telegramApi
      .getChatHistory({ chatId: selectedChat.id, limit: 25 })
      .then((result) => {
        if (cancelled) return;

        setPreviewHistory(result.success ? result.history ?? null : null);
        setPreviewHistoryError(result.success ? '' : result.error || 'Telegram history could not be loaded.');
        setPreviewHistoryLoading(false);
      })
      .catch((error) => {
        if (cancelled) return;

        setPreviewHistory(null);
        setPreviewHistoryError(error instanceof Error ? error.message : 'Telegram history could not be loaded.');
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
  const scheduleSummary = (() => {
    if (!date || !time) return 'Schedule';

    const dateValue = new Date(date);
    if (Number.isNaN(dateValue.getTime())) return 'Schedule';

    const summaryDate = new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
    }).format(dateValue);

    const summaryTime = new Date(`2000-01-01T${time}`).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });

    return `${summaryDate} · ${summaryTime}`;
  })();

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
      publishActionBlocker = 'Введите текст сообщения';
    } else if (!draftStoreReady) {
      publishActionBlocker = draftStoreError || 'Подождите загрузки хранилища черновиков';
    }
  } else if (publishAction === 'schedule') {
    if (!hasDraftContentState) {
      publishActionBlocker = 'Введите текст сообщения';
    } else if (!hasSelectedTarget) {
      publishActionBlocker = 'Выберите чат';
    } else if (!hasValidScheduleDate) {
      publishActionBlocker = 'Укажите корректную дату';
    } else if (!hasValidScheduleTime) {
      publishActionBlocker = 'Укажите корректное время';
    } else if (!hasValidRepeatConfig) {
      publishActionBlocker = 'Проверьте параметры повтора';
    } else if (!hasFutureSchedule) {
      publishActionBlocker = 'Укажите дату и время в будущем';
    }
  } else if (!hasDraftContentState) {
    publishActionBlocker = 'Введите текст сообщения';
  } else if (!hasSelectedTarget) {
    publishActionBlocker = 'Выберите чат';
  } else if (attachmentError) {
    publishActionBlocker = 'Исправьте ошибку во вложении';
  }
  const publishScheduleSummary = formatScheduleSummary(date, time, {
    mode: repeatMode,
    days: repeatDays,
    occurrences: repeatOccurrences,
  });
  const currentModeSummary = rescheduleSource
    ? `Replace scheduled post • ${rescheduleSource.chatName}`
    : publishAction === 'schedule'
      ? (date && time ? publishScheduleSummary : 'Choose date and time')
      : publishAction === 'draft'
        ? `Draft • ${savedAt}`
        : selectedChat
          ? `Send now • ${selectedChat.name}`
          : 'Send now • Choose a chat';
  const publishFooterStatus = sendError
    ? { message: sendError, kind: 'error', transient: false, dismissible: false, duration: FOOTER_STATUS_DURATION_MS.sendError }
    : sendInFlight || publishingDraft
      ? { message: 'Отправка…', kind: 'progress', transient: false, dismissible: false, duration: null }
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
        setSendError('Не удалось отправить сообщение.');
        return;
      }

      setSendError('');
      setDraftBody('');
      setDraftEntities([]);
      showPublishFeedback('Сообщение отправлено', 'success');

      setPreviewHistory((current) => {
        if (!current || current.chat.id !== chat.id) return current;

        return appendPreviewMessage(current, chat.id, text, replyMarkup);
      });
    } catch {
      setSendError('Не удалось отправить сообщение.');
    } finally {
      sendInFlightRef.current = false;
      setSendInFlight(false);
    }
  };

  const openScheduleStage = (focus: 'repeat' | 'time' | null = null) => {
    const isSameFocusOpen = stageMode === 'schedule' && scheduleFocus === focus;

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
      savedDraftsRef.current = nextSavedDrafts;
      setSavedDrafts(nextSavedDrafts);
      setSavedAt(nextDraft.savedAt);
    })) return;
    showPublishFeedback('Черновик сохранён', 'success');
    setPublishAction('draft');
    setPublishMenuOpen(false);
  };

  const choosePublishAction = (action: PublishAction) => {
    setPublishAction(action);
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
        showPublishFeedback('Введите текст сообщения');
        return;
      }
      if (!hasSelectedTarget) {
        showPublishFeedback('Выберите чат');
        return;
      }
      if (!canSchedule) {
        if (stageMode !== 'schedule') {
          openScheduleStage();
        }
        if (hasDraftContentState && hasSelectedTarget && hasValidScheduleDate && hasValidScheduleTime && hasValidRepeatConfig && !hasFutureSchedule) {
          showPublishFeedback('Укажите дату и время в будущем');
        }
        return;
      }
      if (stageMode === 'schedule') {
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
    if (!window.confirm(`Delete template "${template.name}"?`)) return;

    setTemplates((current) => deleteTemplate(current, template.id));
    showPublishFeedback('Шаблон удалён', 'success');
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

  const rescheduleMessage = (message: ScheduledMessage) => {
    const chat = chats.find((item) => item.id === message.chatId);
    const scheduledAt = new Date(message.when);
    if (!chat || Number.isNaN(scheduledAt.getTime())) return;

    const nextDate = `${scheduledAt.getFullYear()}-${String(scheduledAt.getMonth() + 1).padStart(2, '0')}-${String(scheduledAt.getDate()).padStart(2, '0')}`;
    const nextTime = `${String(scheduledAt.getHours()).padStart(2, '0')}:${String(scheduledAt.getMinutes()).padStart(2, '0')}`;
    setSelectedChat(chat);
    rescheduleSourceRef.current = message;
    setRescheduleSource(message);
    focusRescheduledEditorAtEndRef.current = true;
    setPublishAction('schedule');
    setDraftBody(message.text);
    setDraftEntities(message.entities ?? []);
    setAttachments((message.attachments ?? []).map((path) => ({
      name: path.split(/[\\/]/).pop() || path,
      path,
    })));
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
    if (!window.confirm(`Delete draft "${draft.name}"?`)) return;

    const nextSavedDrafts = deleteSavedDraft(savedDraftsRef.current, draft.id);
    const deleted = await persistDraftStore(nextSavedDrafts, createWorkspaceDraftSnapshot(), () => {
      savedDraftsRef.current = nextSavedDrafts;
      setSavedDrafts(nextSavedDrafts);
    });
    if (deleted) showPublishFeedback('Черновик удалён', 'success');
  };

  historyDraftClearerRef.current = async () => {
    if (draftAutosaveTimeoutRef.current) {
      window.clearTimeout(draftAutosaveTimeoutRef.current);
      draftAutosaveTimeoutRef.current = null;
    }
    const nextSavedDrafts: SavedDraft[] = [];
    return persistDraftStore(nextSavedDrafts, createWorkspaceDraftSnapshot(), () => {
      savedDraftsRef.current = nextSavedDrafts;
      setSavedDrafts(nextSavedDrafts);
      showPublishFeedback('Черновики удалены', 'success');
    });
  };

  historyDraftDeleterRef.current = async (draftId) => {
    const currentSavedDrafts = savedDraftsRef.current;
    const nextSavedDrafts = deleteSavedDraft(currentSavedDrafts, draftId);
    if (nextSavedDrafts.length === currentSavedDrafts.length) return false;

    const deleted = await persistDraftStore(nextSavedDrafts, createWorkspaceDraftSnapshot(), () => {
      savedDraftsRef.current = nextSavedDrafts;
      setSavedDrafts(nextSavedDrafts);
    });
    if (!deleted) return false;

    if (draftEditingId === draftId) {
      setDraftEditingId(null);
      setDraftEditorColor('gray');
      setDraftName('');
      setDraftBodyText('');
      setDraftBodyEntities([]);
    }
    showPublishFeedback('Черновик удалён', 'success');
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
      savedDraftsRef.current = nextSavedDrafts;
      setSavedDrafts(nextSavedDrafts);
    })) return;
    closeDraftEditor();
  };

  const useSavedDraft = (draft: SavedDraft) => {
    setDraftBody(draft.body);
    setDraftEntities(draft.entities ?? []);
    setAttachments(normalizeAttachments(draft.attachments));
    setInlineButtons(draft.inlineButtons ?? []);
    if (draft.selectedChat) setSelectedChat(draft.selectedChat);
    if (draft.date) setDate(draft.date);
    if (draft.time) setTime(draft.time);
    setRepeatMode(draft.repeatMode ?? 'none');
    setRepeatDays(draft.repeatDays ?? []);
    setRepeatOccurrences(draft.repeatOccurrences ?? 1);
    changeStageMode('editor');
  };

  const handleRestoreDraftBackup = async (index: number) => {
    const draftStorage = getDraftStorageApi();
    if (!draftStorage) {
      const fallback = readWorkspaceDraftStoreFallback();
      if (!fallback) {
        setDraftStoreError('No saved draft backup is available for this runtime.');
        return;
      }
      applyPersistedDraftStore(fallback);
      return;
    }

    const result = await draftStorage.restoreBackup(index);
    if (!result.success || !result.store) {
      setDraftStoreError(result.error || 'The selected backup could not be restored.');
      return;
    }
    applyPersistedDraftStore(result.store);
  };

  const handleExportDrafts = async () => {
    if (draftAutosaveTimeoutRef.current) {
      window.clearTimeout(draftAutosaveTimeoutRef.current);
      draftAutosaveTimeoutRef.current = null;
    }
    const workspaceDraft = createWorkspaceDraftSnapshot();
    if (workspaceDraft) setSavedAt(workspaceDraft.savedAt);
    if (!await persistDraftStore(() => savedDraftsRef.current, workspaceDraft)) return;

    const draftStorage = getDraftStorageApi();
    if (!draftStorage) {
      writeWorkspaceDraftStoreFallback({
        schemaVersion: DRAFT_STORE_SCHEMA_VERSION,
        migrationVersion: 1,
        savedDrafts: savedDraftsRef.current,
        workspaceDraft,
      });
      showPublishFeedback('Резервная копия сохранена локально', 'success');
      return;
    }

    const result = await draftStorage.exportBackup();
    if (!result.success && !result.cancelled) setDraftStoreError(result.error || 'Draft backup could not be exported.');
    else if (result.success) {
      setDraftStoreError('');
      showPublishFeedback('Резервная копия экспортирована', 'success');
    }
  };

  const handleImportDrafts = async () => {
    const draftStorage = getDraftStorageApi();
    if (!draftStorage) {
      const fallback = readWorkspaceDraftStoreFallback();
      if (fallback) {
        applyPersistedDraftStore(fallback);
        showPublishFeedback('Черновики восстановлены из локального хранилища', 'success');
      }
      return;
    }

    const result = await draftStorage.importBackup();
    if (!result.success) {
      if (!result.cancelled) setDraftStoreError(result.error || 'Draft backup could not be imported.');
      return;
    }
    if (result.store) {
      applyPersistedDraftStore(result.store);
      showPublishFeedback('Черновики импортированы', 'success');
    }
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
      showPublishFeedback('Шаблон создан', 'success');
    } else if (templateEditingId) {
      handleUpdateTemplate(templateEditingId, {
        name: templateDraftName,
        body: templateDraftBody,
      });
      showPublishFeedback('Шаблон обновлён', 'success');
    }

    closeTemplateEditor();
  };

  const handleAddFiles = async (files: File[]) => {
    if (!files.length) return;

    setAttachmentError('');

    const currentSize = attachments.reduce((total, attachment) => total + (attachment.size ?? 0), 0);
    const acceptedFiles: File[] = [];
    let nextSize = currentSize;
    let nextError = '';

    for (const file of files) {
      if (attachments.length + acceptedFiles.length >= MAX_ATTACHMENTS) {
        nextError = `Можно добавить не больше ${MAX_ATTACHMENTS} файлов.`;
        break;
      }

      if (file.size > MAX_ATTACHMENT_SIZE) {
        nextError = `${file.name}: размер файла не должен превышать 50 МБ.`;
        continue;
      }

      if (nextSize + file.size > MAX_ATTACHMENTS_TOTAL_SIZE) {
        nextError = 'Общий размер вложений не должен превышать 200 МБ.';
        break;
      }

      acceptedFiles.push(file);
      nextSize += file.size;
    }

    const copiedAttachments = await Promise.all(acceptedFiles.map(async (file) => {
      try {
        const draftStorage = getDraftStorageApi();
        if (!draftStorage) {
          const dataUrl = await readFileAsDataUrl(file);
          return { name: file.name, path: dataUrl, size: file.size, previewUrl: dataUrl };
        }

        const result = await draftStorage.copyAttachment(file);
        return result.success && result.attachment
          ? result.attachment
          : { error: result.error || `${file.name} could not be stored.` };
      } catch (error) {
        return { error: error instanceof Error ? error.message : `${file.name} could not be stored.` };
      }
    }));
    const storedAttachments = copiedAttachments.filter((item): item is { name: string; path: string; size: number } => 'path' in item);
    const copyErrors = copiedAttachments.filter((item): item is { error: string } => 'error' in item);
    if (storedAttachments.length) setAttachments((current) => [...current, ...storedAttachments]);

    setAttachmentError([nextError, ...copyErrors.map((item) => item.error)].filter(Boolean).join(' '));
  };

  const handleFileSelection = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const files = Array.from(input.files ?? []);
    await handleAddFiles(files);
    input.value = '';
  };

  const handleRemoveAttachment = (index: number) => {
    const previewUrl = attachments[index]?.previewUrl;
    if (previewUrl && attachmentPreviewUrlsRef.current.delete(previewUrl)) {
      URL.revokeObjectURL(previewUrl);
    }
    setAttachments((current) => current.filter((_, attachmentIndex) => attachmentIndex !== index));
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
          setTextFileError('Text import is unavailable in this runtime.');
          return;
        }
        setDraftBody(body);
        setDraftEntities([]);
        setTextFileError('');
        changeStageMode('editor');
        showPublishFeedback('Текст импортирован в редактор', 'success');
        return;
      }

      const result = await draftStorage.importText();
      if (!result.success) {
        if (!result.cancelled) setTextFileError(result.error || 'Text file could not be imported.');
        return;
      }
      if (typeof result.text !== 'string') {
        setTextFileError('The selected text file is empty or invalid.');
        return;
      }
      if (result.text.length > maxDraftLength) {
        setTextFileError(`Text exceeds the current ${maxDraftLength}-character message limit.`);
        return;
      }
      if (draftBody.length > 0 && result.text !== draftBody && !window.confirm('Replace the current editor text with the imported text?')) return;

      setDraftBody(result.text);
      setDraftEntities([]);
      setTextFileError('');
      changeStageMode('editor');
      showPublishFeedback('Текст импортирован в редактор', 'success');
    } catch (error) {
      setTextFileError(error instanceof Error ? error.message : 'Text file could not be imported.');
    }
  };

  return (
    <div
      ref={workspaceRef}
      aria-label="Workspace page"
      className="workspace-page"
    >
      {attachmentPreview && createPortal(
        <div
          className="workspace-page-attachment-preview"
          style={{ left: attachmentPreview.left, top: attachmentPreview.top, width: attachmentPreview.width, height: attachmentPreview.height }}
          role="tooltip"
          aria-label={`Preview of ${attachmentPreview.name}`}
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
                    <span className="workspace-page-editor-title-text">Create Post</span>
                  </div>

                  <div className="workspace-page-mode-summary" aria-live="polite">
                    <span className="workspace-page-mode-summary-label">Current action</span>
                    <strong>{currentModeSummary}</strong>
                  </div>
                </div>

                <div className="workspace-page-editor-shell">
              <div className="workspace-page-editor-canvas">
                <div className="workspace-page-form-row">
                  <label className="workspace-page-field-label" aria-label="Channel selector" />
                  <div className="workspace-page-channel-picker">
                    <button type="button" className="workspace-page-chat-trigger" onClick={openChatSelection} aria-label="Choose chat" title="Choose a chat or channel">
                      {selectedChat ? (
                        <>
                          <span className="workspace-page-chat-trigger-avatar" aria-hidden="true">
                            {selectedChat.avatarDataUrl ? <img src={selectedChat.avatarDataUrl} alt="" /> : selectedChat.name.slice(0, 1).toUpperCase()}
                          </span>
                          <span className="workspace-page-chat-trigger-copy">
                            <strong>{selectedChat.name}</strong>
                            <span>{selectedChat.name === 'Saved Messages' ? 'Saved Messages' : selectedChat.type || 'Chat'}</span>
                          </span>
                          <ChevronDown className="workspace-page-chat-trigger-chevron" size={16} strokeWidth={1.8} aria-hidden="true" />
                        </>
                      ) : (
                        <>
                          <span>Choose chat</span>
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
                    onPasteImages={(files) => void handleAddFiles(files)}
                    onChange={(nextText, nextEntities) => {
                      const limited = nextText.length > maxDraftLength
                        ? sliceRichText(nextText, nextEntities, 0, maxDraftLength)
                        : { text: nextText, entities: nextEntities };
                      setDraftBody(limited.text);
                      setDraftEntities(limited.entities);
                    }}
                    stageContent={(
                      <WorkspaceTextStage
                        mode={stageMode}
                        scheduleFocus={scheduleFocus}
                        onModeChange={changeStageMode}
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
                        onExportDrafts={handleExportDrafts}
                        onImportDrafts={handleImportDrafts}
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
                aria-label="Attached files"
                aria-hidden={attachments.length === 0}
              >
                <div className="workspace-page-media-items">
                  {attachments.map((file, index) => (
                    <div key={`${file.name}-${index}`} className="workspace-page-attachment-card">
                      {isImageAttachment(file) && (file.path || file.previewUrl) ? (
                        <img
                          src={file.previewUrl || toFileUrl(file.path)}
                          alt=""
                          className="workspace-page-attachment-thumbnail"
                          tabIndex={0}
                          aria-label={`Preview ${file.name}`}
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
                        <div className="workspace-page-attachment-file-mark">FILE</div>
                      )}
                      <span className="workspace-page-attachment-name">{file.name}</span>
                      <button
                        type="button"
                        className="workspace-page-attachment-remove"
                        onClick={() => handleRemoveAttachment(index)}
                        aria-label={`Remove ${file.name}`}
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
                    aria-label="Add file"
                    title="Add attachment"
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
                    aria-label={previewLayout.visible === false ? 'Show preview' : 'Hide preview'}
                    title={previewLayout.visible === false ? 'Show preview' : 'Hide preview'}
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
                        <path d="M1.8 12s3.4 5.8 10.2 5.8S22.2 12 22.2 12" fill="none" stroke="rgba(5, 11, 17, 0.86)" strokeWidth="4.2" strokeLinecap="round" />
                        <path d="M1.8 12s3.4 5.8 10.2 5.8S22.2 12 22.2 12" fill="none" stroke="url(#workspace-preview-metal)" strokeWidth="3.1" strokeLinecap="round" />
                        <path d="M6.2 18.8 5.3 20.1M12 19.1v1.5M17.8 18.8l.9 1.3" fill="none" stroke="url(#workspace-preview-metal)" strokeWidth="1.75" strokeLinecap="round" />
                        <g className="workspace-page-preview-eyelashes" fill="none" strokeLinecap="round">
                          <path d="M4.8 15.8 3.3 17.8M19.2 15.8 20.7 17.8" stroke="#c2d8e5" strokeWidth="1.75" />
                        </g>
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
                        <path d="M1.8 12s3.4-5.8 10.2-5.8S22.2 12 22.2 12s-3.4 5.8-10.2 5.8S1.8 12 1.8 12Z" fill="none" stroke="rgba(5, 11, 17, 0.86)" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M1.8 12s3.4-5.8 10.2-5.8S22.2 12 22.2 12s-3.4 5.8-10.2 5.8S1.8 12 1.8 12Z" fill="none" stroke="url(#workspace-preview-metal)" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M2.8 10.4c2-2 5-3.6 9.2-3.6s7.2 1.6 9.2 3.6" fill="none" stroke="rgba(250, 253, 255, 0.5)" strokeWidth="0.65" strokeLinecap="round" />
                        <circle cx="12" cy="12" r="3.2" fill="#18252e" stroke="url(#workspace-preview-metal)" strokeWidth="1.1" />
                        <circle cx="10.9" cy="10.9" r="0.75" fill="#f5fbff" opacity="0.8" />
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
                    title="Open and manage reusable message templates"
                  >
                    Templates
                  </button>
                  {(publishAction === 'draft' || stageMode === 'draft') && (
                    <button
                      type="button"
                      className="workspace-page-mode-button workspace-page-mode-button-template"
                      onClick={() => stageMode === 'draft' ? changeStageMode('editor') : changeStageMode('draft')}
                      aria-pressed={publishAction === 'draft'}
                      title="Open saved drafts"
                    >
                      Draft
                    </button>
                  )}
                  {(publishAction === 'schedule' || stageMode === 'schedule') && (
                    <div className="workspace-page-schedule-compact-group" aria-label="Schedule tools">
                      <button
                        type="button"
                        className={`workspace-page-mode-button workspace-page-schedule-compact-button ${stageMode === 'schedule' && scheduleFocus === 'time' ? 'is-active' : ''}`}
                        onClick={() => openScheduleStage('time')}
                        aria-pressed={stageMode === 'schedule' && scheduleFocus === 'time'}
                        title="Set the schedule date and time"
                      >
                        Time
                      </button>
                      <button
                        type="button"
                        className={`workspace-page-mode-button workspace-page-schedule-compact-button ${stageMode === 'schedule' && scheduleFocus === 'repeat' ? 'is-active' : ''}`}
                        onClick={() => openScheduleStage('repeat')}
                        aria-pressed={stageMode === 'schedule' && scheduleFocus === 'repeat'}
                        title="Configure a repeating schedule"
                      >
                        Repeat
                      </button>
                    </div>
                  )}
                </div>

                <div className="workspace-page-submit-actions" ref={publishMenuRef}>
                  <button
                    type="button"
                    className={`workspace-page-action-button workspace-page-publish-trigger workspace-page-publish-main ${successPulse && lastAction === 'sent' ? 'is-active' : ''}`}
                    onClick={handlePrimaryPublish}
                    onPointerMove={updateIconRimPointer}
                    onPointerLeave={clearIconRimPointer}
                    disabled={sendInFlight || publishingDraft || scheduling || (publishAction === 'draft' && draftStoreSaving)}
                  >
                    <span className="workspace-page-publish-trigger-main">
                      {publishAction === 'schedule'
                        ? (scheduling ? 'Scheduling…' : successPulse && lastAction === 'scheduled' ? 'Scheduled' : 'Schedule')
                        : publishAction === 'draft'
                          ? 'Save draft'
                          : (publishingDraft ? 'Sending…' : successPulse && lastAction === 'sent' ? 'Sent' : 'Send now')}
                    </span>
                  </button>
                  <button
                    type="button"
                    className={`workspace-page-publish-trigger workspace-page-publish-menu-toggle ${publishMenuOpen ? 'is-active' : ''}`}
                    ref={publishMenuToggleRef}
                    onClick={() => setPublishMenuOpen((current) => !current)}
                    aria-label="More publish options"
                    title="Choose Send now, Schedule, or Save draft"
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
                    <div className="workspace-page-publish-menu workspace-page-publish-menu-compact" role="menu" aria-label="Publish action">
                      <button
                        type="button"
                        className={`workspace-page-publish-option ${publishAction === 'send' ? 'is-selected' : ''}`}
                        autoFocus={publishAction === 'send'}
                        onClick={() => choosePublishAction('send')}
                        role="menuitemradio"
                        aria-checked={publishAction === 'send'}
                        onPointerMove={updateGlassPointer}
                        onPointerLeave={clearGlassPointer}
                      >
                        <span>Send now</span>
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
                        <span>{scheduling ? 'Scheduling…' : successPulse && lastAction === 'scheduled' ? 'Scheduled' : 'Schedule'}</span>
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
                        <span>Save draft</span>
                      </button>
                    </div>
                  )}
                </div>

              </div>

              <div className="workspace-page-action-row workspace-page-draft-footer">
                <div className="workspace-page-draft-meta">Draft saved: {savedAt}</div>
                <div className={`workspace-page-schedule-summary ${publishAction === 'draft' ? 'has-draft-color-picker' : ''}`}>
                  <div
                    className={`workspace-page-publish-footer-content${publishFooterStatus ? ' is-feedback-hidden' : ''}`}
                    aria-hidden={Boolean(publishFooterStatus)}
                  >
                    {publishAction === 'schedule'
                      ? publishScheduleSummary
                      : publishAction === 'draft'
                        ? <DraftColorPicker color={draftColor} onChange={setDraftColor} ariaLabel="Color for new draft" />
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
                        Retry
                      </button>
                    )}
                    {previewHistoryError && publishFooterStatus.message === previewHistoryError && (
                      <button type="button" className="workspace-page-send-retry" onClick={() => setPreviewHistoryRetry((retry) => retry + 1)} disabled={previewHistoryLoading}>
                        Retry
                      </button>
                    )}
                    {draftStoreError && publishFooterStatus.message === draftStoreError && draftStoreBackups.map((index) => (
                      <button key={index} type="button" className="workspace-page-send-retry" onClick={() => void handleRestoreDraftBackup(index)}>
                        Restore backup {index}
                      </button>
                    ))}
                    {draftStoreError && publishFooterStatus.message === draftStoreError && (
                      <button type="button" className="workspace-page-send-retry" onClick={() => window.location.reload()}>
                        Retry
                      </button>
                    )}
                    {publishFooterStatus.dismissible && (
                      <button type="button" className="workspace-page-publish-status-dismiss" onClick={closeNotification} aria-label="Dismiss status">
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
