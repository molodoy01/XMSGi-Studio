import { Suspense, lazy } from 'react';
import type { StudioBridgeProps } from '@shared/bridge';
import { preloadStudioApp } from './studioLoader';

const StudioApp = lazy(preloadStudioApp);

type StudioMountProps = Required<Pick<StudioBridgeProps, 'connected' | 'activeAccountId' | 'chats' | 'scheduler'>>
  & Pick<StudioBridgeProps,
    | 'onRegisterHistoryDraftOpener'
    | 'onRegisterHistoryDraftUseHandler'
    | 'onRegisterHistoryDraftClearHandler'
    | 'onRegisterHistoryDraftDeleteHandler'
    | 'onRegisterHistoryRescheduleHandler'
  >;

export function StudioMount({ connected, activeAccountId, chats, scheduler, onRegisterHistoryDraftOpener, onRegisterHistoryDraftUseHandler, onRegisterHistoryDraftClearHandler, onRegisterHistoryDraftDeleteHandler, onRegisterHistoryRescheduleHandler }: StudioMountProps) {
  return (
    <Suspense fallback={null}>
      <StudioApp
        connected={connected}
        activeAccountId={activeAccountId}
        chats={chats}
        scheduler={scheduler}
        onRegisterHistoryDraftOpener={onRegisterHistoryDraftOpener}
        onRegisterHistoryDraftUseHandler={onRegisterHistoryDraftUseHandler}
        onRegisterHistoryDraftClearHandler={onRegisterHistoryDraftClearHandler}
        onRegisterHistoryDraftDeleteHandler={onRegisterHistoryDraftDeleteHandler}
        onRegisterHistoryRescheduleHandler={onRegisterHistoryRescheduleHandler}
      />
    </Suspense>
  );
}