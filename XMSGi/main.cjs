const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { app, BrowserWindow, Tray, Menu, ipcMain, safeStorage, shell, dialog } = require('electron');

const writableAppDataRoot = path.join(process.env.LOCALAPPDATA || app.getPath('appData'), 'XMSGi');
fs.mkdirSync(writableAppDataRoot, { recursive: true });
app.setPath('userData', writableAppDataRoot);
app.setPath('sessionData', writableAppDataRoot);

if (!app.isPackaged && process.env.npm_lifecycle_event !== 'start') {
  require('dotenv').config();

  for (const key of ['API_ID', 'API_HASH', 'SESSION_STRING']) {
    delete process.env[key];
  }
}

const {
  validateCancelPayload,
  validateChatId,
  validateEnabled,
  validateGeminiGeneratePayload,
  validateGeminiKey,
  validateHistoryPayload,
  validateLoginPayload,
  validateTelegramCredentialsPayload,
  validateQuery,
  validateSchedulePayload,
  validateSendPayload,
  assertTrustedRenderer
} = require('./ipc-security.cjs');
const { readChats, writeChats, readJsonFile, writeJsonFile } = require('./chat-storage.cjs');
const draftStoreModulePath = (() => {
  const candidates = [
    app.isPackaged ? path.join(process.resourcesPath, 'draft-store.cjs') : null,
    path.resolve(__dirname, 'draft-store.cjs'),
    path.resolve(__dirname, '../../AwaitMsg-Studio/draft-store.cjs'),
    path.resolve(__dirname, '../../AwaitMsg-Studio-old/draft-store.cjs'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return path.resolve(__dirname, 'draft-store.cjs');
})();
const { createDraftStore } = require(draftStoreModulePath);

const SECURE_CONFIG_PATH = path.join(
  app.getPath('userData'),
  'awaitmsg-secure-config.json'
);
const CHAT_STORAGE_PATH = path.join(
  app.getPath('userData'),
  'awaitmsg-chats.json'
);
const DRAFT_STORE_DIRECTORY = path.join(app.getPath('userData'), 'drafts');
const draftStore = createDraftStore({ directory: DRAFT_STORE_DIRECTORY });
const SCHEDULE_HISTORY_PATH = path.join(app.getPath('userData'), 'awaitmsg-schedule-history.json');

let mainWindow = null;
let tray = null;
let isQuitting = false;
const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

app.on('second-instance', () => {
  showMainWindow();
});

function readSecureConfig() {
  try {
    const raw = fs.readFileSync(SECURE_CONFIG_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function writeSecureConfig(data) {
  try {
    fs.writeFileSync(SECURE_CONFIG_PATH, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Secure config write failed:', error?.code || error?.name || 'unknown');
  }
}

const GEMINI_KEY_FIELD = 'GEMINI_API_KEY_ENCRYPTED';
const AI_ASSISTANT_ENABLED_FIELD = 'AI_ASSISTANT_ENABLED';

function getGeminiKey() {
  const config = readSecureConfig();
  const encryptedKey = config[GEMINI_KEY_FIELD];

  if (!encryptedKey || !safeStorage.isEncryptionAvailable()) {
    return '';
  }

  try {
    return safeStorage.decryptString(Buffer.from(encryptedKey, 'base64')).trim();
  } catch (error) {
    console.error('Gemini key decryption failed:', error?.code || error?.name || 'unknown');
    return '';
  }
}

function getGeminiKeyMask(key) {
  return key ? `••••••••${key.slice(-4)}` : '';
}

function getGeminiSettings() {
  const key = getGeminiKey();
  const config = readSecureConfig();
  const enabled = config[AI_ASSISTANT_ENABLED_FIELD] ?? true;

  return {
    hasKey: Boolean(key),
    maskedKey: getGeminiKeyMask(key),
    enabled: enabled === true,
    encryptionAvailable: safeStorage.isEncryptionAvailable()
  };
}

function saveGeminiKey(key) {
  const normalizedKey = typeof key === 'string' ? key.trim() : '';

  if (!normalizedKey) {
    throw new Error('Gemini API key is required.');
  }

  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secure local storage is unavailable on this system.');
  }

  const config = readSecureConfig();
  const encryptedKey = safeStorage.encryptString(normalizedKey).toString('base64');

  writeSecureConfig({
    ...config,
    [GEMINI_KEY_FIELD]: encryptedKey
  });

  return getGeminiSettings();
}

function removeGeminiKey() {
  const config = readSecureConfig();
  const nextConfig = { ...config };

  delete nextConfig[GEMINI_KEY_FIELD];
  writeSecureConfig(nextConfig);

  return getGeminiSettings();
}

function setGeminiEnabled(enabled) {
  const config = readSecureConfig();
  writeSecureConfig({
    ...config,
    [AI_ASSISTANT_ENABLED_FIELD]: Boolean(enabled)
  });

  return getGeminiSettings();
}

function shouldLoadProductionBuild() {
  const distIndexPath = path.join(__dirname, 'dist', 'index.html');
  const explicitDevMode = process.env.ELECTRON_DEV_SERVER === '1' || process.env.ELECTRON_DEV_SERVER === 'true';
  const explicitProdMode = process.env.ELECTRON_PROD_BUILD === '1' || process.env.ELECTRON_PROD_BUILD === 'true';

  if (app.isPackaged) {
    return true;
  }

  if (explicitDevMode) {
    return false;
  }

  if (explicitProdMode) {
    return true;
  }

  return fs.existsSync(distIndexPath);
}

function getAppUrl() {
  if (shouldLoadProductionBuild()) {
    return `file://${path.join(__dirname, 'dist', 'index.html')}`;
  }

  return 'http://localhost:5173';
}

function sendTelegramStatus(status) {

  if (
    mainWindow &&
    !mainWindow.isDestroyed()
  ) {

    mainWindow.webContents.send(
      'telegram-status',
      status
    );

  }

}

const {
  connectTelegram,
  loginUser,
  saveTelegramApiCredentials,
  getTelegramConfig,
  signOutKeepSession,
  welcomeBack,
  forgetTelegramAccount,
  clearTelegramSession,
  getChats,
  getChatPermissions,
  getChatAvatar,
  getChatHistory,
  getContacts,
  getAvailableEffects,
  resolveChat,
  getTelegramRateLimitState,
  getTelegramStatus,
  waitForTelegramRateLimit,
  sendMessage,
  scheduleMessage,
  cancelScheduledMessage,
  shutdownTelegram,
  setTelegramStatusCallback
} = require('./telegram.cjs');
const { generateGeminiContent } = require('./gemini.cjs');

setTelegramStatusCallback((status) => {
  sendTelegramStatus(status);
});

function getSafeTelegramAuthState() {
  const config = getTelegramConfig();
  const hasSession = Boolean(config.hasSession);
  const signedOut = Boolean(config.signedOut);
  const connected = Boolean(config.connected);

  return {
    hasSession,
    signedOut,
    connected,
    userName: config.userName || '',
    state: !hasSession
      ? 'NO_SESSION'
      : signedOut
        ? 'SIGNED_OUT'
        : connected
          ? 'CONNECTED'
          : 'DISCONNECTED'
  };
}

function getGeminiErrorCode(error) {
  const status = error && typeof error === 'object' ? error.status : undefined;
  const details = error instanceof Error ? error.message : String(error);

  if (
    status === 429 ||
    /\b429\b|quota|rate limit|resource exhausted|too many requests/i.test(details)
  ) {
    return 'quota';
  }

  return 'generic';
}


function createWindow() {
   mainWindow = new BrowserWindow({
    title: 'XMSGi',
    icon: path.join(__dirname, 'build', 'icon.ico'),
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#11110f',
    autoHideMenuBar: true,
    show: false,

    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs')
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.on('close', (event) => {
    if (isQuitting) return;

    event.preventDefault();
    mainWindow.hide();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url === 'https://aistudio.google.com/app/apikey') {
      shell.openExternal(url);
    }

    return { action: 'deny' };
  });

  mainWindow.webContents.session.setSpellCheckerLanguages(['ru-RU', 'en-US']);

  const appUrl = getAppUrl();

  if (shouldLoadProductionBuild()) {
    mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
  } else {
    mainWindow.loadURL(appUrl);
  }
}

function requestQuit() {
  if (isQuitting) return;

  isQuitting = true;

  if (tray) {
    tray.destroy();
    tray = null;
  }

  console.log('XMSGi shutting down.');

  shutdownTelegram()
    .catch((error) => {
      console.error('Telegram shutdown error:', error?.code || error?.name || 'unknown');
    })
    .finally(() => {
      console.log('XMSGi shutdown complete.');
      app.quit();
    });
}

function createTray() {
  if (tray) return;

  tray = new Tray(path.join(__dirname, 'build', 'icon.ico'));
  tray.setToolTip('XMSGi');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'XMSGi', enabled: false },
    { type: 'separator' },
    { label: 'Open XMSGi', click: showMainWindow },
    { label: 'Exit', click: requestQuit },
  ]));
  tray.on('double-click', showMainWindow);
}

ipcMain.handle('gemini-generate', async (event, data = {}) => {
  assertTrustedRenderer(
    event,
    mainWindow?.webContents,
    pathToFileURL(path.join(__dirname, 'dist', 'index.html')).href
  );
  const validated = validateGeminiGeneratePayload(data);

  try {
    const apiKey = getGeminiKey();

    if (!apiKey) {
      return { success: false, errorCode: 'setup_required' };
    }

    const result = await generateGeminiContent(validated.prompt, {
      context: validated.context,
      apiKey
    });

    return {
      success: true,
      intent: result
    };
  } catch (error) {
    console.error('Gemini generation error:', error?.status || error?.code || error?.name || 'unknown');

    return {
      success: false,
      errorCode: getGeminiErrorCode(error)
    };
  }
});

ipcMain.handle('gemini-settings-status', async (event) => {
  assertTrustedRenderer(
    event,
    mainWindow?.webContents,
    pathToFileURL(path.join(__dirname, 'dist', 'index.html')).href
  );
  return getGeminiSettings();
});

ipcMain.handle('gemini-save-key', async (event, key) => {
  assertTrustedRenderer(
    event,
    mainWindow?.webContents,
    pathToFileURL(path.join(__dirname, 'dist', 'index.html')).href
  );
  const validatedKey = validateGeminiKey(key);

  try {
    return { success: true, settings: saveGeminiKey(validatedKey) };
  } catch (error) {
    console.error('Gemini key save failed:', error?.code || error?.name || 'unknown');
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Gemini key could not be saved.'
    };
  }
});

ipcMain.handle('gemini-remove-key', async (event) => {
  assertTrustedRenderer(
    event,
    mainWindow?.webContents,
    pathToFileURL(path.join(__dirname, 'dist', 'index.html')).href
  );
  try {
    return { success: true, settings: removeGeminiKey() };
  } catch (error) {
    console.error('Gemini key removal failed:', error?.code || error?.name || 'unknown');
    return { success: false, error: 'Gemini key could not be removed.' };
  }
});

ipcMain.handle('gemini-set-enabled', async (event, enabled) => {
  assertTrustedRenderer(
    event,
    mainWindow?.webContents,
    pathToFileURL(path.join(__dirname, 'dist', 'index.html')).href
  );
  const validatedEnabled = validateEnabled(enabled);

  try {
    return { success: true, settings: setGeminiEnabled(validatedEnabled) };
  } catch (error) {
    console.error('AI Assistant setting update failed:', error?.code || error?.name || 'unknown');
    return {
      success: false,
      error: error instanceof Error ? error.message : 'AI Assistant setting could not be updated.'
    };
  }
});

ipcMain.handle('chat-storage-load', async (event) => {
  assertTrustedRenderer(
    event,
    mainWindow?.webContents,
    pathToFileURL(path.join(__dirname, 'dist', 'index.html')).href
  );
  return readChats(CHAT_STORAGE_PATH);
});

ipcMain.handle('chat-storage-save', async (event, chats) => {
  assertTrustedRenderer(
    event,
    mainWindow?.webContents,
    pathToFileURL(path.join(__dirname, 'dist', 'index.html')).href
  );
  writeChats(CHAT_STORAGE_PATH, chats);
  return { success: true };
});

function assertDraftStorageRenderer(event) {
  assertTrustedRenderer(
    event,
    mainWindow?.webContents,
    pathToFileURL(path.join(__dirname, 'dist', 'index.html')).href
  );
}

const SCHEDULE_HISTORY_SCOPES = new Set(['personal', 'workspace']);
const SCHEDULE_HISTORY_FIELDS = new Set(['upcoming', 'sent']);
const SCHEDULE_STATUSES = new Set(['pending', 'scheduled', 'confirmed', 'sent']);

function validateStoredScheduleMessages(messages) {
  if (!Array.isArray(messages) || messages.length > 2000) {
    throw new Error('Schedule history has an invalid message list.');
  }

  const serialized = JSON.stringify(messages);
  if (Buffer.byteLength(serialized, 'utf8') > 8 * 1024 * 1024) {
    throw new Error('Schedule history exceeds the supported size.');
  }

  return messages.map((message) => {
    if (!message || typeof message !== 'object' || Array.isArray(message)
      || typeof message.id !== 'string'
      || typeof message.chatId !== 'string'
      || typeof message.chatName !== 'string'
      || typeof message.text !== 'string'
      || typeof message.when !== 'string'
      || !Number.isFinite(Date.parse(message.when))
      || typeof message.createdAt !== 'string'
      || !SCHEDULE_STATUSES.has(message.status)) {
      throw new Error('Schedule history contains an invalid message.');
    }
    return message;
  });
}

ipcMain.handle('schedule-history:load', (event, scope) => {
  assertDraftStorageRenderer(event);
  if (!SCHEDULE_HISTORY_SCOPES.has(scope)) return { success: false, error: 'Schedule history scope is invalid.' };

  const exists = fs.existsSync(SCHEDULE_HISTORY_PATH);
  const store = readJsonFile(SCHEDULE_HISTORY_PATH, null);
  if (exists && (!store || typeof store !== 'object' || Array.isArray(store))) {
    return { success: false, error: 'Schedule history could not be read.' };
  }

  try {
    const scopeStore = store?.[scope];
    const history = {
      upcoming: validateStoredScheduleMessages(scopeStore?.upcoming ?? []),
      sent: validateStoredScheduleMessages(scopeStore?.sent ?? []),
    };
    return { success: true, history, needsMigration: !scopeStore };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Schedule history could not be read.' };
  }
});

ipcMain.handle('schedule-history:save', (event, data = {}) => {
  assertDraftStorageRenderer(event);
  const { scope, field, messages } = data;
  if (!SCHEDULE_HISTORY_SCOPES.has(scope) || !SCHEDULE_HISTORY_FIELDS.has(field)) {
    return { success: false, error: 'Schedule history destination is invalid.' };
  }

  try {
    const exists = fs.existsSync(SCHEDULE_HISTORY_PATH);
    const current = readJsonFile(SCHEDULE_HISTORY_PATH, null);
    if (exists && (!current || typeof current !== 'object' || Array.isArray(current))) {
      throw new Error('Existing schedule history could not be read.');
    }
    const validatedMessages = validateStoredScheduleMessages(messages);
    const scopeHistory = current?.[scope] && typeof current[scope] === 'object'
      ? current[scope]
      : { upcoming: [], sent: [] };
    writeJsonFile(SCHEDULE_HISTORY_PATH, {
      schemaVersion: 1,
      ...(current ?? {}),
      [scope]: { ...scopeHistory, [field]: validatedMessages },
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Schedule history could not be saved.' };
  }
});

ipcMain.handle('draft-store:load', (event) => {
  assertDraftStorageRenderer(event);
  return draftStore.load();
});

ipcMain.handle('draft-store:migrate', (event, legacy) => {
  assertDraftStorageRenderer(event);
  return draftStore.migrate(legacy);
});

ipcMain.handle('draft-store:save', async (event, data) => {
  assertDraftStorageRenderer(event);
  try {
    return { success: true, store: await draftStore.save(data) };
  } catch (error) {
    return { success: false, code: 'WRITE_FAILED', error: error instanceof Error ? error.message : 'Drafts could not be saved.' };
  }
});

ipcMain.on('draft-store:flush', (event, data) => {
  try {
    assertDraftStorageRenderer(event);
    event.returnValue = { success: true, store: draftStore.saveSync(data) };
  } catch (error) {
    event.returnValue = { success: false, code: 'WRITE_FAILED', error: error instanceof Error ? error.message : 'Drafts could not be saved before closing.' };
  }
});

ipcMain.handle('draft-store:restore-backup', (event, index) => {
  assertDraftStorageRenderer(event);
  return draftStore.restoreBackup(index);
});

ipcMain.handle('draft-store:copy-attachment', (event, sourcePath) => {
  assertDraftStorageRenderer(event);
  return draftStore.copyAttachment(sourcePath);
});

ipcMain.handle('draft-store:export', async (event) => {
  assertDraftStorageRenderer(event);
  const owner = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showSaveDialog(owner, {
    title: 'Export Saved Drafts',
    defaultPath: 'awaitmsg-drafts-backup.json',
    filters: [{ name: 'JSON backup', extensions: ['json'] }],
  });
  if (result.canceled || !result.filePath) return { success: false, cancelled: true };
  return draftStore.exportTo(result.filePath);
});

ipcMain.handle('draft-store:import', async (event) => {
  assertDraftStorageRenderer(event);
  const owner = BrowserWindow.fromWebContents(event.sender);
  const selection = await dialog.showOpenDialog(owner, {
    title: 'Import Saved Drafts',
    properties: ['openFile'],
    filters: [{ name: 'JSON backup', extensions: ['json'] }],
  });
  if (selection.canceled || !selection.filePaths[0]) return { success: false, cancelled: true };

  const choice = await dialog.showMessageBox(owner, {
    type: 'question',
    title: 'Import Saved Drafts',
    message: 'Choose how to import this backup.',
    detail: 'Merge keeps existing drafts and updates matching IDs. Replace overwrites the current library.',
    buttons: ['Merge', 'Replace', 'Cancel'],
    defaultId: 0,
    cancelId: 2,
  });
  if (choice.response === 2) return { success: false, cancelled: true };
  return draftStore.importFrom(selection.filePaths[0], choice.response === 0 ? 'merge' : 'replace');
});

ipcMain.handle('editor-text:export', async (event, text) => {
  assertDraftStorageRenderer(event);
  const owner = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showSaveDialog(owner, {
    title: 'Export editor text',
    defaultPath: 'message.txt',
    filters: [{ name: 'Text document', extensions: ['txt'] }],
  });
  if (result.canceled || !result.filePath) return { success: false, cancelled: true };
  return draftStore.exportTextTo(result.filePath, text);
});

ipcMain.handle('editor-text:import', async (event) => {
  assertDraftStorageRenderer(event);
  const owner = BrowserWindow.fromWebContents(event.sender);
  const selection = await dialog.showOpenDialog(owner, {
    title: 'Import text into editor',
    properties: ['openFile'],
    filters: [{ name: 'Text document', extensions: ['txt'] }],
  });
  if (selection.canceled || !selection.filePaths[0]) return { success: false, cancelled: true };
  return draftStore.importTextFrom(selection.filePaths[0]);
});

ipcMain.handle('telegram-connect', async (event) => {
  assertTrustedRenderer(
    event,
    mainWindow?.webContents,
    pathToFileURL(path.join(__dirname, 'dist', 'index.html')).href
  );
  try {
    await connectTelegram();
    return { success: true };
  } catch (error) {
    console.error('Telegram connection error:', error?.code || error?.name || 'unknown');
    return { success: false, error: error.message };
  }
});

ipcMain.handle('telegram-config', async (event) => {
  assertTrustedRenderer(
    event,
    mainWindow?.webContents,
    pathToFileURL(path.join(__dirname, 'dist', 'index.html')).href
  );
  try {
    const config = getTelegramConfig();
    return {
      success: true,
      config: {
        hasCredentials: Boolean(config.hasCredentials),
        hasSession: Boolean(config.hasSession),
        connected: Boolean(config.connected)
      }
    };
  } catch (error) {
    console.error('Telegram config read error:', error?.code || error?.name || 'unknown');
    return { success: false, error: error.message };
  }
});

ipcMain.handle('telegram-save-credentials', async (event, data = {}) => {
  assertTrustedRenderer(
    event,
    mainWindow?.webContents,
    pathToFileURL(path.join(__dirname, 'dist', 'index.html')).href
  );

  const validated = validateTelegramCredentialsPayload(data);

  try {
    const result = saveTelegramApiCredentials(validated);

    if (!result.saved) {
      return { success: false, error: 'Telegram API credentials could not be saved securely.' };
    }

    return {
      success: true,
      config: {
        hasCredentials: Boolean(result.config?.hasCredentials),
        hasSession: Boolean(result.config?.hasSession),
        connected: Boolean(result.config?.connected)
      }
    };
  } catch (error) {
    console.error('Telegram credentials save error:', error?.code || error?.name || 'unknown');
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Telegram API credentials could not be saved securely.'
    };
  }
});

ipcMain.handle('telegram-auth-state', async (event) => {
  assertTrustedRenderer(
    event,
    mainWindow?.webContents,
    pathToFileURL(path.join(__dirname, 'dist', 'index.html')).href
  );
  try {
    return { success: true, authState: getSafeTelegramAuthState() };
  } catch (error) {
    console.error('Telegram auth state error:', error?.code || error?.name || 'unknown');
    return { success: false, error: error.message };
  }
});

ipcMain.handle('telegram-rate-limit-state', async (event) => {
  assertTrustedRenderer(
    event,
    mainWindow?.webContents,
    pathToFileURL(path.join(__dirname, 'dist', 'index.html')).href
  );
  return getTelegramRateLimitState();
});

ipcMain.handle('telegram-status', async (event) => {
  assertTrustedRenderer(
    event,
    mainWindow?.webContents,
    pathToFileURL(path.join(__dirname, 'dist', 'index.html')).href
  );
  return getTelegramStatus();
});

ipcMain.handle('telegram-wait-for-rate-limit', async (event) => {
  assertTrustedRenderer(
    event,
    mainWindow?.webContents,
    pathToFileURL(path.join(__dirname, 'dist', 'index.html')).href
  );
  try {
    return await waitForTelegramRateLimit();
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Telegram is not ready to resume requests.'
    };
  }
});

ipcMain.handle('telegram-sign-out-keep-session', async (event) => {
  assertTrustedRenderer(
    event,
    mainWindow?.webContents,
    pathToFileURL(path.join(__dirname, 'dist', 'index.html')).href
  );
  try {
    await signOutKeepSession();
    return { success: true, authState: getSafeTelegramAuthState() };
  } catch (error) {
    console.error('Telegram sign out error:', error?.code || error?.name || 'unknown');
    return { success: false, error: error.message };
  }
});

ipcMain.handle('telegram-welcome-back', async (event) => {
  assertTrustedRenderer(
    event,
    mainWindow?.webContents,
    pathToFileURL(path.join(__dirname, 'dist', 'index.html')).href
  );
  try {
    await welcomeBack();
    return { success: true, authState: getSafeTelegramAuthState() };
  } catch (error) {
    console.error('Telegram Welcome Back error:', error?.code || error?.name || 'unknown');
    return { success: false, error: error.message };
  }
});

ipcMain.handle('telegram-forget-account', async (event) => {
  assertTrustedRenderer(
    event,
    mainWindow?.webContents,
    pathToFileURL(path.join(__dirname, 'dist', 'index.html')).href
  );
  try {
    await forgetTelegramAccount();
    return { success: true, authState: getSafeTelegramAuthState() };
  } catch (error) {
    console.error('Telegram account removal error:', error?.code || error?.name || 'unknown');
    return { success: false, error: error.message };
  }
});

ipcMain.handle('telegram-clear-session', async (event) => {
  assertTrustedRenderer(
    event,
    mainWindow?.webContents,
    pathToFileURL(path.join(__dirname, 'dist', 'index.html')).href
  );
  try {
    const result = await clearTelegramSession();
    return { success: true, ...result };
  } catch (error) {
    console.error('Telegram clear session error:', error?.code || error?.name || 'unknown');
    return { success: false, error: error.message };
  }
});

ipcMain.handle('telegram-login', async (event, data = {}) => {
  assertTrustedRenderer(
    event,
    mainWindow?.webContents,
    pathToFileURL(path.join(__dirname, 'dist', 'index.html')).href
  );
  const validated = validateLoginPayload(data);

  try {
    const result = await loginUser(validated);
    return {
      success: true,
      requiresCode: result.requiresCode === true,
      requiresPassword: result.requiresPassword === true,
      nextStep: result.nextStep,
      isCodeViaApp: result.isCodeViaApp === true
    };
  } catch (error) {
    console.error('Telegram login error:', error?.code || error?.name || 'unknown');
    return { success: false, error: error.message };
  }
});

ipcMain.handle('telegram-chats', async (event) => {
  assertTrustedRenderer(
    event,
    mainWindow?.webContents,
    pathToFileURL(path.join(__dirname, 'dist', 'index.html')).href
  );
  try {
    const chats = await getChats();
    return { success: true, chats };
  } catch (error) {
    console.error('Telegram chats error:', error?.code || error?.name || 'unknown');
    return { success: false, error: error.message };
  }
});

ipcMain.handle('telegram-chat-avatar', async (event, chatId) => {
  assertTrustedRenderer(
    event,
    mainWindow?.webContents,
    pathToFileURL(path.join(__dirname, 'dist', 'index.html')).href
  );
  const validatedChatId = validateChatId(chatId);

  try {
    return { success: true, avatarDataUrl: await getChatAvatar(validatedChatId) };
  } catch (error) {
    console.error('Telegram chat avatar error:', error?.code || error?.name || 'unknown');
    return { success: false, avatarDataUrl: '', error: error.message };
  }
});

ipcMain.handle('telegram-chat-permissions', async (event, chatId) => {
  assertTrustedRenderer(
    event,
    mainWindow?.webContents,
    pathToFileURL(path.join(__dirname, 'dist', 'index.html')).href
  );
  const validatedChatId = validateChatId(chatId);

  try {
    return { success: true, permissions: await getChatPermissions(validatedChatId) };
  } catch (error) {
    console.error('Telegram chat permissions error:', error?.code || error?.name || 'unknown');
    return { success: false, error: error.message };
  }
});

ipcMain.handle('telegram-chat-history', async (event, data = {}) => {
  assertTrustedRenderer(
    event,
    mainWindow?.webContents,
    pathToFileURL(path.join(__dirname, 'dist', 'index.html')).href
  );
  const validated = validateHistoryPayload(data);

  try {
    return {
      success: true,
      history: await getChatHistory(validated.chatId, validated.limit)
    };
  } catch (error) {
    console.error('Telegram chat history error:', error?.code || error?.name || 'unknown');
    return { success: false, error: error.message };
  }
});

// -------------------------
// Telegram contacts
// -------------------------

ipcMain.handle('telegram-contacts', async (event) => {
  assertTrustedRenderer(
    event,
    mainWindow?.webContents,
    pathToFileURL(path.join(__dirname, 'dist', 'index.html')).href
  );
  try {
    const contacts = await getContacts();

    return {
      success: true,
      contacts
    };

  } catch (error) {
    console.error('Telegram contacts error:', error?.code || error?.name || 'unknown');

    return {
      success: false,
      error: error.message
    };
  }
});

ipcMain.handle('telegram-effects', async (event) => {
  assertTrustedRenderer(
    event,
    mainWindow?.webContents,
    pathToFileURL(path.join(__dirname, 'dist', 'index.html')).href
  );
  try {
    const effects = await getAvailableEffects();
    return {
      success: true,
      effects
    };
  } catch (error) {
    console.error('Telegram effects error:', error?.code || error?.name || 'unknown');
    return {
      success: false,
      error: error.message
    };
  }
});

// -------------------------
// Find Telegram chat
// -------------------------

ipcMain.handle('telegram-find-chat', async (event, query) => {
  assertTrustedRenderer(
    event,
    mainWindow?.webContents,
    pathToFileURL(path.join(__dirname, 'dist', 'index.html')).href
  );
  const validatedQuery = validateQuery(query);

  try {
    const chat = await resolveChat(validatedQuery);

    return {
      success: true,
      chat
    };

  } catch (error) {
    console.error('Telegram find chat error:', error?.code || error?.name || 'unknown');

    return {
      success: false,
      error: error.message
    };
  }
});


// -------------------------
// Send message
// -------------------------

ipcMain.handle('telegram-send', async (event, data) => {
  assertTrustedRenderer(
    event,
    mainWindow?.webContents,
    pathToFileURL(path.join(__dirname, 'dist', 'index.html')).href
  );
  const validated = validateSendPayload(data);

  try {
    await sendMessage(
      validated.chatId,
      validated.message,
      validated.attachments,
      validated.entities,
      validated.replyMarkup,
      validated.silent,
      validated.effect
    );

    return {
      success: true
    };

  } catch (error) {
    console.error('Telegram send error:', error?.code || error?.name || 'unknown');

    return {
      success: false,
      error: error.message,
      code: error.code,
      waitSeconds: error.waitSeconds
    };
  }
});


// -------------------------
// Schedule message
// -------------------------

ipcMain.handle('telegram-schedule', async (event, data) => {
  assertTrustedRenderer(
    event,
    mainWindow?.webContents,
    pathToFileURL(path.join(__dirname, 'dist', 'index.html')).href
  );
  const validated = validateSchedulePayload(data);

  try {
    const result = await scheduleMessage(
      validated.chatId,
      validated.message,
      undefined,
      undefined,
      validated.targetTimestamp,
      validated.attachments,
      validated.entities,
      validated.replyMarkup,
      validated.silent,
      validated.effect
    );

    return {
      success: true,
      telegramMessageId: result.telegramMessageId ?? result.id,
      confirmed: result.confirmed === true
    };

  } catch (error) {
    console.error('Schedule error:', error?.code || error?.name || 'unknown');

    return {
      success: false,
      error: error.message,
      code: error.code,
      waitSeconds: error.waitSeconds
    };
  }
});

// -------------------------
// Cancel scheduled message
// -------------------------

ipcMain.handle('telegram-cancel', async (event, data) => {
  assertTrustedRenderer(
    event,
    mainWindow?.webContents,
    pathToFileURL(path.join(__dirname, 'dist', 'index.html')).href
  );
  const validated = validateCancelPayload(data);

  try {
    await cancelScheduledMessage(
      validated.chatId,
      validated.telegramMessageId
    );

    return {
      success: true
    };

  } catch (error) {
    console.error('Cancel error:', error?.code || error?.name || 'unknown');

    return {
      success: false,
      error: error.message
    };
  }
});

// -------------------------
// App
// -------------------------

app.whenReady().then(() => {

  console.log('XMSGi started.');
  createWindow();
  createTray();

  app.on('activate', () => {

    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }

    createTray();

  });

});


app.on('window-all-closed', () => {
  // Closing the window is handled by mainWindow.close and keeps the app in the tray.
});

app.on('before-quit', (event) => {
  if (isQuitting) return;

  event.preventDefault();
  requestQuit();
});

app.on('will-quit', () => {
  if (tray) {
    tray.destroy();
    tray = null;
  }
});
