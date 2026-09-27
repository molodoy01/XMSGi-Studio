const fs = require('fs');
const path = require('path');
const crypto = require('node:crypto');

function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath, data) {
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  try {
    fs.writeFileSync(temporaryPath, JSON.stringify(data, null, 2), { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    try { fs.unlinkSync(temporaryPath); } catch { /* Ignore temporary-file cleanup errors. */ }
    throw error;
  }
}

function normalizeChat(value) {
  if (!value || typeof value !== 'object') return null;

  const id = typeof value.id === 'string' ? value.id.trim() : '';
  const name = typeof value.name === 'string' ? value.name : '';

  if (!id || !name) return null;

  return {
    id,
    name,
    ...(typeof value.username === 'string' ? { username: value.username } : {}),
    ...(typeof value.type === 'string' ? { type: value.type } : {}),
    ...(typeof value.avatarDataUrl === 'string' ? { avatarDataUrl: value.avatarDataUrl } : {}),
  };
}

function readChats(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeChat).filter(Boolean);
  } catch {
    return [];
  }
}

function writeChats(filePath, chats) {
  const normalized = Array.isArray(chats)
    ? chats.map(normalizeChat).filter(Boolean)
    : [];
  const chatsById = new Map(normalized.map((chat) => [chat.id, chat]));
  const deduplicated = [...chatsById.values()];
  const temporaryPath = `${filePath}.tmp`;

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(temporaryPath, JSON.stringify(deduplicated, null, 2), 'utf8');
  fs.renameSync(temporaryPath, filePath);
}

module.exports = { readChats, writeChats, readJsonFile, writeJsonFile };
