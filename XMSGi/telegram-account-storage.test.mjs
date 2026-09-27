import { describe, expect, it, vi } from 'vitest';
import { Buffer } from 'node:buffer';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createAccountStorageAdapter } = require('./telegram-account-storage.cjs');

function getConfigPath() {
  return 'C:\\temp\\awaitmsg-secure-config.json';
}

function createFakeStorage(initialConfig = {}, options = {}) {
  const files = new Map([
    [getConfigPath(), options.rawConfig ?? JSON.stringify(initialConfig)]
  ]);
  const safeStorage = {
    isEncryptionAvailable: () => options.encryptionAvailable !== false,
    encryptString: (value) => Buffer.from(`encrypted:${value}`),
    decryptString: (value) => value.toString().replace(/^encrypted:/, '')
  };
  const fs = {
    readFileSync: vi.fn((filePath) => {
      if (options.readError) throw options.readError;
      if (!files.has(filePath)) throw new Error('missing');
      return files.get(filePath);
    }),
    writeFileSync: vi.fn((filePath, value) => {
      if (options.writeError) throw options.writeError;
      files.set(filePath, value);
    }),
    renameSync: vi.fn((temporaryPath, configPath) => {
      if (options.renameError) throw options.renameError;
      files.set(configPath, files.get(temporaryPath));
      files.delete(temporaryPath);
    }),
    unlinkSync: vi.fn((filePath) => {
      files.delete(filePath);
    })
  };
  const adapter = createAccountStorageAdapter({
    fs,
    path: { join: () => getConfigPath() },
    app: { getPath: () => 'C:\\temp' },
    safeStorage
  });

  return { adapter, files, fs };
}

