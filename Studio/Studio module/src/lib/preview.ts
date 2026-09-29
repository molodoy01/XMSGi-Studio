import type { PreviewChatHistory, PreviewHistoryMessage } from '@/types';
import type { InlineKeyboardMarkup } from './inlineKeyboard';

export function appendPreviewMessage(
  history: PreviewChatHistory,
  chatId: string,
  text: string,
  replyMarkup?: InlineKeyboardMarkup,
): PreviewChatHistory {
  if (history.chat.id !== chatId) return history;

  const message: PreviewHistoryMessage = {
    id: `local-${Date.now()}`,
    text,
    date: new Date().toISOString(),
    outgoing: true,
    replyMarkup,
  };

  return { ...history, messages: [...history.messages, message] };
}