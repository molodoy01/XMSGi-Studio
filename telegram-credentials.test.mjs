import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const nodeRequire = createRequire(import.meta.url);
const nodeModule = nodeRequire('node:module');
const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(
  fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')
);

function readSource(fileName) {
  return fs.readFileSync(path.join(projectRoot, fileName), 'utf8');
}

function clearEnvironmentApiCredentials() {
  delete process.env.API_ID;
  delete process.env.API_HASH;
}

function installLoginHarness(storageState, { onInvoke, sendCode, signInWithPassword } = {}) {
  const originalLoad = nodeModule._load;
  const constructedClients = [];

  nodeModule._load = function load(request, parent, isMain) {
    if (request === 'teleproto') {
      return {
        TelegramClient: class FakeTelegramClient {
          constructor(session, apiId, apiHash) {
            this.session = session;
            this.connected = false;
            constructedClients.push({ apiId, apiHash });
          }

          async connect() {
            this.connected = true;
          }

          async sendCode(...args) {
            if (sendCode) return sendCode(...args);
            return { phoneCodeHash: 'phone-code-hash', isCodeViaApp: false };
          }

          async invoke(request) {
            if (onInvoke) return onInvoke(request);
            return { user: { firstName: 'Alex' } };
          }

          async signInWithPassword(credentials, callbacks) {
            if (signInWithPassword) return signInWithPassword(credentials, callbacks);
            return { firstName: 'Alex' };
          }

          async disconnect() {
            this.connected = false;
          }
        },
        Api: {
          auth: {
            SignIn: class FakeSignIn {
              constructor(data) {
                Object.assign(this, data);
              }
            }
          }
        }
      };
    }

    if (request === 'teleproto/events') {
      return { NewMessage: class {} };
    }

    if (request === 'teleproto/sessions') {
      return {
        StringSession: class FakeStringSession {
          save() {
            return 'login-session-stub';
          }
        }
      };
    }

    if (request === './telegram-account-storage.cjs') {
      return {
        loadAccountSecrets: () => ({ ...storageState }),
        saveAccountSecrets: () => true,
        getTelegramAuthState: () => ({
          hasSession: Boolean(storageState.SESSION_STRING),
          signedOut: storageState.signedOut === true,
          userName: ''
        }),
        setTelegramSignedOut: (value) => {
          storageState.signedOut = Boolean(value);
          return true;
        },
        clearAccountSecrets: () => true
      };
    }

    return originalLoad(request, parent, isMain);
  };

  return {
    constructedClients,
    restore: () => {
      nodeModule._load = originalLoad;
    }
  };
}

async function clearPendingLogin(core) {
  const pendingLogin = core.lifecycleState.pendingLogin;

  if (pendingLogin) {
    await pendingLogin.clear();
  }
}

