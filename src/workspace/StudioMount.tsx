import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { StudioBridgeProps, StudioSchedulerActions, StudioSchedulerRuntime } from '@shared/bridge';
import type { NotificationState, NotificationType } from '@shared/types';

const StudioApp = lazy(() => import('@studio/App'));

type StudioInlineNotification = {
  message: string;
  title: string;
  type: NotificationType;
  durationMs: number;
  revision: number;
};

type StudioMountProps = Required<Pick<StudioBridgeProps, 'connected' | 'activeAccountId' | 'chats' | 'scheduler'>>
  & Pick<StudioBridgeProps,
    | 'selectedChat'
    | 'onSelectChat'
    | 'connectionRecoveryStatus'
    | 'onRegisterPlannerTextOpener'
    | 'onRegisterBeforeLeaveStudio'
    | 'onRegisterHistoryDraftOpener'
    | 'onRegisterHistoryDraftUseHandler'
    | 'onRegisterHistoryDraftClearHandler'
    | 'onRegisterHistoryDraftDeleteHandler'
    | 'onRegisterHistoryRescheduleHandler'
  >
  & { notification?: NotificationState };

type StudioSchedulerHandlers = Pick<StudioSchedulerActions,
  | 'handleSchedule'
  | 'handleSendDraftNow'
  | 'handleSendNow'
  | 'handleDeleteMessage'
  | 'handleClearSent'
  | 'handleCancelMessage'
  | 'handleCancelMessages'
> & Pick<StudioSchedulerRuntime, 'showNotification'>;

function useStableSchedulerRuntime(
  scheduler: StudioSchedulerRuntime,
  showNotification: StudioSchedulerRuntime['showNotification'],
): StudioSchedulerRuntime {
  const schedulerRef = useRef(scheduler);
  schedulerRef.current = scheduler;
  const actions = useMemo<StudioSchedulerHandlers>(() => ({
    handleSchedule: (...args) => schedulerRef.current.handleSchedule(...args),
    handleSendDraftNow: (...args) => schedulerRef.current.handleSendDraftNow(...args),
    handleSendNow: (...args) => schedulerRef.current.handleSendNow(...args),
    handleDeleteMessage: (...args) => schedulerRef.current.handleDeleteMessage(...args),
    handleClearSent: (...args) => schedulerRef.current.handleClearSent(...args),
    handleCancelMessage: (...args) => schedulerRef.current.handleCancelMessage(...args),
    handleCancelMessages: (...args) => schedulerRef.current.handleCancelMessages(...args),
    showNotification,
  }), [showNotification]);

  return useMemo(() => ({
    protocolVersion: scheduler.protocolVersion,
    ...actions,
    upcoming: scheduler.upcoming,
    sent: scheduler.sent,
    scheduling: scheduler.scheduling,
    successPulse: scheduler.successPulse,
    lastAction: scheduler.lastAction,
    revealingId: scheduler.revealingId,
    cancelingIds: scheduler.cancelingIds,
    sendingIds: scheduler.sendingIds,
    publishingDraft: scheduler.publishingDraft,
  }), [
    actions,
    scheduler.protocolVersion,
    scheduler.upcoming,
    scheduler.sent,
    scheduler.scheduling,
    scheduler.successPulse,
    scheduler.lastAction,
    scheduler.revealingId,
    scheduler.cancelingIds,
    scheduler.sendingIds,
    scheduler.publishingDraft,
  ]);
}

export function StudioMount({ connected, connectionRecoveryStatus, activeAccountId, chats, selectedChat, onSelectChat, notification, scheduler, onRegisterPlannerTextOpener, onRegisterBeforeLeaveStudio, onRegisterHistoryDraftOpener, onRegisterHistoryDraftUseHandler, onRegisterHistoryDraftClearHandler, onRegisterHistoryDraftDeleteHandler, onRegisterHistoryRescheduleHandler }: StudioMountProps) {
  const [inlineNotification, setInlineNotification] = useState<StudioInlineNotification | null>(null);
  const notificationTimeoutRef = useRef<number | null>(null);
  const notificationRevisionRef = useRef(0);
  const showInlineNotification = useCallback<StudioSchedulerRuntime['showNotification']>(
    (message, type, title, _errorDetails, durationMs = 4500) => {
      if (notificationTimeoutRef.current !== null) window.clearTimeout(notificationTimeoutRef.current);
      const revision = ++notificationRevisionRef.current;
      setInlineNotification({ message, type, title, durationMs, revision });
      notificationTimeoutRef.current = window.setTimeout(() => {
        notificationTimeoutRef.current = null;
        setInlineNotification((current) => current?.revision === revision ? null : current);
      }, durationMs);
    },
    [],
  );
  useLayoutEffect(() => {
    if (!notification?.visible) return;
    showInlineNotification(
      notification.message,
      notification.type,
      notification.title,
      notification.errorDetails,
    );
  }, [notification?.errorDetails, notification?.message, notification?.revision, notification?.title, notification?.type, notification?.visible, showInlineNotification]);
  useEffect(() => () => {
    if (notificationTimeoutRef.current !== null) window.clearTimeout(notificationTimeoutRef.current);
  }, []);

  const stableScheduler = useStableSchedulerRuntime(scheduler, showInlineNotification);

  return (
    <Suspense fallback={null}>
      <StudioApp
        connected={connected}
        connectionRecoveryStatus={connectionRecoveryStatus}
        activeAccountId={activeAccountId}
        chats={chats}
        selectedChat={selectedChat}
        onSelectChat={onSelectChat}
        scheduler={stableScheduler}
        inlineNotification={inlineNotification}
        onRegisterPlannerTextOpener={onRegisterPlannerTextOpener}
        onRegisterBeforeLeaveStudio={onRegisterBeforeLeaveStudio}
        onRegisterHistoryDraftOpener={onRegisterHistoryDraftOpener}
        onRegisterHistoryDraftUseHandler={onRegisterHistoryDraftUseHandler}
        onRegisterHistoryDraftClearHandler={onRegisterHistoryDraftClearHandler}
        onRegisterHistoryDraftDeleteHandler={onRegisterHistoryDraftDeleteHandler}
        onRegisterHistoryRescheduleHandler={onRegisterHistoryRescheduleHandler}
      />
    </Suspense>
  );
}