import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveAppDataPath } from './app-data-path.cjs';

function createMemoryFileSystem(initialFiles = {}) {
  const files = new Map(Object.entries(initialFiles));
  return {
    files,
    existsSync: (filePath) => files.has(filePath),
    renameSync: (oldPath, newPath) => {
      if (!files.has(oldPath)) throw new Error('Source file does not exist.');
      files.set(newPath, files.get(oldPath));
      files.delete(oldPath);
    },
  };
}

describe('resolveAppDataPath', () => {
  it('renames an existing legacy data file to the current filename', () => {
    const userDataPath = path.join('tmp', 'XMSGi Studio');
    const legacyPath = path.join(userDataPath, 'awaitmsg-chats.json');
    const currentPath = path.join(userDataPath, 'xmsgi-studio-chats.json');
    const fileSystem = createMemoryFileSystem({ [legacyPath]: '[{"id":"saved"}]' });

    expect(resolveAppDataPath(fileSystem, path, userDataPath, 'xmsgi-studio-chats.json', 'awaitmsg-chats.json'))
      .toBe(currentPath);
    expect(fileSystem.files.get(currentPath)).toBe('[{"id":"saved"}]');
    expect(fileSystem.files.has(legacyPath)).toBe(false);
  });

  it('prefers the current file when both names exist', () => {
    const userDataPath = path.join('tmp', 'XMSGi Studio');
    const legacyPath = path.join(userDataPath, 'awaitmsg-chats.json');
    const currentPath = path.join(userDataPath, 'xmsgi-studio-chats.json');
    const fileSystem = createMemoryFileSystem({ [legacyPath]: 'legacy', [currentPath]: 'current' });

    expect(resolveAppDataPath(fileSystem, path, userDataPath, 'xmsgi-studio-chats.json', 'awaitmsg-chats.json'))
      .toBe(currentPath);
    expect(fileSystem.files.get(currentPath)).toBe('current');
  });

  it('keeps using the legacy file if migration fails', () => {
    const userDataPath = path.join('tmp', 'XMSGi Studio');
    const legacyPath = path.join(userDataPath, 'awaitmsg-chats.json');
    const fileSystem = createMemoryFileSystem({ [legacyPath]: 'legacy' });
    fileSystem.renameSync = () => { throw new Error('Permission denied.'); };

    expect(resolveAppDataPath(fileSystem, path, userDataPath, 'xmsgi-studio-chats.json', 'awaitmsg-chats.json'))
      .toBe(legacyPath);
    expect(fileSystem.files.get(legacyPath)).toBe('legacy');
  });
});