import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import security from './ipc-security.cjs';

const {
  validateCancelPayload,
  validateChatId,
  validateLoginPayload,
  validateTelegramCredentialsPayload,
  validateSchedulePayload,
  validateSendPayload,
  validateTimestamp,
  assertTrustedRenderer
} = security;

describe('IPC security validation', () => {
  const webContents = {};
  const fileUrl = 'file:///app/dist/index.html';

  it('accepts a call from the expected renderer', () => {
    expect(() => assertTrustedRenderer(
      {
        sender: webContents,
        senderFrame: { url: fileUrl }
      },
      webContents,
      fileUrl
    )).not.toThrow();
  });

  it('rejects an unknown sender and a mismatched webContents', () => {
    expect(() => assertTrustedRenderer(
      {
        sender: {},
        senderFrame: { url: fileUrl }
      },
      webContents,
      fileUrl
    )).toThrow('Untrusted renderer');

    expect(() => assertTrustedRenderer(
      {
        sender: webContents,
        senderFrame: { url: 'https://attacker.invalid/' }
      },
      webContents,
      fileUrl
    )).toThrow('Untrusted renderer');
  });

  it('rejects invalid chat IDs, message types, and oversized messages', () => {
    expect(() => validateChatId('username')).toThrow('chatId');
    expect(() => validateSendPayload({ chatId: 'me', message: 42 })).toThrow('message');
    expect(() => validateSendPayload({
      chatId: 'me',
      message: 'x'.repeat(4097)
    })).toThrow('too long');

    expect(validateSendPayload({
      chatId: 'me',
      message: 'With media',
      attachments: ['C:\\media\\photo.jpg'],
      entities: [
        { type: 'bold', offset: 0, length: 4 },
        { type: 'text_url', offset: 5, length: 5, url: 'https://example.com' }
      ]
    })).toMatchObject({
      attachments: ['C:\\media\\photo.jpg'],
      entities: [
        { type: 'bold', offset: 0, length: 4 },
        { type: 'text_url', offset: 5, length: 5, url: 'https://example.com' }
      ]
    });
    expect(() => validateSendPayload({
      chatId: 'me',
      message: 'short',
      entities: [{ type: 'bold', offset: 4, length: 2 }]
    })).toThrow('range');
    expect(() => validateSendPayload({
      chatId: 'me',
      message: 'link',
      entities: [{ type: 'text_url', offset: 0, length: 4, url: 'javascript:bad' }]
    })).toThrow('url');
  });

  it('rejects invalid timestamps and scheduling payloads', () => {
    expect(() => validateTimestamp(1)).toThrow('targetTimestamp');
    expect(() => validateSchedulePayload({
      chatId: 'me',
      message: 'Reminder',
      targetTimestamp: 'tomorrow'
    })).toThrow('targetTimestamp');
  });

  it('validates credentials without returning them as a login result', () => {
    expect(validateLoginPayload({ phoneNumber: '+15550000000' })).toEqual({
      phoneNumber: '+15550000000'
    });
    expect(() => validateLoginPayload({ phoneNumber: '+1', password: 42 })).toThrow('password');
    expect(() => validateCancelPayload({ chatId: 'me', telegramMessageId: 'bad' })).toThrow('telegramMessageId');

    const mainSource = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), 'main.cjs'),
      'utf8'
    );
    expect(mainSource).toContain('requiresCode: result.requiresCode === true');
    expect(mainSource).not.toContain('session: result.session');
    expect(mainSource).not.toContain('user: result.user');
    expect(mainSource).not.toContain('phoneCodeHash: result.phoneCodeHash');

    const telegramSource = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), 'telegram.cjs'),
      'utf8'
    );
    expect(mainSource).not.toContain('process.env.SESSION_STRING');
    expect(mainSource).not.toContain('loadProductionSecrets');
    expect(mainSource).not.toContain('syncSecureEnv');
    expect(telegramSource).not.toContain('process.env.SESSION_STRING');
  });

  it('validates the dedicated Telegram credential save payload', () => {
    expect(validateTelegramCredentialsPayload({
      API_ID: '123456',
      API_HASH: 'hash-value'
    })).toEqual({
      API_ID: '123456',
      API_HASH: 'hash-value'
    });
    expect(() => validateTelegramCredentialsPayload({ API_ID: '0', API_HASH: 'hash' })).toThrow('API_ID');
    expect(() => validateTelegramCredentialsPayload({ API_ID: '123', API_HASH: 'x'.repeat(257) })).toThrow('API_HASH');
  });

  it('keeps auth IPC responses credential-free', () => {
    const projectRoot = path.dirname(fileURLToPath(import.meta.url));
    const mainSource = fs.readFileSync(path.join(projectRoot, 'main.cjs'), 'utf8');
    const preloadSource = fs.readFileSync(path.join(projectRoot, 'preload.cjs'), 'utf8');
    const authStateFunction = mainSource.match(
      /function getSafeTelegramAuthState\(\) \{[\s\S]*?\n\}/
    )?.[0];

    expect(authStateFunction).toBeDefined();
    expect(authStateFunction).toContain('hasSession');
    expect(authStateFunction).toContain('signedOut');
    expect(authStateFunction).toContain('connected');
    expect(authStateFunction).toContain('state');
    expect(authStateFunction).not.toMatch(/SESSION_STRING|API_ID|API_HASH|ENCRYPTED/);

    for (const channel of [
      'telegram-auth-state',
      'telegram-sign-out-keep-session',
      'telegram-welcome-back',
      'telegram-forget-account'
    ]) {
      expect(mainSource).toContain(
        `ipcMain.handle('${channel}', async (event) => {`
      );
    }

    expect(mainSource).not.toMatch(
      /ipcMain\.handle\('(telegram-auth-state|telegram-sign-out-keep-session|telegram-welcome-back|telegram-forget-account)', async \(event,/
    );

    expect(preloadSource).toMatch(
      /getAuthState:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('telegram-auth-state'\)/
    );
    expect(preloadSource).toMatch(
      /signOutKeepSession:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('telegram-sign-out-keep-session'\)/
    );
    expect(preloadSource).toMatch(
      /welcomeBack:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('telegram-welcome-back'\)/
    );
    expect(preloadSource).toMatch(
      /forgetAccount:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('telegram-forget-account'\)/
    );
  });

  it('does not expose credential parameters in new preload auth methods', () => {
    const preloadSource = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), 'preload.cjs'),
      'utf8'
    );

    for (const method of ['getAuthState', 'signOutKeepSession', 'welcomeBack', 'forgetAccount']) {
      expect(preloadSource).toMatch(
        new RegExp(`${method}:\\s*\\(\\)\\s*=>\\s*ipcRenderer\\.invoke\\('[^']+'\\)`)
      );
    }

    expect(preloadSource).not.toMatch(
      /(getAuthState|signOutKeepSession|welcomeBack|forgetAccount):\s*\([^)]*SESSION_STRING|\([^)]*API_ID|\([^)]*API_HASH/
    );
  });
});