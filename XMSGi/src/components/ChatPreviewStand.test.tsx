import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MutableRefObject } from 'react';
import type { Chat } from '@/types';
import { LocaleProvider } from '@/lib/i18n';
import { ChatPreviewStand } from '../../../Studio/Studio module/src/components/ChatPreviewStand';

const chats: Chat[] = [
  { id: 'chat-1', name: 'Saved Messages', type: 'private' },
  { id: 'chat-2', name: 'Design Group', type: 'group' },
];

function renderStand(chatListOpen = true) {
  const previewFeedRef = { current: null } as MutableRefObject<HTMLDivElement | null>;
  const onSelectChat = vi.fn();
  const onToggleChatList = vi.fn();

  const { container } = render(
    <LocaleProvider>
      <ChatPreviewStand
        chats={chats}
        selectedChat={chats[0]}
        previewHistory={null}
        previewHistoryLoading={false}
        previewFeedRef={previewFeedRef}
        draftText=""
        draftEntities={[]}
        inlineButtons={[]}
        attachments={[]}
        previewTime="12:00"
        collapsed={false}
        chatListOpen={chatListOpen}
        onToggleChatList={onToggleChatList}
        onSelectChat={onSelectChat}
      />
    </LocaleProvider>,
  );

  return { container, onSelectChat, onToggleChatList };
}

describe('ChatPreviewStand DOM behavior', () => {
  it('renders the current chat list and selects another chat', () => {
    const { onSelectChat } = renderStand();

    expect(screen.getByRole('complementary', { name: 'Chats' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Design Group/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Design Group/ }));
    expect(onSelectChat).toHaveBeenCalledWith(chats[1]);
  });

  it('filters the Web chat list from the inline search field', () => {
    renderStand();

    fireEvent.change(screen.getByRole('textbox', { name: 'Search chats' }), { target: { value: 'design' } });

    expect(screen.getByRole('button', { name: /Design Group/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Saved Messages/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Search chats/ })).not.toBeInTheDocument();
  });

  it('uses the chat toggle control when the list is closed', () => {
    const { onToggleChatList } = renderStand(false);

    fireEvent.click(screen.getByRole('button', { name: 'Preview settings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show chats' }));
    expect(onToggleChatList).toHaveBeenCalledTimes(1);
  });

  it('opens the chat list from the Today separator', () => {
    const { onToggleChatList } = renderStand(false);
    const dateButton = screen.getByRole('button', { name: 'Open chat list' });

    expect(dateButton.closest('.chat-preview-feed')).toContainElement(dateButton);

    fireEvent.click(dateButton);

    expect(onToggleChatList).toHaveBeenCalledTimes(1);
  });

  it('closes the open chat list when preview settings opens', () => {
    const { onToggleChatList } = renderStand(true);

    fireEvent.click(screen.getByRole('button', { name: 'Preview settings' }));

    expect(onToggleChatList).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('group', { name: 'Preview settings' })).toBeInTheDocument();
  });

  it('switches between web and mobile preview modes', () => {
    const { container, onToggleChatList } = renderStand(false);
    const preview = container.querySelector('.chat-preview-stand');

    expect(preview).toHaveClass('is-web');
    expect(screen.queryByRole('button', { name: 'Web' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mobile' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Preview settings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Switch to Mobile preview' }));
    expect(preview).toHaveClass('is-mobile');
    expect(screen.queryByRole('button', { name: 'Switch to Mobile preview' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Preview settings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Switch to Web preview' }));
    expect(preview).toHaveClass('is-web');
    expect(screen.queryByRole('button', { name: 'Switch to Web preview' })).not.toBeInTheDocument();
    expect(onToggleChatList).toHaveBeenCalledTimes(1);
  });
});
