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
  let fileDescriptor;
  try {
    fileDescriptor = fs.openSync(temporaryPath, 'wx', 0o600);
    fs.writeFileSync(fileDescriptor, JSON.stringify(data, null, 2), 'utf8');
    fs.fsyncSync(fileDescriptor);
    fs.closeSync(fileDescriptor);
    fileDescriptor = undefined;
    fs.renameSync(temporaryPath, filePath);
    if (process.platform !== 'win32') {
      const directoryDescriptor = fs.openSync(path.dirname(filePath), 'r');
      try {
        fs.fsyncSync(directoryDescriptor);
      } finally {
        fs.closeSync(directoryDescriptor);
      }
    }
  } catch (error) {
    if (fileDescriptor !== undefined) {
      try { fs.closeSync(fileDescriptor); } catch { /* Preserve the original write error. */ }
    }
    try { fs.unlinkSync(temporaryPath); } catch { /* Ignore temporary-file cleanup errors. */ }
    throw error;
  }
}

function normalizeChat(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const id = typeof value.id === 'string' ? value.id.trim() : '';
  const name = typeof value.name === 'string' ? value.name : '';

  if (!id || !name) return null;
  if ((value.username !== undefined && typeof value.username !== 'string')
    || (value.type !== undefined && typeof value.type !== 'string')
    || (value.avatarDataUrl !== undefined && typeof value.avatarDataUrl !== 'string')) return null;

  return {
    id,
    name,
    ...(typeof value.username === 'string' ? { username: value.username } : {}),
    ...(typeof value.type === 'string' ? { type: value.type } : {}),
    ...(typeof value.avatarDataUrl === 'string' ? { avatarDataUrl: value.avatarDataUrl } : {}),
  };
}

function readChats(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return { success: true, chats: [], exists: false };
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Saved chats could not be read.',
    };
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('Saved chats have an invalid structure.');
    const normalized = parsed.map(normalizeChat);
    if (normalized.some((chat) => chat === null)) {
      throw new Error('Saved chats contain an invalid record.');
    }
    return { success: true, chats: normalized, exists: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Saved chats could not be read.',
    };
  }
}

function writeChats(filePath, chats) {
  const existing = readChats(filePath);
  if (!existing.success) throw new Error(`Existing saved chats could not be read: ${existing.error}`);
  if (!Array.isArray(chats)) throw new Error('Saved chats must be an array.');

  const normalized = chats.map(normalizeChat);
  if (normalized.some((chat) => chat === null)) throw new Error('Saved chats contain an invalid record.');
  const chatsById = new Map(normalized.map((chat) => [chat.id, chat]));
  const deduplicated = [...chatsById.values()];
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  try {
    fs.writeFileSync(temporaryPath, JSON.stringify(deduplicated, null, 2), { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    try { fs.unlinkSync(temporaryPath); } catch { /* Ignore temporary-file cleanup errors. */ }
    throw error;
  }
}

module.exports = { readChats, writeChats, readJsonFile, writeJsonFile };
