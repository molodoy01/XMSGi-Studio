import { useEffect, useMemo, useState } from 'react';
import { WorkspacePage } from './pages/WorkspacePage';
import type { Chat, NotificationState, ScheduledMessage } from './types';
import type { InlineKeyboardMarkup } from './lib/inlineKeyboard';
import { type ScheduleRepeatOptions } from './lib/scheduling';
import { getCurrentAccountId } from './domain/accountContext';
import { createDomainDraft, createPublishPost } from './services/postStudioService';
import { createScheduledEntries } from './services/scheduleDomainService';

const chats: Chat[] = [
  { id: 'telegram', name: 'Telegram', username: 'telegram', type: 'channel' },
  { id: 'studio', name: 'Studio Design', username: 'studio_design', type: 'group' },
  { id: 'notes', name: 'Private Notes', username: 'notes', type: 'private' },
];

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

export default function App({ connected: xmsgiConnected, chats: xmsgiChats, scheduler }: StudioAppProps = {}) {
  const [selectedChat, setSelectedChat] = useState<Chat | null>(xmsgiChats?.[0] ?? chats[0]);
  const [localChats, setLocalChats] = useState(xmsgiChats ?? chats);
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
  const [cancelingIds] = useState<Set<string>>(new Set());
  const [sendingIds] = useState<Set<string>>(new Set());
  const showNotification = (message: string, type: NotificationState['type'] = 'info', title = 'Studio') => setNotification({ message, title, type, visible: true });
  const closeNotification = () => setNotification((current) => ({ ...current, visible: false }));
  const addChat = (chat: Chat) => setLocalChats((current) => current.some((item) => item.id === chat.id) ? current : [...current, chat]);
  const removeChat = (chat: Chat) => setRemoveModal({ show: true, chat });
  const confirmRemoveChat = () => { const chat = removeModal.chat; if (!chat) return; setLocalChats((current) => current.filter((item) => item.id !== chat.id)); if (selectedChat?.id === chat.id) setSelectedChat(localChats.find((item) => item.id !== chat.id) ?? null); setRemoveModal({ show: false, chat: null }); };
  const handleSchedule = (payload?: { chatId: string; message: string; date: string; time: string; attachments?: string[]; entities?: unknown; replyMarkup?: InlineKeyboardMarkup }, repeat?: ScheduleRepeatOptions) => { if (!payload) return; const chat = localChats.find((item) => item.id === payload.chatId) ?? selectedChat; if (!chat) return; const currentAccountId = getCurrentAccountId(); const draft = createDomainDraft({ authorAccountId: currentAccountId, contentBody: payload.message, metadata: { source: 'studio-schedule', date: payload.date, time: payload.time } }); const post = createPublishPost({ accountId: currentAccountId, channelId: chat.id, body: payload.message, entities: Array.isArray(payload.entities) ? payload.entities as Array<{ type: 'bold' | 'italic' | 'underline' | 'strikethrough' | 'text_url'; offset: number; length: number; url?: string }> : [], mediaIds: payload.attachments ?? [] }); const scheduledEntries = createScheduledEntries({ chatId: chat.id, chatName: chat.name, message: payload.message, date: payload.date, time: payload.time, attachments: payload.attachments, entities: Array.isArray(payload.entities) ? payload.entities as Array<{ type: 'bold' | 'italic' | 'underline' | 'strikethrough' | 'text_url'; offset: number; length: number; url?: string }> : [], replyMarkup: payload.replyMarkup, repeat }); setUpcoming((current) => [...scheduledEntries.map((entry) => ({ ...makeMessage(chat, entry.text, entry.when.slice(0, 10), entry.when.slice(11, 16), entry.status, entry.attachments), id: entry.id, operationId: entry.operationId, status: entry.status, createdAt: entry.createdAt, replyMarkup: entry.replyMarkup, entities: entry.entities })), ...current]); setLastAction('scheduled'); setSuccessPulse(true); showNotification(`Saved to local queue. Draft id: ${draft.id}; post id: ${post.id}`, 'success', 'Studio'); };
  const handleSendDraftNow = async (chat: Chat, text: string, attachments?: string[], _entities?: unknown, _replyMarkup?: InlineKeyboardMarkup) => { setPublishingDraft(true); const currentAccountId = getCurrentAccountId(); const draft = createDomainDraft({ authorAccountId: currentAccountId, contentBody: text, attachments: attachments?.map((attachment) => ({ name: attachment, path: attachment, size: 0 })) }); const post = createPublishPost({ accountId: currentAccountId, channelId: chat.id, body: text, mediaIds: attachments ?? [] }); const message = makeMessage(chat, text, date, time, 'sent', attachments); setSent((current) => [{ ...message, sentAt: new Date().toISOString() }, ...current]); setPublishingDraft(false); setLastAction('sent'); setSuccessPulse(true); showNotification(`Local preview only. Draft ${draft.id}; post ${post.id} created in domain layer.`, 'info', 'Studio'); return true; };
  const handleSendNow = (message: ScheduledMessage) => { setUpcoming((current) => current.filter((item) => item.id !== message.id)); setSent((current) => [{ ...message, status: 'sent', sentAt: new Date().toISOString() }, ...current]); };
  const handleDeleteMessage = (message: ScheduledMessage) => { setUpcoming((current) => current.filter((item) => item.id !== message.id)); setSent((current) => current.filter((item) => item.id !== message.id)); };
  const handleClearSent = () => setSent([]);
  const handleClearAll = () => setUpcoming([]);
  const handleCancelMessage = handleDeleteMessage;
  const connected = xmsgiConnected ?? true;
  useEffect(() => {
    if (!xmsgiChats) return;
    setLocalChats(xmsgiChats);
    setSelectedChat((current) => current && xmsgiChats.some((chat) => chat.id === current.id)
      ? current
      : xmsgiChats[0] ?? null);
  }, [xmsgiChats]);
  useEffect(() => {
    if (!successPulse) return;
    const timeoutId = window.setTimeout(() => setSuccessPulse(false), 2200);
    return () => window.clearTimeout(timeoutId);
  }, [successPulse]);

  const props = useMemo(() => ({ connected, chats: localChats, selectedChat, setSelectedChat, onAddChat: addChat, onRemoveChat: removeChat, removeModal, setRemoveModal, confirmRemoveChat, date, time, scheduling: scheduler?.scheduling ?? scheduling, successPulse: scheduler?.successPulse ?? successPulse, lastAction: scheduler?.lastAction ?? lastAction, notification: scheduler?.notification ?? notification, closeNotification: scheduler?.closeNotification ?? closeNotification, upcoming: scheduler?.upcoming ?? upcoming, sent: scheduler?.sent ?? sent, activeTab, revealingId: scheduler?.revealingId ?? revealingId, cancelingIds: scheduler?.cancelingIds ?? cancelingIds, sendingIds: scheduler?.sendingIds ?? sendingIds, setDate, setTime, handleSchedule: scheduler?.handleSchedule ?? handleSchedule, handleSendDraftNow: scheduler?.handleSendDraftNow ?? handleSendDraftNow, handleSendNow: scheduler?.handleSendNow ?? handleSendNow, handleDeleteMessage: scheduler?.handleDeleteMessage ?? handleDeleteMessage, handleClearSent: scheduler?.handleClearSent ?? handleClearSent, handleClearAll: scheduler?.handleClearAll ?? handleClearAll, setActiveTab, publishingDraft: scheduler?.publishingDraft ?? publishingDraft, handleCancelMessage: scheduler?.handleCancelMessage ?? handleCancelMessage }), [localChats, selectedChat, removeModal, date, time, scheduling, successPulse, lastAction, notification, upcoming, sent, activeTab, revealingId, cancelingIds, sendingIds, publishingDraft, scheduler]);
  return <WorkspacePage {...props} />;
}
