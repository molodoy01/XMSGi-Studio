import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, Clock, MessageCircle, Search, Star, Upload } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import type { Chat, DraftColor, RichTextEntity, SavedDraft, Template } from '@/types';
import { getScheduleDateTimeAfter, MAX_SCHEDULE_OCCURRENCES, type ScheduleRepeatOptions } from '@/lib/scheduling';
import { InlineKeyboardBuilder } from '@/components/InlineKeyboardBuilder';
import { DraftColorPicker } from '@/components/DraftColorPicker';
import type { InlineButtonRow } from '@/lib/inlineKeyboard';

const chatTypeLabels: Record<NonNullable<Chat['type']>, string> = {
  private: 'Private chat',
  group: 'Group chat',
  supergroup: 'Supergroup',
  channel: 'Channel',
  unknown: 'Chat',
};

const timeOptions = Array.from({ length: 96 }, (_, index) => {
  const hour = Math.floor(index / 4);
  const minute = (index % 4) * 15;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
});

const FAVORITE_CHATS_STORAGE_KEY = 'xmsgi_favorite_chats';
const LEGACY_FAVORITE_CHATS_STORAGE_KEY = 'awaitmsg_favorite_chats';

function getLocalTimezoneLabel() {
  const now = new Date();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const offsetMinutes = -now.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absoluteMinutes = Math.abs(offsetMinutes);
  const offsetHours = Math.floor(absoluteMinutes / 60);
  const offsetRemainder = absoluteMinutes % 60;
  const offset = `UTC${sign}${String(offsetHours).padStart(2, '0')}:${String(offsetRemainder).padStart(2, '0')}`;
  const country = timezone === 'Europe/Helsinki' ? 'Finland' : timezone;

  return `${country} · ${offset}`;
}

function getDraftAttachmentSummary(draft: SavedDraft): string {
  const attachments = draft.attachments ?? [];
  if (attachments.length === 0) {
    return '';
  }

  const photoCount = attachments.filter((attachment) => /\.(?:avif|gif|jpe?g|png|webp)$/i.test(attachment.name)).length;
  const fileCount = attachments.length - photoCount;

  if (attachments.length === 1) {
    return photoCount === 1 ? '1 photo' : '1 file';
  }

  if (photoCount === attachments.length) {
    return `${attachments.length} photos`;
  }

  if (fileCount === attachments.length) {
    return `${attachments.length} files`;
  }

  return `${attachments.length} media`;
}

interface Props {
  mode: 'editor' | 'schedule' | 'template' | 'draft' | 'chat' | 'buttons';
  scheduleFocus?: 'repeat' | 'time' | null;
  onModeChange: (mode: 'editor' | 'schedule' | 'template' | 'draft' | 'chat' | 'buttons') => void;
  selectedChat: Chat | null;
  chats: Chat[];
  selectedChats: Chat[];
  onChatSelectionChange: (chats: Chat[]) => void;
  onChatSelectionDone: () => void;
  onChatSelectionBack: () => void;
  onChatError: (message: string) => void;
  onAddChat: (chat: Chat) => void;
  onRemoveChat: (chat: Chat) => void;
  draftBody: string;
  draftEntities: RichTextEntity[];
  date: string;
  time: string;
  setDate: Dispatch<SetStateAction<string>>;
  setTime: Dispatch<SetStateAction<string>>;
  scheduling: boolean;
  canSchedule: boolean;
  onSchedule: (entities: RichTextEntity[], repeat: ScheduleRepeatOptions) => void;
  repeatMode: ScheduleRepeatOptions['mode'];
  setRepeatMode: Dispatch<SetStateAction<ScheduleRepeatOptions['mode']>>;
  repeatDays: string[];
  setRepeatDays: Dispatch<SetStateAction<string[]>>;
  repeatOccurrences: number;
  setRepeatOccurrences: Dispatch<SetStateAction<number>>;
  templates: Template[];
  onInsertTemplate: (body: string) => void;
  templateEditingId: string | null;
  templateDraftName: string;
  setTemplateDraftName: Dispatch<SetStateAction<string>>;
  templateDraftBody: string;
  setTemplateDraftBody: Dispatch<SetStateAction<string>>;
  openTemplateEditor: (template?: Template) => void;
  onDeleteTemplate: (template: Template) => void;
  closeTemplateEditor: () => void;
  saveTemplateStage: () => void;
  savedDrafts: SavedDraft[];
  onInsertDraft: (draft: SavedDraft) => void;
  draftEditingId: string | null;
  draftColor: DraftColor;
  setDraftColor: Dispatch<SetStateAction<DraftColor>>;
  draftName: string;
  setDraftName: Dispatch<SetStateAction<string>>;
  draftBodyText: string;
  setDraftBodyText: Dispatch<SetStateAction<string>>;
  openDraftEditor: (draft?: SavedDraft) => void;
  onDeleteDraft: (draft: SavedDraft) => void;
  closeDraftEditor: () => void;
  saveDraftStage: () => void;
  draftStoreReady: boolean;
  draftStoreSaving: boolean;
  onExportDrafts: () => void;
  onImportDrafts: () => void;
  onImportEditorText: () => void;
  inlineButtons: InlineButtonRow[];
  setInlineButtons: (rows: InlineButtonRow[]) => void;
}

