const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('path');
const { createDraftStore } = require('./draft-store.cjs');

let draftStore;

function assertMainFrame(event) {
  if (!BrowserWindow.fromWebContents(event.sender) || event.senderFrame !== event.sender.mainFrame) {
    throw new Error('Draft storage is available only to the application window.');
  }
}

function registerDraftStorageIpc() {
  ipcMain.handle('draft-store:load', (event) => {
    assertMainFrame(event);
    return draftStore.load();
  });

  ipcMain.handle('draft-store:migrate', (event, legacy) => {
    assertMainFrame(event);
    return draftStore.migrate(legacy);
  });

  ipcMain.handle('draft-store:save', async (event, data) => {
    assertMainFrame(event);
    try {
      return { success: true, store: await draftStore.save(data) };
    } catch (error) {
      return { success: false, code: 'WRITE_FAILED', error: error instanceof Error ? error.message : 'Drafts could not be saved.' };
    }
  });

  ipcMain.on('draft-store:flush', (event, data) => {
    try {
      assertMainFrame(event);
      event.returnValue = { success: true, store: draftStore.saveSync(data) };
    } catch (error) {
      event.returnValue = { success: false, code: 'WRITE_FAILED', error: error instanceof Error ? error.message : 'Drafts could not be saved before closing.' };
    }
  });

  ipcMain.handle('draft-store:restore-backup', (event, index) => {
    assertMainFrame(event);
    return draftStore.restoreBackup(index);
  });

  ipcMain.handle('draft-store:copy-attachment', (event, sourcePath) => {
    assertMainFrame(event);
    return draftStore.copyAttachment(sourcePath);
  });

  ipcMain.handle('draft-store:export', async (event) => {
    assertMainFrame(event);
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
    assertMainFrame(event);
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
    assertMainFrame(event);
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
    assertMainFrame(event);
    const owner = BrowserWindow.fromWebContents(event.sender);
    const selection = await dialog.showOpenDialog(owner, {
      title: 'Import text into editor',
      properties: ['openFile'],
      filters: [{ name: 'Text document', extensions: ['txt'] }],
    });
    if (selection.canceled || !selection.filePaths[0]) return { success: false, cancelled: true };
    return draftStore.importTextFrom(selection.filePaths[0]);
  });
}

function createWindow() {
  const window = new BrowserWindow({
    title: 'XMSGi Studio',
    width: 1280,
    height: 900,
    minWidth: 900,
    minHeight: 620,
    backgroundColor: '#090b0d',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  window.loadFile(path.join(__dirname, 'dist', 'index.html'));
}

app.whenReady().then(() => {
  draftStore = createDraftStore({ directory: path.join(app.getPath('userData'), 'draft-storage') });
  registerDraftStorageIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
