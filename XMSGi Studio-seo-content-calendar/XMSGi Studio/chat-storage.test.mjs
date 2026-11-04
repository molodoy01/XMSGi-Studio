import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { readChats, writeChats, readJsonFile, writeJsonFile } = require('./chat-storage.cjs');

const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('Electron chat storage', () => {
  it('treats a missing file as an empty new store', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'xmsgi-studio-chat-storage-'));
    temporaryDirectories.push(directory);
    const result = readChats(path.join(directory, 'not-created.json'));

    expect(result).toEqual({ success: true, chats: [], exists: false });
  });

  it('atomically persists and reloads app JSON data', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'xmsgi-studio-json-storage-'));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, 'userData', 'xmsgi-studio-schedule-history.json');
    const history = {
      workspace: {
        upcoming: [{ id: 'scheduled-1', when: '2030-06-01T16:30:00.000Z' }],
        sent: [],
      },
    };

    writeJsonFile(filePath, history);

    expect(readJsonFile(filePath, null)).toEqual(history);
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it('flushes temporary JSON contents before replacing the persisted file', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'xmsgi-studio-json-storage-'));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, 'history.json');
    const operations = [];
    const originalFsync = fs.fsyncSync.bind(fs);
    const originalRename = fs.renameSync.bind(fs);
    const fsync = vi.spyOn(fs, 'fsyncSync').mockImplementation((...args) => {
      operations.push('fsync');
      return originalFsync(...args);
    });
    const rename = vi.spyOn(fs, 'renameSync').mockImplementation((...args) => {
      operations.push('rename');
      return originalRename(...args);
    });

    try {
      writeJsonFile(filePath, { sent: [{ id: 'sent-1' }] });

      expect(operations.indexOf('fsync')).toBeGreaterThanOrEqual(0);
      expect(operations.indexOf('fsync')).toBeLessThan(operations.indexOf('rename'));
      expect(readJsonFile(filePath, null)).toEqual({ sent: [{ id: 'sent-1' }] });
    } finally {
      fsync.mockRestore();
      rename.mockRestore();
    }
  });

  it('preserves the current JSON file when flushing the temporary write fails', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'xmsgi-studio-json-storage-'));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, 'history.json');
    const current = { sent: [{ id: 'existing' }] };
    writeJsonFile(filePath, current);
    const fsync = vi.spyOn(fs, 'fsyncSync').mockImplementation(() => {
      throw new Error('Simulated flush failure');
    });

    try {
      expect(() => writeJsonFile(filePath, { sent: [{ id: 'new' }] }))
        .toThrow('Simulated flush failure');
      expect(readJsonFile(filePath, null)).toEqual(current);
      expect(fs.readdirSync(directory).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    } finally {
      fsync.mockRestore();
    }
  });

  it('persists a search-only channel across a fresh read and keeps its full metadata', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'xmsgi-studio-chat-storage-'));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, 'userData', 'xmsgi-studio-chats.json');
    const searchOnlyChannel = {
      id: 'search-only-channel',
      name: 'Search-only channel',
      username: 'search_only_channel',
      type: 'channel',
      avatarDataUrl: 'saved-avatar',
    };

    writeChats(filePath, [searchOnlyChannel]);

    const afterRestart = readChats(filePath);

    expect(afterRestart).toEqual({ success: true, chats: [searchOnlyChannel], exists: true });
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it('replaces an existing chat record instead of creating a duplicate', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'xmsgi-studio-chat-storage-'));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, 'xmsgi-studio-chats.json');

    writeChats(filePath, [
      { id: 'channel-1', name: 'Old name', type: 'channel' },
      { id: 'channel-1', name: 'Fresh name', type: 'channel' },
    ]);

    expect(readChats(filePath)).toMatchObject({
      success: true,
      exists: true,
      chats: [{ id: 'channel-1', name: 'Fresh name', type: 'channel' }],
    });
  });

  it('distinguishes valid empty data from malformed JSON and invalid chat structures', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'xmsgi-studio-chat-storage-'));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, 'chats.json');

    fs.writeFileSync(filePath, '[]', 'utf8');
    expect(readChats(filePath)).toEqual({ success: true, chats: [], exists: true });

    fs.writeFileSync(filePath, '{"not":"an array"}', 'utf8');
    expect(readChats(filePath)).toMatchObject({ success: false });
    fs.writeFileSync(filePath, '[{"id":"chat-1"}]', 'utf8');
    expect(readChats(filePath)).toMatchObject({ success: false });
    fs.writeFileSync(filePath, '{invalid json', 'utf8');
    expect(readChats(filePath)).toMatchObject({ success: false });
  });

  it('refuses to replace an unreadable or corrupt chat file', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'xmsgi-studio-chat-storage-'));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, 'chats.json');
    const original = '{corrupt json that must remain available';
    fs.writeFileSync(filePath, original, 'utf8');

    expect(() => writeChats(filePath, [])).toThrow('Existing saved chats could not be read');
    expect(fs.readFileSync(filePath, 'utf8')).toBe(original);

    const directoryAsFile = path.join(directory, 'not-a-file');
    fs.mkdirSync(directoryAsFile);
    expect(readChats(directoryAsFile)).toMatchObject({ success: false });
  });

  it('does not replace the old chat file when preparation of the atomic write fails', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'xmsgi-studio-chat-storage-'));
    temporaryDirectories.push(directory);
    const blocker = path.join(directory, 'parent-is-a-file');
    fs.writeFileSync(blocker, 'keep this file', 'utf8');

    expect(() => writeChats(path.join(blocker, 'chats.json'), [])).toThrow();
    expect(fs.readFileSync(blocker, 'utf8')).toBe('keep this file');
  });
});
