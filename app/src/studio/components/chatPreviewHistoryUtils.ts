import type { PreviewChatHistory } from '@studio/types';

export type HistoryGroup = {
  key: string;
  groupId?: string;
  messages: PreviewChatHistory['messages'];
};

export function groupHistory(messages: PreviewChatHistory['messages']): HistoryGroup[] {
  const groups: HistoryGroup[] = [];

  for (const message of messages) {
    const previous = groups[groups.length - 1];
    const groupHasMedia = previous?.messages.some((item) => item.media) ?? false;
    if (message.groupId && previous?.groupId === message.groupId && (Boolean(message.media) || groupHasMedia)) {
      previous.messages.push(message);
    } else {
      groups.push({
        key: message.media ? message.groupId || message.id : message.id,
        groupId: message.groupId,
        messages: [message],
      });
    }
  }

  return groups;
}
