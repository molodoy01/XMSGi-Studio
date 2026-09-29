import { useEffect, useMemo, useState } from 'react';
import { WorkspacePage } from './pages/WorkspacePage';
import type { Chat, NotificationState, ScheduledMessage } from './types';
import type { InlineKeyboardMarkup } from './lib/inlineKeyboard';
import { type ScheduleRepeatOptions } from './lib/scheduling';
import { createScheduledEntries } from './services/scheduleDomainService';
import { publishToChannel, scheduleToChannel } from './services/publishingService';
import { telegramChannelAdapter } from './services/telegramChannelAdapter';

function makeMessage(chat: Chat, text: string, date: string, time: string, status: ScheduledMessage['status'], attachments?: string[]): ScheduledMessage {
  return {
    id: crypto.randomUUID(),
    chatId: chat.id,
    chatName: chat.name,
    text,
    when: `${date}T${time}:00`,
    createdAt: new Date().toISOString(),
    status,
    attachments: attachments?.filter(Boolean),
  };
}

function toLocalDateTime(value: Date) {
  const date = `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  const time = `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;
  return { date, time };
}

type StudioAppProps = {
  connected?: boolean;
  chats?: Chat[];
  scheduler?: StudioSchedulerRuntime;
  activeAccountId?: 'account-1' | 'account-2';
};

export type StudioSchedulerRuntime = {
  upcoming: ScheduledMessage[];
  sent: ScheduledMessage[];
  scheduling: boolean;
  successPulse: boolean;
  lastAction: 'sent' | 'scheduled' | null;
  revealingId: string | null;
  cancelingIds: Set<string>;
  sendingIds: Set<string>;
  publishingDraft: boolean;
  notification: NotificationState;
  closeNotification: () => void;
  handleSchedule: (payload?: {
    chatId: string;
    message: string;
    date: string;
    time: string;
    attachments?: string[];
    entities?: unknown;
    replyMarkup?: InlineKeyboardMarkup;
  }, repeat?: ScheduleRepeatOptions) => void;
  handleSendDraftNow: (chat: Chat, text: string, attachments?: string[], entities?: unknown, replyMarkup?: InlineKeyboardMarkup) => Promise<boolean>;
  handleSendNow: (message: ScheduledMessage) => void;
  handleDeleteMessage: (message: ScheduledMessage) => void;
  handleClearSent: () => void;
  handleClearAll: () => void;
  handleCancelMessage: (message: ScheduledMessage) => void;
};

