let studioModule: Promise<typeof import('$studio')> | undefined;

export function preloadStudioApp() {
  studioModule ??= import('$studio');
  return studioModule;
}