describe('application API configuration', () => {
  beforeEach(() => {
    clearEnvironmentApiCredentials();
  });

  afterEach(() => {
    clearEnvironmentApiCredentials();
    vi.resetModules();
  });

  it('ships valid xmsgiApi defaults in package.json', () => {
    expect(packageJson.xmsgiApi).toBeTypeOf('object');
    expect(String(packageJson.xmsgiApi.apiId)).toMatch(/^\d+$/);
    expect(String(packageJson.xmsgiApi.apiHash)).toMatch(/^[0-9a-f]{16,64}$/i);
  });

  it('recognizes package defaults as credentials on first launch', async () => {
    vi.resetModules();
    const harness = installLoginHarness({});
    let core = null;

    try {
      const { createTelegramCore } = await import('./telegram.cjs');
      core = createTelegramCore();

      expect(core.getTelegramConfig().hasCredentials).toBe(true);
    } finally {
      if (core) await clearPendingLogin(core);
      harness.restore();
    }
  });

  it('logs in with package defaults when account storage is empty', async () => {
    vi.resetModules();
    const harness = installLoginHarness({});
    let core = null;

    try {
      const { createTelegramCore } = await import('./telegram.cjs');
      core = createTelegramCore();

      const result = await core.loginUser({ phoneNumber: '+15550000000' });

      expect(result.requiresCode).toBe(true);
      expect(harness.constructedClients).toHaveLength(1);
      expect(harness.constructedClients[0].apiId).toBe(Number(packageJson.xmsgiApi.apiId));
      expect(harness.constructedClients[0].apiHash).toBe(packageJson.xmsgiApi.apiHash);
    } finally {
      if (core) await clearPendingLogin(core);
      harness.restore();
    }
  });

  it('keeps the pending login after an invalid code so the correct code can be retried', async () => {
    vi.resetModules();
    const phone = '+15550000000';
    const sendCode = vi.fn().mockResolvedValue({
      phoneCodeHash: 'phone-code-hash',
      isCodeViaApp: false
    });
    const submittedCodes = [];
    const harness = installLoginHarness({}, {
      sendCode,
      onInvoke: async (request) => {
        submittedCodes.push(request);
        if (request.phoneCode === 'wrong-code') {
          const error = new Error('The phone code is invalid.');
          error.errorMessage = 'PHONE_CODE_INVALID';
          throw error;
        }
        return { user: { firstName: 'Alex' } };
      }
    });
    let core = null;

    try {
      const { createTelegramCore } = await import('./telegram.cjs');
      core = createTelegramCore();

      await core.loginUser({ phoneNumber: phone });
      await expect(core.loginUser({
        phoneNumber: phone,
        phoneCode: 'wrong-code'
      })).rejects.toThrow('The phone code is invalid.');

      expect(core.lifecycleState.pendingLogin).not.toBeNull();

      const result = await core.loginUser({
        phoneNumber: phone,
        phoneCode: 'correct-code'
      });

      expect(result.success).toBe(true);
      expect(sendCode).toHaveBeenCalledOnce();
      expect(submittedCodes.map(({ phoneNumber, phoneCodeHash, phoneCode }) => ({
        phoneNumber,
        phoneCodeHash,
        phoneCode
      }))).toEqual([
        { phoneNumber: phone, phoneCodeHash: 'phone-code-hash', phoneCode: 'wrong-code' },
        { phoneNumber: phone, phoneCodeHash: 'phone-code-hash', phoneCode: 'correct-code' }
      ]);
    } finally {
      if (core) await core.shutdownTelegram();
      harness.restore();
    }
  });

  it('keeps the pending login after an invalid 2FA password so the correct password can be retried', async () => {
    vi.resetModules();
    const phone = '+15550000000';
    const sendCode = vi.fn().mockResolvedValue({
      phoneCodeHash: 'phone-code-hash',
      isCodeViaApp: false
    });
    const signInWithPassword = vi.fn(async (_credentials, callbacks) => {
      const password = await callbacks.password();
      if (password === 'wrong-password') {
        const error = new Error('The password is invalid.');
        error.errorMessage = 'PASSWORD_HASH_INVALID';
        if (await callbacks.onError(error)) {
          throw new Error('AUTH_USER_CANCEL');
        }
      }
      return { firstName: 'Alex' };
    });
    const harness = installLoginHarness({}, {
      sendCode,
      onInvoke: async () => {
        const error = new Error('Two-step verification is enabled.');
        error.errorMessage = 'SESSION_PASSWORD_NEEDED';
        throw error;
      },
      signInWithPassword
    });
    let core = null;

    try {
      const { createTelegramCore } = await import('./telegram.cjs');
      core = createTelegramCore();

      await core.loginUser({ phoneNumber: phone });
      await expect(core.loginUser({
        phoneNumber: phone,
        phoneCode: 'correct-code'
      })).resolves.toMatchObject({ requiresPassword: true, nextStep: 'password' });

      await expect(core.loginUser({
        phoneNumber: phone,
        phoneCode: 'correct-code',
        password: 'wrong-password'
      })).rejects.toThrow('The password is invalid.');

      expect(core.lifecycleState.pendingLogin).not.toBeNull();

      const result = await core.loginUser({
        phoneNumber: phone,
        phoneCode: 'correct-code',
        password: 'correct-password'
      });

      expect(result.success).toBe(true);
      expect(sendCode).toHaveBeenCalledOnce();
      expect(signInWithPassword).toHaveBeenCalledTimes(2);
      expect(await signInWithPassword.mock.calls[0][1].password()).toBe('wrong-password');
      expect(await signInWithPassword.mock.calls[1][1].password()).toBe('correct-password');
    } finally {
      if (core) await core.shutdownTelegram();
      harness.restore();
    }
  });

  it('requests a fresh code instead of reusing credentials after the pending login expires', async () => {
    vi.resetModules();
    const phone = '+15550000000';
    const sendCode = vi.fn()
      .mockResolvedValueOnce({ phoneCodeHash: 'first-hash', isCodeViaApp: false })
      .mockResolvedValueOnce({ phoneCodeHash: 'fresh-hash', isCodeViaApp: false });
    const onInvoke = vi.fn(async () => {
      const error = new Error('Two-step verification is enabled.');
      error.errorMessage = 'SESSION_PASSWORD_NEEDED';
      throw error;
    });
    const harness = installLoginHarness({}, { sendCode, onInvoke });
    let core = null;

    try {
      const { createTelegramCore } = await import('./telegram.cjs');
      core = createTelegramCore({ loginTtlMs: 25 });

      await core.loginUser({ phoneNumber: phone });
      await expect(core.loginUser({
        phoneNumber: phone,
        phoneCode: 'accepted-code'
      })).resolves.toMatchObject({ requiresPassword: true, nextStep: 'password' });

      await new Promise((resolve) => globalThis.setTimeout(resolve, 40));
      expect(core.lifecycleState.pendingLogin).toBeNull();

      const result = await core.loginUser({
        phoneNumber: phone,
        phoneCode: 'stale-code',
        password: 'stale-password'
      });

      expect(result).toMatchObject({ requiresCode: true, nextStep: 'code' });
      expect(sendCode).toHaveBeenCalledTimes(2);
      expect(onInvoke).toHaveBeenCalledOnce();
      expect(core.lifecycleState.pendingLogin.value.phoneCodeHash).toBe('fresh-hash');
    } finally {
      if (core) await core.shutdownTelegram();
      harness.restore();
    }
  });

  it('times out a stuck 2FA verification and clears the pending login', async () => {
    vi.resetModules();
    const phone = '+15550000000';
    const neverResolves = new Promise(() => {});
    const harness = installLoginHarness({}, {
      onInvoke: async () => {
        const error = new Error('Two-step verification is enabled.');
        error.errorMessage = 'SESSION_PASSWORD_NEEDED';
        throw error;
      },
      signInWithPassword: vi.fn(() => neverResolves)
    });
    let core = null;

    try {
      const { createTelegramCore } = await import('./telegram.cjs');
      core = createTelegramCore({ authRequestTimeoutMs: 10 });

      await core.loginUser({ phoneNumber: phone });
      await core.loginUser({ phoneNumber: phone, phoneCode: 'accepted-code' });

      await expect(core.loginUser({
        phoneNumber: phone,
        phoneCode: 'accepted-code',
        password: 'password'
      })).rejects.toMatchObject({
        code: 'OPERATION_TIMEOUT',
        message: 'Telegram 2FA verification timed out after 10 ms'
      });
      expect(core.lifecycleState.pendingLogin).toBeNull();
    } finally {
      if (core) await core.shutdownTelegram();
      harness.restore();
    }
  });

  it('prefers saved account credentials over package defaults', async () => {
    vi.resetModules();
    const storageState = {
      API_ID: '9999991',
      API_HASH: 'abcdef0123456789abcdef0123456789',
      SESSION_STRING: 'saved-session-stub',
      signedOut: false
    };
    const harness = installLoginHarness(storageState);
    let core = null;

    try {
      const { createTelegramCore } = await import('./telegram.cjs');
      core = createTelegramCore();

      const result = await core.loginUser({ phoneNumber: '+15550000000' });

      expect(result.requiresCode).toBe(true);
      expect(harness.constructedClients).toHaveLength(1);
      expect(harness.constructedClients[0].apiId).toBe(Number(storageState.API_ID));
      expect(harness.constructedClients[0].apiHash).toBe(storageState.API_HASH);
      expect(harness.constructedClients[0].apiId).not.toBe(Number(packageJson.xmsgiApi.apiId));
    } finally {
      if (core) await clearPendingLogin(core);
      harness.restore();
    }
  });

  it('prefers explicit environment credentials over package defaults', async () => {
    process.env.API_ID = '1234501';
    process.env.API_HASH = 'abcdef0123456789abcdef0123456789';
    vi.resetModules();
    const harness = installLoginHarness({});
    let core = null;

    try {
      const { createTelegramCore } = await import('./telegram.cjs');
      core = createTelegramCore();

      const result = await core.loginUser({ phoneNumber: '+15550000000' });

      expect(result.requiresCode).toBe(true);
      expect(harness.constructedClients).toHaveLength(1);
      expect(harness.constructedClients[0].apiId).toBe(1234501);
      expect(harness.constructedClients[0].apiHash).toBe('abcdef0123456789abcdef0123456789');
    } finally {
      if (core) await clearPendingLogin(core);
      harness.restore();
    }
  });

  it('never writes SESSION_STRING into process.env', () => {
    expect(readSource('main.cjs')).not.toContain('process.env.SESSION_STRING');
    expect(readSource('telegram.cjs')).not.toContain('process.env.SESSION_STRING');
  });
});