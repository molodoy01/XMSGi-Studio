import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useChats } from './useChats';
import { saveChats } from '@/lib/storage';
import type { Chat } from '@/types';

const savedChannel: Chat = {
  id: 'search-only-channel',
  name: 'Search-only channel',
  username: 'search_only_channel',
  type: 'channel',
  avatarDataUrl: 'saved-avatar',
};

const telegramDialog: Chat = {
  id: 'telegram-dialog',
  name: 'Telegram dialog',
  username: 'telegram_dialog',
  type: 'private',
};

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

describe('useChats persistence merge', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('restores a search-only channel after restart and merges later Telegram data without duplicates', async () => {
    saveChats([savedChannel]);

    const getChats = vi
      .fn()
      .mockResolvedValueOnce({ success: true, chats: [telegramDialog] })
      .mockResolvedValueOnce({ success: true, chats: [telegramDialog] })
      .mockResolvedValueOnce({
        success: true,
        chats: [
          telegramDialog,
          {
            ...savedChannel,
            name: 'Fresh Telegram channel',
            avatarDataUrl: 'fresh-avatar',
          },
        ],
      });

    window.telegram = {
      getChats,
      getChatAvatar: vi.fn().mockResolvedValue({ success: false }),
    } as unknown as Window['telegram'];

    const firstRun = renderHook(() => useChats({ connected: true }));

    await waitFor(() => {
      expect(firstRun.result.current.chats).toContainEqual(savedChannel);
    });

    firstRun.unmount();

    const restarted = renderHook(() => useChats({ connected: true }));

    await waitFor(() => {
      expect(restarted.result.current.chats).toContainEqual(savedChannel);
    });

    expect(
      restarted.result.current.chats.filter((chat) => chat.id === savedChannel.id),
    ).toHaveLength(1);

    restarted.unmount();

    const telegramRefresh = renderHook(() => useChats({ connected: true }));

    await waitFor(() => {
      expect(
        telegramRefresh.result.current.chats.find((chat) => chat.id === savedChannel.id),
      ).toMatchObject({
        id: savedChannel.id,
        name: 'Fresh Telegram channel',
        avatarDataUrl: 'fresh-avatar',
      });
    });

    expect(
      telegramRefresh.result.current.chats.filter((chat) => chat.id === savedChannel.id),
    ).toHaveLength(1);
    expect(getChats).toHaveBeenCalledTimes(3);
  });

  it('keeps a search-only channel selected when refreshed permissions deny sending', async () => {
    saveChats([savedChannel]);
    window.telegram = {
      getChats: vi.fn().mockResolvedValue({ success: true, chats: [] }),
      getChatPermissions: vi.fn().mockResolvedValue({
        success: true,
        permissions: { canView: true, canSend: false, canSchedule: false },
      }),
    } as unknown as Window['telegram'];

    const { result } = renderHook(() => useChats({ connected: true }));

    await waitFor(() => {
      expect(result.current.selectedChat?.id).toBe(savedChannel.id);
      expect(result.current.selectedChatPermissions).toMatchObject({
        canView: true,
        canSend: false,
        canSchedule: false,
      });
    });

    expect(result.current.chats).toHaveLength(1);
    expect(result.current.chats[0].id).toBe(savedChannel.id);
  });

  it('preserves a chat added while startup sync is still loading', async () => {
    const startupChats = createDeferred<{ success: boolean; chats: Chat[] }>();
    const persistedSnapshots: Chat[][] = [];

    window.telegram = {
      loadSavedChats: vi.fn().mockResolvedValue([]),
      saveSavedChats: vi.fn().mockImplementation(async (chats: Chat[]) => {
        persistedSnapshots.push(chats);
        return { success: true };
      }),
      getChats: vi.fn().mockReturnValue(startupChats.promise),
      getChatAvatar: vi.fn().mockResolvedValue({ success: false }),
    } as unknown as Window['telegram'];

    const { result } = renderHook(() => useChats({ connected: true }));

    await waitFor(() => {
      expect(window.telegram.getChats).toHaveBeenCalled();
    });

    act(() => {
      result.current.handleAddChat(savedChannel);
    });

    startupChats.resolve({ success: true, chats: [telegramDialog] });

    await waitFor(() => {
      expect(result.current.chats).toContainEqual(savedChannel);
      expect(persistedSnapshots[persistedSnapshots.length - 1]).toEqual(
        expect.arrayContaining([
          savedChannel,
          expect.objectContaining({ id: telegramDialog.id }),
        ]),
      );
    });
  });

  it('preserves a chat added before a stale avatar callback completes', async () => {
    const avatarRequest = createDeferred<{ success: boolean; avatarDataUrl?: string }>();
    const persistedSnapshots: Chat[][] = [];

    window.telegram = {
      loadSavedChats: vi.fn().mockResolvedValue([]),
      saveSavedChats: vi.fn().mockImplementation(async (chats: Chat[]) => {
        persistedSnapshots.push(chats);
        return { success: true };
      }),
      getChats: vi.fn().mockResolvedValue({ success: true, chats: [telegramDialog] }),
      getChatAvatar: vi.fn().mockReturnValue(avatarRequest.promise),
    } as unknown as Window['telegram'];

    const { result } = renderHook(() => useChats({ connected: true }));

    await waitFor(() => {
      expect(window.telegram.getChatAvatar).toHaveBeenCalledWith(telegramDialog.id);
    });

    act(() => {
      result.current.handleAddChat(savedChannel);
    });

    avatarRequest.resolve({ success: true, avatarDataUrl: 'fresh-avatar' });

    await waitFor(() => {
      expect(result.current.chats).toContainEqual(savedChannel);
      expect(persistedSnapshots[persistedSnapshots.length - 1]).toEqual(
        expect.arrayContaining([
          savedChannel,
          expect.objectContaining({ id: telegramDialog.id }),
        ]),
      );
    });
  });

  it('limits concurrent avatar requests while preserving all chats', async () => {
    const telegramChats: Chat[] = Array.from({ length: 7 }, (_, index) => ({
      id: `avatar-chat-${index}`,
      name: `Avatar chat ${index}`,
      type: 'private',
    }));
    const requests = new Map(telegramChats.map((chat) => [
      chat.id,
      createDeferred<{ success: boolean; avatarDataUrl?: string }>(),
    ]));
    let activeRequests = 0;
    let maxActiveRequests = 0;
    const getChatAvatar = vi.fn((chatId: string) => {
      activeRequests += 1;
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
      return requests.get(chatId)!.promise.finally(() => { activeRequests -= 1; });
    });
    window.telegram = {
      loadSavedChats: vi.fn().mockResolvedValue([]),
      saveSavedChats: vi.fn().mockResolvedValue({ success: true }),
      getChats: vi.fn().mockResolvedValue({ success: true, chats: telegramChats }),
      getChatAvatar,
    } as unknown as Window['telegram'];

    const { result } = renderHook(() => useChats({ connected: true }));

    await waitFor(() => expect(getChatAvatar).toHaveBeenCalled());
    expect(getChatAvatar).toHaveBeenCalledTimes(4);
    expect(maxActiveRequests).toBe(4);

    let resolvedCount = 0;
    while (resolvedCount < telegramChats.length) {
      const batch = telegramChats.slice(resolvedCount, resolvedCount + 4);
      act(() => {
        batch.forEach((chat) => requests.get(chat.id)!.resolve({
          success: true,
          avatarDataUrl: `avatar-${chat.id}`,
        }));
      });
      resolvedCount += batch.length;
      if (resolvedCount < telegramChats.length) {
        await waitFor(() => expect(getChatAvatar).toHaveBeenCalledTimes(Math.min(resolvedCount + 4, telegramChats.length)));
      }
    }

    await waitFor(() => expect(result.current.chats.filter((chat) => chat.avatarDataUrl)).toHaveLength(7));
    expect(result.current.chats.map((chat) => chat.id)).toEqual(telegramChats.map((chat) => chat.id));
    expect(maxActiveRequests).toBeLessThanOrEqual(4);
  });

  it('does not reload cached avatars on rerender or reconnect', async () => {
    const persistedChats: Chat[] = [];
    const getChatAvatar = vi.fn().mockResolvedValue({ success: true, avatarDataUrl: 'cached-avatar' });
    window.telegram = {
      loadSavedChats: vi.fn().mockImplementation(async () => persistedChats),
      saveSavedChats: vi.fn().mockImplementation(async (chats: Chat[]) => {
        persistedChats.splice(0, persistedChats.length, ...chats);
        return { success: true };
      }),
      getChats: vi.fn().mockResolvedValue({ success: true, chats: [telegramDialog] }),
      getChatAvatar,
    } as unknown as Window['telegram'];

    const { result, rerender } = renderHook(
      ({ connected }) => useChats({ connected }),
      { initialProps: { connected: true } },
    );

    await waitFor(() => expect(result.current.chats[0]?.avatarDataUrl).toBe('cached-avatar'));
    expect(getChatAvatar).toHaveBeenCalledTimes(1);

    rerender({ connected: true });
    expect(getChatAvatar).toHaveBeenCalledTimes(1);

    await waitFor(() => expect(persistedChats[0]?.avatarDataUrl).toBe('cached-avatar'));
    rerender({ connected: false });
    rerender({ connected: true });
    await waitFor(() => expect(window.telegram.getChats).toHaveBeenCalledTimes(2));
    expect(getChatAvatar).toHaveBeenCalledTimes(1);
    expect(result.current.chats).toEqual([expect.objectContaining({
      id: telegramDialog.id,
      avatarDataUrl: 'cached-avatar',
    })]);
  });

  it('keeps other chats and successful avatars when one avatar request fails', async () => {
    const chats: Chat[] = [
      { id: 'avatar-ok-1', name: 'Avatar one', type: 'private' },
      { id: 'avatar-fails', name: 'Avatar failure', type: 'group' },
      { id: 'avatar-ok-2', name: 'Avatar two', type: 'channel' },
    ];
    window.telegram = {
      loadSavedChats: vi.fn().mockResolvedValue([]),
      saveSavedChats: vi.fn().mockResolvedValue({ success: true }),
      getChats: vi.fn().mockResolvedValue({ success: true, chats }),
      getChatAvatar: vi.fn().mockImplementation(async (chatId: string) => {
        if (chatId === 'avatar-fails') throw new Error('avatar unavailable');
        return { success: true, avatarDataUrl: `avatar-${chatId}` };
      }),
    } as unknown as Window['telegram'];

    const { result } = renderHook(() => useChats({ connected: true }));

    await waitFor(() => expect(result.current.chats).toHaveLength(3));
    await waitFor(() => expect(result.current.chats.find((chat) => chat.id === 'avatar-ok-2')?.avatarDataUrl)
      .toBe('avatar-avatar-ok-2'));
    expect(result.current.chats.map((chat) => chat.id)).toEqual(chats.map((chat) => chat.id));
    expect(result.current.chats.find((chat) => chat.id === 'avatar-ok-1')?.avatarDataUrl).toBe('avatar-avatar-ok-1');
    expect(result.current.chats.find((chat) => chat.id === 'avatar-fails')?.avatarDataUrl).toBe('');
  });

  it('removes only the requested chat from the local list', async () => {
    const secondChat: Chat = {
      id: 'second-chat',
      name: 'Second chat',
      type: 'group',
    };
    saveChats([savedChannel, secondChat]);
    window.telegram = {
      getChats: vi.fn().mockResolvedValue({ success: true, chats: [] }),
    } as unknown as Window['telegram'];

    const { result } = renderHook(() => useChats({ connected: false }));

    await waitFor(() => {
      expect(result.current.chats).toHaveLength(2);
    });

    act(() => {
      result.current.handleRemoveChat(savedChannel);
    });

    expect(result.current.chats).toEqual([secondChat]);
    expect(result.current.selectedChat?.id).toBe(secondChat.id);
  });

  it('ignores legacy hidden ids after the hidden-state migration', async () => {
    const channel: Chat = {
      id: '-1004431408545',
      name: 'Новости топ 5 дня',
      username: 'NewsWithoutNoise24',
      type: 'channel',
    };
    window.localStorage.setItem('awaitmsg_hidden_chats', JSON.stringify([channel.id]));
    saveChats([channel]);
    window.telegram = {
      getChats: vi.fn().mockResolvedValue({ success: true, chats: [channel] }),
      getChatAvatar: vi.fn().mockResolvedValue({ success: false }),
    } as unknown as Window['telegram'];

    const { result } = renderHook(() => useChats({ connected: true }));

    await waitFor(() => {
      expect(result.current.chats).toEqual([expect.objectContaining(channel)]);
    });

    expect(window.localStorage.getItem('awaitmsg_hidden_chats_v2')).toBeNull();
    expect(result.current.chats.some((chat) => chat.id === channel.id)).toBe(true);
  });

  it('persists the new hidden state for a channel across hook reloads', async () => {
    const channel: Chat = {
      id: '-1004431408545',
      name: 'Новости топ 5 дня',
      username: 'NewsWithoutNoise24',
      type: 'channel',
    };
    const otherChat: Chat = { id: 'other-chat', name: 'Other chat', type: 'private' };
    saveChats([channel, otherChat]);
    window.telegram = {
      getChats: vi.fn().mockResolvedValue({ success: true, chats: [channel, otherChat] }),
      getChatAvatar: vi.fn().mockResolvedValue({ success: false }),
    } as unknown as Window['telegram'];

    const firstRun = renderHook(() => useChats({ connected: true }));
    await waitFor(() => expect(firstRun.result.current.chats).toHaveLength(2));

    act(() => firstRun.result.current.handleRemoveChat(channel));
    expect(firstRun.result.current.chats.map((chat) => chat.id)).toEqual([otherChat.id]);
    expect(JSON.parse(window.localStorage.getItem('awaitmsg_hidden_chats_v2') || '[]')).toEqual([channel.id]);
    firstRun.unmount();

    const reloaded = renderHook(() => useChats({ connected: false }));
    await waitFor(() => expect(reloaded.result.current.chats).toEqual([expect.objectContaining(otherChat)]));
    expect(reloaded.result.current.chats.some((chat) => chat.id === channel.id)).toBe(false);
  });
});