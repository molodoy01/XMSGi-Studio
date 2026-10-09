import { useMemo, useState } from 'react';
import { WorkspacePage } from './pages/WorkspacePage';
import { useStudioChats } from './hooks/useStudioChats';
import type { NotificationState } from './types';
import type { BridgeErrorDetails, StudioBridgeProps } from '@shared/bridge';
import { useStudioScheduler } from './hooks/useStudioScheduler';

export type { StudioSchedulerRuntime } from '@shared/bridge';

export default function App({ connected: xmsgiConnected, chats: xmsgiChats, scheduler, activeAccountId = 'account-1', onRegisterHistoryDraftOpener, onRegisterHistoryDraftUseHandler, onRegisterHistoryDraftClearHandler, onRegisterHistoryDraftDeleteHandler, onRegisterHistoryRescheduleHandler }: StudioBridgeProps = {}) {
  const [notification, setNotification] = useState<NotificationState>({ message: '', title: '', type: 'info', visible: false });
  const showNotification = (message: string, type: NotificationState['type'] = 'info', title = 'Studio', errorDetails?: BridgeErrorDetails) => setNotification({ message, title, type, visible: true, ...(errorDetails ? { errorDetails } : {}) });
  const closeNotification = () => setNotification((current) => ({ ...current, visible: false }));
  const connected = xmsgiConnected ?? false;
  const {
    chats: localChats,
    selectedChat,
    setSelectedChat,
    addChat,
    removeChat,
    removeModal,
    setRemoveModal,
    confirmRemoveChat,
  } = useStudioChats({ chats: xmsgiChats, setNotification });
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

  const props = useMemo(() => ({ connected, chats: localChats, selectedChat, setSelectedChat, onAddChat: addChat, onRemoveChat: removeChat, removeModal, setRemoveModal, confirmRemoveChat, date, time, scheduling: scheduler?.scheduling ?? scheduling, successPulse: scheduler?.successPulse ?? successPulse, lastAction: scheduler?.lastAction ?? lastAction, notification: scheduler?.notification ?? notification, closeNotification: scheduler?.closeNotification ?? closeNotification, upcoming: scheduler?.upcoming ?? upcoming, sent: scheduler?.sent ?? sent, revealingId: scheduler?.revealingId ?? revealingId, cancelingIds: scheduler?.cancelingIds ?? cancelingIds, sendingIds: scheduler?.sendingIds ?? sendingIds, setDate, setTime, handleSchedule: scheduler?.handleSchedule ?? handleSchedule, handleSendDraftNow: scheduler?.handleSendDraftNow ?? handleSendDraftNow, handleSendNow: scheduler?.handleSendNow ?? handleSendNow, handleDeleteMessage: scheduler?.handleDeleteMessage ?? handleDeleteMessage, handleClearSent: scheduler?.handleClearSent ?? handleClearSent, publishingDraft: scheduler?.publishingDraft ?? publishingDraft, handleCancelMessage: scheduler?.handleCancelMessage ?? handleCancelMessage, onRegisterHistoryDraftOpener }), [localChats, selectedChat, removeModal, date, time, scheduling, successPulse, lastAction, notification, upcoming, sent, revealingId, cancelingIds, sendingIds, publishingDraft, scheduler, onRegisterHistoryDraftOpener]);
  return <WorkspacePage {...props} handleCancelMessages={scheduler?.handleCancelMessages} onRegisterHistoryDraftUseHandler={onRegisterHistoryDraftUseHandler} onRegisterHistoryDraftClearHandler={onRegisterHistoryDraftClearHandler} onRegisterHistoryDraftDeleteHandler={onRegisterHistoryDraftDeleteHandler} onRegisterHistoryRescheduleHandler={onRegisterHistoryRescheduleHandler} />;
}
