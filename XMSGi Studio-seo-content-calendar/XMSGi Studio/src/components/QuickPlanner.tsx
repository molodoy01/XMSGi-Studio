import { type ChangeEvent, type CSSProperties, type DragEvent, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Chat, RichTextEntity, ScheduledMessage } from '@/types';
import { useLocale } from '@/lib/i18n';
import { EmojiPickerPanel } from './EmojiPickerPanel';
import {
  getVisibleEmojiOptions,
  readRecentEmojis,
  recentEmojiStorageKey,
} from '@/lib/emojiCatalog';
import {
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Eraser,
  FileText,
  Paperclip,
  Search,
  Send,
  Smile,
  Sparkles,
  RotateCcw,
  X,
} from 'lucide-react';
import {
  EDITOR_APPEARANCE_UPDATED_EVENT,
  getEditorAppearanceCssTokens,
  readEditorAppearancePreferences,
  resolveEditorAppearanceColor,
} from '@shared/editorAppearance';
import type { StudioPlannerTextPayload } from '@shared/bridge';
import { createPortal } from 'react-dom';
import { telegramGetFilePath } from '@/services/telegramAppService';
import { getDraftStorageApi } from '@studio/lib/draftStore';
import { loadFreeTelegramMessageEffects, type TelegramMessageEffect } from '@/lib/telegramMessageEffects';
import { ChatAvatar } from '../studio/components/ChatAvatar';
import { QuickPlannerNavigationContext } from '../workspace/QuickPlannerNavigationContext';
import { QuickPlannerActivity } from './QuickPlannerActivity';
import {
  flushPlannerDraftWrite,
  MAX_PLANNER_ATTACHMENTS,
  readPlannerDraft,
  readPlannerDraftAttachments,
  readPlannerDraftEntities,
  writePlannerDraft,
} from '../lib/plannerDraft';
import './QuickPlanner.css';

const actionModes = [
  { mode: 'Send now', labelKey: 'quickplanner.mode.send', icon: Send },
  { mode: 'Schedule', labelKey: 'quickplanner.mode.schedule', icon: CalendarDays },
  { mode: 'Draft', labelKey: 'quickplanner.mode.draft', icon: FileText },
] as const;

export type QuickPlannerActionFeedback = {
  message: string;
  tone: 'error' | 'warning' | 'success' | 'info';
  instance?: number;
  actions?: Array<{
    id: 'retry' | 'dismiss';
    label: string;
    onClick: () => void;
  }>;
};

type PlannerAttachment = {
  name: string;
  path: string;
};

type ChatPickerOption = {
  id: string;
  name: string;
  type: string;
  avatarDataUrl?: string;
  sourceChat?: Chat;
};

type QuickPlannerProps = {
  draftLoadRequest?: {
    revision: number;
    text: string;
    attachments: string[];
    entities: RichTextEntity[];
    restoreDraft: {
      text: string;
      attachments: string[];
      entities: RichTextEntity[];
    } | null;
  } | null;
  onRestoreDraft?: (draft: { text: string; attachments: string[]; entities: RichTextEntity[] } | null) => void;
  chats?: Chat[];
  selectedChat?: Chat | null;
  upcoming?: ScheduledMessage[];
  sent?: ScheduledMessage[];
  historyReady?: boolean;
  historyError?: boolean;
  onSelectChat?: (chat: Chat | null) => void;
  onRemoveChat?: (chat: Chat) => void;
  onOpenInStudio?: (payload: StudioPlannerTextPayload) => void;
  onSendNow?: (chat: Chat, message: string, attachments?: string[], effect?: string, entities?: RichTextEntity[]) => Promise<boolean | 'sent-history-failed'>;
  onSchedule?: (request: { chatId: string; message: string; date: string; time: string; attachments?: string[]; effect?: string; entities?: RichTextEntity[] }) => Promise<boolean | 'sent-history-failed'>;
  onSaveDraft?: (draft: { message: string; attachments: string[]; entities: RichTextEntity[]; selectedChat: Chat | null }) => boolean;
  feedbackPreview?: QuickPlannerActionFeedback | null;
  connectionRecoveryStatus?: 'reconnecting' | 'offline' | null;
};

function getChatInitial(name: string) {
  return name.trim().charAt(0).toLocaleUpperCase();
}

function getAttachmentName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function retainUnchangedRichTextEntities(previousText: string, nextText: string, entities: RichTextEntity[]) {
  let prefixLength = 0;
  while (prefixLength < previousText.length
    && prefixLength < nextText.length
    && previousText[prefixLength] === nextText[prefixLength]) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  while (suffixLength < previousText.length - prefixLength
    && suffixLength < nextText.length - prefixLength
    && previousText[previousText.length - suffixLength - 1] === nextText[nextText.length - suffixLength - 1]) {
    suffixLength += 1;
  }

  const changedEnd = previousText.length - suffixLength;
  const offsetDelta = nextText.length - previousText.length;
  return entities.flatMap((entity) => {
    const entityEnd = entity.offset + entity.length;
    if (entityEnd <= prefixLength) return [entity];
    if (entity.offset >= changedEnd) return [{ ...entity, offset: entity.offset + offsetDelta }];
    return [];
  });
}

function isFileDrag(dataTransfer: DataTransfer) {
  return Array.from(dataTransfer.types).includes('Files') || dataTransfer.files.length > 0;
}

const scheduleTimeOptions = Array.from({ length: 96 }, (_, index) => (
  `${String(Math.floor(index / 4)).padStart(2, '0')}:${String((index % 4) * 15).padStart(2, '0')}`
));
const feedbackDurationMs = {
  error: 8000,
  warning: 5000,
  success: 3360,
  info: 3360,
} as const;
const restoredDraftFeedbackDurationMs = feedbackDurationMs.success + 1000;

function toDateInputValue(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatDateLabel(value: string, locale: 'en' | 'ru') {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return value;
  const date = new Date(year, month - 1, day);
  const label = new Intl.DateTimeFormat(locale === 'ru' ? 'ru-RU' : 'en-US', { month: 'short', day: 'numeric' }).format(date);
  return year === new Date().getFullYear()
    ? label
    : new Intl.DateTimeFormat(locale === 'ru' ? 'ru-RU' : 'en-US', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
    }).format(date);
}

function formatTimeValue(date: Date) {
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
}