export function WorkspaceTextStage({
  mode,
  scheduleFocus = null,
  onModeChange,
  chats,
  selectedChats,
  onChatSelectionChange,
  onChatSelectionDone,
  onChatSelectionBack,
  onChatError,
  onAddChat,
  onRemoveChat,
  date,
  time,
  setDate,
  setTime,
  repeatMode,
  setRepeatMode,
  repeatDays,
  setRepeatDays,
  repeatOccurrences,
  setRepeatOccurrences,
  templates,
  onInsertTemplate,
  templateEditingId,
  templateDraftName,
  setTemplateDraftName,
  templateDraftBody,
  setTemplateDraftBody,
  openTemplateEditor,
  onDeleteTemplate,
  closeTemplateEditor,
  saveTemplateStage,
  savedDrafts,
  onInsertDraft,
  draftEditingId,
  draftColor,
  setDraftColor,
  draftName,
  setDraftName,
  draftBodyText,
  setDraftBodyText,
  openDraftEditor,
  onDeleteDraft,
  closeDraftEditor,
  saveDraftStage,
  draftStoreReady,
  draftStoreSaving,
  onExportDrafts,
  onImportDrafts,
  onImportEditorText,
  inlineButtons,
  setInlineButtons,
}: Props) {
  const [showAddChat, setShowAddChat] = useState(false);
  const [addChatQuery, setAddChatQuery] = useState('');
  const [showChatSearch, setShowChatSearch] = useState(false);
  const [chatSearchQuery, setChatSearchQuery] = useState('');
  const [addingChat, setAddingChat] = useState(false);
  const [failedAvatarSources, setFailedAvatarSources] = useState<Set<string>>(() => new Set());
  const [scheduleDateDraft, setScheduleDateDraft] = useState<{ year: string; month: string; day: string } | null>(null);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [timePickerOpen, setTimePickerOpen] = useState(false);
  const [timePickerPosition, setTimePickerPosition] = useState({ top: 0, left: 0 });
  const timePickerRef = useRef<HTMLDivElement | null>(null);
  const [favoriteChatIds, setFavoriteChatIds] = useState<string[]>(() => {
    try {
      const primaryRaw = window.localStorage.getItem(FAVORITE_CHATS_STORAGE_KEY);
      const raw = primaryRaw ?? window.localStorage.getItem(LEGACY_FAVORITE_CHATS_STORAGE_KEY);
      if (raw === null) return [];
      if (!primaryRaw) {
        window.localStorage.setItem(FAVORITE_CHATS_STORAGE_KEY, raw);
      }
      const stored = JSON.parse(raw);
      return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string') : [];
    } catch {
      return [];
    }
  });
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);

  useEffect(() => {
    if (mode === 'chat') {
      onChatError('');
      setShowChatSearch(false);
      setChatSearchQuery('');
      setShowAddChat(false);
      setAddChatQuery('');
    }
  }, [mode]);

  useEffect(() => {
    const serialized = JSON.stringify(favoriteChatIds);
    window.localStorage.setItem(FAVORITE_CHATS_STORAGE_KEY, serialized);
    window.localStorage.setItem(LEGACY_FAVORITE_CHATS_STORAGE_KEY, serialized);
  }, [favoriteChatIds]);

  useEffect(() => {
    setDatePickerOpen(false);
    setTimePickerOpen(false);
  }, [mode, scheduleFocus]);

  const visibleSelectedChats = selectedChats.filter((chat) => chats.some((item) => item.id === chat.id));
  const filteredChats = chats.filter((chat) => {
    if (showFavoritesOnly && !favoriteChatIds.includes(chat.id)) return false;

    const query = chatSearchQuery.trim().toLowerCase();
    if (!query) return true;

    return `${chat.name} ${chat.username || ''}`.toLowerCase().includes(query);
  });
  const toggleChat = (chat: Chat) => {
    onChatSelectionChange([chat]);
  };
  const toggleFavoriteChat = (chat: Chat) => {
    setFavoriteChatIds((current) => current.includes(chat.id)
      ? current.filter((id) => id !== chat.id)
      : [...current, chat.id]);
  };

  const addChat = async () => {
    if (!addChatQuery.trim() || addingChat) return;

    setAddingChat(true);
    onChatError('');
    try {
      const result = await window.telegram.findChat(addChatQuery.trim());
      if (!result.success || !result.chat) {
        const message = result.error || 'That chat could not be found.';
        onChatError(message);
        return;
      }

      const chat: Chat = {
        id: String(result.chat.id),
        name: result.chat.name,
        username: result.chat.username || '',
        type: result.chat.type || 'unknown',
        avatarDataUrl: result.chat.avatarDataUrl || '',
      };
      onAddChat(chat);
      onChatSelectionChange([chat]);
      onChatError('');
      setAddChatQuery('');
      setShowAddChat(false);
    } catch {
      const message = 'Telegram could not be reached. Try again.';
      onChatError(message);
    } finally {
      setAddingChat(false);
    }
  };
  const scheduleDateInputRef = useRef<HTMLInputElement | null>(null);
  const timePickerButtonRef = useRef<HTMLButtonElement | null>(null);
  const openScheduleDatePicker = () => {
    const input = scheduleDateInputRef.current;
    if (!input) return;

    if (datePickerOpen) {
      input.blur();
      setDatePickerOpen(false);
      return;
    }

    setTimePickerOpen(false);
    if (typeof input.showPicker === 'function') {
      input.showPicker();
    } else {
      input.click();
    }
    setDatePickerOpen(true);
  };
  const openScheduleTimePicker = () => {
    setDatePickerOpen(false);
    setTimePickerOpen((current) => !current);
  };

  useEffect(() => {
    if (!timePickerOpen) return undefined;

    const updateTimePickerPosition = () => {
      const button = timePickerButtonRef.current;
      if (!button) return;

      const bounds = button.getBoundingClientRect();
      const pickerHeight = Math.min(220, window.innerHeight - 16);
      const spaceBelow = window.innerHeight - bounds.bottom - 8;
      const top = spaceBelow >= pickerHeight
        ? bounds.bottom + 8
        : Math.max(8, bounds.top - pickerHeight - 8);
      setTimePickerPosition({
        top,
        left: Math.min(
          Math.max(8, bounds.left),
          Math.max(8, window.innerWidth - 188),
        ),
      });
    };

    updateTimePickerPosition();
    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        !timePickerButtonRef.current?.contains(target)
        && !timePickerRef.current?.contains(target)
      ) {
        setTimePickerOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setTimePickerOpen(false);
      timePickerButtonRef.current?.focus();
    };
    window.addEventListener('resize', updateTimePickerPosition);
    window.addEventListener('scroll', updateTimePickerPosition, true);
    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('resize', updateTimePickerPosition);
      window.removeEventListener('scroll', updateTimePickerPosition, true);
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [timePickerOpen]);
  const scheduleTimeLabel = time
    ? new Date(`2000-01-01T${time}`).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : 'Choose time';
  const scheduleDateLabel = date
    ? new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${date}T12:00:00`))
    : 'Choose date';
  const scheduleRepeatLabel = {
    none: "Doesn't repeat",
    daily: 'Every day',
    weekly: `Every week${repeatDays.length ? ` · ${repeatDays.join(', ')}` : ''}`,
    biweekly: `Every 2 weeks${repeatDays.length ? ` · ${repeatDays.join(', ')}` : ''}`,
    monthly: `Every month${date ? ` · day ${new Date(`${date}T12:00:00`).getDate()}` : ''}`,
  }[repeatMode];
  const quickTimePresets = [
    { label: '+1m', minutes: 0 },
    { label: '+15m', minutes: 15 },
    { label: '+30m', minutes: 30 },
    { label: '+1h', minutes: 60 },
  ];
  const repeatModePresets: Array<{ label: string; value: ScheduleRepeatOptions['mode'] }> = [
    { label: "Doesn't repeat", value: 'none' },
    { label: 'Daily', value: 'daily' },
    { label: 'Weekly', value: 'weekly' },
    { label: 'Bi-weekly', value: 'biweekly' },
    { label: 'Monthly', value: 'monthly' },
  ];
  const repeatOccurrenceOptions = [1, 3, 5, 10, MAX_SCHEDULE_OCCURRENCES];
  const weekdayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const activeScheduleFocus = scheduleFocus === 'repeat' ? 'repeat' : 'time';
  const displayRepeatSummary = repeatMode === 'none'
    ? 'No repeat'
    : `${scheduleRepeatLabel}${repeatMode === 'monthly' ? '' : ` · ${repeatOccurrences}x`}`;
  const scheduleHeaderDetails = activeScheduleFocus === 'repeat' && repeatMode !== 'none'
    ? `${scheduleDateLabel} · ${scheduleTimeLabel} · ${displayRepeatSummary}`
    : `${scheduleDateLabel} · ${scheduleTimeLabel}`;
  const [scheduleYear, scheduleMonth, scheduleDay] = (date || '2026-01-01').split('-');
  const currentDateSegments = scheduleDateDraft ?? {
    year: scheduleYear || String(new Date().getFullYear()),
    month: scheduleMonth || '01',
    day: scheduleDay || '01',
  };
  const isValidDateSegments = (segments: typeof currentDateSegments) => {
    if (!/^\d{4}$/.test(segments.year)) return false;
    const month = Number(segments.month);
    const day = Number(segments.day);
    if (month < 1 || month > 12 || day < 1 || day > 31) return false;
    const candidate = new Date(`${segments.year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T12:00:00`);
    return candidate.getFullYear() === Number(segments.year)
      && candidate.getMonth() + 1 === month
      && candidate.getDate() === day;
  };
  const updateScheduleDateSegment = (segment: 'day' | 'month' | 'year', value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, segment === 'year' ? 4 : 2);
    const nextSegments = { ...currentDateSegments, [segment]: digits };
    setScheduleDateDraft(nextSegments);

    if (isValidDateSegments(nextSegments)) {
      setDate(`${nextSegments.year}-${String(Number(nextSegments.month)).padStart(2, '0')}-${String(Number(nextSegments.day)).padStart(2, '0')}`);
      setScheduleDateDraft(null);
    }
  };
  const commitScheduleDate = () => {
    if (scheduleDateDraft && isValidDateSegments(scheduleDateDraft)) {
      setDate(`${scheduleDateDraft.year}-${String(Number(scheduleDateDraft.month)).padStart(2, '0')}-${String(Number(scheduleDateDraft.day)).padStart(2, '0')}`);
    } else if (scheduleDateDraft) {
      setScheduleDateDraft(null);
    }
  };
  const selectRepeatMode = (nextMode: ScheduleRepeatOptions['mode']) => {
    setRepeatMode(nextMode);
    if (nextMode === 'none') {
      setRepeatDays([]);
      return;
    }

    if ((nextMode === 'weekly' || nextMode === 'biweekly') && repeatDays.length === 0 && date) {
      const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(new Date(`${date}T12:00:00`));
      setRepeatDays([weekday]);
    }
  };
  return (
    <>
      <div className={`workspace-page-rich-text-stage-view workspace-page-rich-text-schedule-stage ${mode === 'schedule' ? 'is-active' : ''} is-${activeScheduleFocus}-focus`} aria-hidden={mode !== 'schedule'}>
        <header className="workspace-page-stage-header workspace-page-schedule-header">
          <div className="workspace-page-schedule-header-title">
            <strong>Schedule</strong>
            <span className="workspace-page-schedule-header-time">{scheduleHeaderDetails}</span>
          </div>
          <span className="workspace-page-schedule-timezone">{getLocalTimezoneLabel()}</span>
        </header>

        <div className={`workspace-page-stage-main workspace-page-schedule-main workspace-page-schedule-empty-panel workspace-page-schedule-${activeScheduleFocus}-focus-panel`} aria-label={`${activeScheduleFocus === 'time' ? 'Time' : 'Repeat'} schedule settings`}>
            {activeScheduleFocus === 'time' && (
              <>
                <div className="workspace-page-schedule-inline-row">
                  <div className="workspace-page-schedule-inline-field workspace-page-schedule-inline-date">
                <input
                  ref={scheduleDateInputRef}
                  aria-label="Schedule date picker"
                  className="workspace-page-schedule-date-native-input"
                  type="date"
                  value={date || ''}
                  onChange={(event) => {
                    setDate(event.target.value || date);
                    setDatePickerOpen(false);
                  }}
                  onClick={(event) => event.stopPropagation()}
                />
                <button type="button" className="workspace-page-schedule-icon-button" aria-label="Open date picker" onClick={openScheduleDatePicker} tabIndex={0}>
                  <CalendarDays className="workspace-page-schedule-field-icon" size={15} strokeWidth={1.8} />
                </button>
                <div className="workspace-page-schedule-inline-value workspace-page-schedule-date-value">
                  <input
                    aria-label="Day"
                    className="workspace-page-schedule-segment"
                    type="text"
                    inputMode="numeric"
                    maxLength={2}
                    value={currentDateSegments.day}
                    onChange={(event) => updateScheduleDateSegment('day', event.target.value)}
                    onBlur={commitScheduleDate}
                  />
                  <span className="workspace-page-schedule-separator">/</span>
                  <input
                    aria-label="Month"
                    className="workspace-page-schedule-segment"
                    type="text"
                    inputMode="numeric"
                    maxLength={2}
                    value={currentDateSegments.month}
                    onChange={(event) => updateScheduleDateSegment('month', event.target.value)}
                    onBlur={commitScheduleDate}
                  />
                  <span className="workspace-page-schedule-separator">/</span>
                  <input
                    aria-label="Year"
                    className="workspace-page-schedule-segment workspace-page-schedule-segment-year"
                    type="text"
                    inputMode="numeric"
                    maxLength={4}
                    value={currentDateSegments.year}
                    onChange={(event) => updateScheduleDateSegment('year', event.target.value)}
                    onBlur={commitScheduleDate}
                  />
                </div>
                  </div>
                  <label className="workspace-page-schedule-inline-field workspace-page-schedule-inline-time">
                    <button ref={timePickerButtonRef} type="button" className="workspace-page-schedule-icon-button" aria-label="Open time picker" aria-haspopup="listbox" aria-expanded={timePickerOpen} onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      openScheduleTimePicker();
                    }} tabIndex={0}>
                      <Clock className="workspace-page-schedule-field-icon" size={15} strokeWidth={1.8} />
                    </button>
                    {timePickerOpen && createPortal(
                      <div
                        ref={timePickerRef}
                        className="workspace-page-schedule-time-picker"
                        role="listbox"
                        aria-label="Available times"
                        style={{ top: timePickerPosition.top, left: timePickerPosition.left }}
                      >
                        {timeOptions.map((option) => (
                          <button
                            key={option}
                            type="button"
                            role="option"
                            aria-selected={time === option}
                            className={time === option ? 'is-selected' : ''}
                            onClick={() => {
                              setTime(option);
                              setTimePickerOpen(false);
                            }}
                          >
                            {option}
                          </button>
                        ))}
                      </div>,
                      document.body,
                    )}
                    <input
                      aria-label="Schedule time"
                      type="time"
                      value={time || ''}
                      onChange={(event) => {
                        setTime(event.target.value);
                        setTimePickerOpen(false);
                      }}
                    />
                  </label>
                </div>
              </>
            )}

            {activeScheduleFocus === 'time' ? (
              <div className="workspace-page-schedule-quick-panel">
                <div className="workspace-page-schedule-options-heading">Quick time</div>
                <div className="workspace-page-schedule-quick-row">
                  {quickTimePresets.map((preset) => (
                    <button key={preset.label} type="button" aria-label={`Set time ${preset.label}`} onClick={() => {
                      const scheduledAt = getScheduleDateTimeAfter(preset.minutes);
                      setDate(scheduledAt.date);
                      setTime(scheduledAt.time);
                    }}>
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <section className="workspace-page-schedule-repeat-panel">
                <div className="workspace-page-schedule-row-heading workspace-page-schedule-repeat-heading">
                  <span>Repeat</span>
                  {repeatMode !== 'none' && <strong>{displayRepeatSummary}</strong>}
                </div>
                <div className="workspace-page-schedule-repeat-menu">
                  {repeatModePresets.map((preset) => (
                    <button
                      key={preset.value}
                      type="button"
                      className={repeatMode === preset.value ? 'is-selected' : ''}
                      onClick={() => selectRepeatMode(preset.value)}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                {(repeatMode === 'weekly' || repeatMode === 'biweekly') && (
                  <div className="workspace-page-schedule-repeat-meta">
                    <div className="workspace-page-weekday-list">
                      {weekdayNames.map((weekday) => (
                        <button
                          key={weekday}
                          type="button"
                          className={repeatDays.includes(weekday) ? 'is-selected' : ''}
                          onClick={() => setRepeatDays((current) => current.includes(weekday)
                            ? current.filter((day) => day !== weekday)
                            : [...current, weekday])}
                        >
                          {weekday}
                        </button>
                      ))}
                    </div>
                    <label className="workspace-page-schedule-occurrences">
                      <span>Runs</span>
                      <select
                        aria-label="Repeat occurrences"
                        value={repeatOccurrences}
                        onChange={(event) => setRepeatOccurrences(Number(event.target.value))}
                      >
                        {repeatOccurrenceOptions.map((occurrences) => (
                          <option key={occurrences} value={occurrences}>{occurrences} times</option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}
                {repeatMode !== 'none' && repeatMode !== 'weekly' && repeatMode !== 'biweekly' && (
                  <label className="workspace-page-schedule-occurrences">
                    <span>Runs</span>
                    <select
                      aria-label="Repeat occurrences"
                      value={repeatOccurrences}
                      onChange={(event) => setRepeatOccurrences(Number(event.target.value))}
                    >
                      {repeatOccurrenceOptions.map((occurrences) => (
                        <option key={occurrences} value={occurrences}>{occurrences} times</option>
                      ))}
                    </select>
                  </label>
                )}
              </section>
            )}

        </div>

        <div className="workspace-page-stage-actions workspace-page-template-stage-footer workspace-page-schedule-footer">
          <button type="button" className="workspace-page-stage-secondary" onClick={() => onModeChange('editor')}>← Back</button>
          <div className="workspace-page-template-stage-footer-actions">
            <button type="button" className="workspace-page-stage-primary" onClick={() => onModeChange('editor')}>Done</button>
          </div>
        </div>
      </div>

      <div className={`workspace-page-rich-text-stage-view workspace-page-rich-text-template-stage ${mode === 'template' ? 'is-active' : ''}`} aria-hidden={mode !== 'template'}>
        <header className="workspace-page-stage-header workspace-page-template-stage-header">
          <strong>{templateEditingId ? 'Template' : 'Templates'}</strong>
          <span>{templateEditingId ? 'Edit saved content' : `${templates.length} saved`}</span>
        </header>
        {templateEditingId ? (
          <form id="workspace-template-editor-form" className="workspace-page-stage-main workspace-page-template-stage-editor" onSubmit={(event) => { event.preventDefault(); saveTemplateStage(); }}>
            <label>
              <span>Name</span>
              <input
                type="text"
                value={templateDraftName}
                onChange={(event) => setTemplateDraftName(event.target.value)}
                aria-label="Template name"
                autoFocus
              />
            </label>
            <label>
              <span>Body</span>
              <textarea value={templateDraftBody} onChange={(event) => setTemplateDraftBody(event.target.value)} rows={5} />
            </label>
          </form>
        ) : (
          <div className="workspace-page-stage-main workspace-page-template-stage-list-area">
            <div className="workspace-page-template-stage-list">
              {templates.length > 0 ? templates.map((template) => (
                <div className="workspace-page-template-stage-item" key={template.id}>
                  <button type="button" onClick={() => { onInsertTemplate(template.body); onModeChange('editor'); }}>
                    <strong>{template.name}</strong>
                    <span>{template.body.length} characters</span>
                  </button>
                  <div>
                    <button type="button" onClick={() => openTemplateEditor(template)}>Edit</button>
                    <button type="button" onClick={() => onDeleteTemplate(template)}>Delete</button>
                  </div>
                </div>
              )) : <div className="workspace-page-template-stage-empty">No templates yet.</div>}
            </div>
          </div>
        )}
        <footer className="workspace-page-stage-actions workspace-page-template-stage-footer">
          <button type="button" className="workspace-page-stage-secondary" onClick={templateEditingId ? closeTemplateEditor : () => onModeChange('editor')}>← Back</button>
          <div className="workspace-page-template-stage-footer-actions">
            {templateEditingId ? (
              <button type="submit" form="workspace-template-editor-form" className="workspace-page-stage-primary" disabled={!templateDraftName.trim() || !templateDraftBody.trim()}>
                Save
              </button>
            ) : (
              <button type="button" className="workspace-page-stage-primary" onClick={() => openTemplateEditor()}>+ New template</button>
            )}
          </div>
        </footer>
      </div>

      <div className={`workspace-page-rich-text-stage-view workspace-page-rich-text-template-stage workspace-page-rich-text-draft-stage ${mode === 'draft' ? 'is-active' : ''}`} aria-hidden={mode !== 'draft'}>
        <header className="workspace-page-stage-header workspace-page-template-stage-header">
          <strong>{draftEditingId ? 'Draft' : 'Saved Drafts'}</strong>
          <span>{draftEditingId ? 'Edit saved content' : `${savedDrafts.length} saved · ${draftStoreSaving ? 'Saving…' : draftStoreReady ? 'Saved locally' : 'Loading…'}`}</span>
        </header>
        {draftEditingId ? (
          <form id="workspace-draft-editor-form" className="workspace-page-stage-main workspace-page-template-stage-editor" onSubmit={(event) => { event.preventDefault(); saveDraftStage(); }}>
            <div className="workspace-page-draft-name-row">
              <label className="workspace-page-draft-name-field">
                <span>Name</span>
                <input
                  type="text"
                  value={draftName}
                  onChange={(event) => setDraftName(event.target.value)}
                  aria-label="Draft name"
                  autoFocus
                />
              </label>
              <div className="workspace-page-draft-color-field">
                <DraftColorPicker color={draftColor} onChange={setDraftColor} ariaLabel="Saved draft color" />
              </div>
            </div>
            <label>
              <span>Body</span>
              <textarea value={draftBodyText} onChange={(event) => setDraftBodyText(event.target.value)} rows={5} aria-label="Draft body" />
            </label>
          </form>
        ) : (
          <div className="workspace-page-stage-main workspace-page-template-stage-list-area">
            <div className="workspace-page-template-stage-list">
              {savedDrafts.length > 0 ? savedDrafts.map((draft) => {
                const attachmentSummary = getDraftAttachmentSummary(draft);
                return (
                  <div className="workspace-page-template-stage-item" key={draft.id}>
                    <button type="button" onClick={() => onInsertDraft(draft)}>
                      <strong>
                        <span className="workspace-page-draft-color-dot" data-color={draft.color ?? 'gray'} aria-hidden="true" />
                        {draft.name}
                      </strong>
                      <span>
                        {draft.body.length} characters{attachmentSummary ? ` · ${attachmentSummary}` : ''}
                      </span>
                    </button>
                    <div>
                      <button type="button" onClick={() => openDraftEditor(draft)}>Edit</button>
                      <button type="button" onClick={() => onDeleteDraft(draft)}>Delete</button>
                    </div>
                  </div>
                );
              }) : <div className="workspace-page-template-stage-empty">No drafts yet.</div>}
            </div>
          </div>
        )}
        <footer className="workspace-page-stage-actions workspace-page-template-stage-footer workspace-page-draft-stage-footer">
          <div className="workspace-page-draft-stage-footer-left">
            <button type="button" className="workspace-page-stage-secondary" onClick={draftEditingId ? closeDraftEditor : () => onModeChange('editor')}>← Back</button>
            {!draftEditingId && (
              <>
                <button type="button" className="workspace-page-stage-secondary" onClick={onImportEditorText} aria-label="Import text into editor" title="Import a .txt file into the editor">
                  <Upload size={15} strokeWidth={1.8} aria-hidden="true" /> Import .txt
                </button>
              </>
            )}
          </div>
          <div className="workspace-page-template-stage-footer-actions">
            {draftEditingId ? (
              <button type="submit" form="workspace-draft-editor-form" className="workspace-page-stage-primary" disabled={!draftStoreReady || draftStoreSaving || !draftName.trim() || !draftBodyText.trim()}>
                {draftStoreSaving ? 'Saving…' : 'Save'}
              </button>
            ) : (
              <>
                <button type="button" className="workspace-page-stage-secondary" onClick={onExportDrafts} disabled={!draftStoreReady || draftStoreSaving}>Export all drafts</button>
                <button type="button" className="workspace-page-stage-secondary" onClick={onImportDrafts} disabled={!draftStoreReady || draftStoreSaving}>Import drafts</button>
                <button type="button" className="workspace-page-stage-primary" onClick={() => openDraftEditor()} disabled={!draftStoreReady || draftStoreSaving}>+ New draft</button>
              </>
            )}
          </div>
        </footer>
      </div>

      <div className={`workspace-page-rich-text-stage-view workspace-page-rich-text-buttons-stage ${mode === 'buttons' ? 'is-active' : ''}`} aria-hidden={mode !== 'buttons'}>
        <InlineKeyboardBuilder rows={inlineButtons} onChange={setInlineButtons} open={mode === 'buttons'} onClose={() => onModeChange('editor')} />
      </div>

      <div className={`workspace-page-rich-text-stage-view workspace-page-rich-text-chat-stage ${mode === 'chat' ? 'is-active' : ''}`} aria-hidden={mode !== 'chat'}>
        <header className="workspace-page-stage-header workspace-page-chat-stage-header">
          <strong>Channel</strong>
          <span>{visibleSelectedChats.length > 0 ? 'Selected chat or channel' : 'Choose one chat or channel for this post'}</span>
        </header>

        <div className="workspace-page-stage-main workspace-page-chat-stage-main">
          <div className="workspace-page-chat-stage-list" role="listbox" aria-label="Choose a Telegram chat" aria-multiselectable="false">
            {filteredChats.length > 0 ? filteredChats.map((chat) => {
            const selected = visibleSelectedChats.some((item) => item.id === chat.id);
            const favorite = favoriteChatIds.includes(chat.id);
            const avatarSource = chat.avatarDataUrl || '';
            const avatarFailed = Boolean(avatarSource && failedAvatarSources.has(avatarSource));
            return (
              <div
                key={chat.id}
                className={`workspace-page-chat-stage-item ${selected ? 'is-selected' : ''}`}
                role="option"
                aria-selected={selected}
                tabIndex={0}
                onClick={() => toggleChat(chat)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    toggleChat(chat);
                  }
                }}
              >
                <span className={`workspace-page-chat-stage-avatar ${avatarFailed ? 'is-broken' : ''}`} aria-hidden="true">
                  {avatarSource && !avatarFailed ? (
                    <img
                      src={avatarSource}
                      alt=""
                      onError={() => setFailedAvatarSources((current) => new Set(current).add(avatarSource))}
                    />
                  ) : avatarFailed ? chat.name.slice(0, 1).toUpperCase() : <MessageCircle size={15} strokeWidth={1.8} />}
                </span>
                <span className="workspace-page-chat-stage-copy">
                  <strong>{chat.name}</strong>
                  <span>{chat.name === 'Saved Messages' ? 'Saved Messages' : chatTypeLabels[chat.type || 'unknown']}{chat.username ? ` · @${chat.username}` : ''}</span>
                </span>
                <span className="workspace-page-chat-stage-check" aria-hidden="true">{selected ? '✓' : ''}</span>
                <button
                  type="button"
                  className={`workspace-page-chat-stage-favorite ${favorite ? 'is-favorite' : ''}`}
                  onClick={(event) => { event.stopPropagation(); toggleFavoriteChat(chat); }}
                  aria-label={`${favorite ? 'Remove' : 'Add'} ${chat.name} ${favorite ? 'from' : 'to'} favorites`}
                  aria-pressed={favorite}
                >
                  <Star size={15} strokeWidth={1.8} fill={favorite ? 'currentColor' : 'none'} />
                </button>
                <button type="button" className="workspace-page-chat-stage-remove" onClick={(event) => { event.stopPropagation(); onRemoveChat(chat); }} aria-label={`Remove ${chat.name} from saved chats`}>×</button>
              </div>
            );
            }) : (
              <div className="workspace-page-chat-stage-empty" role="status">
                <strong>{chats.length === 0 ? 'No chats saved yet' : showFavoritesOnly ? 'No favorite chats yet' : 'No chats found'}</strong>
                <span>{chats.length === 0 ? 'Add a Telegram chat to continue.' : showFavoritesOnly ? 'Mark a chat with the star to add it here.' : 'Try another name or username.'}</span>
              </div>
            )}
          </div>

          {showAddChat && (
            <div className="workspace-page-chat-stage-add-form">
              <input value={addChatQuery} onChange={(event) => setAddChatQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void addChat(); } }} placeholder="@username or chat name" aria-label="Chat name or username" autoFocus />
              <button type="button" onClick={() => void addChat()} disabled={addingChat}>{addingChat ? 'Adding…' : 'Add'}</button>
            </div>
          )}

          {showChatSearch && (
            <div className="workspace-page-chat-stage-search">
              <input
                type="search"
                value={chatSearchQuery}
                onChange={(event) => setChatSearchQuery(event.target.value)}
                placeholder="Find a chat or channel"
                aria-label="Find a chat or channel"
                autoFocus
              />
            </div>
          )}
        </div>

        <div className="workspace-page-stage-actions workspace-page-chat-stage-footer">
          <div className="workspace-page-chat-stage-footer-left">
            <button type="button" className="workspace-page-stage-secondary" onClick={onChatSelectionBack}>← Back</button>
            <button type="button" className="workspace-page-chat-stage-add" onClick={() => { setShowAddChat((current) => { if (!current) setShowChatSearch(false); return !current; }); onChatError(''); }} aria-expanded={showAddChat}>
              <span aria-hidden="true">+</span> Add another chat
            </button>
            <button type="button" className="workspace-page-chat-stage-add" onClick={() => { setShowChatSearch((current) => { if (!current) setShowAddChat(false); return !current; }); onChatError(''); }} aria-expanded={showChatSearch}>
              <Search size={13} strokeWidth={1.8} /> Find a chat
            </button>
          </div>
          <div className="workspace-page-chat-stage-footer-right">
            <button
              type="button"
              className={`workspace-page-chat-favorites-filter ${showFavoritesOnly ? 'is-active' : ''}`}
              onClick={() => {
                setShowFavoritesOnly((current) => !current);
                setShowAddChat(false);
                setShowChatSearch(false);
                setAddChatQuery('');
                setChatSearchQuery('');
                onChatError('');
              }}
              aria-pressed={showFavoritesOnly}
            >
              <Star size={13} strokeWidth={1.8} fill={showFavoritesOnly ? 'currentColor' : 'none'} /> Favorites
            </button>
            <button type="button" className="workspace-page-stage-primary" onClick={onChatSelectionDone}>Done</button>
          </div>
        </div>
      </div>
    </>
  );
}
