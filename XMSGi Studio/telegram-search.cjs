function normalizeQuery(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^(?:https?:\/\/)?t\.me\//i, '')
    .replace(/^@/, '')
    .split('?')[0]
    .split('#')[0]
    .replace(/\/$/, '')
    .trim();
}

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}

function isPhoneLikeQuery(value) {
  const raw = String(value || '').trim();
  const digits = normalizePhone(raw);

  return digits.length >= 5 && /^[+\d\s().-]+$/.test(raw);
}

function isUsernameQuery(value) {
  const raw = String(value || '').trim();
  const normalized = normalizeQuery(raw);

  if (/^(?:https?:\/\/)?t\.me\//i.test(raw) || raw.startsWith('@')) {
    return true;
  }

  return /^[a-z][a-z0-9_]{4,31}$/i.test(normalized);
}

module.exports = {
  normalizeQuery,
  normalizePhone,
  isPhoneLikeQuery,
  isUsernameQuery
};
