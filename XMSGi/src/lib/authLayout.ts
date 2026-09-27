export type AuthLayoutState = {
  connected: boolean;
  signedOut: boolean;
};

export function shouldShowTopbar({ connected, signedOut }: AuthLayoutState) {
  return connected && !signedOut;
}
