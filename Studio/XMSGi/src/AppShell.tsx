import type { PropsWithChildren } from 'react';

export function AppShell({ children }: PropsWithChildren) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#0b1020' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 18px',
          borderBottom: '1px solid rgba(148, 163, 184, 0.23)',
          background: 'rgba(15, 23, 42, 0.88)',
          backdropFilter: 'blur(10px)',
          color: '#e2e8f0',
          fontFamily: 'Inter, system-ui, sans-serif',
        }}
      >
        <div>
          <div style={{ fontSize: '0.72rem', letterSpacing: '0.14em', textTransform: 'uppercase', opacity: 0.72 }}>
            XMSGi Studio
          </div>
          <div style={{ fontSize: '1.05rem', fontWeight: 700 }}>Post Workspace</div>
        </div>

        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 10px',
            borderRadius: 999,
            background: 'rgba(96, 165, 250, 0.12)',
            border: '1px solid rgba(96, 165, 250, 0.38)',
            color: '#bfdbfe',
            fontSize: '0.72rem',
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
          }}
        >
          <span style={{ width: 8, height: 8, display: 'inline-block', background: '#34d399', borderRadius: '50%' }} />
          XMSGi Core Active
        </div>
      </header>

      <main style={{ flex: 1, minHeight: 0 }}>{children}</main>
    </div>
  );
}
