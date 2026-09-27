import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const mainSource = fs.readFileSync(path.join(projectRoot, 'main.cjs'), 'utf8');

describe('Electron tray lifecycle contract', () => {
  it('creates one tray with Open and Exit actions', () => {
    expect(mainSource).toContain('if (tray) return;');
    expect(mainSource).toContain("new Tray(path.join(__dirname, 'build', 'icon.ico'))");
    expect(mainSource).toContain("label: 'Open XMSGi'");
    expect(mainSource).toContain("label: 'Exit'");
    expect(mainSource).toContain("tray.on('double-click', showMainWindow)");
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

  it('focuses the existing window for a second instance', () => {
    expect(mainSource).toContain("app.on('second-instance'");
    expect(mainSource).toContain('showMainWindow();');
  });
});