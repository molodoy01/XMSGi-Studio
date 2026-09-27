import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { readChats, writeChats, readJsonFile, writeJsonFile } = require('./chat-storage.cjs');

const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('Electron chat storage', () => {
  it('atomically persists and reloads app JSON data', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'awaitmsg-json-storage-'));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, 'userData', 'awaitmsg-schedule-history.json');
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

  it('persists a search-only channel across a fresh read and keeps its full metadata', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'awaitmsg-chat-storage-'));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, 'userData', 'awaitmsg-chats.json');
    const searchOnlyChannel = {
      id: 'search-only-channel',
      name: 'Search-only channel',
      username: 'search_only_channel',
      type: 'channel',
      avatarDataUrl: 'saved-avatar',
    };

    writeChats(filePath, [searchOnlyChannel]);

    const afterRestart = readChats(filePath);

    expect(afterRestart).toEqual([searchOnlyChannel]);
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it('replaces an existing chat record instead of creating a duplicate', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'awaitmsg-chat-storage-'));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, 'awaitmsg-chats.json');

    writeChats(filePath, [
      { id: 'channel-1', name: 'Old name', type: 'channel' },
      { id: 'channel-1', name: 'Fresh name', type: 'channel' },
    ]);

    expect(readChats(filePath)).toEqual([
      { id: 'channel-1', name: 'Fresh name', type: 'channel' },
    ]);
  });
});
