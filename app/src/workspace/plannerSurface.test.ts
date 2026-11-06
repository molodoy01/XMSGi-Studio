import { describe, expect, it } from 'vitest';
import { getPlannerSurface } from './plannerSurface';

describe('getPlannerSurface', () => {
  it('keeps product pages hidden while startup connection state is unresolved', () => {
    expect(getPlannerSurface({
      browserDraftMode: false,
      connected: false,
      signedOut: false,
      connecting: true,
      connectionResolved: false,
    })).toBe('pending');
  });

  it('waits for the saved-session check before showing login after an early offline event', () => {
    expect(getPlannerSurface({
      browserDraftMode: false,
      connected: false,
      sessionAvailable: false,
      sessionResolved: false,
      signedOut: false,
      connecting: false,
      connectionResolved: true,
    })).toBe('pending');
  });

  it('keeps product pages hidden while restoring a signed-out session', () => {
    expect(getPlannerSurface({
      browserDraftMode: false,
      connected: false,
      signedOut: true,
      connecting: true,
      connectionResolved: true,
    })).toBe('pending');
  });

  it('keeps Welcome Back visible during an explicit reconnect action', () => {
    expect(getPlannerSurface({
      browserDraftMode: false,
      connected: false,
      signedOut: true,
      connecting: true,
      connectionResolved: true,
      welcomeBackInProgress: true,
    })).toBe('login');
  });

  it('shows the login screen after session state is resolved and signed out', () => {
    expect(getPlannerSurface({
      browserDraftMode: false,
      connected: false,
      signedOut: true,
      connecting: false,
      connectionResolved: true,
    })).toBe('login');
  });

  it('shows Quick Planner for connected and browser draft sessions', () => {
    expect(getPlannerSurface({
      browserDraftMode: false,
      connected: true,
      signedOut: false,
      connecting: false,
      connectionResolved: true,
    })).toBe('quick');
    expect(getPlannerSurface({
      browserDraftMode: true,
      connected: false,
      signedOut: false,
      connecting: true,
      connectionResolved: false,
    })).toBe('quick');
  });

  it('keeps Quick Planner available while a saved session reconnects', () => {
    expect(getPlannerSurface({
      browserDraftMode: false,
      connected: false,
      sessionAvailable: true,
      signedOut: false,
      connecting: true,
      connectionResolved: false,
    })).toBe('quick');
    expect(getPlannerSurface({
      browserDraftMode: false,
      connected: false,
      sessionAvailable: true,
      signedOut: false,
      connecting: false,
      connectionResolved: true,
    })).toBe('quick');
  });
});