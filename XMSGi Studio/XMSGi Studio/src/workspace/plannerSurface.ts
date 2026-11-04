export type PlannerSurface = 'quick' | 'pending' | 'login';

export type PlannerSurfaceState = {
  browserDraftMode: boolean;
  connected: boolean;
  sessionAvailable?: boolean;
  sessionResolved?: boolean;
  signedOut: boolean;
  connecting: boolean;
  connectionResolved: boolean;
  welcomeBackInProgress?: boolean;
};

export function getPlannerSurface({
  browserDraftMode,
  connected,
  sessionAvailable = false,
  sessionResolved = true,
  signedOut,
  connecting,
  connectionResolved,
  welcomeBackInProgress = false,
}: PlannerSurfaceState): PlannerSurface {
  if (browserDraftMode) return 'quick';
  if (!sessionResolved) return 'pending';
  if (signedOut && welcomeBackInProgress) return 'login';
  if (signedOut && connecting) return 'pending';
  if (signedOut) return 'login';
  if (connected || sessionAvailable) return 'quick';
  if (!connectionResolved || connecting) return 'pending';
  return 'login';
}