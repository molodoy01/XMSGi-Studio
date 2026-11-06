import type { PreviewChatHistory, PreviewHistoryMessage } from '@studio/types';

export function appendPreviewMessage(
  history: PreviewChatHistory,
  chatId: string,
  text: string,
): PreviewChatHistory {
  if (history.chat.id !== chatId) return history;

  const message: PreviewHistoryMessage = {
    id: `local-${Date.now()}`,
    text,
    date: new Date().toISOString(),
    outgoing: true,
  };

  return { ...history, messages: [...history.messages, message] };
}