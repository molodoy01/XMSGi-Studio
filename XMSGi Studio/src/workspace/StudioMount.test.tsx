import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { StudioSchedulerRuntime } from '@shared/bridge';
import { LocaleProvider } from '@/lib/i18n';
import { preloadStudioApp, StudioMount } from './StudioMount';

vi.mock('@studio/App', () => ({
  default: () => <div data-testid="studio-app-content">Studio ready</div>,
}));

describe('StudioMount', () => {
  it('reuses a preloaded Studio app when the surface mounts', async () => {
    await preloadStudioApp();

    render(
      <LocaleProvider>
        <StudioMount
          connected={true}
          activeAccountId="account-1"
          chats={[]}
          scheduler={{} as StudioSchedulerRuntime}
        />
      </LocaleProvider>,
    );

    expect(await screen.findByTestId('studio-app-content')).toHaveTextContent('Studio ready');
  });

  it('does not flash a loading surface while Studio loads', () => {
    render(
      <LocaleProvider>
        <StudioMount
          connected={true}
          activeAccountId="account-1"
          chats={[]}
          scheduler={{} as StudioSchedulerRuntime}
        />
      </LocaleProvider>,
    );

    expect(screen.queryByRole('status', { name: /studio workspace loading/i })).not.toBeInTheDocument();
  });
});
