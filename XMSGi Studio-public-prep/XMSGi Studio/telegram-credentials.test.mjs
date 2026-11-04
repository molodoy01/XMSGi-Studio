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

function installLoginHarness(storageState) {
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

          async sendCode() {
            return { phoneCodeHash: 'phone-code-hash', isCodeViaApp: false };
          }

          async disconnect() {
            this.connected = false;
          }
        },
        Api: {}
      };
    }

    if (request === 'teleproto/events') {
      return { NewMessage: class {} };
    }

    if (request === 'teleproto/sessions') {
      return { StringSession: class FakeStringSession {} };
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