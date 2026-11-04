import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ChatPicker } from './ChatPicker';
import { LocaleProvider } from '@/lib/i18n';
import type { Chat } from '@/types';

function renderPicker(findChat: (query: string) => Promise<unknown>, chats: Chat[] = []) {
  vi.stubGlobal('telegram', { findChat });

  const onSelect = vi.fn();
  const onAddChat = vi.fn();
  const onRemoveChat = vi.fn();

  render(
    <LocaleProvider>
      <ChatPicker
        chats={chats}
        selectedChat={null}
        onSelect={onSelect}
        onAddChat={onAddChat}
        onRemoveChat={onRemoveChat}
      />
    </LocaleProvider>,
  );

  fireEvent.click(screen.getByRole('button', { name: 'Choose a chat…' }));

  return { onSelect, onAddChat, onRemoveChat };
}

describe('ChatPicker global username result flow', () => {
  it('adds and selects a private user returned from a global username lookup', async () => {
    const privateUser: Chat = {
      id: '9001',
      name: 'Alice Example',
      username: 'alice_12345',
      type: 'private',
      avatarDataUrl: '',
    };
    const findChat = vi.fn().mockResolvedValue({ success: true, chat: privateUser });
    const { onSelect, onAddChat } = renderPicker(findChat);
    const input = screen.getByPlaceholderText('Add chat, @name or phone');

    fireEvent.change(input, { target: { value: '@alice_12345' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(findChat).toHaveBeenCalledWith('@alice_12345');
      expect(onAddChat).toHaveBeenCalledWith(privateUser);
      expect(onSelect).toHaveBeenCalledWith(privateUser);
    });
  });

  it('removes a chat without selecting it when the row delete control is clicked', () => {
    const chat: Chat = {
      id: 'chat-1',
      name: 'Chat one',
      type: 'group',
    };
    const { onSelect, onRemoveChat } = renderPicker(vi.fn(), [chat]);

    fireEvent.click(screen.getByRole('button', { name: 'Remove Chat one' }));

    expect(onRemoveChat).toHaveBeenCalledWith(chat);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('keeps the remove control available on hover and keyboard focus', () => {
    const chat: Chat = { id: 'chat-2', name: 'Hover target', type: 'private' };
    renderPicker(vi.fn(), [chat]);

    const remove = screen.getByRole('button', { name: 'Remove Hover target' });
    fireEvent.mouseOver(remove);
    fireEvent.focus(remove);

    expect(remove).toBeVisible();
    expect(remove).toHaveAttribute('title', 'Remove');
  });

  it('renders long channel names and channel type without selecting on delete', () => {
    const chat: Chat = {
      id: '-1004431408545',
      name: 'Новости топ 5 дня с очень длинным названием',
      type: 'channel',
    };
    const { onSelect, onRemoveChat } = renderPicker(vi.fn(), [chat]);

    expect(screen.getByText(chat.name)).toBeInTheDocument();
    expect(screen.getByText('Channel')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: `Remove ${chat.name}` }));

    expect(onRemoveChat).toHaveBeenCalledWith(chat);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
