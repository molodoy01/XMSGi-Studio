const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('telegram', {
  getChats: () => ipcRenderer.invoke('telegram-chats'),
  findChat: (query) => ipcRenderer.invoke('telegram-find-chat', query),
  getChatHistory: (data) => ipcRenderer.invoke('telegram-chat-history', data),
  send: (chatId, message, attachments = [], entities = [], replyMarkup, silent = false, effect, accountId) =>
    ipcRenderer.invoke('telegram-send', { accountId, chatId, message, attachments, entities, replyMarkup, silent, effect }),
  schedule: (data) => ipcRenderer.invoke('telegram-schedule', data),
  cancel: (data) => ipcRenderer.invoke('telegram-cancel', data),
  getFilePath: (file) => webUtils.getPathForFile(file),
  onStatus: (callback) => {
    const handler = (_event, status) => {
      if (typeof callback === 'function') callback(status);
    };
    ipcRenderer.on('telegram-status', handler);
    return () => ipcRenderer.removeListener('telegram-status', handler);
  },
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
