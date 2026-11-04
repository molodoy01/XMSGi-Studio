const { contextBridge, ipcRenderer, webUtils } = require('electron');
const telegramStatusSubscriptions = new WeakMap();

function createRendererSendHistoryWarningSubscription() {
  const callbacks = new Set();
  let pending = false;

  ipcRenderer.on('telegram-send-history-warning', () => {
    if (callbacks.size === 0) {
      pending = true;
      return;
    }
    for (const callback of callbacks) callback();
  });

  return (callback) => {
    if (typeof callback !== 'function') return () => {};

    callbacks.add(callback);
    if (pending) {
      pending = false;
      callback();
    }
    return () => callbacks.delete(callback);
  };
}

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

const subscribeToSendHistoryWarning = createRendererSendHistoryWarningSubscription();

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

  getAccountAvatar: () =>
    ipcRenderer.invoke('telegram-account-avatar'),

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

  reconcileSendAttempt: (data) =>
    ipcRenderer.invoke('telegram-send-reconcile', data),

  getScheduleIdentities: (operations) =>
    ipcRenderer.invoke('telegram-schedule-identities', { operations }),

  schedule: (data) =>
    ipcRenderer.invoke('telegram-schedule', data),

  reconcilePendingSchedule: (data) =>
    ipcRenderer.invoke('telegram-schedule-reconcile', data),

  getChatHistory: (data) =>
    ipcRenderer.invoke('telegram-chat-history', data),

  deleteSavedMessage: (data) =>
    ipcRenderer.invoke('telegram-saved-message:delete', data),

  getFilePath: (file) =>
    webUtils.getPathForFile(file),

  cancel: (data) =>
    ipcRenderer.invoke('telegram-cancel', data),

  onStatus: subscribeToTelegramStatus,

  onSendHistoryWarning: subscribeToSendHistoryWarning

});

contextBridge.exposeInMainWorld('draftStorage', {
  load: () => ipcRenderer.invoke('draft-store:load'),
  migrate: (legacy) => ipcRenderer.invoke('draft-store:migrate', legacy),
  save: (store) => ipcRenderer.invoke('draft-store:save', store),
  flush: (store) => ipcRenderer.sendSync('draft-store:flush', store),
  restoreBackup: (index) => ipcRenderer.invoke('draft-store:restore-backup', index),
  exportBackup: () => ipcRenderer.invoke('draft-store:export'),
  importBackup: () => ipcRenderer.invoke('draft-store:import'),
  exportText: (text, format) => ipcRenderer.invoke('editor-text:export', { text, format }),
  importText: () => ipcRenderer.invoke('editor-text:import'),
  copyAttachment: async (file) => {
    const sourcePath = webUtils.getPathForFile(file);
    if (sourcePath) return ipcRenderer.invoke('draft-store:copy-attachment', sourcePath);
    return ipcRenderer.invoke('draft-store:write-attachment', {
      name: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
  },
  copyAttachmentPath: (sourcePath) => ipcRenderer.invoke('draft-store:copy-attachment', sourcePath),
});
