declare module '$studio' {
  import type { ComponentType } from 'react';
  import type { StudioSchedulerRuntime } from '../../../AwaitMsg-Studio/src/studio';

  const StudioApp: ComponentType<{
    connected: boolean;
    chats: Array<{ id: string; name: string; username?: string; type?: string; avatarDataUrl?: string }>;
    scheduler: StudioSchedulerRuntime;
    activeAccountId: 'account-1' | 'account-2';
  }>;
  export type { AccountContext, AccountSlotId, ChannelConnection, StudioSchedulerRuntime };
  export default StudioApp;
}