export default function App({ connected: xmsgiConnected, chats: xmsgiChats, scheduler, activeAccountId = 'account-1' }: StudioAppProps = {}) {
  const [selectedChat, setSelectedChat] = useState<Chat | null>(xmsgiChats?.[0] ?? null);
  const [localChats, setLocalChats] = useState(xmsgiChats ?? []);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState('12:00');
  const [upcoming, setUpcoming] = useState<ScheduledMessage[]>([]);
  const [sent, setSent] = useState<ScheduledMessage[]>([]);
  const [activeTab, setActiveTab] = useState<'upcoming' | 'sent'>('upcoming');
  const [notification, setNotification] = useState<NotificationState>({ message: '', title: '', type: 'info', visible: false });
  const [removeModal, setRemoveModal] = useState<{ show: boolean; chat: Chat | null }>({ show: false, chat: null });
  const [scheduling, setScheduling] = useState(false);
  const [publishingDraft, setPublishingDraft] = useState(false);
  const [successPulse, setSuccessPulse] = useState(false);
  const [lastAction, setLastAction] = useState<'sent' | 'scheduled' | null>(null);
  const [revealingId] = useState<string | null>(null);
  const [cancelingIds, setCancelingIds] = useState<Set<string>>(new Set());
  const [sendingIds, setSendingIds] = useState<Set<string>>(new Set());
  const showNotification = (message: string, type: NotificationState['type'] = 'info', title = 'Studio') => setNotification({ message, title, type, visible: true });
  const closeNotification = () => setNotification((current) => ({ ...current, visible: false }));
  const addChat = (chat: Chat) => setLocalChats((current) => current.some((item) => item.id === chat.id) ? current : [...current, chat]);
  const removeChat = (chat: Chat) => setRemoveModal({ show: true, chat });
  const confirmRemoveChat = () => { const chat = removeModal.chat; if (!chat) return; setLocalChats((current) => current.filter((item) => item.id !== chat.id)); if (selectedChat?.id === chat.id) setSelectedChat(localChats.find((item) => item.id !== chat.id) ?? null); setRemoveModal({ show: false, chat: null }); };
  const handleSchedule = async (payload?: { chatId: string; message: string; date: string; time: string; attachments?: string[]; entities?: unknown; replyMarkup?: InlineKeyboardMarkup }, repeat?: ScheduleRepeatOptions) => {
    if (!payload || scheduling) return;
    const chat = localChats.find((item) => item.id === payload.chatId) ?? selectedChat;
    if (!chat) return;

    const entities = Array.isArray(payload.entities)
      ? payload.entities as Array<{ type: 'bold' | 'italic' | 'underline' | 'strikethrough' | 'text_url'; offset: number; length: number; url?: string }>
      : [];
    const scheduledEntries = createScheduledEntries({
      chatId: chat.id,
      chatName: chat.name,
      message: payload.message,
      date: payload.date,
      time: payload.time,
      attachments: payload.attachments,
      entities,
      replyMarkup: payload.replyMarkup,
      repeat,
    });
    setScheduling(true);

    const scheduledMessages: ScheduledMessage[] = [];
    const failures: string[] = [];
    try {
      for (const entry of scheduledEntries) {
        const { publishResult } = await scheduleToChannel({
          accountId: activeAccountId,
          channelId: chat.id,
          body: entry.text,
          entities: entry.entities,
          mediaIds: entry.attachments,
          replyMarkup: entry.replyMarkup,
          scheduleAt: new Date(entry.when).toISOString(),
        });
        if (!publishResult.ok) {
          failures.push(publishResult.error || 'Telegram could not schedule the message.');
          continue;
        }

        scheduledMessages.push({
          ...makeMessage(chat, entry.text, entry.when.slice(0, 10), entry.when.slice(11, 16), 'scheduled', entry.attachments),
          id: entry.id,
          operationId: entry.operationId,
          createdAt: entry.createdAt,
          status: publishResult.confirmed ? 'confirmed' : 'scheduled',
          telegramMessageId: publishResult.messageId,
          replyMarkup: entry.replyMarkup,
          entities: entry.entities,
        });
      }
    } catch (error) {
      failures.push(error instanceof Error ? error.message : 'Telegram could not schedule the message.');
    } finally {
      setScheduling(false);
    }

    if (scheduledMessages.length > 0) {
      setUpcoming((current) => [...scheduledMessages, ...current]);
      setLastAction('scheduled');
      setSuccessPulse(true);
      showNotification(
        failures.length ? `${scheduledMessages.length} scheduled; ${failures.length} failed.` : 'Scheduled with Telegram.',
        failures.length ? 'warning' : 'success',
        'Studio',
      );
    } else {
      showNotification(failures[0] || 'Telegram could not schedule the message.', 'error', 'Studio');
    }
  };
  const handleSendDraftNow = async (chat: Chat, text: string, attachments?: string[], entities?: unknown, replyMarkup?: InlineKeyboardMarkup) => {
    setPublishingDraft(true);
    try {
      const { publishResult } = await publishToChannel({
        accountId: activeAccountId,
        channelId: chat.id,
        body: text,
        entities: Array.isArray(entities) ? entities as Array<{ type: string; offset: number; length: number; url?: string }> : [],
        mediaIds: attachments ?? [],
        replyMarkup,
      });
      if (!publishResult.ok) {
        showNotification(publishResult.error || 'Telegram could not send the message.', 'error', 'Studio');
        return false;
      }

      const message = makeMessage(chat, text, date, time, 'sent', attachments);
      setSent((current) => [{ ...message, sentAt: new Date().toISOString() }, ...current]);
      setLastAction('sent');
      setSuccessPulse(true);
      showNotification('Message sent through Telegram.', 'success', 'Studio');
      return true;
    } catch (error) {
      showNotification(error instanceof Error ? error.message : 'Telegram could not send the message.', 'error', 'Studio');
      return false;
    } finally {
      setPublishingDraft(false);
    }
  };
  const handleSendNow = async (message: ScheduledMessage) => {
    setSendingIds((current) => new Set(current).add(message.id));
    try {
      if (message.telegramMessageId !== undefined) {
        const cancelled = await telegramChannelAdapter.cancelScheduled(message.chatId, message.telegramMessageId);
        if (!cancelled.ok) throw new Error(cancelled.error || 'Telegram could not cancel the scheduled message.');
      }

      const { publishResult } = await publishToChannel({
        accountId: activeAccountId,
        channelId: message.chatId,
        body: message.text,
        entities: message.entities,
        mediaIds: message.attachments,
        replyMarkup: message.replyMarkup,
      });
      if (!publishResult.ok) throw new Error(publishResult.error || 'Telegram could not send the message.');

      setUpcoming((current) => current.filter((item) => item.id !== message.id));
      setSent((current) => [{ ...message, status: 'sent', sentAt: new Date().toISOString() }, ...current]);
    } catch (error) {
      showNotification(error instanceof Error ? error.message : 'Telegram could not send the message.', 'error', 'Studio');
    } finally {
      setSendingIds((current) => {
        const next = new Set(current);
        next.delete(message.id);
        return next;
      });
    }
  };
  const handleDeleteMessage = (message: ScheduledMessage) => { setUpcoming((current) => current.filter((item) => item.id !== message.id)); setSent((current) => current.filter((item) => item.id !== message.id)); };
  const handleClearSent = () => setSent([]);
  const handleClearAll = async () => {
    for (const message of upcoming) {
      await handleCancelMessage(message);
    }
  };
  const handleCancelMessage = async (message: ScheduledMessage) => {
    if (cancelingIds.has(message.id)) return;
    if (message.telegramMessageId === undefined) {
      showNotification('Telegram schedule ID is missing; the message was not removed.', 'error', 'Studio');
      return;
    }

    setCancelingIds((current) => new Set(current).add(message.id));
    try {
      const result = await telegramChannelAdapter.cancelScheduled(message.chatId, message.telegramMessageId);
      if (!result.ok) throw new Error(result.error || 'Telegram could not cancel the scheduled message.');
      setUpcoming((current) => current.filter((item) => item.id !== message.id));
      showNotification('Scheduled message cancelled.', 'success', 'Studio');
    } catch (error) {
      showNotification(error instanceof Error ? error.message : 'Telegram could not cancel the scheduled message.', 'error', 'Studio');
    } finally {
      setCancelingIds((current) => {
        const next = new Set(current);
        next.delete(message.id);
        return next;
      });
    }
  };
  const connected = xmsgiConnected ?? false;
  useEffect(() => {
    let cancelled = false;
    const applyChats = (nextChats: Chat[]) => {
      setLocalChats(nextChats);
      setSelectedChat((current) => current && nextChats.some((chat) => chat.id === current.id)
        ? current
        : nextChats[0] ?? null);
    };

    if (xmsgiChats !== undefined) {
      applyChats(xmsgiChats);
    } else if (typeof window.telegram?.getChats === 'function') {
      window.telegram.getChats()
        .then((result) => {
          if (!cancelled && result.success) applyChats(result.chats ?? []);
        })
        .catch((error) => {
          if (!cancelled) {
            setNotification({
              message: error instanceof Error ? error.message : 'Telegram chats could not be loaded.',
              title: 'Studio',
              type: 'error',
              visible: true,
            });
          }
        });
    }

    return () => { cancelled = true; };
  }, [xmsgiChats]);
  useEffect(() => {
    if (!successPulse) return;
    const timeoutId = window.setTimeout(() => setSuccessPulse(false), 2200);
    return () => window.clearTimeout(timeoutId);
  }, [successPulse]);

  const props = useMemo(() => ({ connected, chats: localChats, selectedChat, setSelectedChat, onAddChat: addChat, onRemoveChat: removeChat, removeModal, setRemoveModal, confirmRemoveChat, date, time, scheduling: scheduler?.scheduling ?? scheduling, successPulse: scheduler?.successPulse ?? successPulse, lastAction: scheduler?.lastAction ?? lastAction, notification: scheduler?.notification ?? notification, closeNotification: scheduler?.closeNotification ?? closeNotification, upcoming: scheduler?.upcoming ?? upcoming, sent: scheduler?.sent ?? sent, activeTab, revealingId: scheduler?.revealingId ?? revealingId, cancelingIds: scheduler?.cancelingIds ?? cancelingIds, sendingIds: scheduler?.sendingIds ?? sendingIds, setDate, setTime, handleSchedule: scheduler?.handleSchedule ?? handleSchedule, handleSendDraftNow: scheduler?.handleSendDraftNow ?? handleSendDraftNow, handleSendNow: scheduler?.handleSendNow ?? handleSendNow, handleDeleteMessage: scheduler?.handleDeleteMessage ?? handleDeleteMessage, handleClearSent: scheduler?.handleClearSent ?? handleClearSent, handleClearAll: scheduler?.handleClearAll ?? handleClearAll, setActiveTab, publishingDraft: scheduler?.publishingDraft ?? publishingDraft, handleCancelMessage: scheduler?.handleCancelMessage ?? handleCancelMessage }), [localChats, selectedChat, removeModal, date, time, scheduling, successPulse, lastAction, notification, upcoming, sent, activeTab, revealingId, cancelingIds, sendingIds, publishingDraft, scheduler]);
  return <WorkspacePage {...props} />;
}
