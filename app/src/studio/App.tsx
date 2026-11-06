import { useCallback, useMemo } from 'react';
import { WorkspacePage, type StudioInlineNotification } from './pages/WorkspacePage';
import { useStudioChats } from './hooks/useStudioChats';
import type { StudioBridgeProps, StudioSchedulePayload, StudioScheduleRepeatOptions } from '@shared/bridge';
import { useStudioScheduler } from './hooks/useStudioScheduler';
import { useNotifications } from '@/hooks/useNotifications';
import { getScheduleDateTimeAfter } from './lib/scheduling';

export type { StudioSchedulerRuntime } from '@shared/bridge';

type StudioAppProps = StudioBridgeProps & {
  onRegisterBeforeLeaveStudio?: (flush: (() => Promise<boolean>) | null) => void;
  inlineNotification?: StudioInlineNotification | null;
};

export default function App({ connected: xmsgiConnected, connectionRecoveryStatus, chats: xmsgiChats, selectedChat: xmsgiSelectedChat, onSelectChat, scheduler, inlineNotification, activeAccountId = 'account-1', onRegisterPlannerTextOpener, onRegisterBeforeLeaveStudio, onRegisterHistoryDraftOpener, onRegisterHistoryDraftUseHandler, onRegisterHistoryDraftClearHandler, onRegisterHistoryDraftDeleteHandler, onRegisterHistoryRescheduleHandler }: StudioAppProps = {}) {
  const localNotifications = useNotifications();
  const showNotification = scheduler?.showNotification ?? localNotifications.showNotification;
  const connected = xmsgiConnected ?? false;
  const selectedChatControlled = xmsgiSelectedChat !== undefined && onSelectChat !== undefined;
  const {
    chats: localChats,
    selectedChat,
    setSelectedChat,
    addChat,
    removeChat,
    removeModal,
    setRemoveModal,
    confirmRemoveChat,
  } = useStudioChats({ chats: xmsgiChats, selectedChat: xmsgiSelectedChat, onSelectChat, showNotification });
  const studioScheduler = useStudioScheduler({
    accountId: activeAccountId,
    chats: localChats,
    selectedChat,
    showNotification,
  });

  const {
    date,
    time,
    setDate,
    setTime,
    upcoming,
    sent,
    scheduling,
    publishingDraft,
    successPulse,
    lastAction,
    cancelingIds,
    sendingIds,
    revealingId,
    handleSchedule,
    handleSendDraftNow,
    handleSendNow,
    handleDeleteMessage,
    handleClearSent,
    handleCancelMessage,
  } = studioScheduler;

  const handleStudioSchedule = useCallback(async (
    payload?: StudioSchedulePayload,
    repeat?: StudioScheduleRepeatOptions,
  ) => {
    const result = await (scheduler?.handleSchedule ?? handleSchedule)(
      payload ? { ...payload, waitForConfirmation: true } : undefined,
      repeat,
    );
    if (result === true) {
      const nextSchedule = getScheduleDateTimeAfter(0);
      setDate(nextSchedule.date);
      setTime(nextSchedule.time);
    }
    return result;
  }, [handleSchedule, scheduler, setDate, setTime]);

  const props = useMemo(() => ({ connected, chats: localChats, selectedChat, setSelectedChat, selectedChatControlled, onAddChat: addChat, onRemoveChat: removeChat, removeModal, setRemoveModal, confirmRemoveChat, date, time, scheduling: scheduler?.scheduling ?? scheduling, successPulse: scheduler?.successPulse ?? successPulse, lastAction: scheduler?.lastAction ?? lastAction, upcoming: scheduler?.upcoming ?? upcoming, sent: scheduler?.sent ?? sent, revealingId: scheduler?.revealingId ?? revealingId, cancelingIds: scheduler?.cancelingIds ?? cancelingIds, sendingIds: scheduler?.sendingIds ?? sendingIds, setDate, setTime, handleSchedule: handleStudioSchedule, handleSendDraftNow: scheduler?.handleSendDraftNow ?? handleSendDraftNow, handleSendNow: scheduler?.handleSendNow ?? handleSendNow, handleDeleteMessage: scheduler?.handleDeleteMessage ?? handleDeleteMessage, handleClearSent: scheduler?.handleClearSent ?? handleClearSent, publishingDraft: scheduler?.publishingDraft ?? publishingDraft, handleCancelMessage: scheduler?.handleCancelMessage ?? handleCancelMessage, showNotification: scheduler?.showNotification, onRegisterHistoryDraftOpener }), [localChats, selectedChat, selectedChatControlled, removeModal, date, time, scheduling, successPulse, lastAction, upcoming, sent, revealingId, cancelingIds, sendingIds, publishingDraft, scheduler, handleStudioSchedule, onRegisterHistoryDraftOpener]);
  return <WorkspacePage {...props} connectionRecoveryStatus={connectionRecoveryStatus} inlineNotification={inlineNotification} handleCancelMessages={scheduler?.handleCancelMessages} onRegisterPlannerTextOpener={onRegisterPlannerTextOpener} onRegisterBeforeLeaveStudio={onRegisterBeforeLeaveStudio} onRegisterHistoryDraftUseHandler={onRegisterHistoryDraftUseHandler} onRegisterHistoryDraftClearHandler={onRegisterHistoryDraftClearHandler} onRegisterHistoryDraftDeleteHandler={onRegisterHistoryDraftDeleteHandler} onRegisterHistoryRescheduleHandler={onRegisterHistoryRescheduleHandler} />;
}
