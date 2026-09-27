import StudioApp, { type StudioSchedulerRuntime } from '$studio';
import type { Chat } from '@/types';
import { LocaleProvider } from '@/lib/i18n';

type StudioMountProps = {
  connected: boolean;
  activeAccountId: 'account-1' | 'account-2';
  chats: Chat[];
  scheduler: StudioSchedulerRuntime;
};

export function StudioMount({ connected, activeAccountId, chats, scheduler }: StudioMountProps) {
  return (
    <LocaleProvider>
      <StudioApp connected={connected} activeAccountId={activeAccountId} chats={chats} scheduler={scheduler} />
    </LocaleProvider>
  );
}