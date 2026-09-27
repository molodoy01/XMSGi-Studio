import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadHiddenChats,
  loadPersistentChats,
  loadUpcoming,
  saveHiddenChats,
  savePersistentChats,
  saveUpcoming,
} from './storage';
import type { ScheduledMessage } from '@/types';

const UPCOMING_STORAGE_KEY = 'awaitmsg_upcoming';

function createMemoryStorage() {
  const data = new Map<string, string>();

  return {
    getItem(key: string) {
      return data.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      data.set(key, value);
    },
    removeItem(key: string) {
      data.delete(key);
    },
    clear() {
      data.clear();
    },
    data,
  };
}

function createMessage(
  id: string,
  status: ScheduledMessage['status']
): ScheduledMessage {
  return {
    id,
    operationId: id,
    chatId: 'chat-1',
    chatName: 'Test chat',
    text: `Message ${id}`,
    when: '2030-01-01T10:00:00.000Z',
    createdAt: '2029-12-31T10:00:00.000Z',
    status,
  };
}

describe('Upcoming storage', () => {
  let storage: ReturnType<typeof createMemoryStorage>;

  beforeEach(() => {
    storage = createMemoryStorage();
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('telegram', undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('saves Upcoming messages to localStorage', () => {
    const messages = [createMessage('pending-1', 'pending')];

    saveUpcoming(messages);

    expect(storage.getItem(UPCOMING_STORAGE_KEY)).toBe(JSON.stringify(messages));
  });

  it('loads saved Upcoming messages', () => {
    const messages = [createMessage('scheduled-1', 'scheduled')];
    storage.setItem(UPCOMING_STORAGE_KEY, JSON.stringify(messages));

    expect(loadUpcoming()).toEqual(messages);
  });

  it('restores Upcoming correctly after storage is recreated', () => {
    const messages = [
      createMessage('pending-1', 'pending'),
      createMessage('scheduled-1', 'scheduled'),
    ];

    saveUpcoming(messages);
    const persistedValue = storage.getItem(UPCOMING_STORAGE_KEY);

    const restartedStorage = createMemoryStorage();
    restartedStorage.setItem(UPCOMING_STORAGE_KEY, persistedValue || '');
    vi.stubGlobal('localStorage', restartedStorage);

    expect(loadUpcoming()).toEqual(messages);
  });

  it('returns an empty list when storage is missing or empty', () => {
    expect(loadUpcoming()).toEqual([]);

    storage.setItem(UPCOMING_STORAGE_KEY, '');

    expect(loadUpcoming()).toEqual([]);
  });

  it('preserves pending and scheduled statuses', () => {
    const messages = [
      createMessage('pending-1', 'pending'),
      createMessage('scheduled-1', 'scheduled'),
    ];

    saveUpcoming(messages);

    expect(loadUpcoming().map((message) => message.status)).toEqual([
      'pending',
      'scheduled',
    ]);
  });

  it('keeps personal and workspace histories in separate storage keys', () => {
    const personalMessage = createMessage('personal-1', 'scheduled');
    const workspaceMessage = createMessage('workspace-1', 'scheduled');

    saveUpcoming([personalMessage], 'personal');
    saveUpcoming([workspaceMessage], 'workspace');

    expect(loadUpcoming('personal')).toEqual([personalMessage]);
    expect(loadUpcoming('workspace')).toEqual([workspaceMessage]);
  });

  it('writes workspace history through the Electron storage bridge', () => {
    const messages = [createMessage('workspace-native-1', 'scheduled')];
    const saveScheduleHistory = vi.fn().mockResolvedValue({ success: true });
    vi.stubGlobal('telegram', { saveScheduleHistory });

    saveUpcoming(messages, 'workspace');

    expect(saveScheduleHistory).toHaveBeenCalledWith({
      scope: 'workspace',
      field: 'upcoming',
      messages,
    });
    expect(storage.getItem('awaitmsg_workspace_upcoming')).toBeNull();
  });
});

describe('Chat storage migration', () => {
  let storage: ReturnType<typeof createMemoryStorage>;

  beforeEach(() => {
    storage = createMemoryStorage();
    vi.stubGlobal('localStorage', storage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('persists hidden chat ids under the v2 key and reloads them', () => {
    saveHiddenChats(['-1004431408545', 'private-1']);

    expect(loadHiddenChats()).toEqual(['-1004431408545', 'private-1']);
    expect(storage.getItem('awaitmsg_hidden_chats_v2')).toBe(
      JSON.stringify(['-1004431408545', 'private-1']),
    );
  });

  it('migrates legacy chats to persistent storage once', async () => {
    const channel = { id: '-1004431408545', name: 'Новости топ 5 дня', type: 'channel' as const };
    storage.setItem('awaitmsg_chats', JSON.stringify([channel]));
    const saveSavedChats = vi.fn().mockResolvedValue({ success: true });
    vi.stubGlobal('telegram', { loadSavedChats: vi.fn().mockResolvedValue([]), saveSavedChats });

    await expect(loadPersistentChats()).resolves.toEqual([channel]);
    expect(saveSavedChats).toHaveBeenCalledWith([channel]);
  });

  it('round-trips v2 persistent chats without losing a channel id', async () => {
    const chats = [{ id: '-1004431408545', name: 'Новости топ 5 дня', type: 'channel' as const }];
    const saveSavedChats = vi.fn().mockResolvedValue({ success: true });
    vi.stubGlobal('telegram', { saveSavedChats });

    await savePersistentChats(chats);

    expect(await loadPersistentChats()).toEqual(chats);
    expect(saveSavedChats).toHaveBeenCalledWith(chats);
  });
});
