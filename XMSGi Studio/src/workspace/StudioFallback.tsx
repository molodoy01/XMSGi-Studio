import type { Chat } from '@/types';
import { LocaleProvider } from '@/lib/i18n';

export type StudioSchedulerRuntime = Record<string, unknown>;

type StudioFallbackProps = {
  connected: boolean;
  activeAccountId: 'account-1' | 'account-2';
  chats: Chat[];
  scheduler: StudioSchedulerRuntime;
};

const skeletonLineStyle = {
  height: 12,
  borderRadius: 999,
  background: 'linear-gradient(90deg, rgba(160, 170, 185, 0.14), rgba(210, 220, 232, 0.28), rgba(160, 170, 185, 0.14))',
  backgroundSize: '200% 100%',
  animation: 'studioFallbackShift 1.35s ease-in-out infinite',
} as const;

const glowStyle = {
  position: 'absolute' as const,
  inset: 0,
  opacity: 0.8,
  pointerEvents: 'none' as const,
};

export function StudioFallback({ connected, activeAccountId, chats }: StudioFallbackProps) {
  const previewLines = [
    { width: '36%', marginBottom: 12 },
    { width: '72%', marginBottom: 12 },
    { width: '60%', marginBottom: 18 },
    { width: '100%', marginBottom: 12 },
    { width: '82%', marginBottom: 12 },
  ];

  return (
    <LocaleProvider>
      <div
        role="status"
        aria-live="polite"
        aria-label="Studio workspace loading"
        style={{
          minHeight: 320,
          borderRadius: 18,
          border: '1px solid rgba(148, 160, 176, 0.15)',
          background: 'rgba(15, 18, 22, 0.84)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.03)',
          overflow: 'hidden',
          position: 'relative',
          margin: '24px 0',
        }}
      >
        <div style={glowStyle}>
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.03) 50%, transparent 100%)',
              transform: 'translateX(-100%)',
              animation: 'studioFallbackSweep 1.6s ease-in-out infinite',
            }}
          />
        </div>

        <div style={{ position: 'relative', padding: 20, display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <div style={{ ...skeletonLineStyle, width: 180, height: 16 }} />
            <div style={{ ...skeletonLineStyle, width: 100, height: 14 }} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.35fr) minmax(180px, 0.65fr)', gap: 20 }}>
            <div style={{ display: 'grid', gap: 14 }}>
              <div style={{ ...skeletonLineStyle, width: '42%', height: 14 }} />
              {previewLines.map((line, index) => (
                <div
                  key={`${line.width}-${index}`}
                  style={{ ...skeletonLineStyle, width: line.width, marginBottom: line.marginBottom ?? 0 }}
                />
              ))}
            </div>

            <div style={{ display: 'grid', gap: 12 }}>
              <div style={{ ...skeletonLineStyle, width: '78%', height: 14 }} />
              <div style={{ ...skeletonLineStyle, width: '100%', height: 70, borderRadius: 14 }} />
              <div style={{ ...skeletonLineStyle, width: '92%', height: 12 }} />
              <div style={{ ...skeletonLineStyle, width: '68%', height: 12 }} />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12, marginTop: 10 }}>
            <div style={{ ...skeletonLineStyle, width: '20%', height: 32, borderRadius: 12 }} />
            <div style={{ ...skeletonLineStyle, width: '18%', height: 32, borderRadius: 12 }} />
            <div style={{ ...skeletonLineStyle, width: '16%', height: 32, borderRadius: 12 }} />
          </div>
        </div>

        <style>{`
          @keyframes studioFallbackShift {
            0% { background-position: 200% 0; }
            100% { background-position: -200% 0; }
          }
          @keyframes studioFallbackSweep {
            0% { transform: translateX(-100%); }
            100% { transform: translateX(100%); }
          }
        `}</style>
      </div>
    </LocaleProvider>
  );
}
