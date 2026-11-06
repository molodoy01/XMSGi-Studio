import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ScheduledMessage } from '@/types';
import { useLocale } from '@/lib/i18n';
import './QuickPlannerActivity.css';

type QuickPlannerActivityProps = {
  sent?: ScheduledMessage[];
  upcoming?: ScheduledMessage[];
  historyReady?: boolean;
  historyError?: boolean;
};

type ActivityPeriod = 7 | 30;
type ActivityView = 'sent' | 'scheduled' | 'all';
const WEEKLY_PLOT_TOP = 10;
const ACTIVITY_SCALE_STEPS = 5;
const WEEKLY_SCALE_LEVELS = 7;
const WEEKLY_LINE_EDGE_INSET_PX = 12;
const WEEKLY_LINE_FADE_PX = 24;
const WEEKLY_EDGE_SLOPE_FACTOR = 0.35;
const WEEKLY_LINE_MORPH_DURATION = 340;

function getLocalDateKey(date: Date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function getUniqueMessages(messages: ScheduledMessage[]) {
  const seen = new Set<string>();
  return messages.filter((message) => {
    const identity = message.sendAttemptId
      ? `attempt:${message.sendAttemptId}`
      : `message:${message.id}`;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function getActivityDays(messages: ScheduledMessage[], now: Date, period: ActivityPeriod) {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const firstDay = new Date(today);
  firstDay.setDate(firstDay.getDate() - (period - 1));
  const dates = Array.from({ length: period }, (_, index) => {
    const date = new Date(firstDay);
    date.setDate(firstDay.getDate() + index);
    return date;
  });
  const counts = new Map(dates.map((date) => [getLocalDateKey(date), 0]));
  const seen = new Set<string>();

  for (const message of messages) {
    if (message.status !== 'sent' || !message.sentAt) continue;
    const timestamp = Date.parse(message.sentAt);
    if (!Number.isFinite(timestamp) || timestamp > now.getTime() || timestamp < firstDay.getTime()) continue;

    const identity = message.sendAttemptId
      ? `attempt:${message.sendAttemptId}`
      : `message:${message.id}`;
    if (seen.has(identity)) continue;
    seen.add(identity);

    const key = getLocalDateKey(new Date(timestamp));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return dates.map((date) => ({ date, count: counts.get(getLocalDateKey(date)) ?? 0 }));
}

function getScheduledActivityDays(messages: ScheduledMessage[], now: Date, period: ActivityPeriod) {
  const firstDay = new Date(now);
  firstDay.setHours(0, 0, 0, 0);
  const dates = Array.from({ length: period }, (_, index) => {
    const date = new Date(firstDay);
    date.setDate(firstDay.getDate() + index);
    return date;
  });
  const counts = new Map(dates.map((date) => [getLocalDateKey(date), 0]));

  for (const message of messages) {
    const timestamp = Date.parse(message.when);
    if (message.status !== 'scheduled' || !Number.isFinite(timestamp) || timestamp <= now.getTime()) continue;

    const key = getLocalDateKey(new Date(timestamp));
    if (counts.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return dates.map((date) => ({ date, count: counts.get(getLocalDateKey(date)) ?? 0 }));
}

function getAllActivityDays(
  sent: ScheduledMessage[],
  scheduled: ScheduledMessage[],
  now: Date,
  period: ActivityPeriod,
) {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const firstDay = new Date(today);
  firstDay.setDate(firstDay.getDate() - Math.floor((period - 1) / 2));
  const dates = Array.from({ length: period }, (_, index) => {
    const date = new Date(firstDay);
    date.setDate(firstDay.getDate() + index);
    return date;
  });
  const counts = new Map(dates.map((date) => [getLocalDateKey(date), { sent: 0, scheduled: 0 }]));

  for (const message of getUniqueMessages(sent)) {
    if (message.status !== 'sent' || !message.sentAt) continue;
    const timestamp = Date.parse(message.sentAt);
    if (!Number.isFinite(timestamp) || timestamp > now.getTime()) continue;

    const key = getLocalDateKey(new Date(timestamp));
    const day = counts.get(key);
    if (day) day.sent += 1;
  }

  for (const message of scheduled) {
    const timestamp = Date.parse(message.when);
    if (message.status !== 'scheduled' || !Number.isFinite(timestamp) || timestamp <= now.getTime()) continue;

    const key = getLocalDateKey(new Date(timestamp));
    const day = counts.get(key);
    if (day) day.scheduled += 1;
  }

  return dates.map((date) => {
    const day = counts.get(getLocalDateKey(date)) ?? { sent: 0, scheduled: 0 };
    return {
      date,
      count: day.sent + day.scheduled,
      sentCount: day.sent,
      scheduledCount: day.scheduled,
    };
  });
}

function getChartPoints(
  counts: number[],
  top: number,
  scaleMax = Math.max(...counts),
  left = 0,
  right = 360,
) {
  const bottom = 82;
  const max = Math.max(...counts);

  return counts.map((count, index) => ({
    x: counts.length === 7
      ? left + (index / (counts.length - 1)) * (right - left)
      : left + ((index + 0.5) / counts.length) * (right - left),
    y: max === 0 || scaleMax <= 0
      ? bottom
      : bottom - (count / scaleMax) * (bottom - top),
  }));
}

function formatMonthlyCount(count: number) {
  if (count < 1000) return String(count);
  const thousands = count / 1000;
  return `${Number(thousands.toFixed(thousands < 10 ? 1 : 0))}k`;
}

function getSmoothPath(points: Array<{ x: number; y: number }>) {
  if (points.length < 2) return '';

  const slopes = points.slice(0, -1).map((point, index) => (
    (points[index + 1].y - point.y) / (points[index + 1].x - point.x)
  ));
  const tangents = points.map((_, index) => {
    if (index === 0 || index === points.length - 1) return 0;

    const previousSlope = slopes[index - 1];
    const nextSlope = slopes[index];
    return previousSlope * nextSlope <= 0 ? 0 : (previousSlope + nextSlope) / 2;
  });

  return points.slice(0, -1).reduce((path, point, index) => {
    const next = points[index + 1];
    const segmentWidth = next.x - point.x;
    const delta = next.y - point.y;
    let startTangent = tangents[index];
    let endTangent = tangents[index + 1];

    if (delta === 0) {
      startTangent = 0;
      endTangent = 0;
    } else {
      const startRatio = (startTangent * segmentWidth) / delta;
      const endRatio = (endTangent * segmentWidth) / delta;
      const tangentMagnitude = Math.hypot(startRatio, endRatio);
      if (tangentMagnitude > 3) {
        const scale = 3 / tangentMagnitude;
        startTangent *= scale;
        endTangent *= scale;
      }
    }

    const startsAfterFlat = index > 0 && slopes[index - 1] === 0;
    const endsBeforeFlat = index < slopes.length - 1 && slopes[index + 1] === 0;
    const startHandle = startsAfterFlat ? 0.38 : 1 / 3;
    const endHandle = endsBeforeFlat ? 0.38 : 1 / 3;
    const control1X = point.x + segmentWidth * startHandle;
    const control1Y = Math.min(Math.max(point.y + (startTangent * segmentWidth) / 3, Math.min(point.y, next.y)), Math.max(point.y, next.y));
    const control2X = next.x - segmentWidth * endHandle;
    const control2Y = Math.min(Math.max(next.y - (endTangent * segmentWidth) / 3, Math.min(point.y, next.y)), Math.max(point.y, next.y));
    return `${path} C ${control1X} ${control1Y}, ${control2X} ${control2Y}, ${next.x} ${next.y}`;
  }, `M ${points[0].x} ${points[0].y}`);
}

function interpolateSvgPath(fromPath: string, toPath: string, progress: number) {
  if (progress <= 0) return fromPath;
  if (progress >= 1) return toPath;

  const numberPattern = /-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi;
  const fromValues = Array.from(fromPath.matchAll(numberPattern), ([value]) => Number(value));
  const toValues = Array.from(toPath.matchAll(numberPattern), ([value]) => Number(value));
  if (fromValues.length !== toValues.length) return toPath;

  const easedProgress = progress * progress * (3 - 2 * progress);
  let valueIndex = 0;
  return toPath.replace(numberPattern, () => {
    const value = fromValues[valueIndex]
      + (toValues[valueIndex] - fromValues[valueIndex]) * easedProgress;
    valueIndex += 1;
    return String(Number(value.toFixed(3)));
  });
}

export function QuickPlannerActivity({
  sent = [],
  upcoming = [],
  historyReady = true,
  historyError = false,
}: QuickPlannerActivityProps) {
  const { locale, t } = useLocale();
  const [activityView, setActivityView] = useState<ActivityView>('sent');
  const [period, setPeriod] = useState<ActivityPeriod>(7);
  const [previousWeeklyLinePath, setPreviousWeeklyLinePath] = useState<string | null>(null);
  const [weeklyLineProgress, setWeeklyLineProgress] = useState(1);
  const [weeklyLineAnimationVersion, setWeeklyLineAnimationVersion] = useState(0);
  const [chartTransition, setChartTransition] = useState<'idle' | 'clearing' | 'revealing'>('idle');
  const [pendingPeriod, setPendingPeriod] = useState<ActivityPeriod | null>(null);
  const [hoveredMonthDay, setHoveredMonthDay] = useState<string | null>(null);
  const [monthTooltipVisible, setMonthTooltipVisible] = useState(false);
  const [monthTooltipLeft, setMonthTooltipLeft] = useState<number | null>(null);
  const [monthlyChartWidth, setMonthlyChartWidth] = useState(0);
  const [weeklyBaselineBounds, setWeeklyBaselineBounds] = useState({ left: 0, right: 360 });
  const monthTooltipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activitySectionRef = useRef<HTMLElement>(null);
  const activityChartRef = useRef<HTMLDivElement>(null);
  const monthTooltipRef = useRef<HTMLDivElement>(null);
  const now = new Date();
  const allMessages = [...upcoming, ...sent];
  const scheduledMessages = getUniqueMessages(allMessages
    .filter((message) => {
      const timestamp = Date.parse(message.when);
      return message.status === 'scheduled' && Number.isFinite(timestamp) && timestamp > now.getTime();
    })
    .sort((left, right) => Date.parse(left.when) - Date.parse(right.when)));
  const sentActivityDays = getActivityDays(sent, now, period);
  const scheduledActivityDays = getScheduledActivityDays(scheduledMessages, now, period);
  const allActivityDays = getAllActivityDays(sent, scheduledMessages, now, period);
  const chartDays = activityView === 'scheduled'
    ? scheduledActivityDays
    : activityView === 'all'
      ? allActivityDays
      : sentActivityDays;
  const dateLocale = locale === 'ru' ? 'ru-RU' : 'en-US';
  const sentTotal = sentActivityDays.reduce((count, day) => count + day.count, 0);
  const scheduledPeriodTotal = scheduledActivityDays.reduce((count, day) => count + day.count, 0);
  const allSentTotal = allActivityDays.reduce((count, day) => count + day.sentCount, 0);
  const allScheduledTotal = allActivityDays.reduce((count, day) => count + day.scheduledCount, 0);
  const allTotal = allSentTotal + allScheduledTotal;
  const total = activityView === 'scheduled'
    ? scheduledPeriodTotal
    : activityView === 'all'
      ? allTotal
      : sentTotal;
  const activeDayCount = sentActivityDays.filter(({ count }) => count > 0).length;
  const todayKey = getLocalDateKey(now);
  const nextScheduledDateShort = scheduledMessages[0]
    ? new Intl.DateTimeFormat(dateLocale, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(scheduledMessages[0].when))
    : '—';
  const gradientId = `activity-area-${useId().replace(/:/g, '')}`;
  const lineGradientId = `${gradientId}-line`;
  const monthBarGradientId = `${gradientId}-month-bar`;
  const edgeFadeId = `${gradientId}-edge-fade`;
  const activityMax = Math.max(...chartDays.map(({ count }) => count));
  const monthlyScaleMax = Math.max(activityMax, ACTIVITY_SCALE_STEPS);
  const weeklyScaleMax = Math.max(
    ACTIVITY_SCALE_STEPS,
    activityMax * (WEEKLY_SCALE_LEVELS / (WEEKLY_SCALE_LEVELS - 1)),
  );
  const weeklyGridLines = Array.from({ length: WEEKLY_SCALE_LEVELS }, (_, index) => (
    Number((WEEKLY_PLOT_TOP + ((82 - WEEKLY_PLOT_TOP) * index) / WEEKLY_SCALE_LEVELS).toFixed(1))
  ));
  const monthlyPlotTop = WEEKLY_PLOT_TOP;
  const monthlyPlotLeft = 0;
  const monthlyPlotRight = 360;
  const weeklyPlotLeft = monthlyChartWidth > 24
    ? ((12 + (monthlyChartWidth - 24) / 14) * 360) / monthlyChartWidth
    : 36;
  const monthlyScaleLabelX = monthlyPlotLeft - 12;
  const chartPoints = getChartPoints(
    chartDays.map(({ count }) => count),
    period === 30 ? monthlyPlotTop : WEEKLY_PLOT_TOP,
    period === 30 ? monthlyScaleMax : weeklyScaleMax,
    period === 30 ? monthlyPlotLeft : weeklyPlotLeft,
    period === 30 ? monthlyPlotRight : 360 - weeklyPlotLeft,
  );
  const monthlyScaleTicks = activityMax === 0
    ? [{ value: 0, y: 82 }]
    : Array.from({ length: 5 }, (_, index) => {
      const value = Math.round((activityMax * index) / 4);
      const y = 82 - (value / monthlyScaleMax) * (82 - monthlyPlotTop);
      return { value, y };
    }).filter((tick, index, ticks) => index === 0 || tick.value !== ticks[index - 1].value);
  const monthlyPeakY = 82 - (activityMax / monthlyScaleMax) * (82 - monthlyPlotTop);
  const weeklyEdgeInset = monthlyChartWidth > 0 ? (7 * 360) / monthlyChartWidth : 0;
  const weeklyLineEdgeInset = monthlyChartWidth > 0
    ? (WEEKLY_LINE_EDGE_INSET_PX * 360) / monthlyChartWidth
    : 0;
  const weeklyLineFadeWidth = monthlyChartWidth > 0
    ? (WEEKLY_LINE_FADE_PX * 360) / monthlyChartWidth
    : WEEKLY_LINE_FADE_PX;
  const lineStartX = period === 7 ? -24 + weeklyEdgeInset + weeklyLineEdgeInset : -24;
  const lineEndX = period === 7 ? 384 - weeklyEdgeInset - weeklyLineEdgeInset : 384;
  const fadeStartEndX = lineStartX + weeklyLineFadeWidth;
  const fadeEndStartX = lineEndX - weeklyLineFadeWidth;
  const hoveredMonthDayIndex = chartDays.findIndex(
    ({ date }) => getLocalDateKey(date) === hoveredMonthDay,
  );
  const hoveredMonthDayData = hoveredMonthDayIndex >= 0
    ? chartDays[hoveredMonthDayIndex]
    : null;
  const hoveredMonthDayDateLabel = hoveredMonthDayData
    ? new Intl.DateTimeFormat(dateLocale, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    }).format(hoveredMonthDayData.date)
    : '';
  useLayoutEffect(() => {
    const chart = activityChartRef.current;
    const section = activitySectionRef.current;
    if (!chart || !section) return;

    const updateChartBounds = () => {
      const chartBounds = chart.getBoundingClientRect();
      const sectionBounds = section.getBoundingClientRect();
      setMonthlyChartWidth(chartBounds.width);
      if (chartBounds.width === 0) return;

      const scale = 360 / chartBounds.width;
      const left = Math.max(-24, (sectionBounds.left - chartBounds.left) * scale);
      const right = Math.min(384, (sectionBounds.right - chartBounds.left) * scale);
      setWeeklyBaselineBounds((current) => (
        Math.abs(current.left - left) < 0.01 && Math.abs(current.right - right) < 0.01
          ? current
          : { left, right }
      ));
    };
    updateChartBounds();
    if (typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(updateChartBounds);
    observer.observe(chart);
    observer.observe(section);
    return () => observer.disconnect();
  }, [activityView, historyReady, historyError]);

  useEffect(() => {
    if (chartTransition !== 'clearing' || pendingPeriod === null) return undefined;
    const timer = window.setTimeout(() => {
      setPeriod(pendingPeriod);
      setChartTransition('revealing');
    }, 140);
    return () => window.clearTimeout(timer);
  }, [chartTransition, pendingPeriod]);

  useEffect(() => {
    if (chartTransition !== 'revealing') return undefined;
    const timer = window.setTimeout(() => {
      setChartTransition('idle');
      setPendingPeriod(null);
    }, 380);
    return () => window.clearTimeout(timer);
  }, [chartTransition]);

  useEffect(() => {
    if (previousWeeklyLinePath === null) return undefined;
    const startedAt = performance.now();
    let animationFrame = 0;
    const updateProgress = (now: number) => {
      const progress = Math.min((now - startedAt) / WEEKLY_LINE_MORPH_DURATION, 1);
      setWeeklyLineProgress(progress);
      if (progress < 1) {
        animationFrame = window.requestAnimationFrame(updateProgress);
      } else {
        setPreviousWeeklyLinePath(null);
      }
    };

    animationFrame = window.requestAnimationFrame(updateProgress);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [previousWeeklyLinePath, weeklyLineAnimationVersion]);

  useLayoutEffect(() => {
    const section = activitySectionRef.current;
    const chart = activityChartRef.current;
    const workbench = document.querySelector<HTMLElement>('.quick-planner-workbench');
    if (!section || !chart || !workbench) return;

    const updateCardHeight = () => {
      if (window.innerWidth <= 1040) {
        section.style.removeProperty('height');
        return;
      }

      const sectionBounds = section.getBoundingClientRect();
      const chartBounds = chart.getBoundingClientRect();
      const workbenchBounds = workbench.getBoundingClientRect();
      const sectionStyle = getComputedStyle(section);
      const naturalHeight = chartBounds.bottom - sectionBounds.top
        + Number.parseFloat(sectionStyle.paddingBottom)
        + Number.parseFloat(sectionStyle.borderBottomWidth);
      const workbenchAlignedHeight = workbenchBounds.bottom - sectionBounds.top;
      const targetHeight = Math.max(naturalHeight, workbenchAlignedHeight);

      if (Math.abs(sectionBounds.height - targetHeight) > 0.5) {
        section.style.height = `${targetHeight}px`;
      }
    };

    updateCardHeight();
    window.addEventListener('resize', updateCardHeight);
    if (typeof ResizeObserver === 'undefined') {
      return () => window.removeEventListener('resize', updateCardHeight);
    }

    const observer = new ResizeObserver(updateCardHeight);
    observer.observe(section);
    observer.observe(chart);
    observer.observe(workbench);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateCardHeight);
      section.style.removeProperty('height');
    };
  }, [activityView, historyReady, historyError]);

  const handleMonthChartEnter = () => {
    if (monthTooltipVisible || monthTooltipTimerRef.current) return;
    setMonthTooltipVisible(false);
    monthTooltipTimerRef.current = setTimeout(() => {
      setMonthTooltipVisible(true);
      monthTooltipTimerRef.current = null;
    }, 1000);
  };
  const handleMonthDayEnter = (dayKey: string) => {
    setHoveredMonthDay(dayKey);
  };
  const handleMonthDayLeave = () => {
    if (monthTooltipTimerRef.current) clearTimeout(monthTooltipTimerRef.current);
    monthTooltipTimerRef.current = null;
    setHoveredMonthDay(null);
    setMonthTooltipVisible(false);
  };
  useEffect(() => () => {
    if (monthTooltipTimerRef.current) clearTimeout(monthTooltipTimerRef.current);
  }, []);
  useLayoutEffect(() => {
    if (period !== 30 || hoveredMonthDayIndex < 0) return undefined;

    const updateTooltipPosition = () => {
      const section = activitySectionRef.current;
      const chart = activityChartRef.current;
      const tooltip = monthTooltipRef.current;
      if (!section || !chart || !tooltip) return;

      const sectionBounds = section.getBoundingClientRect();
      const chartBounds = chart.getBoundingClientRect();
      tooltip.style.maxWidth = `${Math.max(0, sectionBounds.width - 16)}px`;
      const tooltipWidth = tooltip.getBoundingClientRect().width;
      setMonthTooltipLeft(chartBounds.width - tooltipWidth);
    };

    updateTooltipPosition();
    window.addEventListener('resize', updateTooltipPosition);
    return () => window.removeEventListener('resize', updateTooltipPosition);
  }, [hoveredMonthDayDateLabel, hoveredMonthDayIndex, monthTooltipVisible, period]);
  const firstChartPoint = chartPoints[0];
  const secondChartPoint = chartPoints[1];
  const lastChartPoint = chartPoints[chartPoints.length - 1];
  const previousChartPoint = chartPoints[chartPoints.length - 2];
  const linePoints = [
    {
      x: lineStartX,
      y: firstChartPoint.y
        + (period === 7
          ? ((secondChartPoint.y - firstChartPoint.y) * (lineStartX - firstChartPoint.x)
            / (secondChartPoint.x - firstChartPoint.x)) * WEEKLY_EDGE_SLOPE_FACTOR
          : 0),
    },
    ...chartPoints,
    {
      x: lineEndX,
      y: lastChartPoint.y
        + (period === 7
          ? ((lastChartPoint.y - previousChartPoint.y) * (lineEndX - lastChartPoint.x)
            / (lastChartPoint.x - previousChartPoint.x)) * WEEKLY_EDGE_SLOPE_FACTOR
          : 0),
    },
  ];
  const linePath = getSmoothPath(linePoints);
  const weeklyLinePath = previousWeeklyLinePath === null
    ? linePath
    : interpolateSvgPath(previousWeeklyLinePath, linePath, weeklyLineProgress);
  const areaPath = `${weeklyLinePath} L ${lineEndX} 92 L ${lineStartX} 92 Z`;
  const activityChartLabel = activityView === 'scheduled'
    ? t('quickPlanner.activityScheduledChartLabel', { count: total, days: period })
    : activityView === 'all'
      ? t('quickPlanner.activityAllChartLabel', { count: total, days: period })
      : t('quickPlanner.activityChartLabel', { count: total, days: period });
  const activityTotalLabel = activityView === 'scheduled'
    ? t('quickPlanner.activityScheduledTotalLabel')
    : activityView === 'all'
      ? t('quickPlanner.activityAllTotalLabel')
      : t('quickPlanner.activityTotalLabel');
  const activityEmptyLabel = activityView === 'scheduled'
    ? t('quickPlanner.activityEmptyScheduled')
    : t('quickPlanner.emptyActivity');
  const activityDayDescription = (date: string, count: number) => (
    activityView === 'scheduled'
      ? t('quickPlanner.activityScheduledDayCount', { date, count })
      : activityView === 'all'
        ? t('quickPlanner.activityAllDayCount', { date, count })
        : t('quickPlanner.activityDayCount', { date, count })
  );
  const activityModes: Array<{ id: ActivityView; label: string; count: number }> = [
    { id: 'sent', label: t('quickPlanner.activityViewSent'), count: sentTotal },
    { id: 'scheduled', label: t('quickPlanner.activityViewScheduled'), count: scheduledMessages.length },
    { id: 'all', label: t('quickPlanner.activityViewAll'), count: allTotal },
  ];
  const activityModeSwitch = (
    <div className="quick-planner-activity-views" role="group" aria-label={t('quickPlanner.activityViewLabel')}>
      {activityModes.map(({ id, label, count }) => (
        <button
          aria-pressed={activityView === id}
          className={`quick-planner-activity-view${activityView === id ? ' is-active' : ''}`}
          key={id}
          onClick={() => {
            if (activityView === id) return;
            const shouldMorphWeeklyLine = period === 7
              && chartTransition === 'idle'
              && (typeof window.matchMedia !== 'function'
                || !window.matchMedia('(prefers-reduced-motion: reduce)').matches);
            if (shouldMorphWeeklyLine) {
              const visiblePath = previousWeeklyLinePath === null
                ? linePath
                : interpolateSvgPath(previousWeeklyLinePath, linePath, weeklyLineProgress);
              setPreviousWeeklyLinePath(visiblePath);
              setWeeklyLineProgress(0);
              setWeeklyLineAnimationVersion((version) => version + 1);
            }
            setActivityView(id);
          }}
          type="button"
        >
          <span>{label}</span>
          <strong>{new Intl.NumberFormat(dateLocale).format(count)}</strong>
        </button>
      ))}
    </div>
  );

  return (
    <section
      className="quick-planner-activity-section"
      aria-labelledby="quick-planner-activity-heading"
      ref={activitySectionRef}
    >
      <div className="quick-planner-activity-header">
        <h2 id="quick-planner-activity-heading">{t('quickPlanner.activity')}</h2>
        <div className="quick-planner-activity-period" role="group" aria-label={t('quickPlanner.activityPeriodLabel')}>
          {([7, 30] as const).map((days) => (
            <button
              aria-pressed={(pendingPeriod ?? period) === days}
              className={`quick-planner-activity-period-option${(pendingPeriod ?? period) === days ? ' is-active' : ''}`}
              key={days}
              onClick={() => {
                if (pendingPeriod === days || (chartTransition === 'idle' && period === days)) return;
                setPendingPeriod(days);
                setChartTransition('clearing');
              }}
              type="button"
            >
              {t('quickPlanner.activityPeriodValue', { days })}
            </button>
          ))}
        </div>
      </div>
      {historyError ? (
        <p className="quick-planner-activity-state is-error">{t('quickPlanner.historyError')}</p>
      ) : !historyReady ? (
        <p className="quick-planner-activity-state">{t('quickPlanner.loadingActivity')}</p>
      ) : (
        <>
          <div className={`quick-planner-activity-total${total === 0 ? ' is-empty' : ''}${chartTransition === 'clearing' ? ' is-clearing' : chartTransition === 'revealing' ? ' is-revealing' : ''}`}>
            <strong className="quick-planner-activity-total-count">{new Intl.NumberFormat(dateLocale).format(total)}</strong>
            <span className="quick-planner-activity-total-copy">
              {total === 0 ? (
                <span className="quick-planner-activity-empty-copy">{activityEmptyLabel}</span>
              ) : (
                <span className="quick-planner-activity-total-label">{activityTotalLabel}</span>
              )}
            </span>
          </div>
          <div
            className={`quick-planner-activity-chart${chartTransition === 'clearing' ? ' is-clearing' : ''}${chartTransition === 'revealing' ? ' is-revealing' : ''}`}
            role="img"
            aria-label={activityChartLabel}
            data-period={period}
            ref={activityChartRef}
            onMouseLeave={() => period === 30 && handleMonthDayLeave()}
          >
            {period === 30 && <div className="quick-planner-activity-plot-depth" aria-hidden="true" />}
            <svg
              className="quick-planner-activity-chart-svg"
              viewBox="0 0 360 108"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <defs>
                <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="var(--activity-chart-color)" stopOpacity="0.2" />
                  <stop offset="100%" stopColor="var(--activity-chart-color)" stopOpacity="0.015" />
                </linearGradient>
                <linearGradient id={lineGradientId} x1="0" x2="1" y1="0" y2="0">
                  <stop offset="0%" stopColor="var(--activity-chart-color-bright)" />
                  <stop offset="50%" stopColor="var(--activity-chart-color)" />
                  <stop offset="100%" stopColor="var(--activity-chart-color-bright)" />
                </linearGradient>
                <linearGradient id={monthBarGradientId} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="var(--activity-chart-color-bright)" />
                  <stop offset="45%" stopColor="var(--activity-chart-color)" />
                  <stop offset="100%" stopColor="var(--activity-chart-color-deep)" />
                </linearGradient>
                <linearGradient
                  id={`${edgeFadeId}-gradient`}
                  gradientUnits="userSpaceOnUse"
                  x1="-24"
                  x2="384"
                  y1="0"
                  y2="0"
                >
                  <stop offset="0%" stopColor="black" />
                  <stop offset={`${((lineStartX + 24) / 408) * 100}%`} stopColor="black" />
                  <stop offset={`${((lineStartX + weeklyLineFadeWidth * 0.25 + 24) / 408) * 100}%`} stopColor="rgb(24, 24, 24)" />
                  <stop offset={`${((lineStartX + weeklyLineFadeWidth * 0.6 + 24) / 408) * 100}%`} stopColor="rgb(112, 112, 112)" />
                  <stop offset={`${((fadeStartEndX + 24) / 408) * 100}%`} stopColor="white" />
                  <stop offset={`${((fadeEndStartX + 24) / 408) * 100}%`} stopColor="white" />
                  <stop offset={`${((lineEndX - weeklyLineFadeWidth * 0.6 + 24) / 408) * 100}%`} stopColor="rgb(112, 112, 112)" />
                  <stop offset={`${((lineEndX - weeklyLineFadeWidth * 0.25 + 24) / 408) * 100}%`} stopColor="rgb(24, 24, 24)" />
                  <stop offset={`${((lineEndX + 24) / 408) * 100}%`} stopColor="black" />
                  <stop offset="100%" stopColor="black" />
                </linearGradient>
              </defs>
              <mask id={edgeFadeId} maskUnits="userSpaceOnUse" x="-24" y="0" width="408" height="108">
                  <rect x="-24" width="408" height="108" fill={`url(#${edgeFadeId}-gradient)`} />
              </mask>
              {period === 30 ? (
                <>
                  {monthlyScaleTicks.map(({ value, y }, index) => (
                    <g className="quick-planner-activity-month-grid" key={`${value}-${index}`}>
                      <path
                        className={`quick-planner-activity-grid-line${index === 0 ? ' is-baseline' : ''}`}
                        d={`M ${weeklyBaselineBounds.left} ${y} H ${weeklyBaselineBounds.right}`}
                      />
                      {value === activityMax && activityMax > 0 && (
                        <text
                          className="quick-planner-activity-scale-label is-peak"
                          x={monthlyScaleLabelX}
                          y={y + 2.5}
                          textAnchor="end"
                        >
                          {formatMonthlyCount(value)}
                        </text>
                      )}
                    </g>
                  ))}
                  <path
                    className="quick-planner-activity-grid-line is-y-axis"
                    d={`M ${monthlyPlotLeft} ${monthlyPlotTop} V 82`}
                  />
                </>
              ) : (
                <>
                  {weeklyGridLines.map((y) => (
                    <path
                      className="quick-planner-activity-grid-line"
                      key={y}
                      d={`M ${weeklyBaselineBounds.left} ${y} H ${weeklyBaselineBounds.right}`}
                    />
                  ))}
                  <path
                    className="quick-planner-activity-grid-line is-baseline"
                    d={`M ${weeklyBaselineBounds.left} 82 H ${weeklyBaselineBounds.right}`}
                  />
                </>
              )}
              {period === 30 && activityMax > 0 && (
                <path
                  className="quick-planner-activity-peak-guide"
                  d={`M ${weeklyBaselineBounds.left} ${monthlyPeakY} H ${weeklyBaselineBounds.right}`}
                />
              )}
              {period === 30 && (
                <g
                  className="quick-planner-activity-month-interaction-area"
                  onMouseEnter={handleMonthChartEnter}
                  onMouseLeave={handleMonthDayLeave}
                >
                  <g className="quick-planner-activity-month-hit-areas">
                    {chartPoints.map((point, index) => {
                      const { date } = chartDays[index];
                      const dayKey = getLocalDateKey(date);

                      return (
                        <rect
                          className="quick-planner-activity-month-hit-area"
                          key={dayKey}
                          x={point.x - 360 / (period * 2)}
                          y={monthlyPlotTop}
                          width={360 / period}
                          height={82 - monthlyPlotTop}
                          onMouseEnter={() => handleMonthDayEnter(dayKey)}
                        />
                      );
                    })}
                  </g>
                  <g className="quick-planner-activity-month-bars">
                    {chartPoints.map((point, index) => {
                      const { date, count } = chartDays[index];
                      if (count === 0) return null;

                      const dateLabel = new Intl.DateTimeFormat(dateLocale, {
                        weekday: 'long',
                        month: 'long',
                        day: 'numeric',
                      }).format(date);
                      const dayDescription = activityDayDescription(dateLabel, count);

                      return (
                        <rect
                          className={`quick-planner-activity-month-bar${count === activityMax ? ' is-peak' : ''}${getLocalDateKey(date) === getLocalDateKey(new Date()) ? ' is-today' : ''}`}
                          key={getLocalDateKey(date)}
                          x={point.x - 4.3}
                          y={point.y}
                          width="8.6"
                          height={82 - point.y}
                          rx="0"
                          fill={`url(#${monthBarGradientId})`}
                          tabIndex={0}
                          aria-label={dayDescription}
                          onMouseEnter={() => handleMonthDayEnter(getLocalDateKey(date))}
                          onFocus={() => {
                            handleMonthDayEnter(getLocalDateKey(date));
                            setMonthTooltipVisible(true);
                          }}
                          onBlur={handleMonthDayLeave}
                        />
                      );
                    })}
                  </g>
                </g>
              )}
              {period === 7 && chartPoints.length > 0 && (
                <g mask={`url(#${edgeFadeId})`}>
                  <path className="quick-planner-activity-area" d={areaPath} fill={`url(#${gradientId})`} />
                  <path className="quick-planner-activity-line-depth" d={weeklyLinePath} vectorEffect="non-scaling-stroke" />
                  <path className="quick-planner-activity-line-glow" d={weeklyLinePath} vectorEffect="non-scaling-stroke" />
                  <path
                    className="quick-planner-activity-line"
                    d={weeklyLinePath}
                    stroke={`url(#${lineGradientId})`}
                    vectorEffect="non-scaling-stroke"
                  />
                  <path className="quick-planner-activity-line-highlight" d={weeklyLinePath} vectorEffect="non-scaling-stroke" />
                </g>
              )}
              {chartPoints.map((point, index) => {
                const count = chartDays[index].count;
                const showCount = period === 7 && count > 0 && previousWeeklyLinePath === null;
                const countY = point.y + 19;

                return (
                  <g className="quick-planner-activity-point" key={getLocalDateKey(chartDays[index].date)}>
                    {showCount && (
                      <>
                        <text
                          className={`quick-planner-activity-count-shadow${count < 10 ? ' is-single-digit' : ''}`}
                          x={point.x}
                          y={countY + 1}
                          textAnchor="middle"
                        >
                          {count}
                        </text>
                        <text
                          className={`quick-planner-activity-count${count < 10 ? ' is-single-digit' : ''}`}
                          x={point.x}
                          y={countY}
                          textAnchor="middle"
                        >
                          {count}
                        </text>
                      </>
                    )}
                    {period === 7 && count > 0 && (
                      previousWeeklyLinePath === null && (
                        <circle className="quick-planner-activity-point-dot" cx={point.x} cy={point.y} r="4" />
                      )
                    )}
                  </g>
                );
              })}
            </svg>
            {period === 30 && hoveredMonthDayData && monthTooltipVisible && (
              <div
                className="quick-planner-activity-tooltip"
                role="tooltip"
                ref={monthTooltipRef}
                style={{ left: monthTooltipLeft ?? 0 }}
              >
                {activityDayDescription(hoveredMonthDayDateLabel, hoveredMonthDayData.count)}
              </div>
            )}
            <div
              className={`quick-planner-activity-days${period === 30 ? ' is-month' : ''}`}
              style={{ gridTemplateColumns: `repeat(${period}, minmax(0, 1fr))` }}
            >
              {chartDays.map(({ date, count }, index) => {
                const isToday = getLocalDateKey(date) === todayKey;
                const previousDayIsToday = index > 0
                  && getLocalDateKey(chartDays[index - 1].date) === todayKey;
                const nextDayIsToday = index < chartDays.length - 1
                  && getLocalDateKey(chartDays[index + 1].date) === todayKey;
                const showMonthTick = period === 30
                  && (isToday || (index % 7 === 0 && !previousDayIsToday && !nextDayIsToday));
                const dayLabel = period === 7
                  ? new Intl.DateTimeFormat(dateLocale, { weekday: 'short' }).format(date)
                  : new Intl.DateTimeFormat(dateLocale, { day: 'numeric' }).format(date);
                const dateLabel = new Intl.DateTimeFormat(dateLocale, { day: 'numeric' }).format(date);
                const dayKey = getLocalDateKey(date);
                const isNearHoveredMonthDay = period === 30
                  && hoveredMonthDayIndex >= 0
                  && Math.abs(index - hoveredMonthDayIndex) <= 2;
                const fullDate = new Intl.DateTimeFormat(dateLocale, {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                }).format(date);
                return (
                  <div
                    className={`quick-planner-activity-day${period === 30 ? ' is-month' : ''}${isToday ? ' is-today' : ''}${period === 30 && nextDayIsToday ? ' is-before-today' : ''}${showMonthTick ? ' has-month-tick' : ''}${hoveredMonthDay === dayKey ? ' is-hovered' : ''}${isNearHoveredMonthDay ? ' is-near-hovered' : ''}`}
                    key={dayKey}
                    title={activityDayDescription(fullDate, count)}
                    aria-label={activityDayDescription(fullDate, count)}
                  >
                    <span className="quick-planner-activity-day-label">{dayLabel}</span>
                    {period === 7 && (
                      <span className="quick-planner-activity-date-label">{dateLabel}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <div className={`quick-planner-activity-lower${chartTransition === 'clearing' ? ' is-clearing' : chartTransition === 'revealing' ? ' is-revealing' : ''}`}>
            <div className="quick-planner-activity-highlights" aria-label={t('quickPlanner.activityHighlights')} aria-live="polite">
              {activityView === 'sent' ? (
                <>
                  <div className="quick-planner-activity-highlight">
                    <strong>{new Intl.NumberFormat(dateLocale).format(total)}</strong>
                    <span>{t('quickPlanner.activityHighlightSent')}</span>
                  </div>
                  <div className="quick-planner-activity-highlight">
                    <strong>{activeDayCount}</strong>
                    <span>{t('quickPlanner.activityHighlightActiveDays')}</span>
                  </div>
                  <div className="quick-planner-activity-highlight">
                    <strong>{t('quickPlanner.activityPeriodValue', { days: period })}</strong>
                    <span>{t('quickPlanner.activityHighlightPeriod')}</span>
                  </div>
                </>
              ) : activityView === 'scheduled' ? (
                <>
                  <div className="quick-planner-activity-highlight">
                    <strong>{new Intl.NumberFormat(dateLocale).format(scheduledMessages.length)}</strong>
                    <span>{t('quickPlanner.activityHighlightScheduled')}</span>
                  </div>
                  <div className="quick-planner-activity-highlight is-compact">
                    <strong>{nextScheduledDateShort}</strong>
                    <span>{t('quickPlanner.activityHighlightNext')}</span>
                  </div>
                  <div className="quick-planner-activity-highlight">
                    <strong>{new Intl.NumberFormat(dateLocale).format(scheduledPeriodTotal)}</strong>
                    <span>{t('quickPlanner.activityHighlightNextPeriod', { days: period })}</span>
                  </div>
                </>
              ) : activityView === 'all' ? (
                <>
                  <div className="quick-planner-activity-highlight">
                    <strong>{new Intl.NumberFormat(dateLocale).format(allTotal)}</strong>
                    <span>{t('quickPlanner.activityHighlightAll')}</span>
                  </div>
                  <div className="quick-planner-activity-highlight">
                    <strong>{new Intl.NumberFormat(dateLocale).format(allSentTotal)}</strong>
                    <span>{t('quickPlanner.activityHighlightAllSent')}</span>
                  </div>
                  <div className="quick-planner-activity-highlight">
                    <strong>{new Intl.NumberFormat(dateLocale).format(allScheduledTotal)}</strong>
                    <span>{t('quickPlanner.activityHighlightAllScheduled')}</span>
                  </div>
                </>
              ) : null}
            </div>
            {activityModeSwitch}
          </div>
        </>
      )}
    </section>
  );
}
