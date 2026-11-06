import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatPicker } from './ChatPicker';
import { LocaleProvider } from '@/lib/i18n';
import type { Chat } from '@/types';

function renderPicker(findChat: (query: string) => Promise<unknown>, chats: Chat[] = [], showRecentGroups = false, showRemoveControl = true) {
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
        showRecentGroups={showRecentGroups}
        showRemoveControl={showRemoveControl}
      />
    </LocaleProvider>,
  );

  fireEvent.pointerDown(screen.getByRole('button', { name: 'Choose a chat…' }));

  return { onSelect, onAddChat, onRemoveChat };
}

afterEach(() => {
  window.localStorage.removeItem('xmsgi:planner:recent-chat-ids');
});

describe('ChatPicker global username result flow', () => {
  it('shows a delete control for the currently selected chat and removes it without reselecting', () => {
    const selectedChat: Chat = { id: 'selected-chat', name: 'Current chat', type: 'private' };
    const onRemoveChat = vi.fn();
    const onSelect = vi.fn();

    const { container } = render(
      <LocaleProvider>
        <ChatPicker
          chats={[selectedChat]}
          selectedChat={selectedChat}
          onSelect={onSelect}
          onAddChat={vi.fn()}
          onRemoveChat={onRemoveChat}
        />
      </LocaleProvider>,
    );

    fireEvent.pointerDown(container.querySelector('.chat-picker-current') as HTMLElement);
    const chipRemoveButton = container.querySelector('.chat-picker-current-remove');
    const listRemoveButton = screen.getByRole('button', { name: 'Remove Current chat' });

    expect(chipRemoveButton).not.toBeInTheDocument();
    expect(listRemoveButton).toBeInTheDocument();
    fireEvent.click(listRemoveButton);

    expect(onRemoveChat).toHaveBeenCalledWith(selectedChat);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('keeps the picker open immediately after the selected row is toggled and renders the warning on the same line', () => {
    const selectedChat: Chat = { id: 'restricted-chat', name: 'Restricted channel', type: 'channel' };
    render(
      <LocaleProvider>
        <ChatPicker
          chats={[selectedChat]}
          selectedChat={selectedChat}
          onSelect={vi.fn()}
          onAddChat={vi.fn()}
          onRemoveChat={vi.fn()}
          permissionWarning="Нельзя отправлять сообщения"
          warningPulse
        />
      </LocaleProvider>,
    );

    const trigger = document.querySelector('.chat-picker-current') as HTMLElement;
    fireEvent.pointerDown(trigger);

    expect(document.querySelector('.chat-picker')).toHaveClass('is-open');
    expect(document.querySelector('.chat-picker-menu')).toHaveClass('open');

    const name = document.querySelector('.chat-picker-current-name');
    const warning = screen.getByRole('status');
    expect(warning).toHaveTextContent('Нельзя отправлять сообщения');
    expect(name?.nextElementSibling).toBe(warning);
    expect(warning).toHaveClass('is-flashing');
  });

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
    const input = screen.getByRole('textbox', { name: 'Search chats' });

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

  it('hides remove controls when the picker is used only for selection', () => {
    const chat: Chat = { id: 'chat-3', name: 'Selection only', type: 'group' };
    renderPicker(vi.fn(), [chat], false, false);

    expect(screen.queryByRole('button', { name: 'Remove Selection only' })).not.toBeInTheDocument();
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

  it('renders a dedicated scrollbar for the full chat list and tracks its position', () => {
    const chats: Chat[] = Array.from({ length: 12 }, (_, index) => ({
      id: `chat-${index}`,
      name: `Chat ${index + 1}`,
      type: 'private',
    }));
    renderPicker(vi.fn(), chats);

    const viewport = document.querySelector('.chat-picker-scroll-area') as HTMLDivElement;
    expect(viewport.querySelectorAll('.chat-option')).toHaveLength(12);
    Object.defineProperty(viewport, 'clientHeight', { configurable: true, value: 120 });
    Object.defineProperty(viewport, 'scrollHeight', { configurable: true, value: 600 });
    viewport.scrollTop = 84;
    fireEvent.scroll(viewport);

    const scrollbar = document.querySelector('.chat-picker-scrollbar');
    expect(scrollbar).toHaveAttribute('role', 'scrollbar');
    expect(scrollbar).toHaveAttribute('aria-valuenow', '84');
    expect(scrollbar).toHaveAttribute('aria-valuemax', '480');
  });

  it('renders only a window of options for a large chat list', () => {
    const chats: Chat[] = Array.from({ length: 500 }, (_, index) => ({
      id: `chat-${index}`,
      name: `Chat ${index + 1}`,
      type: 'private',
    }));
    renderPicker(vi.fn(), chats);

    const renderedOptions = document.querySelectorAll('.chat-picker-chat-list .chat-option');
    expect(renderedOptions.length).toBeGreaterThan(0);
    expect(renderedOptions.length).toBeLessThan(chats.length);
    expect(document.querySelector('.chat-picker-chat-list')).toHaveStyle({ height: `${chats.length * 64}px` });

    const viewport = document.querySelector('.chat-picker-scroll-area') as HTMLDivElement;
    const list = document.querySelector('.chat-picker-chat-list') as HTMLDivElement;
    vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue({ top: 0 } as DOMRect);
    vi.spyOn(list, 'getBoundingClientRect').mockImplementation(() => ({
      top: 48 - viewport.scrollTop,
    } as DOMRect));
    viewport.scrollTop = 64 * 100;
    fireEvent.scroll(viewport);

    expect(screen.getByText('Chat 101')).toBeInTheDocument();
    expect(screen.queryByText('Chat 1')).not.toBeInTheDocument();
  });

  it('does not render chat options while the picker is closed', () => {
    render(
      <LocaleProvider>
        <ChatPicker
          chats={[{ id: 'chat-closed', name: 'Closed menu chat', type: 'private' }]}
          selectedChat={null}
          onSelect={vi.fn()}
          onAddChat={vi.fn()}
          onRemoveChat={vi.fn()}
        />
      </LocaleProvider>,
    );

    expect(document.querySelector('.chat-picker-chat-list .chat-option')).toBeNull();
  });

  it('hides the scrollbar when the chat list fits in the menu', () => {
    renderPicker(vi.fn(), [{ id: 'chat-short', name: 'Short list', type: 'group' }]);

    expect(document.querySelector('.chat-picker-scrollbar')).toBeNull();
  });
});
  it('finds chats locally by username and phone and groups frequent chats separately', () => {
    const frequentChat: Chat = {
      id: 'frequent-1',
      name: 'Alice Example',
      username: 'alice_12345',
      phone: '+15550101234',
      type: 'private',
    };
    const otherChat: Chat = { id: 'other-2', name: 'Project Team', type: 'group' };
    window.localStorage.setItem('xmsgi:planner:recent-chat-ids', JSON.stringify([frequentChat.id]));
    renderPicker(vi.fn(), [frequentChat, otherChat], true);

    const search = screen.getByRole('textbox', { name: 'Search chats' });
    expect(screen.getByText('Frequent chats')).toBeInTheDocument();
    expect(screen.getByText('All chats')).toBeInTheDocument();
    expect(screen.getByText(frequentChat.name)).toBeInTheDocument();
    expect(screen.getByText(otherChat.name)).toBeInTheDocument();

    fireEvent.change(search, { target: { value: '@alice_12345' } });
    expect(screen.getByText(frequentChat.name)).toBeInTheDocument();
    expect(screen.queryByText(otherChat.name)).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: '+1 (555) 010-1234' } });
    expect(screen.getByText(frequentChat.name)).toBeInTheDocument();
    expect(screen.queryByText(otherChat.name)).not.toBeInTheDocument();
  });

  it('shows all loaded chats before any chat has been selected frequently', () => {
    const chats: Chat[] = [
      { id: 'chat-a', name: 'Chat A', type: 'group' },
      { id: 'chat-b', name: 'Chat B', type: 'private' },
    ];
    renderPicker(vi.fn(), chats, true);

    expect(screen.queryByText('Frequent chats')).not.toBeInTheDocument();
    expect(screen.getByText('All chats')).toBeInTheDocument();
    chats.forEach((chat) => expect(screen.getByText(chat.name)).toBeInTheDocument());
  });

  it('looks up a phone number with Telegram when no loaded chat matches', async () => {
    const phoneContact: Chat = {
      id: 'phone-contact',
      name: 'Phone Contact',
      phone: '+15550109999',
      type: 'private',
    };
    const findChat = vi.fn().mockResolvedValue({ success: true, chat: phoneContact });
    const { onSelect, onAddChat } = renderPicker(findChat);
    const input = screen.getByRole('textbox', { name: 'Search chats' });

    fireEvent.change(input, { target: { value: '+1 (555) 010-9999' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(findChat).toHaveBeenCalledWith('+1 (555) 010-9999');
      expect(onAddChat).toHaveBeenCalledWith(phoneContact);
      expect(onSelect).toHaveBeenCalledWith(phoneContact);
    });
  });

  it('records selected chats in the frequent group across picker remounts', () => {
    const firstChat: Chat = { id: 'first', name: 'First chat', type: 'group' };
    const secondChat: Chat = { id: 'second', name: 'Second chat', type: 'private' };
    const { onSelect } = renderPicker(vi.fn(), [firstChat, secondChat], true);
    fireEvent.click(screen.getByText(secondChat.name));

    expect(onSelect).toHaveBeenCalledWith(secondChat);
    expect(JSON.parse(window.localStorage.getItem('xmsgi:planner:recent-chat-ids') || '[]'))
      .toEqual([secondChat.id]);
  });
