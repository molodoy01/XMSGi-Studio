import StudioApp, { type SavedDraft, type StudioSchedulerRuntime } from '$studio';
import type { Chat } from '@/types';
import type { ScheduledMessage as StudioScheduledMessage } from '../../../Studio/Studio module/src/types';
import { LocaleProvider } from '@/lib/i18n';

type StudioMountProps = {
  connected: boolean;
  activeAccountId: 'account-1' | 'account-2';
  chats: Chat[];
  scheduler: StudioSchedulerRuntime;
  onRegisterHistoryDraftOpener?: (opener: ((draft: SavedDraft) => void) | null) => void;
  onRegisterHistoryDraftUseHandler?: (handler: ((draft: SavedDraft) => void) | null) => void;
  onRegisterHistoryDraftClearHandler?: (handler: (() => Promise<boolean>) | null) => void;
  onRegisterHistoryDraftDeleteHandler?: (handler: ((draftId: string) => Promise<boolean>) | null) => void;
  onRegisterHistoryRescheduleHandler?: (handler: ((message: StudioScheduledMessage) => void) | null) => void;
};

export function StudioMount({ connected, activeAccountId, chats, scheduler, onRegisterHistoryDraftOpener, onRegisterHistoryDraftUseHandler, onRegisterHistoryDraftClearHandler, onRegisterHistoryDraftDeleteHandler, onRegisterHistoryRescheduleHandler }: StudioMountProps) {
  return (
    <LocaleProvider>
      <StudioApp connected={connected} activeAccountId={activeAccountId} chats={chats} scheduler={scheduler} onRegisterHistoryDraftOpener={onRegisterHistoryDraftOpener} onRegisterHistoryDraftUseHandler={onRegisterHistoryDraftUseHandler} onRegisterHistoryDraftClearHandler={onRegisterHistoryDraftClearHandler} onRegisterHistoryDraftDeleteHandler={onRegisterHistoryDraftDeleteHandler} onRegisterHistoryRescheduleHandler={onRegisterHistoryRescheduleHandler} />
    </LocaleProvider>
  );
}