import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, Clock } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import { getScheduleDateTimeAfter, MAX_SCHEDULE_OCCURRENCES, type ScheduleRepeatOptions } from '@/lib/scheduling';
import { useLocale } from '@/lib/i18n';
import type { StageMode } from './types';

const timeOptions = Array.from({ length: 96 }, (_, index) => {
  const hour = Math.floor(index / 4);
  const minute = (index % 4) * 15;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
});

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

function formatLocalDate(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function formatStudioWeekday(day: string, locale: 'en' | 'ru') {
  const weekdayIndex = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(day);
  if (weekdayIndex < 0) return day;
  return new Intl.DateTimeFormat(locale === 'ru' ? 'ru-RU' : 'en-US', { weekday: 'short' })
    .format(new Date(Date.UTC(2023, 0, 1 + weekdayIndex)));
}

interface Props {
  mode: StageMode;
  scheduleFocus?: 'repeat' | 'time' | null;
  onModeChange: (mode: StageMode) => void;
  onScheduleDone?: () => void;
  date: string;
  time: string;
  setDate: Dispatch<SetStateAction<string>>;
  setTime: Dispatch<SetStateAction<string>>;
  repeatMode: ScheduleRepeatOptions['mode'];
  setRepeatMode: Dispatch<SetStateAction<ScheduleRepeatOptions['mode']>>;
  repeatDays: string[];
  setRepeatDays: Dispatch<SetStateAction<string[]>>;
  repeatOccurrences: number;
  setRepeatOccurrences: Dispatch<SetStateAction<number>>;
}

export function ScheduleStage({
  mode,
  scheduleFocus = null,
  onModeChange,
  onScheduleDone,
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
}: Props) {
  const { locale, t } = useLocale();
  const [scheduleDateDraft, setScheduleDateDraft] = useState<{ year: string; month: string; day: string } | null>(null);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [timePickerOpen, setTimePickerOpen] = useState(false);
  const [timePickerPosition, setTimePickerPosition] = useState({ top: 0, left: 0 });
  const timePickerRef = useRef<HTMLDivElement | null>(null);
  const scheduleDateInputRef = useRef<HTMLInputElement | null>(null);
  const scheduleDayInputRef = useRef<HTMLInputElement | null>(null);
  const scheduleMonthInputRef = useRef<HTMLInputElement | null>(null);
  const scheduleYearInputRef = useRef<HTMLInputElement | null>(null);
  const scheduleTimeInputRef = useRef<HTMLInputElement | null>(null);
  const timePickerButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    setScheduleDateDraft(null);
  }, [date, mode]);

  useEffect(() => {
    setDatePickerOpen(false);
    setTimePickerOpen(false);
  }, [mode, scheduleFocus]);

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
    ? new Date(`2000-01-01T${time}`).toLocaleTimeString(locale === 'ru' ? 'ru-RU' : 'en-US', { hour: '2-digit', minute: '2-digit' })
    : t('studio.chooseTime');
  const scheduleDateLabel = date
    ? new Intl.DateTimeFormat(locale === 'ru' ? 'ru-RU' : 'en-US', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${date}T12:00:00`))
    : t('studio.chooseDate');
  const scheduleRepeatLabel = {
    none: t('studio.repeatNone'),
    daily: t('studio.repeatDaily'),
    weekly: `${t('studio.repeatWeekly')}${repeatDays.length ? ` · ${repeatDays.map((day) => formatStudioWeekday(day, locale)).join(', ')}` : ''}`,
    biweekly: `${t('studio.repeatBiweekly')}${repeatDays.length ? ` · ${repeatDays.map((day) => formatStudioWeekday(day, locale)).join(', ')}` : ''}`,
    monthly: `${t('studio.repeatMonthly')}${date ? ` · ${t('studio.day').toLocaleLowerCase(locale === 'ru' ? 'ru-RU' : 'en-US')} ${new Date(`${date}T12:00:00`).getDate()}` : ''}`,
  }[repeatMode];
  const quickTimePresets = [
    { id: 'now', label: t('studio.now'), minutes: 0 },
    { id: '15m', label: t('studio.in15Minutes'), minutes: 15 },
    { id: '30m', label: t('studio.in30Minutes'), minutes: 30 },
    { id: '1h', label: t('studio.inOneHour'), minutes: 60 },
  ];
  const quickDatePresets = [
    { id: 'today', label: t('studio.today'), days: 0 },
    { id: 'day', label: t('studio.inOneDay'), days: 1 },
    { id: 'week', label: t('studio.inOneWeek'), days: 7 },
    { id: 'month', label: t('studio.inOneMonth'), months: 1 },
  ];
  const repeatModePresets: Array<{ label: string; value: ScheduleRepeatOptions['mode'] }> = [
    { label: t('studio.repeatNone'), value: 'none' },
    { label: t('studio.repeatDaily'), value: 'daily' },
    { label: t('studio.repeatWeekly'), value: 'weekly' },
    { label: t('studio.repeatBiweekly'), value: 'biweekly' },
    { label: t('studio.repeatMonthly'), value: 'monthly' },
  ];
  const repeatOccurrenceOptions = [1, 3, 5, 10, MAX_SCHEDULE_OCCURRENCES];
  const weekdayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const activeScheduleFocus = scheduleFocus === 'repeat' ? 'repeat' : 'time';
  const displayRepeatSummary = repeatMode === 'none'
    ? t('studio.repeatNone')
    : `${scheduleRepeatLabel}${repeatMode === 'monthly' ? '' : ` · ${t('studio.repeatCountSummary', { count: repeatOccurrences })}`}`;
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

    const segmentIsComplete = digits.length === (segment === 'year' ? 4 : 2);
    if (segmentIsComplete && isValidDateSegments(nextSegments)) {
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
    <div className={`workspace-page-rich-text-stage-view workspace-page-rich-text-schedule-stage ${mode === 'schedule' ? 'is-active' : ''} is-${activeScheduleFocus}-focus`} aria-hidden={mode !== 'schedule'}>
      <header className="workspace-page-stage-header workspace-page-schedule-header">
        <div className="workspace-page-schedule-header-title">
          <strong>{t('studio.scheduleStage')}</strong>
          <span className="workspace-page-schedule-header-time">{scheduleHeaderDetails}</span>
        </div>
        <span className="workspace-page-schedule-timezone">{getLocalTimezoneLabel()}</span>
      </header>

      <div className={`workspace-page-stage-main workspace-page-schedule-main workspace-page-schedule-empty-panel workspace-page-schedule-${activeScheduleFocus}-focus-panel`} aria-label={`${activeScheduleFocus === 'time' ? t('studio.time') : t('studio.repeat')} ${t('studio.scheduleTools').toLocaleLowerCase(locale === 'ru' ? 'ru-RU' : 'en-US')}`}>
        {activeScheduleFocus === 'time' && (
          <>
            <div className="workspace-page-schedule-inline-row">
              <div className="workspace-page-schedule-inline-field workspace-page-schedule-inline-date">
                <input
                  ref={scheduleDateInputRef}
                  aria-label={t('studio.scheduleDatePicker')}
                  className="workspace-page-schedule-date-native-input"
                  type="date"
                  value={date || ''}
                  onChange={(event) => {
                    setDate(event.target.value || date);
                    setDatePickerOpen(false);
                  }}
                  onClick={(event) => event.stopPropagation()}
                />
                <button type="button" className="workspace-page-schedule-icon-button" aria-label={t('studio.openDatePicker')} onClick={openScheduleDatePicker} tabIndex={0}>
                  <CalendarDays className="workspace-page-schedule-field-icon" size={15} strokeWidth={1.8} />
                </button>
                <div className="workspace-page-schedule-inline-value workspace-page-schedule-date-value">
                  <input
                    ref={scheduleDayInputRef}
                    aria-label={t('studio.day')}
                    className="workspace-page-schedule-segment"
                    type="text"
                    inputMode="numeric"
                    maxLength={2}
                    value={currentDateSegments.day}
                    onChange={(event) => updateScheduleDateSegment('day', event.target.value)}
                    onBlur={commitScheduleDate}
                    onKeyDown={(event) => {
                      if (event.key !== ' ') return;
                      event.preventDefault();
                      scheduleMonthInputRef.current?.focus();
                    }}
                  />
                  <span className="workspace-page-schedule-separator">/</span>
                  <input
                    ref={scheduleMonthInputRef}
                    aria-label={t('studio.month')}
                    className="workspace-page-schedule-segment"
                    type="text"
                    inputMode="numeric"
                    maxLength={2}
                    value={currentDateSegments.month}
                    onChange={(event) => updateScheduleDateSegment('month', event.target.value)}
                    onBlur={commitScheduleDate}
                    onKeyDown={(event) => {
                      if (event.key !== ' ') return;
                      event.preventDefault();
                      scheduleYearInputRef.current?.focus();
                    }}
                  />
                  <span className="workspace-page-schedule-separator">/</span>
                  <input
                    ref={scheduleYearInputRef}
                    aria-label={t('studio.year')}
                    className="workspace-page-schedule-segment workspace-page-schedule-segment-year"
                    type="text"
                    inputMode="numeric"
                    maxLength={4}
                    value={currentDateSegments.year}
                    onChange={(event) => updateScheduleDateSegment('year', event.target.value)}
                    onBlur={commitScheduleDate}
                    onKeyDown={(event) => {
                      if (event.key !== ' ') return;
                      event.preventDefault();
                      scheduleTimeInputRef.current?.focus();
                    }}
                  />
                </div>
              </div>
              <label className="workspace-page-schedule-inline-field workspace-page-schedule-inline-time">
                <button ref={timePickerButtonRef} type="button" className="workspace-page-schedule-icon-button" aria-label={t('studio.openTimePicker')} aria-haspopup="listbox" aria-expanded={timePickerOpen} onClick={(event) => {
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
                    aria-label={t('studio.availableTimes')}
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
                  ref={scheduleTimeInputRef}
                  aria-label={t('studio.scheduleTime')}
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
          <>
            <div className="workspace-page-schedule-quick-panel workspace-page-schedule-quick-date-panel">
              <div className="workspace-page-schedule-options-heading">{t('studio.quickDate')}</div>
              <div className="workspace-page-schedule-quick-row">
                {quickDatePresets.map((preset) => (
                  <button key={preset.id} type="button" aria-label={t('studio.setDate', { date: preset.label })} onClick={() => {
                    const selectedDate = preset.days === 0
                      ? new Date()
                      : date ? new Date(`${date}T12:00:00`) : new Date();
                    if (Number.isNaN(selectedDate.getTime())) return;

                    if (preset.months) {
                      const originalDay = selectedDate.getDate();
                      selectedDate.setDate(1);
                      selectedDate.setMonth(selectedDate.getMonth() + preset.months);
                      const finalDay = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0).getDate();
                      selectedDate.setDate(Math.min(originalDay, finalDay));
                    } else if (preset.days) {
                      selectedDate.setDate(selectedDate.getDate() + preset.days);
                    }

                    setDate(formatLocalDate(selectedDate));
                  }}>
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="workspace-page-schedule-quick-panel workspace-page-schedule-quick-time-panel">
              <div className="workspace-page-schedule-options-heading">{t('studio.quickTime')}</div>
              <div className="workspace-page-schedule-quick-row">
                {quickTimePresets.map((preset) => (
                  <button key={preset.id} type="button" aria-label={t('studio.setTime', { time: preset.label })} onClick={() => {
                    if (preset.id === 'now') {
                      const scheduledAt = getScheduleDateTimeAfter(0);
                      setDate(scheduledAt.date);
                      setTime(scheduledAt.time);
                      return;
                    }

                    const selectedSchedule = new Date(`${date}T${time}:00`);
                    if (!date || !time || Number.isNaN(selectedSchedule.getTime())) {
                      const scheduledAt = getScheduleDateTimeAfter(preset.minutes);
                      setDate(scheduledAt.date);
                      setTime(scheduledAt.time);
                      return;
                    }

                    selectedSchedule.setMinutes(selectedSchedule.getMinutes() + preset.minutes);
                    setDate(formatLocalDate(selectedSchedule));
                    setTime(`${String(selectedSchedule.getHours()).padStart(2, '0')}:${String(selectedSchedule.getMinutes()).padStart(2, '0')}`);
                  }}>
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : (
          <section className="workspace-page-schedule-repeat-panel">
            <div className="workspace-page-schedule-row-heading workspace-page-schedule-repeat-heading">
              <span>{t('studio.repeatMode')}</span>
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
                      {formatStudioWeekday(weekday, locale)}
                    </button>
                  ))}
                </div>
                <label className="workspace-page-schedule-occurrences">
                  <span>{t('studio.runs')}</span>
                  <select
                    aria-label={t('studio.repeatOccurrences')}
                    value={repeatOccurrences}
                    onChange={(event) => setRepeatOccurrences(Number(event.target.value))}
                  >
                    {repeatOccurrenceOptions.map((occurrences) => (
                      <option key={occurrences} value={occurrences}>{t('studio.repeatCountSummary', { count: occurrences })}</option>
                    ))}
                  </select>
                </label>
              </div>
            )}
            {repeatMode !== 'none' && repeatMode !== 'weekly' && repeatMode !== 'biweekly' && (
              <label className="workspace-page-schedule-occurrences">
                <span>{t('studio.runs')}</span>
                <select
                  aria-label={t('studio.repeatOccurrences')}
                  value={repeatOccurrences}
                  onChange={(event) => setRepeatOccurrences(Number(event.target.value))}
                >
                  {repeatOccurrenceOptions.map((occurrences) => (
                    <option key={occurrences} value={occurrences}>{t('studio.repeatCountSummary', { count: occurrences })}</option>
                  ))}
                </select>
              </label>
            )}
          </section>
        )}
      </div>

      <div className="workspace-page-stage-actions workspace-page-template-stage-footer workspace-page-schedule-footer">
        <button type="button" className="workspace-page-stage-secondary" onClick={() => onModeChange('editor')}>← {t('studio.back')}</button>
        <div className="workspace-page-template-stage-footer-actions">
          <button type="button" className="workspace-page-stage-primary" onClick={() => {
            onScheduleDone?.();
            onModeChange('editor');
          }}>{t('studio.done')}</button>
        </div>
      </div>
    </div>
  );
}