import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const mainSource = fs.readFileSync(path.join(projectRoot, 'main.cjs'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));

describe('Electron tray lifecycle contract', () => {
  it('creates one tray with Open and Exit actions', () => {
    expect(mainSource).toContain('if (tray) return;');
    expect(mainSource).toContain('new Tray(appIconPath)');
    expect(mainSource).toContain("process.platform === 'win32'");
    expect(mainSource).toContain("path.join(__dirname, 'build', 'icon.ico')");
    expect(mainSource).toContain("path.join(__dirname, 'src', 'studio', 'assets', 'logo.png')");
    expect(mainSource).toContain("label: 'Open XMSGi Studio'");
    expect(mainSource).toContain("label: 'Exit'");
    expect(mainSource).toContain("tray.on('double-click', showMainWindow)");
  });

  it('keeps a practical desktop minimum size for both product views', () => {
    expect(mainSource).toContain('width: 900');
    expect(mainSource).toContain('minWidth: 900');
    expect(mainSource).toContain('minHeight: 800');
    expect(mainSource).toContain('resizable: true');
  });

  it('opens the CDP endpoint only for unpackaged Electron development', () => {
    expect(mainSource).toContain("if (!app.isPackaged) {");
    expect(mainSource).toContain("process.env.XMSGI_STUDIO_REMOTE_DEBUGGING_PORT || '9222'");
    expect(mainSource).toContain("app.commandLine.appendSwitch('remote-debugging-port', remoteDebuggingPort)");
  });

  it('keeps the Chromium sandbox enabled in both Electron launch scripts', () => {
    expect(packageJson.scripts.electron).not.toContain('--no-sandbox');
    expect(packageJson.scripts['electron:dev']).not.toContain('--no-sandbox');
    expect(mainSource).toContain('sandbox: true');
  });

  it('blocks main-window navigation outside the trusted renderer URL', () => {
    expect(mainSource).toContain("webContents.on('will-navigate'");
    expect(mainSource).toContain("webContents.on('will-redirect'");
    expect(mainSource).toContain('isTrustedRendererUrl(url, expectedRendererUrl)');
  });

  it('allows an isolated user data directory for a second development instance', () => {
    expect(mainSource).toContain('process.env.XMSGI_STUDIO_USER_DATA_DIR');
    expect(mainSource).toContain('path.resolve(isolatedUserDataRoot)');
  });

  it('uses the agent workspace profile when the Vite development server is enabled', () => {
    expect(mainSource).toContain("process.env.ELECTRON_DEV_SERVER === '1'");
    expect(mainSource).toContain("'XMSGi-Workspace-Agent'");
  });

  it('hides the window on close while preserving the Telegram lifecycle', () => {
    expect(mainSource).toContain("mainWindow.on('close'");
    expect(mainSource).toContain('event.preventDefault();');
    expect(mainSource).toContain('mainWindow.hide();');
    expect(mainSource).toContain('Closing the window is handled by mainWindow.close');
  });

  it('routes the real exit through one guarded shutdown path', () => {
    expect(mainSource).toContain('function requestQuit()');
    expect(mainSource).toContain('isQuitting = true;');
    expect(mainSource).toContain('shutdownTelegram()');
    expect(mainSource).toContain('app.quit();');
    expect(mainSource).toContain("app.on('will-quit'");
  });

  it('does not shut down Telegram when the window is only closed to tray', () => {
    expect(mainSource).toContain('if (isQuitting) return;');
    expect(mainSource).toContain('event.preventDefault();');
    expect(mainSource).toContain('mainWindow.hide();');
    expect(mainSource).not.toMatch(/mainWindow\.on\('close'[\s\S]{0,500}shutdownTelegram\(\)/);
  });

  it('guards tray creation and second-instance reuse', () => {
    expect(mainSource).toContain('if (tray) return;');
    expect(mainSource).toContain("app.on('second-instance'");
    expect(mainSource).toContain('showMainWindow();');
  });

  it('rejects a second instance before touching shared cache paths or debug ports', () => {
    const lockIndex = mainSource.indexOf('const hasSingleInstanceLock = app.requestSingleInstanceLock();');
    const dataPathIndex = mainSource.indexOf('const writableAppDataRoot');
    const cachePathIndex = mainSource.indexOf("app.commandLine.appendSwitch('disk-cache-dir', writableCacheRoot)");
    const debugPortIndex = mainSource.indexOf("app.commandLine.appendSwitch('remote-debugging-port', remoteDebuggingPort)");

    expect(lockIndex).toBeGreaterThan(-1);
    expect(lockIndex).toBeLessThan(dataPathIndex);
    expect(lockIndex).toBeLessThan(cachePathIndex);
    expect(lockIndex).toBeLessThan(debugPortIndex);
    expect(mainSource.slice(lockIndex, dataPathIndex)).toContain('if (!hasSingleInstanceLock)');
    expect(mainSource.slice(lockIndex, dataPathIndex)).toContain('app.quit();');
    expect(mainSource.slice(lockIndex, dataPathIndex)).toContain('return;');
  });

  it('restores the existing window when the app is activated', () => {
    const activateHandler = mainSource.match(/app\.on\('activate',[\s\S]*?\n\s{2}\}\);/)?.[0];

    expect(activateHandler).toContain('BrowserWindow.getAllWindows().length === 0');
    expect(activateHandler).toContain('showMainWindow();');
  });

  it('sets the macOS dock icon', () => {
    expect(mainSource).toContain("process.platform === 'darwin' && app.dock");
    expect(mainSource).toContain('app.dock.setIcon(appIconPath);');
  });

  it('focuses the existing window for a second instance', () => {
    expect(mainSource).toContain("app.on('second-instance'");
    expect(mainSource).toContain('showMainWindow();');
  });

  it('reloads the existing renderer for a rebuilt development instance only', () => {
    const secondInstanceHandler = mainSource.match(/app\.on\('second-instance',[\s\S]*?\n\}\);/)?.[0];

    expect(secondInstanceHandler).toContain('if (!app.isPackaged && mainWindow && !mainWindow.isDestroyed())');
    expect(secondInstanceHandler).toContain('mainWindow.webContents.reload();');
  });
});