function parseScheduleTime(value: string) {
  const match = value.trim().match(/^(\d{1,2})[:.](\d{1,2})$/)
    ?? value.trim().replace(/\D/g, '').match(/^(\d{2})(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function toLocalDateTime(dateValue: string, timeValue: string) {
  const [year, month, day] = dateValue.split('-').map(Number);
  const [hours, minutes] = timeValue.split(':').map(Number);
  return new Date(year, month - 1, day, hours, minutes);
}

function formatTimeZoneOffset(date: Date) {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absoluteOffset = Math.abs(offsetMinutes);
  const hours = Math.floor(absoluteOffset / 60);
  const minutes = absoluteOffset % 60;
  return `GMT${sign}${hours}${minutes ? `:${String(minutes).padStart(2, '0')}` : ''}`;
}

function getNextScheduleDateTime(now: Date) {
  const nextAvailable = new Date(now);
  nextAvailable.setMinutes(nextAvailable.getMinutes() + 1, 0, 0);
  return {
    date: toDateInputValue(nextAvailable),
    time: formatTimeValue(nextAvailable),
  };
}

function getUpcomingMessages(messages: ScheduledMessage[], now: Date) {
  return messages
    .filter((message) => {
      if (message.status !== 'scheduled') return false;
      const timestamp = Date.parse(message.when);
      return Number.isFinite(timestamp) && timestamp > now.getTime();
    })
    .sort((left, right) => Date.parse(left.when) - Date.parse(right.when))
    .slice(0, 5);
}

export function QuickPlanner({
  draftLoadRequest = null,
  onRestoreDraft,
  chats = [],
  selectedChat: activeChat = null,
  upcoming = [],
  sent = [],
  historyReady = true,
  historyError = false,
  onSelectChat,
  onRemoveChat,
  onOpenInStudio,
  onSendNow,
  onSchedule,
  onSaveDraft,
  feedbackPreview,
  connectionRecoveryStatus = null,
}: QuickPlannerProps) {
  const { locale, t } = useLocale();
  const [selectedMode, setSelectedMode] = useState('Send now');
  const [message, setMessage] = useState(readPlannerDraft);
  const [messageEntities, setMessageEntities] = useState(readPlannerDraftEntities);
  const lastLoadedDraftRevisionRef = useRef<number | null>(null);
  const initialAttachmentLimitRef = useRef(false);
  const restoreDraftOnCompletionRef = useRef<{
    text: string;
    attachments: string[];
    entities: RichTextEntity[];
  } | null>(null);
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const activityNow = new Date();
  const upcomingMessages = getUpcomingMessages(upcoming, activityNow);
  const [initialScheduleDateTime] = useState(() => getNextScheduleDateTime(currentTime));
  const [selectedDate, setSelectedDate] = useState(initialScheduleDateTime.date);
  const [selectedTime, setSelectedTime] = useState(initialScheduleDateTime.time);
  const [scheduleTimeTouched, setScheduleTimeTouched] = useState(false);
  const [activeSchedulePicker, setActiveSchedulePicker] = useState<'date' | 'time' | null>(null);
  const [scheduleTimeDraft, setScheduleTimeDraft] = useState<string | null>(null);
  const [calendarCursor, setCalendarCursor] = useState(() => new Date());
  const [schedulePickerPosition, setSchedulePickerPosition] = useState({ top: 8, left: 8, maxHeight: 276 });
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [emojiModifierHeld, setEmojiModifierHeld] = useState(false);
  const [emojiCategoryId, setEmojiCategoryId] = useState('faces');
  const [emojiSearchQuery, setEmojiSearchQuery] = useState('');
  const [emojiActiveIndex, setEmojiActiveIndex] = useState(0);
  const [emojiCommandRange, setEmojiCommandRange] = useState<{ start: number; end: number } | null>(null);
  const [recentEmojis, setRecentEmojis] = useState(readRecentEmojis);
  const [effectPickerOpen, setEffectPickerOpen] = useState(false);
  const [availableEffects, setAvailableEffects] = useState<TelegramMessageEffect[]>([]);
  const [selectedEffectId, setSelectedEffectId] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<PlannerAttachment[]>(() => {
    const paths = readPlannerDraftAttachments();
    initialAttachmentLimitRef.current = paths.length > MAX_PLANNER_ATTACHMENTS;
    return paths.slice(0, MAX_PLANNER_ATTACHMENTS).map((path) => ({ name: getAttachmentName(path), path }));
  });
  const [isFileDragOver, setIsFileDragOver] = useState(false);
  const [attachmentScroll, setAttachmentScroll] = useState({ max: 0, position: 0, contentWidth: 0 });
  const [editorAppearance, setEditorAppearance] = useState(readEditorAppearancePreferences);
  const [actionFeedback, setActionFeedback] = useState<QuickPlannerActionFeedback | null>(null);
  const [actionFeedbackInstance, setActionFeedbackInstance] = useState(0);
  const [actionFeedbackRetriggered, setActionFeedbackRetriggered] = useState(false);
  const [chatPickerOpen, setChatPickerOpen] = useState(false);
  const [chatQuery, setChatQuery] = useState('');
  const [selectedChatId, setSelectedChatId] = useState(activeChat?.id ?? '');
  const [removedChatIds, setRemovedChatIds] = useState<string[]>([]);
  const isScheduleMode = selectedMode === 'Schedule';
  const isDraftMode = selectedMode === 'Draft';
  const selectedEffect = availableEffects.find((effect) => effect.id === selectedEffectId) ?? null;
  const normalizedEmojiSearchQuery = emojiSearchQuery.trim().toLocaleLowerCase();
  const visibleEmojiOptions = getVisibleEmojiOptions(emojiSearchQuery, emojiCategoryId as 'faces' | 'hands' | 'hearts' | 'nature' | 'food' | 'fun', Boolean(emojiCommandRange));
  const appearanceMode = selectedMode === 'Send now' ? 'send' : isDraftMode ? 'draft' : 'schedule';
  const plannerAccent = resolveEditorAppearanceColor(editorAppearance, appearanceMode);
  const plannerAccentRgb = getEditorAppearanceCssTokens(editorAppearance, appearanceMode)['--editor-outline'];
  const timeZoneLabel = formatTimeZoneOffset(toLocalDateTime(selectedDate, selectedTime));
  const minimumScheduleDate = getNextScheduleDateTime(currentTime);
  const minimumScheduleDateTime = toLocalDateTime(minimumScheduleDate.date, minimumScheduleDate.time);
  const minimumScheduleDateValue = toDateInputValue(minimumScheduleDateTime);
  const minimumScheduleTimeValue = formatTimeValue(minimumScheduleDateTime);
  const calendarYear = calendarCursor.getFullYear();
  const calendarMonth = calendarCursor.getMonth();
  const calendarFirstWeekdayOffset = (new Date(calendarYear, calendarMonth, 1).getDay() + 6) % 7;
  const calendarDayCount = new Date(calendarYear, calendarMonth + 1, 0).getDate();
  const dateLocale = locale === 'ru' ? 'ru-RU' : 'en-US';
  const calendarMonthLabel = new Intl.DateTimeFormat(dateLocale, { month: 'long', year: 'numeric' }).format(calendarCursor);
  const calendarWeekdayLabels = Array.from({ length: 7 }, (_, index) => (
    new Intl.DateTimeFormat(dateLocale, { weekday: 'short' }).format(new Date(2024, 0, index + 1))
  ));
  const calendarMonthKey = calendarYear * 12 + calendarMonth;
  const minimumMonthKey = Number(minimumScheduleDateValue.slice(0, 4)) * 12 + Number(minimumScheduleDateValue.slice(5, 7)) - 1;
  const todayScheduleDateValue = toDateInputValue(new Date());
  const SubmitIcon = selectedMode === 'Send now' ? Send : selectedMode === 'Draft' ? FileText : CalendarDays;
  const submitLabel = selectedMode === 'Send now' ? t('studio.sendNow') : selectedMode === 'Draft' ? t('quickPlanner.saveDraftAction') : t('quickPlanner.schedulePost');
  const { currentSection, openStudio } = useContext(QuickPlannerNavigationContext);
  const chatPickerRef = useRef<HTMLDivElement>(null);
  const toolsRowRef = useRef<HTMLDivElement>(null);
  const effectsToolRef = useRef<HTMLDivElement>(null);
  const emojiToolRef = useRef<HTMLDivElement>(null);
  const emojiPickerPanelRef = useRef<HTMLDivElement>(null);
  const scheduleRowRef = useRef<HTMLDivElement>(null);
  const scheduleDateTriggerRef = useRef<HTMLButtonElement>(null);
  const scheduleTimeTriggerRef = useRef<HTMLButtonElement>(null);
  const scheduleDatePickerRef = useRef<HTMLDivElement>(null);
  const scheduleTimePickerRef = useRef<HTMLDivElement>(null);
  const chatTriggerRef = useRef<HTMLButtonElement>(null);
  const chatSearchRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const workbenchRef = useRef<HTMLElement>(null);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const attachmentScrollbarRef = useRef<HTMLDivElement>(null);
  const attachmentListRef = useRef<HTMLDivElement>(null);
  const actionFeedbackTimeoutRef = useRef<number | null>(null);
  const scheduleNowConfirmationRef = useRef<string | null>(null);
  const emojiReleaseCloseTimeoutRef = useRef<number | null>(null);
  const emojiSelectionWaitingForReleaseRef = useRef(false);

  useEffect(() => {
    writePlannerDraft(message, messageEntities, attachments.map(({ path }) => path));
  }, [attachments, message, messageEntities]);

  const clearOrRestoreDraftAfterCompletion = () => {
    const restoreDraft = restoreDraftOnCompletionRef.current;
    restoreDraftOnCompletionRef.current = null;
    if (!restoreDraft || (!restoreDraft.text.trim() && restoreDraft.attachments.length === 0)) {
      writePlannerDraft('', [], []);
      setMessage('');
      setMessageEntities([]);
      setAttachments([]);
      onRestoreDraft?.(null);
      return false;
    }

    writePlannerDraft(restoreDraft.text, restoreDraft.entities, restoreDraft.attachments);
    setMessage(restoreDraft.text);
    setMessageEntities(restoreDraft.entities);
    setAttachments(restoreDraft.attachments.map((path) => ({ name: getAttachmentName(path), path })));
    onRestoreDraft?.(restoreDraft);
    return true;
  };

  const hasPreviousDraftToRestore = () => {
    const restoreDraft = restoreDraftOnCompletionRef.current;
    return Boolean(restoreDraft && (restoreDraft.text.trim() || restoreDraft.attachments.length > 0));
  };

  const clearCompletedDraft = () => {
    writePlannerDraft('', [], []);
    setMessage('');
    setMessageEntities([]);
    setAttachments([]);
  };

  const showCompletionFeedback = (message: string) => {
    const restorePreviousDraft = hasPreviousDraftToRestore();
    if (restorePreviousDraft) {
      clearCompletedDraft();
    } else {
      clearOrRestoreDraftAfterCompletion();
    }
    showActionFeedback(
      message,
      'success',
      restorePreviousDraft
        ? { message: t('quickPlanner.previousTextRestored'), tone: 'success', durationMs: restoredDraftFeedbackDurationMs }
        : undefined,
      restorePreviousDraft ? clearOrRestoreDraftAfterCompletion : undefined,
    );
  };

  useLayoutEffect(() => {
    const list = attachmentListRef.current;
    const scrollbar = attachmentScrollbarRef.current;
    if (!list || !scrollbar) return undefined;

    const updateMetrics = () => {
      const max = Math.max(0, list.scrollWidth - list.clientWidth);
      const position = Math.min(list.scrollLeft, max);
      if (list.scrollLeft !== position) list.scrollLeft = position;
      if (scrollbar.scrollLeft !== position) scrollbar.scrollLeft = position;
      const contentWidth = Math.max(list.scrollWidth, list.clientWidth);
      setAttachmentScroll((current) => current.max === max
        && current.position === position
        && current.contentWidth === contentWidth
        ? current
        : { max, position, contentWidth });
    };

    const syncFromList = () => {
      if (scrollbar.scrollLeft !== list.scrollLeft) scrollbar.scrollLeft = list.scrollLeft;
      setAttachmentScroll((current) => current.position === list.scrollLeft
        ? current
        : { ...current, position: list.scrollLeft });
    };

    const syncFromScrollbar = () => {
      if (list.scrollLeft !== scrollbar.scrollLeft) list.scrollLeft = scrollbar.scrollLeft;
      setAttachmentScroll((current) => current.position === scrollbar.scrollLeft
        ? current
        : { ...current, position: scrollbar.scrollLeft });
    };

    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateMetrics);
    resizeObserver?.observe(list);
    Array.from(list.children).forEach((child) => resizeObserver?.observe(child));
    list.addEventListener('scroll', syncFromList, { passive: true });
    scrollbar.addEventListener('scroll', syncFromScrollbar, { passive: true });
    window.addEventListener('resize', updateMetrics);
    updateMetrics();

    return () => {
      resizeObserver?.disconnect();
      list.removeEventListener('scroll', syncFromList);
      scrollbar.removeEventListener('scroll', syncFromScrollbar);
      window.removeEventListener('resize', updateMetrics);
    };
  }, [attachments.length]);

  useLayoutEffect(() => {
    const heading = headingRef.current;
    const workbench = workbenchRef.current;
    if (!heading || !workbench) return undefined;

    const updateHeadingWidth = () => {
      const width = Number.parseFloat(window.getComputedStyle(heading).width);
      if (Number.isFinite(width)) workbench.style.setProperty('--planner-heading-width', `${width}px`);
    };
    updateHeadingWidth();

    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateHeadingWidth);
    resizeObserver?.observe(heading);
    return () => {
      resizeObserver?.disconnect();
      workbench.style.removeProperty('--planner-heading-width');
    };
  }, []);
  const sourceChats = activeChat && !chats.some((chat) => chat.id === activeChat.id)
    ? [activeChat, ...chats]
    : chats;
  const pickerChats: ChatPickerOption[] = sourceChats.map((chat) => ({
      id: chat.id,
      name: chat.name,
      type: chat.type === 'private' ? t('studio.privateChat')
          : chat.type === 'group' ? t('studio.groupChat')
          : chat.type === 'supergroup' ? t('studio.supergroup')
            : chat.type === 'channel' ? t('studio.channelType') : t('studio.chatType'),
      avatarDataUrl: chat.avatarDataUrl,
      sourceChat: chat,
    }));
  const availablePickerChats = pickerChats.filter((chat) => !removedChatIds.includes(chat.id));
  const selectedPickerChat = (activeChat && availablePickerChats.find((chat) => chat.id === activeChat.id))
    ?? availablePickerChats.find((chat) => chat.id === selectedChatId)
    ?? availablePickerChats[0]
    ?? null;
  const filteredChats = availablePickerChats.filter((chat) => (
    `${chat.name} ${chat.type}`.toLowerCase().includes(chatQuery.trim().toLowerCase())
  ));

  const removePickerChat = (chat: ChatPickerOption) => {
    if (chat.sourceChat && onRemoveChat) {
      onRemoveChat(chat.sourceChat);
      return;
    }

    setRemovedChatIds((current) => current.includes(chat.id) ? current : [...current, chat.id]);
    if (chat.id === selectedChatId || chat.id === activeChat?.id) {
      const nextChat = availablePickerChats.find((candidate) => candidate.id !== chat.id);
      setSelectedChatId(nextChat?.id ?? '');
      onSelectChat?.(null);
    }
  };

  const setScheduleDateTimeWithinRange = (dateValue: string, timeValue: string) => {
    setScheduleTimeTouched(true);
    scheduleNowConfirmationRef.current = null;
    const candidate = toLocalDateTime(dateValue, timeValue);
    if (candidate.getTime() <= minimumScheduleDateTime.getTime()) {
      setSelectedDate(minimumScheduleDateValue);
      setSelectedTime(minimumScheduleTimeValue);
      return;
    }
    setSelectedDate(dateValue);
    setSelectedTime(timeValue);
  };

  const resetScheduleDateTime = () => {
    const now = new Date();
    const nextAvailable = getNextScheduleDateTime(now);
    setCurrentTime(now);
    setSelectedDate(nextAvailable.date);
    setSelectedTime(nextAvailable.time);
    setScheduleTimeTouched(false);
    scheduleNowConfirmationRef.current = null;
    setCalendarCursor(now);
  };

  useEffect(() => {
    let timeoutId = 0;
    const tick = () => {
      setCurrentTime(new Date());
      timeoutId = window.setTimeout(tick, 60_000 - (Date.now() % 60_000) + 25);
    };
    const resync = () => {
      if (document.hidden) return;
      window.clearTimeout(timeoutId);
      tick();
    };
    tick();
    document.addEventListener('visibilitychange', resync);
    window.addEventListener('focus', resync);
    return () => {
      window.clearTimeout(timeoutId);
      document.removeEventListener('visibilitychange', resync);
      window.removeEventListener('focus', resync);
    };
  }, []);

  const showActionFeedback = useCallback((
    message: string,
    tone: QuickPlannerActionFeedback['tone'],
    nextFeedback?: Pick<QuickPlannerActionFeedback, 'message' | 'tone'> & { durationMs?: number },
    onNextFeedback?: () => void,
  ) => {
    if (actionFeedbackTimeoutRef.current !== null) {
      window.clearTimeout(actionFeedbackTimeoutRef.current);
    }

    setActionFeedbackRetriggered(actionFeedback?.message === message && actionFeedback.tone === tone);
    setActionFeedbackInstance((instance) => instance + 1);
    setActionFeedback({ message, tone });
    actionFeedbackTimeoutRef.current = window.setTimeout(() => {
      if (nextFeedback) {
        onNextFeedback?.();
        setActionFeedbackRetriggered(false);
        setActionFeedbackInstance((instance) => instance + 1);
        setActionFeedback(nextFeedback);
        actionFeedbackTimeoutRef.current = window.setTimeout(() => {
          setActionFeedback(null);
          setActionFeedbackRetriggered(false);
          actionFeedbackTimeoutRef.current = null;
        }, nextFeedback.durationMs ?? feedbackDurationMs[nextFeedback.tone]);
        return;
      }
      setActionFeedback(null);
      setActionFeedbackRetriggered(false);
      actionFeedbackTimeoutRef.current = null;
    }, feedbackDurationMs[tone]);
  }, [actionFeedback]);

  useEffect(() => {
    if (!draftLoadRequest || lastLoadedDraftRevisionRef.current === draftLoadRequest.revision) return;
    lastLoadedDraftRevisionRef.current = draftLoadRequest.revision;
    restoreDraftOnCompletionRef.current = draftLoadRequest.restoreDraft
      ? {
        ...draftLoadRequest.restoreDraft,
        attachments: draftLoadRequest.restoreDraft.attachments.slice(0, MAX_PLANNER_ATTACHMENTS),
      }
      : null;
    setMessage(draftLoadRequest.text);
    setMessageEntities(draftLoadRequest.entities);
    setAttachments(draftLoadRequest.attachments
      .slice(0, MAX_PLANNER_ATTACHMENTS)
      .map((path) => ({ name: getAttachmentName(path), path })));
    if (draftLoadRequest.attachments.length > MAX_PLANNER_ATTACHMENTS
      || (draftLoadRequest.restoreDraft?.attachments.length ?? 0) > MAX_PLANNER_ATTACHMENTS) {
      showActionFeedback(t('quickPlanner.attachmentLimit', { count: MAX_PLANNER_ATTACHMENTS }), 'warning');
    }
  }, [draftLoadRequest, showActionFeedback, t]);

  useEffect(() => {
    if (!initialAttachmentLimitRef.current) return;
    initialAttachmentLimitRef.current = false;
    if (!draftLoadRequest) {
      showActionFeedback(t('quickPlanner.attachmentLimit', { count: MAX_PLANNER_ATTACHMENTS }), 'warning');
    }
  }, [draftLoadRequest, showActionFeedback, t]);

  const clearActionFeedback = () => {
    if (actionFeedbackTimeoutRef.current !== null) {
      window.clearTimeout(actionFeedbackTimeoutRef.current);
      actionFeedbackTimeoutRef.current = null;
    }
    setActionFeedback(null);
    setActionFeedbackRetriggered(false);
  };

  const toggleEffectPicker = () => {
    const nextOpen = !effectPickerOpen;
    setEffectPickerOpen(nextOpen);
    if (nextOpen) setEmojiPickerOpen(false);
  };

  useEffect(() => {
    let active = true;
    void loadFreeTelegramMessageEffects().then((effects) => {
      if (active) setAvailableEffects(effects);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!effectPickerOpen) return undefined;

    const handlePointerDown = (event: PointerEvent) => {
      if (!effectsToolRef.current?.contains(event.target as Node)) setEffectPickerOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setEffectPickerOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [effectPickerOpen]);

  useEffect(() => () => {
    if (actionFeedbackTimeoutRef.current !== null) {
      window.clearTimeout(actionFeedbackTimeoutRef.current);
    }
  }, []);

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
    if (!chatPickerOpen) return undefined;

    const handlePointerDown = (event: PointerEvent) => {
      if (!chatPickerRef.current?.contains(event.target as Node)) {
        setChatPickerOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setChatPickerOpen(false);
        chatTriggerRef.current?.focus();
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    chatSearchRef.current?.focus();

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [chatPickerOpen]);

  useEffect(() => {
    if (!emojiPickerOpen) return undefined;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!toolsRowRef.current?.contains(target) && !emojiPickerPanelRef.current?.contains(target)) {
        setEmojiPickerOpen(false);
        setEmojiModifierHeld(false);
        setEmojiSearchQuery('');
        setEmojiCommandRange(null);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Control' || event.key === 'Meta') setEmojiModifierHeld(true);
      if (event.key === 'Escape') {
        if (emojiReleaseCloseTimeoutRef.current !== null) {
          window.clearTimeout(emojiReleaseCloseTimeoutRef.current);
          emojiReleaseCloseTimeoutRef.current = null;
        }
        emojiSelectionWaitingForReleaseRef.current = false;
        setEmojiModifierHeld(false);
        setEmojiPickerOpen(false);
        setEmojiSearchQuery('');
        setEmojiCommandRange(null);
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Control' || event.key === 'Meta') setEmojiModifierHeld(false);
      if ((event.key !== 'Control' && event.key !== 'Meta') || !emojiSelectionWaitingForReleaseRef.current) return;
      emojiSelectionWaitingForReleaseRef.current = false;
      if (emojiReleaseCloseTimeoutRef.current !== null) window.clearTimeout(emojiReleaseCloseTimeoutRef.current);
      emojiReleaseCloseTimeoutRef.current = window.setTimeout(() => {
        emojiReleaseCloseTimeoutRef.current = null;
        setEmojiPickerOpen(false);
        setEmojiSearchQuery('');
        setEmojiCommandRange(null);
      }, 700);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
      if (emojiReleaseCloseTimeoutRef.current !== null) {
        window.clearTimeout(emojiReleaseCloseTimeoutRef.current);
        emojiReleaseCloseTimeoutRef.current = null;
      }
      emojiSelectionWaitingForReleaseRef.current = false;
    };
  }, [emojiPickerOpen]);

  useLayoutEffect(() => {
    if (!emojiPickerOpen) return undefined;

    const updateEmojiPickerPosition = () => {
      const anchor = emojiToolRef.current;
      const picker = emojiPickerPanelRef.current;
      if (!anchor || !picker) return;

      const anchorRect = anchor.getBoundingClientRect();
      const pickerRect = picker.getBoundingClientRect();
      const viewportInset = 12;
      const sideGap = 5;
      const maxLeft = Math.max(viewportInset, window.innerWidth - pickerRect.width - viewportInset);
      const rightSideLeft = anchorRect.right + sideGap;
      const left = rightSideLeft <= maxLeft
        ? rightSideLeft
        : Math.max(viewportInset, anchorRect.left - pickerRect.width - sideGap);
      const maxTop = Math.max(viewportInset, window.innerHeight - pickerRect.height - viewportInset);
      const centeredTop = anchorRect.top + (anchorRect.height - pickerRect.height) / 2 + 7;
      const top = Math.min(maxTop, Math.max(viewportInset, centeredTop));

      picker.style.left = `${Math.min(maxLeft, left)}px`;
      picker.style.top = `${top}px`;
    };

    updateEmojiPickerPosition();
    window.addEventListener('resize', updateEmojiPickerPosition);
    window.addEventListener('scroll', updateEmojiPickerPosition, true);
    return () => {
      window.removeEventListener('resize', updateEmojiPickerPosition);
      window.removeEventListener('scroll', updateEmojiPickerPosition, true);
    };
  }, [emojiPickerOpen]);

  useEffect(() => {
    const handleEmojiShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key !== '.') return;
      event.preventDefault();
      setEffectPickerOpen(false);
      setEmojiPickerOpen(true);
      setEmojiSearchQuery('');
      setEmojiCommandRange(null);
      setEmojiActiveIndex(0);
    };

    document.addEventListener('keydown', handleEmojiShortcut);
    return () => document.removeEventListener('keydown', handleEmojiShortcut);
  }, []);

  useEffect(() => {
    if (!activeSchedulePicker) return undefined;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !scheduleRowRef.current?.contains(target)
        && !scheduleDatePickerRef.current?.contains(target)
        && !scheduleTimePickerRef.current?.contains(target)
      ) {
        setActiveSchedulePicker(null);
        setScheduleTimeDraft(null);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setActiveSchedulePicker(null);
        setScheduleTimeDraft(null);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [activeSchedulePicker]);

  useEffect(() => {
    const handlePlannerEscape = (event: KeyboardEvent) => {
      if (
        event.key !== 'Escape'
        || currentSection !== 'quick-plan'
        || chatPickerOpen
        || emojiPickerOpen
        || effectPickerOpen
        || activeSchedulePicker
      ) return;

      event.preventDefault();
      openStudio();
    };

    document.addEventListener('keydown', handlePlannerEscape);
    return () => document.removeEventListener('keydown', handlePlannerEscape);
  }, [activeSchedulePicker, chatPickerOpen, currentSection, effectPickerOpen, emojiPickerOpen, openStudio]);

  useLayoutEffect(() => {
    if (!activeSchedulePicker) return undefined;

    const updateSchedulePickerPosition = () => {
      const anchor = activeSchedulePicker === 'date'
        ? scheduleDateTriggerRef.current
        : scheduleTimeTriggerRef.current;
      const picker = activeSchedulePicker === 'date'
        ? scheduleDatePickerRef.current
        : scheduleTimePickerRef.current;
      if (!anchor || !picker) return;

      const anchorBounds = anchor.getBoundingClientRect();
      const width = activeSchedulePicker === 'date' ? 246 : 172;
      const maxHeight = Math.max(80, Math.min(276, window.innerHeight - 16, anchorBounds.top - 16));
      const pickerHeight = Math.min(picker.getBoundingClientRect().height || maxHeight, maxHeight);
      const top = Math.max(8, anchorBounds.top - pickerHeight - 7);
      const left = Math.max(8, Math.min(anchorBounds.left, window.innerWidth - width - 8));
      setSchedulePickerPosition({ top, left, maxHeight });
    };

    updateSchedulePickerPosition();
    window.addEventListener('resize', updateSchedulePickerPosition);
    window.addEventListener('scroll', updateSchedulePickerPosition, true);
    return () => {
      window.removeEventListener('resize', updateSchedulePickerPosition);
      window.removeEventListener('scroll', updateSchedulePickerPosition, true);
    };
  }, [activeSchedulePicker, calendarMonth]);

  useEffect(() => {
    if (activeSchedulePicker !== 'time') return;
    const timePicker = scheduleTimePickerRef.current?.querySelector('.quick-planner-time-list');
    const selectedOption = timePicker?.querySelector<HTMLButtonElement>('[aria-selected="true"]');
    const firstAvailableOption = timePicker?.querySelector<HTMLButtonElement>('[role="option"]:not(:disabled)');
    const targetOption = selectedOption && !selectedOption.disabled
      ? selectedOption
      : firstAvailableOption ?? selectedOption;
    targetOption?.scrollIntoView?.({ block: 'center' });
  }, [activeSchedulePicker, minimumScheduleTimeValue, selectedDate, selectedTime]);

  const insertEmoji = (emoji: string, keepPickerOpen = false, updateRecent = true) => {
    if (emojiReleaseCloseTimeoutRef.current !== null) {
      window.clearTimeout(emojiReleaseCloseTimeoutRef.current);
      emojiReleaseCloseTimeoutRef.current = null;
    }
    emojiSelectionWaitingForReleaseRef.current = keepPickerOpen;
    const textarea = messageInputRef.current;
    const start = emojiCommandRange?.start ?? textarea?.selectionStart ?? message.length;
    const end = emojiCommandRange?.end ?? textarea?.selectionEnd ?? message.length;
    const nextMessage = `${message.slice(0, start)}${emoji}${message.slice(end)}`.slice(0, 1023);
    setMessageEntities((current) => retainUnchangedRichTextEntities(message, nextMessage, current));
    setMessage(nextMessage);
    setEmojiCommandRange(null);
    if (!keepPickerOpen) setEmojiSearchQuery('');
    if (updateRecent) {
      setRecentEmojis((current) => {
        const nextRecentEmojis = [emoji, ...current.filter((recentEmoji) => recentEmoji !== emoji)].slice(0, 6);
        try {
          window.localStorage.setItem(recentEmojiStorageKey, JSON.stringify(nextRecentEmojis));
        } catch {
          // Keep this picker usable when storage is unavailable.
        }
        return nextRecentEmojis;
      });
    }
    setEmojiPickerOpen(keepPickerOpen);
    window.requestAnimationFrame(() => {
      textarea?.focus();
      const cursor = Math.min(start + emoji.length, nextMessage.length);
      textarea?.setSelectionRange(cursor, cursor);
    });
  };

  const toggleEmojiPicker = () => {
    const nextOpen = !emojiPickerOpen;
    setEmojiPickerOpen(nextOpen);
    if (nextOpen) setEffectPickerOpen(false);
    if (!nextOpen) {
      setEmojiSearchQuery('');
      setEmojiCommandRange(null);
      setEmojiActiveIndex(0);
    }
  };

  const handleEmojiPickerKeyDown = (event: { key: string; ctrlKey?: boolean; metaKey?: boolean; preventDefault: () => void }) => {
    if (!normalizedEmojiSearchQuery || visibleEmojiOptions.length === 0) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      setEmojiActiveIndex((index) => (index + direction + visibleEmojiOptions.length) % visibleEmojiOptions.length);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      insertEmoji(visibleEmojiOptions[emojiActiveIndex]?.emoji ?? visibleEmojiOptions[0].emoji, Boolean(event.ctrlKey || event.metaKey));
    }
  };

  const applyQuickTime = (preset: 'now' | '30min' | 'tomorrow') => {
    if (preset === 'now') {
      const nextAvailable = getNextScheduleDateTime(new Date());
      setScheduleTimeTouched(true);
      scheduleNowConfirmationRef.current = null;
      setSelectedDate(nextAvailable.date);
      setSelectedTime(nextAvailable.time);
      return;
    }

    setScheduleTimeTouched(true);
    scheduleNowConfirmationRef.current = null;
    const selectedDateTime = toLocalDateTime(selectedDate, selectedTime);

    if (preset === '30min') selectedDateTime.setMinutes(selectedDateTime.getMinutes() + 30);
    if (preset === 'tomorrow') selectedDateTime.setDate(selectedDateTime.getDate() + 1);

    setSelectedDate(toDateInputValue(selectedDateTime));
    setSelectedTime(formatTimeValue(selectedDateTime));
  };

  const handleSubmit = async () => {
    if (selectedMode === 'Send now' && connectionRecoveryStatus === 'offline') {
      showActionFeedback(t('telegramStatus.offlineMessage'), 'error');
      return;
    }
    if (!message.trim() && attachments.length === 0) {
      showActionFeedback(t('quickPlanner.writeMessage'), 'warning');
      return;
    }
    if (isScheduleMode) {
      const selectedScheduleDateTime = toLocalDateTime(selectedDate, selectedTime);
      const confirmationKey = JSON.stringify([
        selectedDate,
        selectedTime,
        selectedPickerChat?.sourceChat?.id,
        message,
        attachments.map(({ path }) => path),
        selectedEffectId,
      ]);

      if (!scheduleTimeTouched) {
        if (scheduleNowConfirmationRef.current !== confirmationKey) {
          scheduleNowConfirmationRef.current = confirmationKey;
          showActionFeedback(t('quickPlanner.scheduleNowConfirmation'), 'warning');
          return;
        }
      } else {
        scheduleNowConfirmationRef.current = null;
      }

      if (scheduleTimeTouched && selectedScheduleDateTime.getTime() < minimumScheduleDateTime.getTime()) {
        showActionFeedback(t('quickPlanner.scheduleAtLeastOneMinute'), 'warning');
        return;
      }
    }
    if (isDraftMode) {
      if (onSaveDraft) {
        if (!onSaveDraft({
          message,
          attachments: attachments.map(({ path }) => path),
          entities: messageEntities,
          selectedChat: selectedPickerChat?.sourceChat ?? null,
        })) {
          showActionFeedback(t('quickPlanner.couldNotSaveDraft'), 'error');
          return;
        }
        showCompletionFeedback(t('quickPlanner.draftSavedToPosts'));
        return;
      }
      showActionFeedback(t('quickPlanner.couldNotSaveDraft'), 'error');
    } else if (selectedMode === 'Send now') {
      if (onSendNow) {
        const chat = selectedPickerChat?.sourceChat;
        if (!chat) {
          showActionFeedback(t('quickPlanner.selectConnectedChat'), 'warning');
          return;
        }
        try {
          const sent = await onSendNow(
            chat,
            message,
            attachments.length > 0 ? attachments.map(({ path }) => path) : undefined,
            selectedEffectId ?? undefined,
            messageEntities,
          );
          if (sent === 'sent-history-failed') {
            resetScheduleDateTime();
            showActionFeedback(t('schedule.historyWriteFailed'), 'warning');
            return;
          }
          if (!sent) {
            showActionFeedback(t('quickPlanner.messageNotSent'), 'error');
            return;
          }
          showCompletionFeedback(t('quickPlanner.messageSent'));
          resetScheduleDateTime();
          setSelectedEffectId(null);
        } catch {
          showActionFeedback(t('quickPlanner.messageCouldNotSend'), 'error');
        }
        return;
      }
      showActionFeedback(t('quickPlanner.messageCouldNotSend'), 'error');
    } else {
      if (onSchedule) {
        const chat = selectedPickerChat?.sourceChat;
        if (!chat) {
          showActionFeedback(t('quickPlanner.selectConnectedChat'), 'warning');
          return;
        }
        try {
          const scheduled = await onSchedule({
            chatId: chat.id,
            message,
            date: selectedDate,
            time: selectedTime,
            ...(attachments.length > 0 ? { attachments: attachments.map(({ path }) => path) } : {}),
            ...(selectedEffectId ? { effect: selectedEffectId } : {}),
            entities: messageEntities,
          });
          if (scheduled === 'sent-history-failed') {
            resetScheduleDateTime();
            showActionFeedback(t('schedule.historyWriteFailed'), 'warning');
            return;
          }
          if (!scheduled) {
            showActionFeedback(t('quickPlanner.messageCouldNotSchedule'), 'error');
            return;
          }
          showCompletionFeedback(t('quickPlanner.scheduleRequestSent'));
          resetScheduleDateTime();
          setSelectedEffectId(null);
        } catch {
          showActionFeedback(t('quickPlanner.messageCouldNotSchedule'), 'error');
        }
        return;
      }
      showActionFeedback(t('quickPlanner.messageCouldNotSchedule'), 'error');
    }
  };

  const handleOpenInStudio = () => {
    if (!message.trim() && attachments.length === 0) {
      showActionFeedback(t('quickPlanner.writeBeforeStudio'), 'warning');
      return;
    }
    if (onOpenInStudio) {
      onOpenInStudio({
        text: message,
        attachments: attachments.map(({ path }) => path),
        entities: messageEntities,
        ...(selectedEffectId ? { effect: selectedEffectId } : {}),
      });
      return;
    }
    openStudio();
  };

  const handleAttachmentFiles = (selectedFiles: File[]) => {
    if (selectedFiles.length > 0) {
      const resolvedFiles = selectedFiles.flatMap((file) => {
        try {
          const path = telegramGetFilePath(file);
          return path ? [{ name: file.name, path }] : [];
        } catch {
          return [];
        }
      });
      const remainingSlots = Math.max(0, MAX_PLANNER_ATTACHMENTS - attachments.length);
      const acceptedFiles = resolvedFiles.slice(0, remainingSlots);
      if (acceptedFiles.length > 0) {
        setAttachments((current) => [...current, ...acceptedFiles].slice(0, MAX_PLANNER_ATTACHMENTS));
      }
      const limitReached = resolvedFiles.length > remainingSlots;
      const someFilesUnavailable = resolvedFiles.length !== selectedFiles.length;
      showActionFeedback(
        limitReached
          ? t('quickPlanner.attachmentLimit', { count: MAX_PLANNER_ATTACHMENTS })
          : someFilesUnavailable
            ? t('quickPlanner.someFilesUnavailable')
            : acceptedFiles.length === 1
              ? t('quickPlanner.fileAdded')
              : t('quickPlanner.filesAdded'),
        limitReached || someFilesUnavailable ? 'warning' : 'success',
      );
    }
  };

  const handleClipboardImages = async (files: File[]) => {
    const remainingSlots = Math.max(0, MAX_PLANNER_ATTACHMENTS - attachments.length);
    const acceptedFiles = files.slice(0, remainingSlots);
    const storage = getDraftStorageApi();

    const storedAttachments = storage && typeof storage.copyAttachment === 'function'
      ? await Promise.all(acceptedFiles.map(async (file) => {
        try {
          const result = await storage.copyAttachment(file);
          return result.success && result.attachment
            ? { name: result.attachment.name, path: result.attachment.path }
            : null;
        } catch {
          return null;
        }
      }))
      : [];
    const resolvedAttachments = storedAttachments.filter((attachment): attachment is PlannerAttachment => attachment !== null);

    if (resolvedAttachments.length > 0) {
      setAttachments((current) => [...current, ...resolvedAttachments].slice(0, MAX_PLANNER_ATTACHMENTS));
    }

    const hasUnavailableFiles = resolvedAttachments.length !== acceptedFiles.length;
    showActionFeedback(
      files.length > remainingSlots
        ? t('quickPlanner.attachmentLimit', { count: MAX_PLANNER_ATTACHMENTS })
        : hasUnavailableFiles
          ? t('quickPlanner.someFilesUnavailable')
          : resolvedAttachments.length === 1
            ? t('quickPlanner.fileAdded')
            : t('quickPlanner.filesAdded'),
      files.length > remainingSlots || hasUnavailableFiles ? 'warning' : 'success',
    );
  };

  const handleMessagePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const clipboardItems = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);
    const clipboardImages = clipboardItems.length > 0
      ? clipboardItems
      : Array.from(event.clipboardData.files).filter((file) => file.type.startsWith('image/'));
    if (clipboardImages.length === 0) return;

    const preparedImages = clipboardImages.map((file, index) => {
      if (file.name) return file;
      const extension = file.type.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
      return new File([file], `pasted-image-${Date.now()}-${index + 1}.${extension}`, {
        type: file.type,
        lastModified: file.lastModified,
      });
    });
    void handleClipboardImages(preparedImages);
  };

  const handleAttachmentChange = (event: ChangeEvent<HTMLInputElement>) => {
    handleAttachmentFiles(Array.from(event.currentTarget.files ?? []));
    event.currentTarget.value = '';
  };

  const visibleActionFeedback = feedbackPreview !== undefined ? feedbackPreview : actionFeedback;

  return (
    <main
      className="quick-planner"
      lang={locale}
      aria-labelledby="quick-planner-title"
      style={{ '--planner-accent': plannerAccent, '--planner-accent-rgb': plannerAccentRgb } as CSSProperties}
    >
      <div className="quick-planner-inner">
        <header className="quick-planner-heading">
          <div>
            <h1 ref={headingRef} id="quick-planner-title">{t('quickPlanner.newMessage')}</h1>
          </div>
        </header>

        <div className="quick-planner-layout">
          <section ref={workbenchRef} className="quick-planner-workbench" aria-label={t('quickPlanner.sectionLabel')}>
            <div className="quick-planner-toolbar">
              <div className="quick-planner-destination" ref={chatPickerRef}>
                <span className="quick-planner-label">{t('quickPlanner.sendTo')}</span>
                <button
                  ref={chatTriggerRef}
                  className={`quick-planner-chat${chatPickerOpen ? ' is-open' : ''}`}
                  type="button"
                  aria-haspopup="listbox"
                  aria-expanded={chatPickerOpen}
                  onClick={() => setChatPickerOpen((open) => !open)}
                >
                  {selectedPickerChat?.avatarDataUrl ? (
                    <ChatAvatar name={selectedPickerChat.name} src={selectedPickerChat.avatarDataUrl} className="quick-planner-chat-avatar" />
                  ) : selectedPickerChat ? (
                    <span className="quick-planner-chat-avatar">{getChatInitial(selectedPickerChat.name)}</span>
                  ) : (
                    <span className="quick-planner-chat-avatar" aria-hidden="true">?</span>
                  )}
                  <span className="quick-planner-chat-copy">
                    <strong>{selectedPickerChat?.name ?? t('quickPlanner.chooseChat')}</strong>
                  </span>
                  <ChevronDown size={15} aria-hidden="true" />
                </button>
                {chatPickerOpen && (
                  <div className="quick-planner-chat-menu">
                    <label className="quick-planner-chat-search">
                      <Search size={15} aria-hidden="true" />
                      <input
                        ref={chatSearchRef}
                        type="search"
                        value={chatQuery}
                        onChange={(event) => setChatQuery(event.target.value)}
                        placeholder={t('quickPlanner.searchChats')}
                        aria-label={t('quickPlanner.searchChats')}
                      />
                    </label>
                    <div className="quick-planner-chat-menu-heading">{t('quickPlanner.recentChats')}</div>
                    <div className="quick-planner-chat-options" role="listbox" aria-label={t('quickPlanner.chatList')}>
                      {filteredChats.map((chat) => (
                        <div
                          key={chat.id}
                          className={`quick-planner-chat-option-row${selectedPickerChat?.id === chat.id ? ' is-selected' : ''}`}
                          role="group"
                          aria-label={chat.name}
                        >
                          <button
                            className={`quick-planner-chat-option${selectedPickerChat?.id === chat.id ? ' is-selected' : ''}`}
                            type="button"
                            role="option"
                            aria-selected={selectedPickerChat?.id === chat.id}
                            onClick={() => {
                              setSelectedChatId(chat.id);
                              onSelectChat?.(chat.sourceChat ?? null);
                              setChatPickerOpen(false);
                              setChatQuery('');
                            }}
                          >
                            {chat.avatarDataUrl ? (
                              <ChatAvatar name={chat.name} src={chat.avatarDataUrl} className="quick-planner-chat-avatar" />
                            ) : (
                              <span className="quick-planner-chat-avatar">{getChatInitial(chat.name)}</span>
                            )}
                            <span className="quick-planner-chat-copy">
                              <strong>{chat.name}</strong>
                              <small>{chat.type}</small>
                            </span>
                            {selectedPickerChat?.id === chat.id && <Check size={16} aria-hidden="true" />}
                          </button>
                          <button
                            className="quick-planner-chat-option-remove"
                            type="button"
                            aria-label={t('quickPlanner.removeChat', { chat: chat.name })}
                            title={t('quickPlanner.removeChat', { chat: chat.name })}
                            onClick={() => removePickerChat(chat)}
                          >
                            <X size={14} aria-hidden="true" />
                          </button>
                        </div>
                      ))}
                      {filteredChats.length === 0 && (
                        <div className="quick-planner-chat-empty">{t('quickPlanner.noChatsFound')}</div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="quick-planner-action-mode">
                <span className="quick-planner-label">{t('quickPlanner.action')}</span>
                <div className="quick-planner-mode-switch" role="group" aria-label={t('quickPlanner.actionModes')}>
                  {actionModes.map(({ mode, labelKey, icon: Icon }) => {
                    const active = selectedMode === mode;

                    return (
                    <button
                      key={mode}
                      className={active ? 'is-active' : ''}
                      type="button"
                      aria-pressed={active}
                      onClick={() => {
                        setSelectedMode(mode);
                        setActiveSchedulePicker(null);
                        setScheduleTimeDraft(null);
                      }}
                    >
                      <Icon size={14} aria-hidden="true" />
                      <span>{t(labelKey)}</span>
                    </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="quick-planner-composer">
              <div className="quick-planner-composer-meta">
                <span>{t('quickPlanner.message')}</span>
                <span className="quick-planner-composer-meta-trailing">
                  {attachments.length > 0 && (
                    <span>{t(getAttachmentCountTranslationKey(locale, attachments.length), { count: attachments.length })}</span>
                  )}
                  <span className="quick-planner-counter-controls">
                    {selectedEffect && (
                      <span
                        className="quick-planner-selected-effect"
                        aria-label={`${t('quickPlanner.messageEffects')}: ${selectedEffect.emoticon}`}
                        title={`${t('quickPlanner.messageEffects')}: ${selectedEffect.emoticon}`}
                      >
                        {selectedEffect.emoticon}
                      </span>
                    )}
                    <span className="quick-planner-character-count">{String(message.length).padStart(2, '0')} <i>/</i> 1023</span>
                    <button
                      className={`quick-planner-clear-message${message ? '' : ' is-hidden'}`}
                      type="button"
                      aria-label={t('quickPlanner.clearReminderText')}
                      aria-hidden={!message}
                      title={t('quickPlanner.clearText')}
                      disabled={!message}
                      tabIndex={message ? 0 : -1}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        setMessage('');
                        setMessageEntities([]);
                        clearActionFeedback();
                        messageInputRef.current?.focus();
                      }}
                    >
                      <Eraser size={16} aria-hidden="true" />
                    </button>
                  </span>
                </span>
              </div>
              <textarea
                ref={messageInputRef}
                className={`quick-planner-message${isFileDragOver ? ' is-file-drag-over' : ''}`}
                wrap="soft"
                aria-label={t('quickPlanner.reminderText')}
                aria-describedby="quick-planner-counter"
                maxLength={1023}
                value={message}
                onClick={(event) => {
                  const textarea = event.currentTarget;
                  if (event.detail >= 4) {
                    textarea.select();
                    return;
                  }
                  if (event.detail !== 3) return;

                  const text = textarea.value;
                  const selectionStart = textarea.selectionStart;
                  const selectionEnd = textarea.selectionEnd;
                  const position = Math.floor((selectionStart + selectionEnd) / 2);
                  const lineStart = text.lastIndexOf('\n', Math.max(0, position - 1)) + 1;
                  const nextLineBreak = text.indexOf('\n', position);
                  const lineEnd = nextLineBreak === -1 ? text.length : nextLineBreak;
                  textarea.setSelectionRange(lineStart, lineEnd);
                }}
                onPaste={handleMessagePaste}
                onDragEnter={(event: DragEvent<HTMLTextAreaElement>) => {
                  if (!isFileDrag(event.dataTransfer)) return;
                  event.preventDefault();
                  setIsFileDragOver(true);
                }}
                onDragOver={(event: DragEvent<HTMLTextAreaElement>) => {
                  if (!isFileDrag(event.dataTransfer)) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'copy';
                  setIsFileDragOver(true);
                }}
                onDragLeave={(event: DragEvent<HTMLTextAreaElement>) => {
                  if (!isFileDrag(event.dataTransfer)) return;
                  setIsFileDragOver(false);
                }}
                onDrop={(event: DragEvent<HTMLTextAreaElement>) => {
                  if (!isFileDrag(event.dataTransfer)) return;
                  event.preventDefault();
                  setIsFileDragOver(false);
                  handleAttachmentFiles(Array.from(event.dataTransfer.files));
                }}
                onChange={(event) => {
                  const nextMessage = event.target.value;
                  setMessageEntities((current) => retainUnchangedRichTextEntities(message, nextMessage, current));
                  setMessage(nextMessage);
                  clearActionFeedback();
                  const caret = event.currentTarget.selectionStart;
                  const commandMatch = nextMessage.slice(0, caret).match(/(?:^|\s):([\p{L}\p{N}_-]*)$/iu);
                  if (commandMatch) {
                    const commandStart = caret - commandMatch[1].length - 1;
                    setEmojiCommandRange({ start: commandStart, end: caret });
                    setEmojiSearchQuery(commandMatch[1].replace(/[_-]/g, ' '));
                    setEmojiActiveIndex(0);
                    setEmojiPickerOpen(true);
                    setEffectPickerOpen(false);
                  } else if (emojiCommandRange) {
                    setEmojiCommandRange(null);
                    setEmojiSearchQuery('');
                    setEmojiPickerOpen(false);
                  }
                }}
                onKeyDown={handleEmojiPickerKeyDown}
                placeholder={t('quickPlanner.messagePlaceholder')}
              />
              <span id="quick-planner-counter" className="quick-planner-sr-only">
                {t('quickPlanner.characterCount', { count: message.length })}
              </span>
            </div>
            <div className="quick-planner-tools-row" ref={toolsRowRef}>
              <div className="quick-planner-tools" aria-label={t('quickPlanner.tools')}>
                <div className="quick-planner-tool-anchor">
                  <button type="button" aria-label={t('quickPlanner.attachFiles')} onClick={() => attachmentInputRef.current?.click()}>
                    <Paperclip size={24} aria-hidden="true" />
                  </button>
                  <input ref={attachmentInputRef} className="quick-planner-file-input" type="file" multiple onChange={handleAttachmentChange} />
                </div>
                <div className="quick-planner-tool-anchor" ref={effectsToolRef}>
                  <button
                    className={effectPickerOpen || selectedEffectId ? 'is-active' : ''}
                    type="button"
                    aria-label={t('quickPlanner.messageEffects')}
                    aria-expanded={effectPickerOpen}
                    aria-pressed={Boolean(selectedEffectId)}
                    title={selectedEffect ? `${t('quickPlanner.messageEffects')}: ${selectedEffect.emoticon}` : t('quickPlanner.messageEffects')}
                    onClick={toggleEffectPicker}
                  ><Sparkles size={24} aria-hidden="true" /></button>
                  {effectPickerOpen && (
                    <div className="quick-planner-tool-popover quick-planner-effects-picker" role="dialog" aria-label={t('quickPlanner.messageEffects')}>
                      <div className="quick-planner-effects-heading">
                        <strong>{t('quickPlanner.messageEffect')}</strong>
                      </div>
                      <div className="quick-planner-effects-grid" role="group" aria-label={t('quickPlanner.chooseMessageEffect')}>
                        {[
                          ...availableEffects.slice(0, 3),
                          { id: null, emoticon: '−', premiumRequired: false },
                          ...availableEffects.slice(3),
                        ].map((effect) => {
                          const isSelected = effect.id === null
                            ? selectedEffectId === null
                            : selectedEffectId === effect.id;
                          const effectLabel = effect.id === null
                            ? t('quickPlanner.noEffect')
                            : t('quickPlanner.effect', { emoji: effect.emoticon });
                          return (
                            <button
                              key={effect.id ?? 'no-effect'}
                              className={`quick-planner-effect-option${isSelected ? ' is-selected' : ''}`}
                              type="button"
                              aria-label={effectLabel}
                              title={effect.id === null ? effectLabel : `${effectLabel} · ${effect.id}`}
                              aria-pressed={isSelected}
                              onClick={() => {
                                setSelectedEffectId(effect.id);
                                setEffectPickerOpen(false);
                              }}
                            >
                              <span className="quick-planner-effect-icon" aria-hidden="true">{effect.emoticon}</span>
                              {effect.id === null && <span className="quick-planner-effect-label">{effectLabel}</span>}
                            </button>
                          );
                        })}
                      </div>
                      {availableEffects.length === 0 && (
                        <p className="quick-planner-effects-empty" role="status">{t('quickPlanner.noFreeEffects')}</p>
                      )}
                    </div>
                  )}
                </div>
                <div className="quick-planner-tool-anchor" ref={emojiToolRef}>
                  <button
                    className={emojiPickerOpen ? 'is-active' : ''}
                    type="button"
                    aria-label={t('quickPlanner.openEmoji')}
                    title={t('quickPlanner.openEmojiTitle')}
                    aria-expanded={emojiPickerOpen}
                    onClick={toggleEmojiPicker}
                  ><Smile size={24} aria-hidden="true" /></button>
                  {emojiPickerOpen && createPortal(
                    <EmojiPickerPanel
                      categoryId={emojiCategoryId as 'faces' | 'hands' | 'hearts' | 'nature' | 'food' | 'fun'}
                      searchQuery={emojiSearchQuery}
                      activeIndex={emojiActiveIndex}
                      recentEmojis={recentEmojis}
                      modifierHeld={emojiModifierHeld}
                      commandMode={Boolean(emojiCommandRange)}
                      className="quick-planner-emoji-picker--floating"
                      pickerRef={emojiPickerPanelRef}
                      style={{
                        '--planner-accent': plannerAccent,
                        '--planner-accent-rgb': plannerAccentRgb,
                        '--planner-ink': 'var(--text)',
                        '--planner-dim': 'var(--dim)',
                        '--planner-line': 'var(--line)',
                      } as CSSProperties}
                      onCategoryChange={setEmojiCategoryId}
                      onSearchQueryChange={setEmojiSearchQuery}
                      onActiveIndexChange={setEmojiActiveIndex}
                      onSelectEmoji={insertEmoji}
                    />,
                    document.body,
                  )}
                </div>
                {attachments.length > 0 && (
                  <div
                    className={`quick-planner-attachments${attachmentScroll.max > 0 ? ' has-overflow' : ''}`}
                    role="group"
                    aria-label={t('quickPlanner.attachments', { count: attachments.length })}
                  >
                    <div
                      className="quick-planner-attachments-scrollbar"
                      ref={attachmentScrollbarRef}
                      role="scrollbar"
                      aria-label={t('quickPlanner.scrollAttachments')}
                      aria-controls="quick-planner-attachment-list"
                      aria-orientation="horizontal"
                      aria-valuemin={0}
                      aria-valuemax={attachmentScroll.max}
                      aria-valuenow={Math.min(attachmentScroll.position, attachmentScroll.max)}
                      tabIndex={0}
                      onKeyDown={(event) => {
                        const step = event.key === 'PageDown' || event.key === 'PageUp' ? 100 : 32;
                        const direction = event.key === 'ArrowRight' || event.key === 'PageDown' ? 1
                          : event.key === 'ArrowLeft' || event.key === 'PageUp' ? -1 : 0;
                        if (event.key === 'Home') attachmentScrollbarRef.current!.scrollLeft = 0;
                        else if (event.key === 'End') attachmentScrollbarRef.current!.scrollLeft = attachmentScroll.max;
                        else if (direction) attachmentScrollbarRef.current!.scrollLeft += direction * step;
                        else return;
                        event.preventDefault();
                      }}
                    >
                      <div className="quick-planner-attachments-scrollbar-content" style={{ width: `${attachmentScroll.contentWidth}px` }} />
                    </div>
                    <div
                      className="quick-planner-attachment-list"
                      id="quick-planner-attachment-list"
                      ref={attachmentListRef}
                      tabIndex={0}
                      onKeyDown={(event) => {
                        const list = attachmentListRef.current;
                        if (!list) return;
                        const step = event.key === 'PageDown' || event.key === 'PageUp' ? 180 : 48;
                        const direction = event.key === 'ArrowRight' || event.key === 'PageDown' ? 1
                          : event.key === 'ArrowLeft' || event.key === 'PageUp' ? -1 : 0;
                        if (event.key === 'Home') list.scrollLeft = 0;
                        else if (event.key === 'End') list.scrollLeft = list.scrollWidth;
                        else if (direction) list.scrollLeft += direction * step;
                        else return;
                        event.preventDefault();
                      }}
                    >
                      {attachments.map((attachment, index) => (
                        <div className="quick-planner-attachment" key={`${attachment.path}-${index}`}>
                          <Paperclip size={14} aria-hidden="true" />
                          <span className="quick-planner-attachment-name" title={attachment.name}>{attachment.name}</span>
                          <button
                            type="button"
                            aria-label={t('composer.removeAttachment', { name: attachment.name })}
                            title={t('composer.removeAttachment', { name: attachment.name })}
                            onClick={() => {
                              const nextAttachments = attachments.filter((_, currentIndex) => currentIndex !== index);
                              setAttachments(nextAttachments);
                              writePlannerDraft(message, readPlannerDraftEntities(), nextAttachments.map(({ path }) => path));
                              flushPlannerDraftWrite();
                            }}
                          ><X size={14} aria-hidden="true" /></button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="quick-planner-schedule-row" ref={scheduleRowRef}>
              <span className="quick-planner-label quick-planner-schedule-label">
                {isDraftMode ? t('quickPlanner.draft') : selectedMode === 'Send now' ? t('quickPlanner.sendNow') : t('quickPlanner.scheduleFor')}
              </span>
              {!isDraftMode && (
                <div className="quick-planner-schedule-field">
                  <button
                    ref={scheduleDateTriggerRef}
                    className={selectedMode === 'Send now' ? 'is-readonly' : undefined}
                    type="button"
                    aria-label={t('quickPlanner.chooseDate')}
                    aria-haspopup={selectedMode === 'Send now' ? undefined : 'dialog'}
                    aria-disabled={selectedMode === 'Send now' || undefined}
                    aria-expanded={selectedMode !== 'Send now' && activeSchedulePicker === 'date'}
                    tabIndex={selectedMode === 'Send now' ? -1 : 0}
                    onClick={selectedMode === 'Send now' ? undefined : () => {
                      setScheduleTimeDraft(null);
                      if (activeSchedulePicker !== 'date') {
                        setCalendarCursor(toLocalDateTime(selectedDate, '12:00'));
                      }
                      setActiveSchedulePicker((picker) => picker === 'date' ? null : 'date');
                    }}
                  >
                    <CalendarDays size={15} aria-hidden="true" />
                    <span>{formatDateLabel(selectedDate, locale)}</span>
                    <ChevronDown size={13} aria-hidden="true" style={{ visibility: selectedMode === 'Send now' ? 'hidden' : undefined }} />
                  </button>
                  {activeSchedulePicker === 'date' && (
                    createPortal(
                      <div
                        ref={scheduleDatePickerRef}
                        className="quick-planner-schedule-popover quick-planner-date-picker"
                        role="dialog"
                        aria-label={t('quickPlanner.scheduleDatePicker')}
                        style={{
                          position: 'fixed',
                          top: schedulePickerPosition.top,
                          left: schedulePickerPosition.left,
                          maxHeight: schedulePickerPosition.maxHeight,
                          '--planner-accent': plannerAccent,
                          '--planner-accent-rgb': plannerAccentRgb,
                        } as CSSProperties}
                      >
                        <div className="quick-planner-date-picker-header">
                          <button
                            type="button"
                            aria-label={t('quickPlanner.previousMonth')}
                            disabled={calendarMonthKey <= minimumMonthKey}
                            onClick={() => setCalendarCursor((cursor) => new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
                          >
                            <ChevronLeft size={14} aria-hidden="true" />
                          </button>
                          <span>{calendarMonthLabel}</span>
                          <button
                            type="button"
                            aria-label={t('quickPlanner.nextMonth')}
                            onClick={() => setCalendarCursor((cursor) => new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
                          >
                            <ChevronRight size={14} aria-hidden="true" />
                          </button>
                        </div>
                        <div className="quick-planner-date-picker-weekdays" aria-hidden="true">
                          {calendarWeekdayLabels.map((label, index) => <span key={`${label}-${index}`}>{label}</span>)}
                        </div>
                        <div className="quick-planner-date-picker-grid">
                          {Array.from({ length: calendarFirstWeekdayOffset }, (_, index) => (
                            <span key={`gap-${index}`} className="quick-planner-date-picker-gap" aria-hidden="true" />
                          ))}
                          {Array.from({ length: calendarDayCount }, (_, index) => {
                            const dayNumber = index + 1;
                            const cellValue = `${calendarYear}-${String(calendarMonth + 1).padStart(2, '0')}-${String(dayNumber).padStart(2, '0')}`;
                            const isSelected = cellValue === selectedDate;
                            const isToday = cellValue === todayScheduleDateValue;
                            const isDisabled = cellValue < minimumScheduleDateValue;
                            return (
                              <button
                                key={cellValue}
                                type="button"
                                aria-label={t('quickPlanner.chooseDay', { date: new Intl.DateTimeFormat(dateLocale, { month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(calendarYear, calendarMonth, dayNumber)) })}
                                aria-pressed={isSelected}
                                className={`${isSelected ? 'is-selected' : ''}${isToday ? ' is-today' : ''}`.trim()}
                                disabled={isDisabled}
                                onClick={() => {
                                  setScheduleDateTimeWithinRange(cellValue, selectedTime);
                                  setActiveSchedulePicker(null);
                                }}
                              >{dayNumber}</button>
                            );
                          })}
                        </div>
                      </div>,
                      document.body,
                    )
                  )}
                </div>
              )}
              {!isDraftMode && (
                <div className="quick-planner-time-value">
                  <div className="quick-planner-schedule-field">
                    <button
                      ref={scheduleTimeTriggerRef}
                      className={selectedMode === 'Send now' ? 'is-readonly' : undefined}
                      type="button"
                      aria-label={t('quickPlanner.chooseTime')}
                      aria-haspopup={selectedMode === 'Send now' ? undefined : 'dialog'}
                      aria-disabled={selectedMode === 'Send now' || undefined}
                      aria-expanded={selectedMode !== 'Send now' && activeSchedulePicker === 'time'}
                      tabIndex={selectedMode === 'Send now' ? -1 : 0}
                      onClick={selectedMode === 'Send now' ? undefined : () => {
                        setActiveSchedulePicker((picker) => picker === 'time' ? null : 'time');
                        setScheduleTimeDraft(null);
                      }}
                    >
                      <Clock3 size={15} aria-hidden="true" />
                      <span>{selectedTime}</span>
                      <ChevronDown size={13} aria-hidden="true" style={{ visibility: selectedMode === 'Send now' ? 'hidden' : undefined }} />
                    </button>
                    {activeSchedulePicker === 'time' && (
                        createPortal(
                          <div
                            ref={scheduleTimePickerRef}
                            className="quick-planner-schedule-popover quick-planner-time-picker"
                            role="dialog"
                            aria-label={t('quickPlanner.scheduleTimePicker')}
                            style={{
                              position: 'fixed',
                              top: schedulePickerPosition.top,
                              left: schedulePickerPosition.left,
                              maxHeight: schedulePickerPosition.maxHeight,
                                '--planner-accent': plannerAccent,
                                '--planner-accent-rgb': plannerAccentRgb,
                            } as CSSProperties}
                          >
                          <input
                            className="quick-planner-time-field"
                            aria-label={t('quickPlanner.enterScheduleTime')}
                            type="text"
                            inputMode="numeric"
                            autoComplete="off"
                            autoFocus
                            value={scheduleTimeDraft ?? selectedTime}
                            onChange={(event) => {
                              const parsed = parseScheduleTime(event.currentTarget.value);
                              if (parsed) {
                                setScheduleTimeDraft(null);
                                setScheduleDateTimeWithinRange(selectedDate, parsed);
                              } else {
                                setScheduleTimeDraft(event.currentTarget.value.slice(0, 5));
                              }
                            }}
                            onBlur={() => setScheduleTimeDraft(null)}
                            onKeyDown={(event) => {
                              if (event.key !== 'Enter') return;
                              event.preventDefault();
                              const parsed = parseScheduleTime(event.currentTarget.value);
                              if (!parsed) return;
                              setScheduleTimeDraft(null);
                              setScheduleDateTimeWithinRange(selectedDate, parsed);
                              setActiveSchedulePicker(null);
                            }}
                          />
                          <div className="quick-planner-time-list" role="listbox" aria-label={t('quickPlanner.availableTimes')}>
                            {scheduleTimeOptions.map((option) => {
                              const isSelected = option === selectedTime;
                              const isPast = selectedDate < minimumScheduleDateValue
                                || (selectedDate === minimumScheduleDateValue && option < minimumScheduleTimeValue);
                              return (
                                <button
                                  key={option}
                                  type="button"
                                  role="option"
                                  aria-selected={isSelected}
                                  disabled={isPast}
                                  onClick={() => {
                                    setScheduleTimeDraft(null);
                                    setScheduleDateTimeWithinRange(selectedDate, option);
                                    setActiveSchedulePicker(null);
                                  }}
                                >{option}</button>
                              );
                            })}
                          </div>
                          </div>,
                          document.body,
                        )
                    )}
                  </div>
                </div>
              )}
              {isScheduleMode && (
                <div className="quick-planner-presets" role="group" aria-label={t('quickPlanner.quickScheduleTimes')}>
                  <button type="button" onClick={() => applyQuickTime('now')}>{t('quickPlanner.now')}</button>
                  <button type="button" onClick={() => applyQuickTime('30min')}>{t('quickPlanner.in30Minutes')}</button>
                  <button type="button" onClick={() => applyQuickTime('tomorrow')}>{t('quickPlanner.tomorrow')}</button>
                </div>
              )}
              {!isDraftMode && (
                <div className="quick-planner-submit-group">
                  <span className={`quick-planner-timezone${isScheduleMode ? '' : ' is-no-presets'}`}>{timeZoneLabel}</span>
                  <button className="quick-planner-submit" type="button" onClick={handleSubmit}>
                    <SubmitIcon size={16} aria-hidden="true" />
                    <span>{submitLabel}</span>
                  </button>
                </div>
              )}
              {isDraftMode && (
                <div className="quick-planner-draft-actions">
                  <button className="quick-planner-open-studio" type="button" onClick={handleOpenInStudio}>
                    <ArrowUpRight size={15} aria-hidden="true" />
                    <span>{t('quickPlanner.openInStudio')}</span>
                  </button>
                  <button className="quick-planner-submit" type="button" onClick={handleSubmit}>
                    <SubmitIcon size={16} aria-hidden="true" />
                    <span>{submitLabel}</span>
                  </button>
                </div>
              )}
            </div>

            <div className="quick-planner-compose-footer">
              {visibleActionFeedback && (
                <div
                  key={feedbackPreview
                    ? `${feedbackPreview.tone}:${feedbackPreview.message}:${feedbackPreview.instance ?? 0}`
                    : actionFeedbackInstance}
                  className={`planner-inline-notification quick-planner-action-feedback is-${visibleActionFeedback.tone}${visibleActionFeedback.actions?.length ? ' has-actions' : ''}${(feedbackPreview ? (feedbackPreview.instance ?? 0) > 0 : actionFeedbackRetriggered) ? ' is-retriggered' : ''}`}
                  role={visibleActionFeedback.tone === 'error' ? 'alert' : 'status'}
                  aria-live={visibleActionFeedback.tone === 'error' ? 'assertive' : 'polite'}
                  aria-atomic="true"
                  title={visibleActionFeedback.message}
                >
                  <span className="quick-planner-action-feedback-message">{visibleActionFeedback.message}</span>
                  {visibleActionFeedback.actions?.map((action) => (
                    <button
                      key={action.id}
                      type="button"
                      className={`quick-planner-feedback-action is-${action.id}`}
                      aria-label={action.label}
                      title={action.label}
                      onClick={action.onClick}
                    >
                      {action.id === 'retry'
                        ? <RotateCcw size={14} aria-hidden="true" />
                        : <X size={14} aria-hidden="true" />}
                      {action.id === 'retry' && <span>{action.label}</span>}
                    </button>
                  ))}
                </div>
              )}
              {!visibleActionFeedback && connectionRecoveryStatus && (
                <div
                  className={`planner-inline-notification quick-planner-action-feedback is-connection-status is-${connectionRecoveryStatus === 'offline' ? 'error' : 'info'}`}
                  role="status"
                  aria-live="polite"
                  aria-atomic="true"
                >
                  {connectionRecoveryStatus === 'reconnecting' && (
                    <span className="quick-planner-connection-spinner" aria-hidden="true" />
                  )}
                  <span className="quick-planner-action-feedback-message">
                    {t(connectionRecoveryStatus === 'offline' ? 'telegramStatus.offlineMessage' : 'telegramStatus.networkMessage')}
                  </span>
                </div>
              )}
            </div>

          </section>

          <aside className="quick-planner-activity" aria-label={t('quickPlanner.activityUpcoming')}>
            <QuickPlannerActivity
              sent={sent}
              upcoming={upcoming}
              historyReady={historyReady}
              historyError={historyError}
            />
            <section className="quick-planner-upcoming-section" aria-labelledby="quick-planner-upcoming-heading" hidden>
              <div className="quick-planner-activity-header">
                <h2 id="quick-planner-upcoming-heading">{t('quickPlanner.upcoming')}</h2>
              </div>
              {historyError ? (
                <p className="quick-planner-activity-state is-error">{t('quickPlanner.historyError')}</p>
              ) : !historyReady ? (
                <p className="quick-planner-activity-state">{t('quickPlanner.loadingUpcoming')}</p>
              ) : upcomingMessages.length === 0 ? (
                <p className="quick-planner-activity-state">{t('quickPlanner.emptyUpcoming')}</p>
              ) : (
                <ul className="quick-planner-upcoming-list">
                  {upcomingMessages.map((scheduledMessage) => {
                    const scheduledDate = new Date(scheduledMessage.when);
                    const preview = scheduledMessage.text.trim()
                      || (scheduledMessage.attachments?.length
                        ? t('quickPlanner.mediaMessage')
                        : t('quickPlanner.emptyTextMessage'));
                    return (
                      <li className="quick-planner-upcoming-item" key={scheduledMessage.id}>
                        <time
                          dateTime={scheduledMessage.when}
                          title={new Intl.DateTimeFormat(dateLocale, {
                            weekday: 'long',
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          }).format(scheduledDate)}
                        >
                          {new Intl.DateTimeFormat(dateLocale, {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          }).format(scheduledDate)}
                        </time>
                        <strong title={scheduledMessage.chatName}>{scheduledMessage.chatName}</strong>
                        <span title={preview}>{preview}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </aside>
        </div>

      </div>
    </main>
  );
}

function getAttachmentCountTranslationKey(locale: 'en' | 'ru', count: number) {
  if (locale === 'en') return count === 1 ? 'quickPlanner.attachmentOne' : 'quickPlanner.attachments';
  const plural = new Intl.PluralRules('ru').select(count);
  if (plural === 'one') return 'quickPlanner.attachmentOne';
  return plural === 'few' ? 'quickPlanner.attachmentsFew' : 'quickPlanner.attachments';
}