import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { StudioSchedulerRuntime } from '$studio';
import { LocaleProvider } from '@/lib/i18n';
import { StudioMount } from './StudioMount';

describe('StudioMount', () => {
  it('renders the studio surface without crashing', () => {
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

    expect(screen.getByText('STUDIO')).toBeInTheDocument();
  });
});
