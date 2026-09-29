import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { StudioSchedulerRuntime } from '$studio';
import { StudioMount } from './StudioMount';

describe('StudioMount', () => {
  it('renders the studio surface without crashing', () => {
    render(
      <StudioMount
        connected={true}
        activeAccountId="account-1"
        chats={[]}
        scheduler={{} as StudioSchedulerRuntime}
      />,
    );

    expect(screen.getByText('STUDIO')).toBeInTheDocument();
  });
});
