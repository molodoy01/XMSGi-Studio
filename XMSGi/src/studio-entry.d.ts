declare module '$studio' {
  import type { ComponentType } from 'react';
  import type { StudioSchedulerRuntime } from '../../../AwaitMsg-Studio/src/studio';
  import type { SavedDraft, ScheduledMessage as StudioScheduledMessage } from '../../Studio/Studio module/src/types';

  const StudioApp: ComponentType<{
    connected: boolean;
    chats: Array<{ id: string; name: string; username?: string; type?: string; avatarDataUrl?: string }>;
    scheduler: StudioSchedulerRuntime;
    activeAccountId: 'account-1' | 'account-2';
    onRegisterHistoryDraftOpener?: (opener: ((draft: SavedDraft) => void) | null) => void;
    onRegisterHistoryRescheduleHandler?: (handler: ((message: StudioScheduledMessage) => void) | null) => void;
  }>;
  export type { AccountContext, AccountSlotId, ChannelConnection, SavedDraft, StudioSchedulerRuntime };
  export default StudioApp;
}