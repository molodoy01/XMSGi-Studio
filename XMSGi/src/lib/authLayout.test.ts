import { describe, expect, it } from 'vitest';
import { shouldShowTopbar } from './authLayout';

describe('auth layout rules', () => {
  it('hides the topbar on initial auth and welcome-back states', () => {
    expect(shouldShowTopbar({ connected: false, signedOut: false })).toBe(false);
    expect(shouldShowTopbar({ connected: false, signedOut: true })).toBe(false);
  });

  it('keeps the topbar for the connected workspace state', () => {
    expect(shouldShowTopbar({ connected: true, signedOut: false })).toBe(true);
  });
});
