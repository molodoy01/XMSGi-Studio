import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MessageOption, ScheduledMessage } from '@/types';
import { MessageCard } from './MessageCard';
import { useLocale } from '@/lib/i18n';
import { getTimezoneLabel } from '@/lib/utils';

interface Props {
  upcoming: ScheduledMessage[];
  sent: ScheduledMessage[];
  assistantText: string;
  revealingId: string | null;
  activeTab: 'upcoming' | 'sent';
  onTabChange: (tab: 'upcoming' | 'sent') => void;
  onCancel: (msg: ScheduledMessage) => void;
  onSendNow: (msg: ScheduledMessage) => void;
  onDelete: (msg: ScheduledMessage) => void;
  onClearSent: () => void;
  onClearAll: () => void;
  cancelingIds: Set<string>;
  sendingIds: Set<string>;
  showAllMessages?: boolean;
  upcomingLabel?: string;
  selectedMessageOption?: MessageOption | null;
}

export function MessagesPanel({
  upcoming,
  sent,
  assistantText,
  revealingId,
  activeTab,
  onTabChange,
  onCancel,
  onSendNow,
  onDelete,
  onClearSent,
  onClearAll,
  cancelingIds,
  sendingIds,
  showAllMessages = false,
  upcomingLabel,
  selectedMessageOption = null,
}: Props) {
  const { t } = useLocale();
  const [showOlderUpcoming, setShowOlderUpcoming] = useState(false);
  const [showOlderSent, setShowOlderSent] = useState(false);
  const autoScrollFrameRef = useRef<number | null>(null);
  const autoScrollTimeoutRef = useRef<number | null>(null);
  const autoScrollActiveRef = useRef(false);
  const userPinnedRef = useRef(false);
  const wasNearBottomRef = useRef(true);
  const scrollStateInitializedRef = useRef(false);
  const lastScrollTopRef = useRef(0);

  const upcomingSorted = [...upcoming].sort(
    (a, b) =>
      new Date(b.createdAt || b.when).getTime() -
      new Date(a.createdAt || a.when).getTime()
  );

  const recentUpcoming = upcomingSorted.slice(0, 3);
  const olderUpcoming = upcomingSorted.slice(3);

  const sentSorted = [...sent].sort(
    (a, b) =>
      new Date(b.sentAt || b.when).getTime() -
      new Date(a.sentAt || a.when).getTime()
  );

  const recentSent = sentSorted.slice(0, 3);
  const olderSent = sentSorted.slice(3);

  useLayoutEffect(() => {
    const groups = Array.from(
      document.querySelectorAll<HTMLElement>(
        '.message-timeline-group-recent, .message-timeline-group-older'
      )
    );

    const updateTimelineLines = () => {
      groups.forEach((group) => {
        const dots = Array.from(
          group.querySelectorAll<HTMLElement>('.message-rail-dot')
        );

        if (dots.length < 2) return;

        const groupRect = group.getBoundingClientRect();
        const firstDot = dots[0].getBoundingClientRect();
        const lastDot = dots[dots.length - 1].getBoundingClientRect();
        const firstCenter = firstDot.top + firstDot.height / 2;
        const lastCenter = lastDot.top + lastDot.height / 2;

        group.style.setProperty(
          '--timeline-left',
          `${firstDot.left + firstDot.width / 2 - groupRect.left}px`
        );
        group.style.setProperty('--timeline-top', `${firstCenter - groupRect.top}px`);
        group.style.setProperty('--timeline-height', `${lastCenter - firstCenter}px`);
      });
    };

    updateTimelineLines();
    const observer = new ResizeObserver(updateTimelineLines);
    groups.forEach((group) => observer.observe(group));

    return () => observer.disconnect();
  }, [
    recentUpcoming.length,
    recentSent.length,
    olderUpcoming.length,
    olderSent.length,
    showOlderUpcoming,
    showOlderSent,
    activeTab,
  ]);

  useEffect(() => {
    const scrollingElement = document.scrollingElement;
    if (!scrollingElement) return;

    const bottomThreshold = 64;
    const getDistanceFromBottom = () =>
      scrollingElement.scrollHeight - window.innerHeight - scrollingElement.scrollTop;
    const isNearBottom = () => getDistanceFromBottom() <= bottomThreshold;

    const cancelAutoScroll = () => {
      if (autoScrollTimeoutRef.current !== null) {
        window.clearTimeout(autoScrollTimeoutRef.current);
        autoScrollTimeoutRef.current = null;
      }

      if (autoScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(autoScrollFrameRef.current);
        autoScrollFrameRef.current = null;
      }

      autoScrollActiveRef.current = false;
    };

    const handleUserInput = () => {
      cancelAutoScroll();
    };

    const handleWheel = (event: WheelEvent) => {
      handleUserInput();

      if (event.deltaY < 0) {
        userPinnedRef.current = true;
      }
    };

    const handleScroll = () => {
      if (autoScrollActiveRef.current) return;

      const currentScrollTop = scrollingElement.scrollTop;
      const nearBottom = isNearBottom();

      if (currentScrollTop < lastScrollTopRef.current && !nearBottom) {
        userPinnedRef.current = true;
      } else if (nearBottom) {
        userPinnedRef.current = false;
      }

      lastScrollTopRef.current = currentScrollTop;
      wasNearBottomRef.current = nearBottom;
    };

    const runAutoScroll = (startTime: number, startPosition: number, targetPosition: number) => {
      const elapsed = Math.min(startTime === 0 ? 0 : performance.now() - startTime, 250);
      const progress = Math.min(1, elapsed / 200);
      const easedProgress = 1 - Math.pow(1 - progress, 3);
      scrollingElement.scrollTop = Math.round(
        startPosition + (targetPosition - startPosition) * easedProgress
      );

      if (progress >= 1 || userPinnedRef.current) {
        autoScrollActiveRef.current = false;
        autoScrollFrameRef.current = null;
        lastScrollTopRef.current = scrollingElement.scrollTop;
        wasNearBottomRef.current = isNearBottom();
        return;
      }

      autoScrollFrameRef.current = window.requestAnimationFrame((now) =>
        runAutoScroll(startTime || now, startPosition, targetPosition)
      );
    };

    const scheduleAutoScroll = () => {
      if (!wasNearBottomRef.current || userPinnedRef.current) return;

      if (autoScrollTimeoutRef.current !== null) {
        window.clearTimeout(autoScrollTimeoutRef.current);
      }

      autoScrollTimeoutRef.current = window.setTimeout(() => {
        autoScrollTimeoutRef.current = null;

        if (userPinnedRef.current || !wasNearBottomRef.current) return;

        const targetPosition = Math.max(
          0,
          scrollingElement.scrollHeight - window.innerHeight
        );
        const startPosition = scrollingElement.scrollTop;

        if (targetPosition <= startPosition) return;

        autoScrollActiveRef.current = true;
        autoScrollFrameRef.current = window.requestAnimationFrame((now) =>
          runAutoScroll(now, startPosition, targetPosition)
        );
      }, 75);
    };

    if (!scrollStateInitializedRef.current) {
      lastScrollTopRef.current = scrollingElement.scrollTop;
      wasNearBottomRef.current = isNearBottom();
      scrollStateInitializedRef.current = true;
    }
    scrollingElement.addEventListener('scroll', handleScroll, { passive: true });
    document.addEventListener('wheel', handleWheel, { capture: true, passive: true });
    document.addEventListener('touchstart', handleUserInput, { capture: true, passive: true });
    document.addEventListener('touchmove', handleUserInput, { capture: true, passive: true });
    document.addEventListener('pointerdown', handleUserInput, { capture: true, passive: true });
    scheduleAutoScroll();

    return () => {
      cancelAutoScroll();
      scrollingElement.removeEventListener('scroll', handleScroll);
      document.removeEventListener('wheel', handleWheel, true);
      document.removeEventListener('touchstart', handleUserInput, true);
      document.removeEventListener('touchmove', handleUserInput, true);
      document.removeEventListener('pointerdown', handleUserInput, true);
    };
  }, [
    activeTab,
    recentUpcoming.length,
    recentSent.length,
    olderUpcoming.length,
    olderSent.length,
    showOlderUpcoming,
    showOlderSent,
  ]);

  useLayoutEffect(() => {
    const scrollingElement = document.scrollingElement;
    if (
      !scrollingElement ||
      !assistantText ||
      !wasNearBottomRef.current ||
      userPinnedRef.current
    ) {
      return;
    }

    if (autoScrollTimeoutRef.current !== null) {
      window.clearTimeout(autoScrollTimeoutRef.current);
      autoScrollTimeoutRef.current = null;
    }

    if (autoScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(autoScrollFrameRef.current);
      autoScrollFrameRef.current = null;
    }

    autoScrollActiveRef.current = false;
    scrollingElement.scrollTop = Math.max(
      0,
      scrollingElement.scrollHeight - window.innerHeight
    );
    lastScrollTopRef.current = scrollingElement.scrollTop;
    wasNearBottomRef.current = true;
  }, [assistantText]);

  return (
    <div className="messages-panel">
      <div className="tabs">
        <button
          className={`tab ${
            activeTab === 'upcoming' ? 'active' : ''
          }`}
          onClick={() => onTabChange('upcoming')}
        >
            {upcomingLabel || t('schedule.upcoming')}
          <span className="tab-count">
            {upcoming.length}
          </span>
        </button>

        <button
          className={`tab history-tab ${
            activeTab === 'sent' ? 'active' : ''
          }`}
          onClick={() => onTabChange('sent')}
        >
          {t('schedule.history')}
          <span className="tab-count">
            {sent.length}
          </span>
        </button>
      </div>

      <div className="tab-actions">
        {activeTab === 'sent' && sent.length > 0 && (
          <button
            className="clear-history"
            onClick={onClearSent}
            title={t('schedule.clearHistoryTitle')}
          >
            {t('schedule.clearHistory')}
          </button>
        )}

        {activeTab === 'upcoming' &&
          upcoming.length > 0 && (
            <button
              className="clear-history"
              onClick={onClearAll}
              title={t('schedule.clearAllTitle')}
            >
              {t('schedule.clearAll')}
            </button>
          )}
      </div>

      <div
        className={`tab-content ${
          activeTab === 'upcoming' ? '' : 'hidden'
        }`}
      >
        {upcomingSorted.length === 0 ? (
          <div className="empty-state">
            <span className="empty-state-message">{t('schedule.emptyUpcoming')}</span>
            <span className="empty-state-timezone">{getTimezoneLabel()}</span>
          </div>
        ) : (
          <div className="message-list">
            <div className="message-timeline-group message-timeline-group-recent">
              {recentUpcoming.map((msg, i) => (
                <MessageCard
                  key={msg.id}
                  message={msg}
                  isLast={i === recentUpcoming.length - 1}
                  isRevealing={revealingId === msg.id}
                  onCancel={onCancel}
                  onSendNow={onSendNow}
                  onDelete={onDelete}
                  showCancel={(msg.status === 'scheduled' || msg.status === 'confirmed') && !cancelingIds.has(msg.id)}
                  showSendNow={(msg.status === 'scheduled' || msg.status === 'confirmed') && !sendingIds.has(msg.id)}
                  showDelete={true}
                  railColor="#9aa8b8"
                  isCanceling={cancelingIds.has(msg.id)}
                  isSending={sendingIds.has(msg.id)}
                  selectedMessageOption={selectedMessageOption}
                />
              ))}
            </div>

            {!showAllMessages && olderUpcoming.length > 0 && (
              <div className="upcoming-older-toggle-wrap">
                <div className="messages-timezone">{getTimezoneLabel()}</div>
                <button
                  type="button"
                  className="upcoming-older-toggle"
                  onClick={() => setShowOlderUpcoming((value) => !value)}
                >
                  {showOlderUpcoming ? t('schedule.showLess') : t('schedule.showMore')}
                </button>
              </div>
            )}

            {(showAllMessages || showOlderUpcoming) && (
              <div className="message-timeline-group message-timeline-group-older">
                {olderUpcoming.map((msg, i) => (
                  <MessageCard
                    key={msg.id}
                    message={msg}
                    isLast={i === olderUpcoming.length - 1}
                    isRevealing={revealingId === msg.id}
                    onCancel={onCancel}
                    onSendNow={onSendNow}
                    onDelete={onDelete}
                    showCancel={(msg.status === 'scheduled' || msg.status === 'confirmed') && !cancelingIds.has(msg.id)}
                    showSendNow={(msg.status === 'scheduled' || msg.status === 'confirmed') && !sendingIds.has(msg.id)}
                    showDelete={true}
                    railColor="#9aa8b8"
                    isCanceling={cancelingIds.has(msg.id)}
                    isSending={sendingIds.has(msg.id)}
                    showCreatedMeta={true}
                    selectedMessageOption={selectedMessageOption}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div
        className={`tab-content ${
          activeTab === 'sent' ? '' : 'hidden'
        }`}
      >
        {sentSorted.length === 0 ? (
          <div className="empty-state">
            <span className="empty-state-message">{t('schedule.emptySent')}</span>
            <span className="empty-state-timezone">{getTimezoneLabel()}</span>
          </div>
        ) : (
          <div className="message-list">
            <div className="message-timeline-group message-timeline-group-recent">
              {recentSent.map((msg, i) => (
                <MessageCard
                  key={msg.id}
                  message={msg}
                  isLast={i === recentSent.length - 1}
                  onCancel={onCancel}
                  onSendNow={onSendNow}
                  onDelete={onDelete}
                  showCancel={false}
                  showSendNow={false}
                  showDelete={true}
                  railColor="#6f9b7c"
                  isRevealing={revealingId === msg.id}
                  selectedMessageOption={selectedMessageOption}
                />
              ))}
            </div>

            {!showAllMessages && olderSent.length > 0 && (
              <div className="upcoming-older-toggle-wrap">
                <div className="messages-timezone">{getTimezoneLabel()}</div>
                <button
                  type="button"
                  className="upcoming-older-toggle"
                  onClick={() => setShowOlderSent((value) => !value)}
                >
                  {showOlderSent ? t('schedule.showLess') : t('schedule.showMore')}
                </button>
              </div>
            )}

            {(showAllMessages || showOlderSent) && (
              <div className="message-timeline-group message-timeline-group-older">
                {olderSent.map((msg, i) => (
                  <MessageCard
                    key={msg.id}
                    message={msg}
                    isLast={i === olderSent.length - 1}
                    onCancel={onCancel}
                    onSendNow={onSendNow}
                    onDelete={onDelete}
                    showCancel={false}
                    showSendNow={false}
                    showDelete={true}
                    railColor="#6f9b7c"
                    isRevealing={revealingId === msg.id}
                    selectedMessageOption={selectedMessageOption}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}