describe('telegram account storage adapter', () => {
  it('preserves unrelated config and encrypted session persistence', () => {
    const { adapter, files } = createFakeStorage({ AI_ASSISTANT_ENABLED: true });

    expect(adapter.saveAccountSecrets({
      API_ID: '123',
      API_HASH: 'hash',
      SESSION_STRING: 'session'
    })).toBe(true);

    expect(JSON.parse(files.get(getConfigPath()))).toEqual({
      API_ID_ENCRYPTED: 'ZW5jcnlwdGVkOjEyMw==',
      API_HASH_ENCRYPTED: 'ZW5jcnlwdGVkOmhhc2g=',
      SESSION_STRING_ENCRYPTED: 'ZW5jcnlwdGVkOnNlc3Npb24=',
      AI_ASSISTANT_ENABLED: true
    });
    expect(JSON.parse(files.get(getConfigPath()))).toEqual({
      API_ID_ENCRYPTED: 'ZW5jcnlwdGVkOjEyMw==',
      API_HASH_ENCRYPTED: 'ZW5jcnlwdGVkOmhhc2g=',
      SESSION_STRING_ENCRYPTED: 'ZW5jcnlwdGVkOnNlc3Npb24=',
      AI_ASSISTANT_ENABLED: true
    });
  });

  it('clears session without removing credentials and migrates legacy secrets', () => {
    const { adapter, files } = createFakeStorage({
      API_ID: '123',
      API_HASH: 'hash',
      SESSION_STRING: 'session'
    });

    expect(adapter.loadAccountSecrets()).toEqual({
      API_ID: '123',
      API_HASH: 'hash',
      SESSION_STRING: 'session',
      signedOut: false
    });
    expect(JSON.parse(files.get(getConfigPath()))).toEqual({
      API_ID_ENCRYPTED: 'ZW5jcnlwdGVkOjEyMw==',
      API_HASH_ENCRYPTED: 'ZW5jcnlwdGVkOmhhc2g=',
      SESSION_STRING_ENCRYPTED: 'ZW5jcnlwdGVkOnNlc3Npb24='
    });
    expect(adapter.clearAccountSecrets()).toBe(true);
    expect(adapter.loadAccountSecrets()).toEqual({
      API_ID: '123',
      API_HASH: 'hash',
      SESSION_STRING: '',
      signedOut: false
    });
  });

  it('migrates legacy Telegram plaintext fields without losing metadata', () => {
    const { adapter, files } = createFakeStorage({
      API_ID: '123',
      API_HASH: 'hash',
      SESSION_STRING: 'session',
      SIGNED_OUT: true,
      GEMINI_API_KEY_ENCRYPTED: 'gemini-ciphertext',
      AI_ASSISTANT_ENABLED: false
    });

    expect(adapter.loadAccountSecrets()).toMatchObject({
      API_ID: '123',
      API_HASH: 'hash',
      SESSION_STRING: 'session',
      signedOut: true
    });

    const migratedConfig = JSON.parse(files.get(getConfigPath()));

    expect(migratedConfig).toMatchObject({
      API_ID_ENCRYPTED: 'ZW5jcnlwdGVkOjEyMw==',
      API_HASH_ENCRYPTED: 'ZW5jcnlwdGVkOmhhc2g=',
      SESSION_STRING_ENCRYPTED: 'ZW5jcnlwdGVkOnNlc3Npb24=',
      SIGNED_OUT: true,
      GEMINI_API_KEY_ENCRYPTED: 'gemini-ciphertext',
      AI_ASSISTANT_ENABLED: false
    });
    expect(migratedConfig).not.toHaveProperty('API_ID');
    expect(migratedConfig).not.toHaveProperty('API_HASH');
    expect(migratedConfig).not.toHaveProperty('SESSION_STRING');
  });

  it('defaults missing signed-out metadata to false', () => {
    const { adapter } = createFakeStorage({
      SESSION_STRING_ENCRYPTED: 'ZW5jcnlwdGVkOnNlc3Npb24='
    });

    expect(adapter.getTelegramAuthState()).toEqual({
      hasSession: true,
      signedOut: false,
      userName: ''
    });
  });

  it('persists signed-out metadata without changing other config fields', () => {
    const { adapter, files } = createFakeStorage({
      API_ID_ENCRYPTED: 'ZW5jcnlwdGVkOjEyMw==',
      API_HASH_ENCRYPTED: 'ZW5jcnlwdGVkOmhhc2g=',
      SESSION_STRING_ENCRYPTED: 'ZW5jcnlwdGVkOnNlc3Npb24=',
      GEMINI_API_KEY_ENCRYPTED: 'gemini-ciphertext',
      AI_ASSISTANT_ENABLED: true
    });

    expect(adapter.setTelegramSignedOut(true)).toBe(true);
    expect(adapter.getTelegramAuthState()).toEqual({
      hasSession: true,
      signedOut: true,
      userName: ''
    });
    expect(JSON.parse(files.get(getConfigPath()))).toEqual({
      API_ID_ENCRYPTED: 'ZW5jcnlwdGVkOjEyMw==',
      API_HASH_ENCRYPTED: 'ZW5jcnlwdGVkOmhhc2g=',
      SESSION_STRING_ENCRYPTED: 'ZW5jcnlwdGVkOnNlc3Npb24=',
      GEMINI_API_KEY_ENCRYPTED: 'gemini-ciphertext',
      AI_ASSISTANT_ENABLED: true,
      SIGNED_OUT: true
    });

    expect(adapter.setTelegramSignedOut(false)).toBe(true);
    expect(adapter.loadAccountSecrets().signedOut).toBe(false);
  });

  it('updates API credentials without clearing an existing session or sign-out state', () => {
    const { adapter, files } = createFakeStorage({
      API_ID_ENCRYPTED: 'ZW5jcnlwdGVkOjEyMw==',
      API_HASH_ENCRYPTED: 'ZW5jcnlwdGVkOmxvbGQ=',
      SESSION_STRING_ENCRYPTED: 'ZW5jcnlwdGVkOnNlc3Npb24=',
      SIGNED_OUT: true
    });

    expect(adapter.saveAccountSecrets({
      API_ID: '456',
      API_HASH: 'new-hash'
    })).toBe(true);

    expect(adapter.loadAccountSecrets()).toEqual({
      API_ID: '456',
      API_HASH: 'new-hash',
      SESSION_STRING: 'session',
      signedOut: true
    });
    expect(JSON.parse(files.get(getConfigPath()))).not.toHaveProperty('API_HASH');
    expect(JSON.parse(files.get(getConfigPath()))).toHaveProperty('API_HASH_ENCRYPTED');
  });

  it('retains the session when setting signed-out metadata', () => {
    const { adapter, files } = createFakeStorage({
      SESSION_STRING_ENCRYPTED: 'ZW5jcnlwdGVkOnNlc3Npb24='
    });

    adapter.setTelegramSignedOut(true);

    expect(JSON.parse(files.get(getConfigPath()))).toMatchObject({
      SESSION_STRING_ENCRYPTED: 'ZW5jcnlwdGVkOnNlc3Npb24=',
      SIGNED_OUT: true
    });
  });

  it('persists the Telegram user name with the auth state', () => {
    const { adapter, files } = createFakeStorage({
      SESSION_STRING_ENCRYPTED: 'ZW5jcnlwdGVkOnNlc3Npb24='
    });

    expect(adapter.saveAccountSecrets({ userName: 'Alex Johnson' })).toBe(true);
    expect(adapter.getTelegramAuthState()).toEqual({
      hasSession: true,
      signedOut: false,
      userName: 'Alex Johnson'
    });
    expect(JSON.parse(files.get(getConfigPath()))).toMatchObject({
      TELEGRAM_USER_NAME: 'Alex Johnson',
      SESSION_STRING_ENCRYPTED: 'ZW5jcnlwdGVkOnNlc3Npb24='
    });

    expect(adapter.setTelegramSignedOut(true)).toBe(true);
    expect(adapter.getTelegramAuthState().userName).toBe('Alex Johnson');
  });

  it('does not overwrite a corrupted config during save', () => {
    const corruptedConfig = '{"API_ID_ENCRYPTED":';
    const { adapter, files, fs } = createFakeStorage({}, { rawConfig: corruptedConfig });

    expect(() => adapter.saveAccountSecrets({ SESSION_STRING: 'new-session' })).toThrow();
    expect(files.get(getConfigPath())).toBe(corruptedConfig);
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('does not overwrite an unreadable config during save', () => {
    const readError = Object.assign(new Error('access denied'), { code: 'EACCES' });
    const { adapter, files, fs } = createFakeStorage(
      { API_ID_ENCRYPTED: 'existing' },
      { readError }
    );
    const originalConfig = files.get(getConfigPath());

    expect(() => adapter.saveAccountSecrets({ SESSION_STRING: 'new-session' })).toThrow();
    expect(files.get(getConfigPath())).toBe(originalConfig);
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('returns failure and preserves the config when writing fails', () => {
    const writeError = new Error('disk full');
    const { adapter, files, fs } = createFakeStorage(
      { API_ID_ENCRYPTED: 'existing' },
      { writeError }
    );
    const originalConfig = files.get(getConfigPath());

    expect(adapter.saveAccountSecrets({ SESSION_STRING: 'new-session' })).toBe(false);
    expect(files.get(getConfigPath())).toBe(originalConfig);
    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
  });

  it('writes a temporary config and atomically renames it', () => {
    const { adapter, files, fs } = createFakeStorage({ AI_ASSISTANT_ENABLED: true });
    const configPath = getConfigPath();
    const temporaryPath = `${configPath}.tmp`;

    expect(adapter.saveAccountSecrets({ SESSION_STRING: 'session' })).toBe(true);
    expect(fs.writeFileSync).toHaveBeenCalledWith(temporaryPath, expect.any(String));
    expect(fs.renameSync).toHaveBeenCalledWith(temporaryPath, configPath);
    expect(files.has(temporaryPath)).toBe(false);
    expect(JSON.parse(files.get(configPath))).toMatchObject({
      SESSION_STRING_ENCRYPTED: 'ZW5jcnlwdGVkOnNlc3Npb24='
    });
  });

  it('preserves the original config when the temporary write fails', () => {
    const writeError = new Error('disk full');
    const { adapter, files, fs } = createFakeStorage(
      { AI_ASSISTANT_ENABLED: true },
      { writeError }
    );
    const originalConfig = files.get(getConfigPath());

    expect(adapter.saveAccountSecrets({ SESSION_STRING: 'session' })).toBe(false);
    expect(files.get(getConfigPath())).toBe(originalConfig);
    expect(fs.writeFileSync).toHaveBeenCalledWith(`${getConfigPath()}.tmp`, expect.any(String));
    expect(fs.renameSync).not.toHaveBeenCalled();
  });

  it('preserves the original config when the temporary rename fails', () => {
    const renameError = new Error('rename failed');
    const { adapter, files, fs } = createFakeStorage(
      { AI_ASSISTANT_ENABLED: true },
      { renameError }
    );
    const originalConfig = files.get(getConfigPath());

    expect(adapter.saveAccountSecrets({ SESSION_STRING: 'session' })).toBe(false);
    expect(files.get(getConfigPath())).toBe(originalConfig);
    expect(fs.renameSync).toHaveBeenCalledWith(
      `${getConfigPath()}.tmp`,
      getConfigPath()
    );
    expect(fs.unlinkSync).toHaveBeenCalledWith(`${getConfigPath()}.tmp`);
  });

  it('does not return encrypted secrets when safeStorage is unavailable', () => {
    const { adapter } = createFakeStorage({
      API_ID_ENCRYPTED: 'ZW5jcnlwdGVkOjEyMw==',
      API_HASH_ENCRYPTED: 'ZW5jcnlwdGVkOmhhc2g=',
      SESSION_STRING_ENCRYPTED: 'ZW5jcnlwdGVkOnNlc3Npb24='
    }, { encryptionAvailable: false });

    expect(adapter.loadAccountSecrets()).toEqual({
      API_ID: '',
      API_HASH: '',
      SESSION_STRING: '',
      signedOut: false
    });
  });

  it('does not use legacy plaintext secrets when safeStorage is unavailable', () => {
    const { adapter } = createFakeStorage({
      API_ID: '123',
      API_HASH: 'hash',
      SESSION_STRING: 'session'
    }, { encryptionAvailable: false });

    expect(adapter.loadAccountSecrets()).toEqual({
      API_ID: '',
      API_HASH: '',
      SESSION_STRING: '',
      signedOut: false
    });
  });

  it('does not report a successful save when safeStorage is unavailable', () => {
    const { adapter, files, fs } = createFakeStorage(
      { AI_ASSISTANT_ENABLED: true },
      { encryptionAvailable: false }
    );
    const originalConfig = files.get(getConfigPath());

    expect(() => adapter.saveAccountSecrets({ SESSION_STRING: 'session' }))
      .toThrow('Secure local storage is unavailable');
    expect(files.get(getConfigPath())).toBe(originalConfig);
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('preserves both changes from concurrent saves', async () => {
    const { adapter, files } = createFakeStorage({ AI_ASSISTANT_ENABLED: true });

    await Promise.all([
      Promise.resolve().then(() => adapter.saveAccountSecrets({ API_ID: '123' })),
      Promise.resolve().then(() => adapter.saveAccountSecrets({ API_HASH: 'hash' }))
    ]);

    expect(JSON.parse(files.get(getConfigPath()))).toMatchObject({
      API_ID_ENCRYPTED: 'ZW5jcnlwdGVkOjEyMw==',
      API_HASH_ENCRYPTED: 'ZW5jcnlwdGVkOmhhc2g=',
      AI_ASSISTANT_ENABLED: true
    });
  });

  it('does not let concurrent config changes overwrite unrelated data', async () => {
    const { adapter, files } = createFakeStorage({
      AI_ASSISTANT_ENABLED: true,
      existingSetting: 'keep'
    });

    await Promise.all([
      Promise.resolve().then(() => adapter.saveAccountSecrets({ SESSION_STRING: 'session' })),
      Promise.resolve().then(() => adapter.saveAccountSecrets({ API_ID: '123' }))
    ]);

    expect(JSON.parse(files.get(getConfigPath()))).toMatchObject({
      SESSION_STRING_ENCRYPTED: 'ZW5jcnlwdGVkOnNlc3Npb24=',
      API_ID_ENCRYPTED: 'ZW5jcnlwdGVkOjEyMw==',
      AI_ASSISTANT_ENABLED: true,
      existingSetting: 'keep'
    });
  });
});
