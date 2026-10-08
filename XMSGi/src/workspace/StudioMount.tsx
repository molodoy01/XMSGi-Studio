import StudioApp from '$studio';
import type { SavedDraft, ScheduledMessage } from '@shared/types';
import type { StudioBridgeProps, StudioSchedulerRuntime } from '@shared/bridge';

type StudioMountProps = Required<Pick<StudioBridgeProps, 'connected' | 'activeAccountId' | 'chats' | 'scheduler'>>
  & Pick<StudioBridgeProps,
    | 'onRegisterHistoryDraftOpener'
    | 'onRegisterHistoryDraftUseHandler'
    | 'onRegisterHistoryDraftClearHandler'
    | 'onRegisterHistoryDraftDeleteHandler'
    | 'onRegisterHistoryRescheduleHandler'
  >;

export function StudioMount({ connected, activeAccountId, chats, scheduler, onRegisterHistoryDraftOpener, onRegisterHistoryDraftUseHandler, onRegisterHistoryDraftClearHandler, onRegisterHistoryDraftDeleteHandler, onRegisterHistoryRescheduleHandler }: StudioMountProps) {
  return <StudioApp connected={connected} activeAccountId={activeAccountId} chats={chats} scheduler={scheduler} onRegisterHistoryDraftOpener={onRegisterHistoryDraftOpener} onRegisterHistoryDraftUseHandler={onRegisterHistoryDraftUseHandler} onRegisterHistoryDraftClearHandler={onRegisterHistoryDraftClearHandler} onRegisterHistoryDraftDeleteHandler={onRegisterHistoryDraftDeleteHandler} onRegisterHistoryRescheduleHandler={onRegisterHistoryRescheduleHandler} />;
}