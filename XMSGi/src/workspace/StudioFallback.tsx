import type { Chat } from '@/types';
import { LocaleProvider } from '@/lib/i18n';

export type StudioSchedulerRuntime = Record<string, unknown>;

type StudioFallbackProps = {
  connected: boolean;
  activeAccountId: 'account-1' | 'account-2';
  chats: Chat[];
  scheduler: StudioSchedulerRuntime;
};

export default function StudioFallback({ connected, activeAccountId, chats }: StudioFallbackProps) {
  const stateText = connected ? `Studio connected · ${activeAccountId}` : 'Studio waiting for Telegram connection';

  return (
    <LocaleProvider>
      <section
        aria-live="polite"
        style={{
          minHeight: 240,
          display: 'grid',
          placeItems: 'center',
          padding: '32px 24px',
          color: '#e2e6eb',
          background: '#111316',
          border: '1px solid rgba(154, 168, 184, 0.18)',
          borderRadius: 18,
          margin: '24px 0',
        }}
      >
        <div style={{ textAlign: 'center', display: 'grid', gap: 8 }}>
          <div style={{ letterSpacing: '0.24em', fontSize: 12, opacity: 0.8 }}>STUDIO</div>
          <div style={{ fontSize: 22, fontWeight: 600 }}>{stateText}</div>
          <div style={{ opacity: 0.75 }}>
            {chats.length > 0 ? `${chats.length} chats ready` : 'No chats yet'}
          </div>
        </div>
      </section>
    </LocaleProvider>
  );
}
