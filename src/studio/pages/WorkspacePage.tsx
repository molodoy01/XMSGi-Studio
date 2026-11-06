import { memo, startTransition, useCallback, useDeferredValue, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { ChatAvatar } from '../components/ChatAvatar';
import { useConfirm } from '@/components/useConfirm';
import { ChatRemoveModal } from '../components/ChatRemoveModal';
import { ChatPreviewStand, type ChatWallpaper } from '../components/ChatPreviewStand';
import { DocumentHistoryDialog } from '../components/editor/DocumentHistoryDialog';
import { WorkspacePageActionRows, type PublishAction, type PublishFooterStatus } from '../components/WorkspacePageActionRows';
import {
  FOOTER_STATUS_DURATION_MS,
  getPreviewHistoryErrorPresentation,
  getPreviewHistoryMediaDataUrlChars,
  loadTemplatesWithDefault,
  savedDraftToWorkspaceSnapshot,
  useTimedStatus,
} from './WorkspacePageHelpers';
import { RichTextEditor } from '../components/RichTextEditor';
import { WorkspaceTextStage } from '../components/WorkspaceTextStage';
import { WorkspaceAttachmentTray } from '../components/WorkspaceAttachmentTray';
import { useStudioDrafts } from '../hooks/useStudioDrafts';
import { useWorkspaceAttachmentSelection } from '../hooks/useWorkspaceAttachmentSelection';
import type { WorkspacePageProps } from './workspacePageTypes';
import { ChatPickerChevron } from '../components/ChatPickerChevron';
import {
  createTemplate,
  deleteTemplate,
  insertTextAtSelection,
  mergeTemplateBackup,
  parseTemplateBackup,
  serializeTemplateBackup,
  TEMPLATE_IMPORT_MAX_BYTES,
  updateTemplate,
} from '../lib/templates';
import { createSavedDraft, deleteSavedDraft, updateSavedDraft } from '../lib/drafts';
import { isTelegramPhotoAlbumImage, normalizeAttachments } from '../lib/draftAttachments';
import { getDraftStorageApi, hasDraftContent, readInitialWorkspaceDraft } from '../lib/draftStore';
import { getLocalAttachmentPath } from '@/lib/localAttachmentPath';
import type { WorkspaceDraft } from '../lib/draftStore';
import { normalizeRichTextEntities, richTextToHtml } from '../lib/richText';
import { sliceRichText } from '../lib/richText';
import { getMessageMaxLength } from '../lib/messageLimits';
import { appendPreviewMessage } from '../lib/preview';
import { useLocale } from '@studio/lib/i18n';
import { hasChatHistoryBridge, telegramGetChatHistory } from '@/services/chatAppService';
import { saveTemplates } from '../lib/storage';
import { createWorkspaceTextTransferHandlers } from '../lib/workspaceTextTransfer';
import {
  getAttachmentTransportGroups,
  getAttachmentTransportItems,
  isImageAttachment,
  MAX_ALBUMS,
  remapAttachmentPositions,
  type WorkspaceAttachment,
} from '../lib/workspaceAttachments';
import {
  DEFAULT_PREVIEW_LAYOUT,
  isLivePreviewSurface,
  readChatWallpaper,
  readPreviewLayout,
  writePreviewLayout,
  type PreviewLayout,
} from '../lib/workspacePreferences';
import { uid } from '@shared/utils';
import {
  EDITOR_APPEARANCE_UPDATED_EVENT,
  getEditorAppearanceCssTokens,
  readEditorAppearancePreferences,
} from '@shared/editorAppearance';
import type { PersistedWorkspaceDocumentVersion } from '@shared/types';
import type { StudioPlannerTextPayload } from '@shared/bridge';
import { areWorkspaceSnapshotsEqual, hasWorkspaceDocumentContent } from '../lib/documentHistory';
import { formatScheduleSummary, isFutureSchedule, MAX_SCHEDULE_OCCURRENCES, refreshScheduleDateTime, type ScheduleRepeatOptions } from '../lib/scheduling';
import type {
  Chat,
  DraftColor,
  PreviewChatHistory,
  RichTextEntity,
  ScheduledMessage,
  SavedDraft,
  Template,
} from '../types';
import './WorkspacePage.css';

const MemoizedChatPreviewStand = memo(ChatPreviewStand);

export { normalizeAttachments } from '../lib/draftAttachments';
export { hasDraftContent, readWorkspaceDraftStoreFallback, writeWorkspaceDraftStoreFallback } from '../lib/draftStore';
export type { StudioInlineNotification } from './workspacePageTypes';

type TelegramConnectionState = 'connected' | 'connecting' | 'reconnecting' | 'disconnected';
type PendingDraftReplacement = {
  previousSnapshot: WorkspaceDraft;
};
export { remapAttachmentPositions } from '../lib/workspaceAttachments';

const PREVIEW_HISTORY_LIMIT = 50;
const PREVIEW_HISTORY_CACHE_TTL_MS = 20_000;
const PREVIEW_HISTORY_CACHE_SIZE = 2;
const PREVIEW_HISTORY_CACHE_MAX_MEDIA_DATA_URL_CHARS = 4 * 1024 * 1024;

export function WorkspacePage({
  connected,
  connectionRecoveryStatus = null,
  inlineNotification = null,
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
  const attachmentPreviewAttemptsRef = useRef(new Set<string>());
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
    standaloneCount: attachments.filter((attachment) => !attachment.albumId).length,
    size: attachments.reduce((total, attachment) => total + (attachment.size ?? 0), 0),
    albumIds: new Set(attachments.flatMap((attachment) => attachment.albumId ? [attachment.albumId] : [])),
  });
  const attachmentSelectionGenerationRef = useRef(0);
  const replaceAttachments = (nextAttachments: WorkspaceAttachment[]) => {
    attachmentUsageRef.current = {
      count: nextAttachments.length,
      standaloneCount: nextAttachments.filter((attachment) => !attachment.albumId).length,
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
  const { handleAddFiles, handleFileSelection, handleAlbumFileSelection } = useWorkspaceAttachmentSelection({
    attachments,
    setAttachments,
    attachmentUsageRef,
    attachmentSelectionGenerationRef,
    albumAttachmentPositionRef,
    albumAttachmentTargetIdRef,
    draftBody,
    setAttachmentError,
  });
  const [initialTemplateState] = useState(loadTemplatesWithDefault);
  const [templates, setTemplates] = useState<Template[]>(initialTemplateState.templates);
  const importedTemplatesRef = useRef<Template[] | null>(null);
  const [templateStorageError, setTemplateStorageError] = useState(initialTemplateState.storageError);
  const [stageMode, setStageMode] = useState<'editor' | 'schedule' | 'template' | 'draft' | 'chat'>(() => {
    return isLivePreviewSurface() ? 'schedule' : 'editor';
  });
  const [scheduleFocus, setScheduleFocus] = useState<'repeat' | 'time' | null>(() => {
    return isLivePreviewSurface() ? 'time' : null;
  });
  const [followCurrentTime, setFollowCurrentTime] = useState(true);
  const [scheduleClockNow, setScheduleClockNow] = useState(() => Date.now());
  const [previewClockNow, setPreviewClockNow] = useState(() => Date.now());
  const publishFeedbackTimerRef = useRef<number | null>(null);
  const [scheduleSelectionConfirmed, setScheduleSelectionConfirmed] = useState(false);
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
    let timeoutId = 0;
    const refreshPreviewClock = () => {
      const now = Date.now();
      setPreviewClockNow(now);
      timeoutId = window.setTimeout(refreshPreviewClock, 60_000 - (now % 60_000) + 25);
    };

    timeoutId = window.setTimeout(refreshPreviewClock, 60_000 - (Date.now() % 60_000) + 25);
    return () => window.clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    if (stageMode !== 'schedule') return undefined;

    let timeoutId = 0;
    const refreshScheduleClock = () => {
      const now = new Date();
      setScheduleClockNow(now.getTime());
      const nextSchedule = refreshScheduleDateTime(date, time, followCurrentTime, now);
      if (nextSchedule) {
        setDate((current) => current === nextSchedule.date ? current : nextSchedule.date);
        setTime((current) => current === nextSchedule.time ? current : nextSchedule.time);
      }
      timeoutId = window.setTimeout(refreshScheduleClock, 60_000 - (Date.now() % 60_000) + 25);
    };

    refreshScheduleClock();
    return () => window.clearTimeout(timeoutId);
  }, [date, followCurrentTime, setDate, setTime, stageMode, time]);
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
      const rawOffset = offset - (editorGap - viewportGap) / 2;
      const alignmentLimitPx = 12;
      const nextOffset = Number.isFinite(rawOffset)
        ? Math.max(-alignmentLimitPx, Math.min(alignmentLimitPx, rawOffset))
        : 0;
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
    if (scheduling) {
      scheduleSubmissionStartedRef.current = true;
      return;
    }
    if (stageMode !== 'schedule' && !scheduleSubmissionStartedRef.current) {
      scheduleSubmissionPendingRef.current = false;
      scheduleSubmissionStartedRef.current = false;
      return;
    }
    if (!scheduleSubmissionStartedRef.current) return;

    const scheduledSuccessfully = lastAction === 'scheduled';
    scheduleSubmissionPendingRef.current = false;
    scheduleSubmissionStartedRef.current = false;
    if (!scheduledSuccessfully) return;

    setRepeatMode('none');
    setRepeatDays([]);
    setRepeatOccurrences(1);
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

  useEffect(() => {
    const readImageDataUrl = getDraftStorageApi()?.readImageDataUrl;
    if (!readImageDataUrl) return;

    let cancelled = false;
    const missingPreviews = attachments.filter((attachment) => (
      isImageAttachment(attachment)
      && (!attachment.previewUrl || /^file:/i.test(attachment.previewUrl))
      && !attachment.unavailable
      && (attachment.path || attachment.previewUrl)
      && !/^(?:blob:|data:|https?:)/i.test(attachment.path)
    ));
    const pending = missingPreviews.filter((attachment) => {
      const key = `${attachment.id}:${attachment.path}`;
      if (attachmentPreviewAttemptsRef.current.has(key)) return false;
      attachmentPreviewAttemptsRef.current.add(key);
      return true;
    });
    if (pending.length === 0) return;

    void Promise.all(pending.map(async (attachment) => {
      try {
        const result = await readImageDataUrl(getLocalAttachmentPath(attachment.path || attachment.previewUrl || ''));
        return { attachment, result };
      } catch (error) {
        return {
          attachment,
          result: {
            success: false,
            error: error instanceof Error ? error.message : 'Image preview could not be loaded.',
          },
        };
      }
    })).then((results) => {
      if (cancelled) return;
      const loadedPreviews = new Map<string, { path: string; previewUrl?: string; dataUrl: string }>();
      results.forEach(({ attachment, result }) => {
        if (result.success && result.dataUrl) {
          loadedPreviews.set(attachment.id, {
            path: attachment.path,
            previewUrl: attachment.previewUrl,
            dataUrl: result.dataUrl,
          });
        } else {
          showPublishFeedback(t('studio.attachmentPreviewFailed', { name: attachment.name }));
        }
      });
      if (loadedPreviews.size > 0) {
        setAttachments((current) => current.map((attachment) => {
          const loaded = loadedPreviews.get(attachment.id);
          return loaded
            && loaded.path === attachment.path
            && loaded.previewUrl === attachment.previewUrl
            && (!attachment.previewUrl || /^file:/i.test(attachment.previewUrl))
            ? { ...attachment, previewUrl: loaded.dataUrl }
            : attachment;
        }));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [attachments, showPublishFeedback, t]);

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
    writePreviewLayout(previewLayout);
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
      setWorkspaceDocumentId(uid());
    })();
  }, [showPublishFeedback, successPulse, t]);

  useEffect(() => {
    if (templateStorageError) {
      showPublishFeedback(t('studio.templateStorageError'), 'warning');
      return;
    }

    if (importedTemplatesRef.current === templates) {
      importedTemplatesRef.current = null;
      return;
    }

    try {
      saveTemplates(templates);
    } catch {
      setTemplateStorageError(true);
    }
  }, [showPublishFeedback, t, templateStorageError, templates]);

  const handleExportTemplates = () => {
    try {
      const backup = serializeTemplateBackup(templates);
      const url = URL.createObjectURL(new Blob([backup], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `xmsgi-templates-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      showPublishFeedback(t('studio.templatesExported'), 'success');
    } catch (error) {
      showPublishFeedback(
        error instanceof Error && error.message.includes('5 MB')
          ? t('studio.templateBackupTooLarge')
          : t('studio.templatesExportFailed'),
        'warning',
      );
    }
  };

  const handleImportTemplates = async (file: File) => {
    if (file.size > TEMPLATE_IMPORT_MAX_BYTES) {
      showPublishFeedback(t('studio.templateBackupTooLarge'), 'warning');
      return;
    }

    try {
      const importedTemplates = parseTemplateBackup(await file.text());
      const mergedTemplates = mergeTemplateBackup(templates, importedTemplates);
      serializeTemplateBackup(mergedTemplates);
      saveTemplates(mergedTemplates);
      importedTemplatesRef.current = mergedTemplates;
      setTemplates(mergedTemplates);
      setTemplateStorageError(false);
      showPublishFeedback(t('studio.templatesImported', { count: importedTemplates.length }), 'success');
    } catch (error) {
      showPublishFeedback(
        error instanceof Error && error.message.includes('5 MB')
          ? t('studio.templateBackupTooLarge')
          : t('studio.templatesImportFailed'),
        'warning',
      );
    }
  };

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
    chatListOpen,
    previewCollapsed,
    selectedChat?.id,
  ]);

  const previewTime = new Date(previewClockNow).toLocaleTimeString([], {
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
  const publishFooterStatus: PublishFooterStatus | null = inlineNotification
    ? {
        message: inlineNotification.message,
        detail: inlineNotification.title === 'Studio' ? undefined : inlineNotification.title,
        kind: inlineNotification.type === 'error'
          ? 'error'
          : inlineNotification.type === 'warning'
            ? 'warning'
            : inlineNotification.type === 'success'
              ? 'success'
              : 'notice',
        transient: true,
        duration: inlineNotification.durationMs,
      }
    : sendError
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
            setWorkspaceDocumentId(uid());
            if (text.trim()) {
              setPreviewHistory((current) => {
                if (!current || current.chat.id !== chat.id) return current;
                const nextHistory = appendPreviewMessage(current, chat.id, text);
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

        const nextHistory = appendPreviewMessage(current, chat.id, text);
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
        restoreEditorFocusForEmptyMessageWarning();
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
      if (publishActionBlocker === t('studio.enterMessage')) {
        restoreEditorFocusForEmptyMessageWarning();
      }
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
  };

  const completeChatSelection = (chosenChat?: Chat) => {
    const selectedChats = chosenChat ? [chosenChat] : workspaceSelectedChats;
    const availableChats = selectedChats.filter((chat) => chats.some((item) => item.id === chat.id));
    setWorkspaceSelectedChats(availableChats);
    setSelectedChat(availableChats[0] ?? null);
    workspaceChatOriginRef.current = null;
    setStageMode('editor');
  };

  const changeStageMode = useCallback((nextMode: 'editor' | 'schedule' | 'template' | 'draft' | 'chat') => {
    if (nextMode !== 'schedule') setScheduleFocus(null);
    if (stageMode === 'chat' && nextMode !== 'chat') {
      setSelectedChat(workspaceChatOriginRef.current);
      workspaceChatOriginRef.current = null;
      setWorkspaceSelectedChats([]);
    }
    if (nextMode !== 'template') closeTemplateEditor();
    if (nextMode !== 'draft') closeDraftEditor();
    setStageMode(nextMode);
  }, [closeDraftEditor, closeTemplateEditor, setSelectedChat, stageMode]);

  const restoreEditorFocusForEmptyMessageWarning = useCallback(() => {
    const focusEditor = () => {
      const editor = bodyInputRef.current;
      if (!editor) return;

      editor.focus({ preventScroll: true });
      const selection = editor.ownerDocument.getSelection();
      if (!selection) return;

      const range = editor.ownerDocument.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
      editor.dataset.selectionStart = String(draftBody.length);
      editor.dataset.selectionEnd = String(draftBody.length);
    };

    if (stageMode !== 'editor') {
      changeStageMode('editor');
    }

    focusEditor();

    if (typeof window !== 'undefined') {
      window.requestAnimationFrame(focusEditor);
    } else {
      focusEditor();
    }
  }, [changeStageMode, draftBody.length, stageMode]);

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
      if (hasDraftContent(draftBody, attachments)) {
        plannerRestoreRef.current ??= {
          draft: createSavedDraft({
            name: 'Studio document before Planner',
            documentId: workspaceDocumentId,
            color: draftColor,
            body: draftBody,
            entities: draftEntities,
            attachments,
            selectedChat,
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
      date,
      time,
      repeatMode,
      repeatDays,
      repeatOccurrences,
      savedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    } satisfies WorkspaceDraft;
    let previousSnapshot: WorkspaceDraft = currentSnapshot;
    if (hasDraftContent(draftBody, attachments)) {
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
      date: previousSnapshot.date,
      time: previousSnapshot.time,
      repeatMode: previousSnapshot.repeatMode,
      repeatDays: previousSnapshot.repeatDays,
      repeatOccurrences: previousSnapshot.repeatOccurrences,
    });
    plannerRestoreRef.current = {
      draft: hasDraftContent(previousDocument.body, normalizeAttachments(previousDocument.attachments))
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
      standaloneCount: incomingAttachments.filter((attachment) => !attachment.albumId).length,
      size: incomingAttachments.reduce((total, attachment) => total + attachment.size, 0),
      albumIds: new Set(incomingAttachments.flatMap((attachment) => attachment.albumId ? [attachment.albumId] : [])),
    };
    setAttachments(incomingAttachments);
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
        ? {
          documentId: draft.documentId ?? workspaceDocumentId,
            body: draft.body,
            entities: draft.entities,
            attachments: restoredAttachments,
            selectedChat: draftChat ?? draft.selectedChat ?? null,
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

  const { handleExportEditorText, handleImportEditorText } = createWorkspaceTextTransferHandlers({
    draftBody,
    maxDraftLength,
    setDraftBody,
    setDraftEntities,
    setTextFileError,
    confirm,
    t,
    createWorkspaceDraftSnapshot,
    recordWorkspaceVersion,
    showPublishFeedback,
    changeStageMode,
  });

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
                        onExportTemplates={handleExportTemplates}
                        onImportTemplates={(file) => { void handleImportTemplates(file); }}
                      />
                    )}
                  />
                </div>

              </div>

                <WorkspaceAttachmentTray
                  attachments={attachments}
                  attachmentItemsRef={attachmentItemsRef}
                  onAddPhotosToAlbum={(albumId, position) => {
                    albumAttachmentTargetIdRef.current = albumId;
                    albumAttachmentPositionRef.current = position;
                    albumFileInputRef.current?.click();
                  }}
                  onRemoveAttachment={handleRemoveAttachment}
                  onRemoveAlbum={handleRemoveAlbum}
                  onSchedulePreview={scheduleAttachmentPreview}
                  onShowPreview={showAttachmentPreview}
                  onHidePreview={hideAttachmentPreview}
                />

              <WorkspacePageActionRows
                fileInputRef={fileInputRef}
                albumFileInputRef={albumFileInputRef}
                onFileSelection={handleFileSelection}
                onAlbumFileSelection={handleAlbumFileSelection}
                previewVisible={previewLayout.visible !== false}
                onTogglePreview={togglePreviewVisibility}
                stageMode={stageMode}
                setStageMode={setStageMode}
                changeStageMode={changeStageMode}
                closeTemplateEditor={closeTemplateEditor}
                publishAction={publishAction}
                scheduleFocus={scheduleFocus}
                openScheduleStage={openScheduleStage}
                publishMenuOpen={publishMenuOpen}
                setPublishMenuOpen={setPublishMenuOpen}
                publishMenuRef={publishMenuRef}
                publishMenuToggleRef={publishMenuToggleRef}
                onPrimaryPublish={handlePrimaryPublish}
                onChoosePublishAction={choosePublishAction}
                sendInFlight={sendInFlight}
                publishingDraft={publishingDraft}
                scheduling={scheduling}
                draftStoreSaving={draftStoreSaving}
                successPulse={successPulse}
                lastAction={lastAction}
                reconnectingForSend={reconnectingForSend}
                publishFooterStatus={publishFooterStatus}
                publishScheduleSummary={publishScheduleSummary}
                draftColor={draftColor}
                setDraftColor={setDraftColor}
                inlineNotification={inlineNotification}
                publishFeedbackInstance={publishFeedbackInstance}
                retriggeredPublishFeedback={retriggeredPublishFeedback}
                connectionRecoveryStatus={connectionRecoveryStatus}
                sendError={sendError}
                onRetrySend={() => { void sendDraftNow(); }}
                previewHistoryError={previewHistoryError}
                previewHistoryErrorRetryable={previewHistoryErrorRetryable}
                previewHistoryLoading={previewHistoryLoading}
                onRetryPreviewHistory={() => setPreviewHistoryRetry((retry) => retry + 1)}
                draftStoreError={draftStoreError}
                draftStoreBackups={draftStoreBackups}
                onRestoreDraftBackup={(index) => { void restoreDraftBackup(index); }}
              />
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
