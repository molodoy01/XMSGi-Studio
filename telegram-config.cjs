function normalizeSessionString(value) {
  return typeof value === 'string'
    ? value.trim()
    : '';
}

function updateRuntimeSecretsFromConfig(nextSecrets) {
  const apiId = nextSecrets.API_ID;
  const apiHash = nextSecrets.API_HASH;
  const sessionString = normalizeSessionString(nextSecrets.SESSION_STRING);

  return {
    apiId: apiId ? Number(apiId) : undefined,
    apiHash,
    sessionString,
    signedOut: nextSecrets.signedOut === true
  };
}

function getSecretValue(key, secrets) {
  if (secrets[key]) {
    return secrets[key];
  }

  return undefined;
}

function normalizeApplicationApiDefaults(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const apiId = String(value.apiId ?? '').trim();
  const apiHash = String(value.apiHash ?? '').trim();

  if (/^\d+$/.test(apiId) && /^[0-9a-f]{16,64}$/i.test(apiHash)) {
    return { apiId, apiHash };
  }

  return null;
}

function loadApplicationApiDefaults() {
  const environmentApiId = typeof process.env.API_ID === 'string' ? process.env.API_ID.trim() : '';
  const environmentApiHash = typeof process.env.API_HASH === 'string' ? process.env.API_HASH.trim() : '';
  const fromEnvironment = normalizeApplicationApiDefaults({
    apiId: environmentApiId,
    apiHash: environmentApiHash
  });

  if (fromEnvironment) {
    return fromEnvironment;
  }

  try {
    return normalizeApplicationApiDefaults(require('./package.json').xmsgiApi);
  } catch {
    return null;
  }
}

function getApplicationApiCredentials(accountSecrets) {
  if (accountSecrets.API_ID && accountSecrets.API_HASH) {
    return { apiId: accountSecrets.API_ID, apiHash: accountSecrets.API_HASH };
  }

  const defaults = loadApplicationApiDefaults();
  return defaults || { apiId: accountSecrets.API_ID, apiHash: accountSecrets.API_HASH };
}

module.exports = {
  normalizeSessionString,
  updateRuntimeSecretsFromConfig,
  getSecretValue,
  normalizeApplicationApiDefaults,
  loadApplicationApiDefaults,
  getApplicationApiCredentials,
};