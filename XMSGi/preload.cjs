const { contextBridge, ipcRenderer, webUtils } = require('electron');
const telegramStatusSubscriptions = new WeakMap();

function subscribeToTelegramStatus(callback) {
  if (typeof callback !== 'function') return () => {};

  let subscription = telegramStatusSubscriptions.get(callback);
  if (!subscription) {
    const listener = (_event, status) => callback(status);
    subscription = { listener, references: 0 };
    telegramStatusSubscriptions.set(callback, subscription);
    ipcRenderer.on('telegram-status', listener);
  }

  subscription.references += 1;
  let subscribed = true;

  return () => {
    if (!subscribed) return;
    subscribed = false;
    subscription.references -= 1;

    if (subscription.references === 0) {
      ipcRenderer.removeListener('telegram-status', subscription.listener);
      telegramStatusSubscriptions.delete(callback);
    }
  };
}
contextBridge.exposeInMainWorld('telegram', {

  getConfig: () =>
    ipcRenderer.invoke('telegram-config'),

  saveCredentials: (data) =>
    ipcRenderer.invoke('telegram-save-credentials', data),

  getAuthState: () =>
    ipcRenderer.invoke('telegram-auth-state'),

  signOutKeepSession: () =>
    ipcRenderer.invoke('telegram-sign-out-keep-session'),

  welcomeBack: () =>
    ipcRenderer.invoke('telegram-welcome-back'),

  forgetAccount: () =>
    ipcRenderer.invoke('telegram-forget-account'),

  clearSession: () =>
    ipcRenderer.invoke('telegram-clear-session'),

  login: (data) =>
    ipcRenderer.invoke('telegram-login', data),

  connect: () =>
    ipcRenderer.invoke('telegram-connect'),

  getChats: () =>
    ipcRenderer.invoke('telegram-chats'),

  getChatPermissions: (chatId) =>
    ipcRenderer.invoke('telegram-chat-permissions', chatId),

  getRateLimitState: () =>
    ipcRenderer.invoke('telegram-rate-limit-state'),

  getStatus: () =>
    ipcRenderer.invoke('telegram-status'),

  waitForRateLimit: () =>
    ipcRenderer.invoke('telegram-wait-for-rate-limit'),

  loadSavedChats: () =>
    ipcRenderer.invoke('chat-storage-load'),

  saveSavedChats: (chats) =>
    ipcRenderer.invoke('chat-storage-save', chats),

  loadScheduleHistory: (scope) =>
    ipcRenderer.invoke('schedule-history:load', scope),

  saveScheduleHistory: (data) =>
    ipcRenderer.invoke('schedule-history:save', data),

  getChatAvatar: (chatId) =>
    ipcRenderer.invoke('telegram-chat-avatar', chatId),

  findChat: (query) =>
    ipcRenderer.invoke('telegram-find-chat', query),

  getContacts: () =>
    ipcRenderer.invoke('telegram-contacts'),

  getAvailableEffects: () =>
    ipcRenderer.invoke('telegram-effects'),

  send: (chatId, message, attachments = [], entities = [], replyMarkup, silent = false, effect, accountId, idempotencyKey) =>
    ipcRenderer.invoke('telegram-send', {
      accountId,
      chatId,
      message,
      attachments,
      entities,
      replyMarkup,
      silent,
      effect,
      idempotencyKey
    }),

  getScheduleIdentities: (operations) =>
    ipcRenderer.invoke('telegram-schedule-identities', { operations }),

  schedule: (data) =>
    ipcRenderer.invoke('telegram-schedule', data),

  getChatHistory: (data) =>
    ipcRenderer.invoke('telegram-chat-history', data),

  deleteSavedMessage: (data) =>
    ipcRenderer.invoke('telegram-saved-message:delete', data),

  getFilePath: (file) =>
    webUtils.getPathForFile(file),

  cancel: (data) =>
    ipcRenderer.invoke('telegram-cancel', data),

  onStatus: subscribeToTelegramStatus

});

contextBridge.exposeInMainWorld('draftStorage', {
  load: () => ipcRenderer.invoke('draft-store:load'),
  migrate: (legacy) => ipcRenderer.invoke('draft-store:migrate', legacy),
  save: (store) => ipcRenderer.invoke('draft-store:save', store),
  flush: (store) => ipcRenderer.sendSync('draft-store:flush', store),
  restoreBackup: (index) => ipcRenderer.invoke('draft-store:restore-backup', index),
  exportBackup: () => ipcRenderer.invoke('draft-store:export'),
  importBackup: () => ipcRenderer.invoke('draft-store:import'),
  exportText: (text) => ipcRenderer.invoke('editor-text:export', text),
  importText: () => ipcRenderer.invoke('editor-text:import'),
  copyAttachment: (file) => {
    const sourcePath = webUtils.getPathForFile(file);
    return ipcRenderer.invoke('draft-store:copy-attachment', sourcePath);
  },
});

contextBridge.exposeInMainWorld('gemini', {
  generate: (prompt, context) =>
    ipcRenderer.invoke('gemini-generate', { prompt, context }),
  getSettings: () =>
    ipcRenderer.invoke('gemini-settings-status'),
  saveKey: (key) =>
    ipcRenderer.invoke('gemini-save-key', key),
  removeKey: () =>
    ipcRenderer.invoke('gemini-remove-key'),
  setEnabled: (enabled) =>
    ipcRenderer.invoke('gemini-set-enabled', enabled)
});
