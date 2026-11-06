const defaultPath = require('path');
const { resolveAppDataPath } = require('./app-data-path.cjs');
const SECRET_FIELDS = {
  API_ID: 'API_ID_ENCRYPTED',
  API_HASH: 'API_HASH_ENCRYPTED',
  SESSION_STRING: 'SESSION_STRING_ENCRYPTED'
};

function createAccountStorageAdapter({ fs, path, app, safeStorage, platform = process.platform } = {}) {
  const fileSystem = fs || require('fs');
  const pathModule = path || defaultPath;
  const electron = app && safeStorage
    ? { app, safeStorage }
    : require('electron');

  function getConfigPath() {
    return resolveAppDataPath(
      fileSystem,
      pathModule,
      electron.app.getPath('userData'),
      'xmsgi-studio-secure-config.json',
      'awaitmsg-secure-config.json',
    );
  }

  function isSafeStorageAvailable() {
    const storage = electron.safeStorage;
    if (!storage || typeof storage.isEncryptionAvailable !== 'function' || !storage.isEncryptionAvailable()) {
      return false;
    }

    return !(
      platform === 'linux' &&
      typeof storage.getSelectedStorageBackend === 'function' &&
      storage.getSelectedStorageBackend() === 'basic_text'
    );
  }

  function encryptSecret(secret) {
    if (!isSafeStorageAvailable()) {
      const message = platform === 'linux'
        ? 'Secure local storage is unavailable. Set up GNOME Keyring, KWallet, or another Secret Service and restart XMSGi Studio.'
        : 'Secure local storage is unavailable on this system.';
      throw new Error(message);
    }

    return electron.safeStorage.encryptString(String(secret ?? '')).toString('base64');
  }

  function decryptSecret(secret) {
    if (!secret) {
      return '';
    }

    if (!isSafeStorageAvailable()) {
      return '';
    }

    try {
      return electron.safeStorage.decryptString(Buffer.from(secret, 'base64')).trim();
    } catch (error) {
      console.error('Telegram secret decryption failed:', error);
      return '';
    }
  }

  function readRawConfig() {
    try {
      const raw = fileSystem.readFileSync(getConfigPath(), 'utf8');
      return JSON.parse(raw) || {};
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return {};
      }

      throw error;
    }
  }

  function writeRawConfig(config) {
    const configPath = getConfigPath();
    const temporaryPath = `${configPath}.tmp`;

    try {
      fileSystem.writeFileSync(temporaryPath, JSON.stringify(config, null, 2));
      fileSystem.renameSync(temporaryPath, configPath);
      return true;
    } catch (error) {
      try {
        fileSystem.unlinkSync(temporaryPath);
      } catch {
        // The temporary file may not exist when writing fails.
      }

      console.error('Secure config write failed:', error);
      return false;
    }
  }

  function getSecretValueFromConfig(config, key) {
    const encryptedKey = SECRET_FIELDS[key];

    if (encryptedKey && config[encryptedKey]) {
      return decryptSecret(config[encryptedKey]);
    }

    if (!isSafeStorageAvailable()) {
      return '';
    }

    return config[key] ?? '';
  }

  function migrateLegacySecrets(config) {
    if (!isSafeStorageAvailable()) {
      return config;
    }

    const nextConfig = { ...config };
    let migrated = false;

    Object.entries(SECRET_FIELDS).forEach(([key, encryptedKey]) => {
      const plainValue = nextConfig[key];

      if (plainValue !== undefined && plainValue !== null && plainValue !== '') {
        nextConfig[encryptedKey] = encryptSecret(plainValue);
        delete nextConfig[key];
        migrated = true;
      }
    });

    if (migrated) {
      if (!writeRawConfig(nextConfig)) {
        console.error(
          'Legacy plaintext Telegram secret migration could not be persisted. The existing config is unchanged; migration will retry on next launch.'
        );
      }
    }

    return nextConfig;
  }

  function loadAccountSecrets() {
    const config = migrateLegacySecrets(readRawConfig());

    return {
      API_ID: getSecretValueFromConfig(config, 'API_ID'),
      API_HASH: getSecretValueFromConfig(config, 'API_HASH'),
      SESSION_STRING: String(getSecretValueFromConfig(config, 'SESSION_STRING') || '').trim(),
      signedOut: config.SIGNED_OUT === true
    };
  }

  function getTelegramUserName(config = migrateLegacySecrets(readRawConfig())) {
    return typeof config.TELEGRAM_USER_NAME === 'string'
      ? config.TELEGRAM_USER_NAME.trim()
      : '';
  }

  function getTelegramUsername(config = migrateLegacySecrets(readRawConfig())) {
    return typeof config.TELEGRAM_USERNAME === 'string'
      ? config.TELEGRAM_USERNAME.trim().replace(/^@/, '')
      : '';
  }

  function saveAccountSecrets(secrets = {}) {
    const config = { ...migrateLegacySecrets(readRawConfig()) };

    Object.entries(SECRET_FIELDS).forEach(([key, encryptedKey]) => {
      const value = secrets[key];

      if (value !== undefined && value !== null && value !== '') {
        delete config[key];
        config[encryptedKey] = encryptSecret(value);
      }
    });

    if (secrets.signedOut !== undefined) {
      config.SIGNED_OUT = Boolean(secrets.signedOut);
    }

    if (secrets.userName !== undefined) {
      const userName = String(secrets.userName || '').trim();

      if (userName) {
        config.TELEGRAM_USER_NAME = userName;
      } else {
        delete config.TELEGRAM_USER_NAME;
      }
    }

    if (secrets.username !== undefined) {
      const username = String(secrets.username || '').trim().replace(/^@/, '');

      if (username) {
        config.TELEGRAM_USERNAME = username;
      } else {
        delete config.TELEGRAM_USERNAME;
      }
    }

    return writeRawConfig(config);
  }

  function getTelegramAuthState() {
    const config = migrateLegacySecrets(readRawConfig());
    const secrets = loadAccountSecrets();
    const authState = {
      hasSession: Boolean(secrets.SESSION_STRING),
      signedOut: secrets.signedOut,
      userName: getTelegramUserName(config)
    };
    const username = getTelegramUsername(config);
    if (username) authState.username = username;
    return authState;
  }

  function setTelegramSignedOut(value) {
    const config = { ...migrateLegacySecrets(readRawConfig()) };
    config.SIGNED_OUT = Boolean(value);
    return writeRawConfig(config);
  }

  function clearAccountSecrets({ sessionOnly = true } = {}) {
    const config = { ...migrateLegacySecrets(readRawConfig()) };

    delete config.SESSION_STRING;
    delete config.SESSION_STRING_ENCRYPTED;
    delete config.SIGNED_OUT;
    delete config.TELEGRAM_USER_NAME;
    delete config.TELEGRAM_USERNAME;

    if (!sessionOnly) {
      delete config.API_ID;
      delete config.API_ID_ENCRYPTED;
      delete config.API_HASH;
      delete config.API_HASH_ENCRYPTED;
    }

    return writeRawConfig(config);
  }

  return {
    loadAccountSecrets,
    saveAccountSecrets,
    getTelegramAuthState,
    setTelegramSignedOut,
    clearAccountSecrets
  };
}

let defaultAdapter;

function getDefaultAdapter() {
  if (!defaultAdapter) {
    defaultAdapter = createAccountStorageAdapter();
  }

  return defaultAdapter;
}

module.exports = {
  createAccountStorageAdapter,
  loadAccountSecrets: (...args) => getDefaultAdapter().loadAccountSecrets(...args),
  saveAccountSecrets: (...args) => getDefaultAdapter().saveAccountSecrets(...args),
  getTelegramAuthState: (...args) => getDefaultAdapter().getTelegramAuthState(...args),
  setTelegramSignedOut: (...args) => getDefaultAdapter().setTelegramSignedOut(...args),
  clearAccountSecrets: (...args) => getDefaultAdapter().clearAccountSecrets(...args)
};