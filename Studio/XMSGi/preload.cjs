const { contextBridge, ipcRenderer, webUtils } = require('electron');

const chats = [
  { id: 'telegram', name: 'Telegram', username: 'telegram', type: 'channel' },
  { id: 'studio', name: 'Studio Design', username: 'studio_design', type: 'group' },
  { id: 'notes', name: 'Private Notes', username: 'notes', type: 'private' },
];

contextBridge.exposeInMainWorld('telegram', {
  getChats: async () => ({ success: true, chats }),
  findChat: async (query) => {
    const normalized = String(query || '').toLowerCase();
    const chat = chats.find((item) => `${item.name} ${item.username}`.toLowerCase().includes(normalized));
    return chat ? { success: true, chat } : { success: false, error: 'Sample chat not found.' };
  },
  getChatHistory: async ({ chatId }) => ({
    success: true,
    history: {
      chat: chats.find((item) => item.id === chatId) || chats[0],
      messages: [
        { id: 'local-1', text: 'Local Studio preview history.', date: new Date().toISOString(), outgoing: false },
        { id: 'local-2', text: 'Telegram is not connected in this standalone build.', date: new Date().toISOString(), outgoing: true },
      ],
    },
  }),
  send: async () => ({ success: false, error: 'Telegram bridge is not connected.' }),
  schedule: async () => ({ success: false, error: 'Telegram bridge is not connected.' }),
  cancel: async () => ({ success: false, error: 'Telegram bridge is not connected.' }),
  onStatus: () => undefined,
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
