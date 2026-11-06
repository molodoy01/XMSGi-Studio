type TelegramWindowBridge = NonNullable<Window['telegram']>;

function getTelegramBridge(): TelegramWindowBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.telegram;
}

export function hasTelegramBridge(): boolean {
  return Boolean(getTelegramBridge());
}

export function isDesktopTelegramRuntime(): boolean {
  return typeof getTelegramBridge()?.login === 'function';
}

export async function telegramGetAccountAvatar() {
  const bridge = getTelegramBridge();
  if (!bridge || typeof bridge.getAccountAvatar !== 'function') {
    return { success: false, error: 'desktopBridgeRequired' };
  }
  return bridge.getAccountAvatar();
}

export async function telegramDeleteSavedMessage(data: { chatId: string; messageId: string }) {
  const bridge = getTelegramBridge();
  if (!bridge || typeof bridge.deleteSavedMessage !== 'function') {
    return { success: false, error: 'desktopBridgeRequired' };
  }
  return bridge.deleteSavedMessage(data);
}

export function telegramGetFilePath(file: File): string | undefined {
  const bridge = getTelegramBridge();
  if (!bridge || typeof bridge.getFilePath !== 'function') return undefined;
  return bridge.getFilePath(file);
}

export async function telegramGetAuthState(): Promise<{ success: boolean; authState?: TelegramAuthState; error?: string }> {
  const bridge = getTelegramBridge();
  if (!bridge || typeof bridge.getAuthState !== 'function') {
    return { success: false, error: 'desktopBridgeRequired' };
  }

  return bridge.getAuthState();
}

export async function telegramGetConfig(): Promise<{
  success: boolean;
  config?: {
    hasCredentials?: boolean;
    apiId?: string;
    hasSession?: boolean;
    connected?: boolean;
    signedOut?: boolean;
  };
  error?: string;
}> {
  const bridge = getTelegramBridge();
  if (!bridge || typeof bridge.getConfig !== 'function') {
    return { success: false, error: 'desktopBridgeRequired' };
  }

  return bridge.getConfig();
}

export async function telegramSaveCredentials(data: { API_ID: string; API_HASH: string }) {
  const bridge = getTelegramBridge();
  if (!bridge || typeof bridge.saveCredentials !== 'function') {
    return { success: false, error: 'desktopBridgeRequired' };
  }

  return bridge.saveCredentials({
    API_ID: String(data.API_ID),
    API_HASH: String(data.API_HASH),
  });
}

export async function telegramLogin(data: { API_ID?: string | number; API_HASH?: string; phoneNumber?: string; phone?: string; password?: string; phoneCode?: string; apiId?: string | number; apiHash?: string }) {
  const bridge = getTelegramBridge();
  if (!bridge || typeof bridge.login !== 'function') {
    return { success: false, error: 'desktopBridgeRequired' };
  }

  return bridge.login(data);
}

export async function telegramConnect(): Promise<{ success: boolean; error?: string }> {
  const bridge = getTelegramBridge();
  if (!bridge || typeof bridge.connect !== 'function') {
    return { success: false, error: 'desktopBridgeRequired' };
  }

  return bridge.connect();
}

export async function telegramGetStatus(): Promise<{
  success: boolean;
  accountId?: string;
  status?: 'normal' | 'rate-limited' | 'slowmode' | 'auth required' | 'network/retrying' | 'error';
  category?: 'flood' | 'slowmode' | 'auth' | 'permission' | 'network' | 'unknown' | null;
  error?: string;
}> {
  const bridge = getTelegramBridge();
  if (!bridge || typeof bridge.getStatus !== 'function') {
    return { success: false };
  }

  return bridge.getStatus();
}

export async function telegramGetRateLimitState(): Promise<{
  success: boolean;
  current?: {
    accountId: string;
    paused: boolean;
    pausedUntil: number | null;
    pausedUntilText?: string;
    remainingMs: number;
    remainingMsText?: string;
    waitSeconds?: number;
    waitSecondsText?: string;
    reason?: 'FLOOD_WAIT';
    status?: 'normal' | 'rate-limited' | 'slowmode' | 'auth required' | 'network/retrying' | 'error';
    category?: 'flood' | 'slowmode' | 'auth' | 'permission' | 'network' | 'unknown' | null;
    error?: string;
  };
  pausedAccounts?: Array<{
    accountId: string;
    paused: boolean;
    pausedUntil: number | null;
    pausedUntilText?: string;
    remainingMs: number;
    remainingMsText?: string;
    waitSeconds?: number;
    waitSecondsText?: string;
    reason?: 'FLOOD_WAIT';
  }>;
}> {
  const bridge = getTelegramBridge();
  if (!bridge || typeof bridge.getRateLimitState !== 'function') {
    return { success: false };
  }

  return bridge.getRateLimitState();
}

export async function telegramSignOutKeepSession(): Promise<{ success: boolean; authState?: TelegramAuthState; error?: string }> {
  const bridge = getTelegramBridge();
  if (!bridge || typeof bridge.signOutKeepSession !== 'function') {
    return { success: false, error: 'desktopBridgeRequired' };
  }

  return bridge.signOutKeepSession();
}

export async function telegramWelcomeBack(): Promise<{ success: boolean; authState?: TelegramAuthState; error?: string }> {
  const bridge = getTelegramBridge();
  if (!bridge || typeof bridge.welcomeBack !== 'function') {
    return { success: false, error: 'desktopBridgeRequired' };
  }

  return bridge.welcomeBack();
}

export async function telegramForgetAccount(): Promise<{ success: boolean; authState?: TelegramAuthState; error?: string }> {
  const bridge = getTelegramBridge();
  if (!bridge || typeof bridge.forgetAccount !== 'function') {
    return { success: false, error: 'desktopBridgeRequired' };
  }

  return bridge.forgetAccount();
}

export function telegramOnStatus(callback: (status: unknown) => void): () => void {
  const bridge = getTelegramBridge();
  if (!bridge || typeof bridge.onStatus !== 'function') {
    return () => undefined;
  }

  return bridge.onStatus(callback);
}

export function telegramOnSendHistoryWarning(callback: () => void): () => void {
  const bridge = getTelegramBridge();
  if (!bridge || typeof bridge.onSendHistoryWarning !== 'function') {
    return () => undefined;
  }

  return bridge.onSendHistoryWarning(callback);
}

export function subscribeToConfirmedSendHistoryWarning(
  showNotification: (message: string, type: 'warning', title: string) => void,
  translate: (key: 'schedule.confirmedSendHistoryWriteFailed' | 'schedule.errorTitle') => string,
): () => void {
  return telegramOnSendHistoryWarning(() => {
    showNotification(
      translate('schedule.confirmedSendHistoryWriteFailed'),
      'warning',
      translate('schedule.errorTitle'),
    );
  });
}
