import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useChats, useNotifications, useScheduler, useTelegramAuth } from './core';
import type { Chat, RichTextEntity } from '@/types';
import type { SavedDraft, ScheduledMessage as StudioScheduledMessage } from '@shared/types';
import { createStudioSchedulerRuntime } from '@shared/bridge';
import type { StudioPlannerTextPayload } from '@shared/bridge';

import { AppShell, StudioMount } from './workspace';
import { useLocale } from '@/lib/i18n';
import { getPlannerAttachmentPaths, hasPlannerPayloadContent } from './workspace/plannerText';
import { getPlannerSurface } from './workspace/plannerSurface';
import { normalizePlannerDraft, normalizeSavedPlannerDraft, normalizeScheduledMessages } from './workspace/historyModel';
import type { HistoryItem, HistorySource } from './workspace/historyModel';
import { QuickPlanner } from './components/QuickPlanner';
import { ConfirmDialogProvider } from './components/ConfirmDialog';
import { LoginPage } from './pages/LoginPage';
import { SettingsPage } from './pages/SettingsPage';
import {
  flushPlannerDraftWrite,
  readPlannerDraft,
  readPlannerDraftAttachments,
  readPlannerDraftEntities,
  readPlannerDraftUpdatedAt,
  readSavedPlannerDrafts,
  writePlannerDraft,
  writeSavedPlannerDrafts,
  SAVED_PLANNER_DRAFTS_UPDATED_EVENT,
} from './lib/plannerDraft';
import {
  hasTelegramBridge,
  isDesktopTelegramRuntime,
  telegramDeleteSavedMessage,
  telegramGetAuthState,
  telegramGetConfig,
  telegramSaveCredentials,
  subscribeToConfirmedSendHistoryWarning,
} from './services/telegramAppService';
import {
  getBackgroundProductView,
  getInitialProductView,
  persistProductView,
  type ProductView,
} from './lib/productView';
import { updateSavedStudioDrafts } from '@studio/lib/draftStore';
import { appStateReducer, createInitialAppState, createMessageSession, type AppRoute } from './appState';

function getCurrentHashPath(): AppRoute {
  const hash = window.location.hash.replace(/^#/, '').trim();
  const path = hash ? (hash.startsWith('/') ? hash : `/${hash}`) : '/';

  if (path === '/settings') {
    return path;
  }

  return '/';
}

function AppContent() {
  const { t } = useLocale();
  const browserDraftMode = !isDesktopTelegramRuntime();
  const [, setSavedPlannerDraftRevision] = useState(0);
  const [plannerDraftLoadRequest, setPlannerDraftLoadRequest] = useState<{
    revision: number;
    text: string;
    attachments: string[];
    entities: RichTextEntity[];
    restoreDraft: {
      text: string;
      attachments: string[];
      entities: RichTextEntity[];
    } | null;
  } | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const initialMessageSession = createMessageSession({
    text: readPlannerDraft(),
    attachments: readPlannerDraftAttachments(),
    entities: readPlannerDraftEntities(),
  });
  const [appState, dispatch] = useReducer(
    appStateReducer,
    createInitialAppState({
      route: getCurrentHashPath(),
      productView: getInitialProductView(browserDraftMode),
      activeAccountId: 'account-1',
      messageSession: initialMessageSession,
    }),
  );
  const { route, productView, activeAccountId, messageSession } = appState;
  const [studioHasBeenOpened, setStudioHasBeenOpened] = useState(() => (
    productView === 'studio'
    || (productView === 'posts'
      && getBackgroundProductView(productView, browserDraftMode ? 'planner' : 'studio') === 'studio')
  ));
  const message = messageSession.text;
  const messageEntities = messageSession.entities as RichTextEntity[];
  const plannerAttachments = messageSession.attachments;
  const messageRef = useRef(message);
  const messageEntitiesRef = useRef(messageEntities);
  const plannerAttachmentsRef = useRef(plannerAttachments);
  const selectedChatIdRef = useRef<string | null>(null);
  const studioFlushBeforeLeaveRef = useRef<(() => Promise<boolean>) | null>(null);
  const studioLeaveFlushRef = useRef<Promise<boolean> | null>(null);
  const studioLeaveFlushScheduledRef = useRef(false);
  const productViewRef = useRef(productView);
  productViewRef.current = productView;

  useEffect(() => {
    const flushPlannerDraftBeforeClose = (event: BeforeUnloadEvent) => {
      if (flushPlannerDraftWrite()) return;
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', flushPlannerDraftBeforeClose);
    return () => window.removeEventListener('beforeunload', flushPlannerDraftBeforeClose);
  }, []);

  useEffect(() => {
    messageRef.current = message;
  }, [message]);
  useEffect(() => {
    messageEntitiesRef.current = messageEntities;
  }, [messageEntities]);
  useEffect(() => {
    plannerAttachmentsRef.current = plannerAttachments;
  }, [plannerAttachments]);
  const setMessage = useCallback((nextMessage: React.SetStateAction<string>) => {
    const resolvedMessage = typeof nextMessage === 'function'
      ? nextMessage(messageRef.current)
      : nextMessage;
    messageRef.current = resolvedMessage;
    writePlannerDraft(resolvedMessage, messageEntitiesRef.current, plannerAttachmentsRef.current);
    dispatch({
      type: 'SET_MESSAGE_DRAFT',
      text: resolvedMessage,
      attachments: plannerAttachmentsRef.current,
      entities: messageEntitiesRef.current,
      chatId: selectedChatIdRef.current,
    });
  }, [dispatch]);
  const setMessageEntities = useCallback((nextEntities: RichTextEntity[]) => {
    messageEntitiesRef.current = nextEntities;
    writePlannerDraft(messageRef.current, nextEntities, plannerAttachmentsRef.current);
    dispatch({
      type: 'SET_MESSAGE_DRAFT',
      text: messageRef.current,
      attachments: plannerAttachmentsRef.current,
      entities: nextEntities,
      chatId: selectedChatIdRef.current,
    });
  }, [dispatch]);
  const setPlannerAttachments = useCallback((nextAttachments: string[]) => {
    plannerAttachmentsRef.current = nextAttachments;
    writePlannerDraft(messageRef.current, messageEntitiesRef.current, nextAttachments);
    dispatch({
      type: 'SET_MESSAGE_DRAFT',
      text: messageRef.current,
      attachments: nextAttachments,
      entities: messageEntitiesRef.current,
      chatId: selectedChatIdRef.current,
    });
  }, [dispatch]);
  const setProductView = useCallback((view: ProductView) => {
    if (productViewRef.current === 'studio' && view !== 'studio' && studioFlushBeforeLeaveRef.current) {
      if (!studioLeaveFlushRef.current && !studioLeaveFlushScheduledRef.current) {
        studioLeaveFlushScheduledRef.current = true;
        const flushDraft = () => {
          const flushCallback = studioFlushBeforeLeaveRef.current;
          if (!flushCallback) {
            studioLeaveFlushScheduledRef.current = false;
            return;
          }
          const flush = flushCallback();
          studioLeaveFlushRef.current = flush;
          const clearFlush = () => {
            if (studioLeaveFlushRef.current === flush) studioLeaveFlushRef.current = null;
            studioLeaveFlushScheduledRef.current = false;
          };
          void flush.then(clearFlush, clearFlush);
        };
        if (typeof window.requestIdleCallback === 'function') {
          window.requestIdleCallback(flushDraft, { timeout: 1000 });
        } else {
          window.setTimeout(flushDraft, 0);
        }
      }
    }

    persistProductView(view);
    productViewRef.current = view;
    if (view === 'studio') setStudioHasBeenOpened(true);
    dispatch({ type: 'SET_PRODUCT_VIEW', view });
  }, [dispatch]);
  const setRoute = useCallback((nextRoute: AppRoute) => {
    dispatch({ type: 'SET_ROUTE', route: nextRoute });
  }, []);
  const setCurrentAction = useCallback((action: 'send-now' | 'schedule' | 'draft') => {
    dispatch({ type: 'SET_CURRENT_ACTION', action });
  }, []);
  const setMessageSessionStatus = useCallback((status: 'draft' | 'preview' | 'sending' | 'scheduled' | 'sent' | 'failed' | 'cancelled') => {
    dispatch({ type: 'SET_MESSAGE_STATUS', status });
  }, []);
  const [welcomeBackInProgress, setWelcomeBackInProgress] = useState(false);
  const settingsReturnViewRef = useRef<ProductView | null>(null);
  const [telegramApiId, setTelegramApiId] = useState('');
  const [telegramApiHash, setTelegramApiHash] = useState('');
  const [telegramCredentialsBusy, setTelegramCredentialsBusy] = useState(false);
  const [telegramCredentialsError, setTelegramCredentialsError] = useState('');
  const [telegramCredentials, setTelegramCredentials] = useState({
    hasCredentials: false,
    apiId: '',
    hasSession: false,
    connected: false,
    signedOut: false,
  });

  useEffect(() => {
    const updateSavedPlannerDrafts = () => setSavedPlannerDraftRevision((revision) => revision + 1);
    window.addEventListener(SAVED_PLANNER_DRAFTS_UPDATED_EVENT, updateSavedPlannerDrafts);
    return () => window.removeEventListener(SAVED_PLANNER_DRAFTS_UPDATED_EVENT, updateSavedPlannerDrafts);
  }, []);

  const {
    notification,
    showNotification,
    closeNotification,
  } = useNotifications();
  useEffect(() => {
    return subscribeToConfirmedSendHistoryWarning(showNotification, t);
  }, [showNotification, t]);
  const [studioMessage, setStudioMessage] = useState('');
  const studioDraftOpenerRef = useRef<((draft: SavedDraft) => void) | null>(null);
  const studioDraftUseRef = useRef<((draft: SavedDraft) => Promise<boolean>) | null>(null);
  const pendingStudioDraftUseWaitersRef = useRef(new Set<(handler: (draft: SavedDraft) => Promise<boolean>) => void>());
  const studioDraftClearerRef = useRef<(() => Promise<boolean>) | null>(null);
  const studioDraftDeleterRef = useRef<((draftId: string) => Promise<boolean>) | null>(null);
  const studioHistoryReschedulerRef = useRef<((message: StudioScheduledMessage) => void) | null>(null);
  const studioPlannerTextOpenerRef = useRef<((payload: StudioPlannerTextPayload) => Promise<boolean>) | null>(null);
  const pendingPlannerTextRef = useRef<StudioPlannerTextPayload | null>(null);
  const pendingPlannerTextOpenedRef = useRef<((opened: boolean) => void) | null>(null);
  const [studioPlannerTextOpenerVersion, setStudioPlannerTextOpenerVersion] = useState(0);
  const registerPlannerTextOpener = useCallback((opener: ((payload: StudioPlannerTextPayload) => Promise<boolean>) | null) => {
    studioPlannerTextOpenerRef.current = opener;
    setStudioPlannerTextOpenerVersion((version) => version + 1);
  }, []);
  const registerHistoryDraftOpener = useCallback((opener: ((draft: SavedDraft) => void) | null) => {
    studioDraftOpenerRef.current = opener;
  }, []);
  const registerHistoryDraftUseHandler = useCallback((handler: ((draft: SavedDraft) => Promise<boolean>) | null) => {
    studioDraftUseRef.current = handler;
    if (!handler) return;
    for (const resolveHandler of pendingStudioDraftUseWaitersRef.current) resolveHandler(handler);
    pendingStudioDraftUseWaitersRef.current.clear();
  }, []);
  const registerHistoryRescheduleHandler = useCallback((handler: ((message: StudioScheduledMessage) => void) | null) => {
    studioHistoryReschedulerRef.current = handler;
  }, []);
  const registerHistoryDraftClearHandler = useCallback((handler: (() => Promise<boolean>) | null) => {
    studioDraftClearerRef.current = handler;
  }, []);

  const registerHistoryDraftDeleteHandler = useCallback((handler: ((draftId: string) => Promise<boolean>) | null) => {
    studioDraftDeleterRef.current = handler;
  }, []);

  const chatsApiRef = useRef<{
    setChats: React.Dispatch<React.SetStateAction<Chat[]>>;
    setSelectedChat: React.Dispatch<React.SetStateAction<Chat | null>>;
  } | null>(null);

  const {
    connected,
    sessionAvailable,
    sessionResolved,
    signedOut,
    returningUserName,
    returningUserUsername,
    connecting,
    connectionResolved,
    authStep,
    showAuthForm,
    phoneNumber,
    phoneCode,
    twoFactorPassword,
    authBusy,
    authError,
    authNotice,
    telegramStatus,
    isConfirmingLogout,
    setIsConfirmingLogout,
    setShowAuthForm,
    setAuthStep,
    setPhoneNumber,
    setPhoneCode,
    setTwoFactorPassword,
    setAuthError,
    handleTelegramAuth,
    handleDisconnect,
    handleWelcomeBack,
    handleForgetAccount,
  } = useTelegramAuth({
    setIsSettingsOpen,
    setChats: (value) => {
      chatsApiRef.current?.setChats(value);
    },
    setSelectedChat: (value) => {
      chatsApiRef.current?.setSelectedChat(value);
    },
  });

  const [connectionRecoveryTimedOut, setConnectionRecoveryTimedOut] = useState(false);
  useEffect(() => {
    if (!sessionResolved || !sessionAvailable || connected || signedOut) {
      setConnectionRecoveryTimedOut(false);
      return undefined;
    }

    const timer = window.setTimeout(() => setConnectionRecoveryTimedOut(true), 10_000);
    return () => window.clearTimeout(timer);
  }, [connected, sessionAvailable, sessionResolved, signedOut]);

  const connectionRecoveryStatus = sessionResolved && sessionAvailable && !connected && !signedOut
    ? connectionRecoveryTimedOut ? 'offline' : 'reconnecting'
    : null;

  useLayoutEffect(() => {
    if (sessionResolved && connectionResolved && ((!connected && !sessionAvailable) || signedOut) && productView !== 'planner') {
      setProductView('planner');
    }
  }, [connected, connectionResolved, productView, sessionAvailable, sessionResolved, setProductView, signedOut]);

  const {
    chats,
    setChats,
    selectedChat,
    setSelectedChat,
    refreshChatPermissions,
    handleRemoveChat,
  } = useChats({
    connected,
    onStorageError: (error) => showNotification(
      error,
      'error',
      'Saved chats unavailable',
    ),
  });

  useEffect(() => {
    selectedChatIdRef.current = selectedChat?.id ?? null;
    dispatch({ type: 'SET_SELECTED_CHAT', chatId: selectedChat?.id ?? null });
  }, [selectedChat, dispatch]);

  useEffect(() => {
    chatsApiRef.current = {
      setChats,
      setSelectedChat,
    };
  }, [setChats, setSelectedChat]);

  const {
    upcoming: personalUpcoming,
    sent: personalSent,
    historyReady: personalHistoryReady,
    historyLoadError: personalHistoryLoadError,
    handleCancelMessage: handlePersonalCancelMessage,
    handleCancelMessages: handlePersonalCancelMessages,
    handleSchedule: handlePersonalSchedule,
    handleSendDraftNow: handlePersonalSendDraftNow,
    handleSendNow: handlePersonalSendNow,
    handleDeleteMessage: handlePersonalDeleteMessage,
    handleClearSent: handlePersonalClearSent,
  } = useScheduler({
    historyScope: 'personal',
    connected,
    selectedChat,
    refreshChatPermissions,
    chats,
    message,
    composerAttachments: plannerAttachments,
    composerEntities: messageEntities,
    showNotification,
    setMessage,
  });

  const studioScheduler = useScheduler({
    historyScope: 'workspace',
    accountId: activeAccountId,
    connected: connected && !signedOut && activeAccountId === 'account-1',
    selectedChat,
    refreshChatPermissions,
    chats,
    message: studioMessage,
    showNotification,
    setMessage: setStudioMessage,
  });

  const studioBridgeScheduler = createStudioSchedulerRuntime(
    {
      ...studioScheduler,
      handleSendDraftNow: (chat, text, attachments, entities, replyMarkup, attachmentGroups, onAttachmentGroupResult, effect, suppressNotifications) => (
        studioScheduler.handleSendDraftNow(
          chat,
          text,
          attachments,
          entities,
          replyMarkup,
          false,
          effect,
          { suppressNotifications },
          attachmentGroups,
          onAttachmentGroupResult,
        )
      ),
    },
    showNotification,
  );

  const openPlannerTextInStudio = (
    payload: StudioPlannerTextPayload,
    onOpened?: (opened: boolean) => void,
  ) => {
    if (!hasPlannerPayloadContent(payload)) {
      showNotification('Add text or an attachment before opening Studio.', 'warning', 'Nothing to open');
      return false;
    }
    if (pendingPlannerTextRef.current !== null) return false;

    pendingPlannerTextRef.current = {
      text: payload.text,
      attachments: [...payload.attachments],
      entities: payload.entities.map((entity) => ({ ...entity })),
      ...(payload.effect ? { effect: payload.effect } : {}),
    };
    pendingPlannerTextOpenedRef.current = onOpened ?? null;
    setCurrentAction('draft');
    setMessageSessionStatus('preview');
    setProductView('studio');
    return true;
  };

  useEffect(() => {
    if (productView !== 'studio' || pendingPlannerTextRef.current === null) return;
    const pendingText = pendingPlannerTextRef.current;
    const opener = studioPlannerTextOpenerRef.current;
    if (!opener) {
      const timeout = window.setTimeout(() => {
        if (pendingPlannerTextRef.current !== pendingText) return;
        pendingPlannerTextRef.current = null;
        const onOpened = pendingPlannerTextOpenedRef.current;
        pendingPlannerTextOpenedRef.current = null;
        onOpened?.(false);
        showNotification('Studio did not finish loading. Planner text is unchanged.', 'error', 'Could not open Studio');
      }, 10000);
      return () => window.clearTimeout(timeout);
    }

    pendingPlannerTextRef.current = null;
    const onOpened = pendingPlannerTextOpenedRef.current;
    pendingPlannerTextOpenedRef.current = null;
    try {
      void opener(pendingText).then((opened) => {
        onOpened?.(opened);
        if (!opened) {
          showNotification(
            'Studio could not preserve its current document. Planner text was not opened.',
            'warning',
            'Document not replaced',
          );
        }
      }).catch(() => {
        onOpened?.(false);
        showNotification('Studio could not open the Planner text. Your Planner text is unchanged.', 'error', 'Could not open Studio');
      });
    } catch {
      onOpened?.(false);
      showNotification('Studio could not open the Planner text. Your Planner text is unchanged.', 'error', 'Could not open Studio');
    }
  }, [productView, showNotification, studioPlannerTextOpenerVersion]);

  const plannerDraftRecord = normalizePlannerDraft(message, selectedChat, readPlannerDraftUpdatedAt(), messageEntities, plannerAttachments);

  useEffect(() => {
    if (!selectedChat?.id && messageSession.chatId) {
      dispatch({
        type: 'SET_MESSAGE_DRAFT',
        text: messageSession.text,
        attachments: messageSession.attachments,
        entities: messageSession.entities,
        chatId: null,
      });
    }
  }, [dispatch, messageSession, selectedChat]);
  const savedPlannerDraftRecords = readSavedPlannerDrafts().map(normalizeSavedPlannerDraft);
  const personalSentHistoryRecords = useMemo(
    () => normalizeScheduledMessages(personalSent, 'personal', 'sent', chats),
    [chats, personalSent],
  );
  const historyRecords = [
    ...normalizeScheduledMessages(personalUpcoming, 'personal', 'upcoming', chats),
    ...personalSentHistoryRecords,
    ...normalizeScheduledMessages(studioScheduler.upcoming, 'workspace', 'upcoming', chats),
    ...normalizeScheduledMessages(studioScheduler.sent, 'workspace', 'sent', chats),
    ...(plannerDraftRecord ? [plannerDraftRecord] : []),
    ...savedPlannerDraftRecords,
  ];
  const cancelHistoryRecord = (record: HistoryItem) => {
    if (record.original.kind !== 'scheduled' || record.status !== 'scheduled') return;
    if (record.source === 'workspace') {
      studioScheduler.handleCancelMessage(record.original.message);
    } else {
      handlePersonalCancelMessage(record.original.message);
    }
  };

  const sendHistoryRecordNow = (record: HistoryItem) => {
    if (record.original.kind !== 'scheduled') return;
    if (record.source === 'workspace') {
      studioScheduler.handleSendNow(record.original.message);
    } else {
      handlePersonalSendNow(record.original.message);
    }
  };

  const rescheduleHistoryRecord = (record: HistoryItem) => {
    if (record.source !== 'workspace' || record.original.kind !== 'scheduled' || record.status !== 'scheduled') return;
    setProductView('studio');
    studioHistoryReschedulerRef.current?.({ ...record.original.message, status: 'scheduled' });
  };

  const clearHistorySent = (source: HistorySource | 'all') => {
    if (source === 'all') {
      studioScheduler.handleClearSent();
      handlePersonalClearSent();
      return;
    }
    if (source === 'workspace') studioScheduler.handleClearSent();
    else handlePersonalClearSent();
  };

  const clearActivePlannerDraft = () => {
    writePlannerDraft('', [], []);
    if (!flushPlannerDraftWrite()) return false;
    setMessage('');
    setMessageEntities([]);
    setPlannerAttachments([]);
    setPlannerDraftLoadRequest((current) => ({
      revision: (current?.revision ?? 0) + 1,
      text: '',
      attachments: [],
      entities: [],
      restoreDraft: null,
    }));
    return true;
  };

  const clearHistoryDrafts = async (source: HistorySource | 'all') => {
    if (source === 'all' || source === 'workspace') {
      const studioDraftClearer = studioDraftClearerRef.current;
      if (studioDraftClearer) {
        if (!await studioDraftClearer()) return false;
      } else {
        const cleared = await updateSavedStudioDrafts(() => []);
        if (!cleared) return false;
      }
    }
    if (source === 'all' || source === 'personal') {
      if (!clearActivePlannerDraft()) return false;
      if (!writeSavedPlannerDrafts([])) return false;
    }
    return true;
  };

  const cancelHistoryQueue = async (records: HistoryItem[]) => {
    const personalMessages = records.flatMap((record) => record.source === 'personal' && record.original.kind === 'scheduled' ? [record.original.message] : []);
    const workspaceMessages = records.flatMap((record) => record.source === 'workspace' && record.original.kind === 'scheduled' ? [record.original.message] : []);
    const results = await Promise.all([
      personalMessages.length ? handlePersonalCancelMessages(personalMessages) : true,
      workspaceMessages.length ? studioScheduler.handleCancelMessages(workspaceMessages) : true,
    ]);
    return results.every(Boolean);
  };

  const deleteSavedStudioDraft = async (draftId: string): Promise<boolean> => {
    const registeredDelete = studioDraftDeleterRef.current;
    if (registeredDelete) return registeredDelete(draftId);
    return updateSavedStudioDrafts((drafts) => drafts.filter((draft) => draft.id !== draftId));
  };

  const deleteHistoryRecord = (record: HistoryItem): void | Promise<boolean> => {
    if (record.original.kind === 'saved-draft') return deleteSavedStudioDraft(record.original.draft.id);
    if (record.original.kind === 'saved-planner-draft') {
      const savedDraftId = record.original.draft.id;
      const remainingDrafts = readSavedPlannerDrafts().filter(({ id }) => id !== savedDraftId);
      return Promise.resolve(writeSavedPlannerDrafts(remainingDrafts));
    }
    if (record.original.kind === 'planner-draft') {
      return Promise.resolve(clearActivePlannerDraft());
    }
    const message = record.original.message;
    const normalizedChatName = message.chatName.trim().toLocaleLowerCase();
    const isSavedMessagesChat = normalizedChatName === 'saved messages' || normalizedChatName === 'сохранённые сообщения';
    const telegramMessageIds = [...new Set([
        message.telegramMessageId,
        ...(message.telegramMessageIds ?? []),
      ].filter((id): id is string | number => id !== undefined && id !== null).map(String))];
    if (record.source === 'personal' && record.status === 'sent' && isSavedMessagesChat && telegramMessageIds.length > 0) {
      return Promise.all(telegramMessageIds.map((messageId) => telegramDeleteSavedMessage({
        chatId: message.chatId,
        messageId,
      }))).then((results) => {
        if (results.some((result) => !result.success)) return false;
        handlePersonalDeleteMessage(message, true);
        return true;
      });
    }
    if (!['sent', 'failed', 'cancelled'].includes(record.status)) return;
    if (record.source === 'workspace') {
      studioScheduler.handleDeleteMessage(message, true);
    } else {
      handlePersonalDeleteMessage(message, true);
    }
  };

  const openHistoryDraft = (record: HistoryItem) => {
    setProductView(record.source === 'workspace' ? 'studio' : 'planner');
    if (record.original.kind === 'saved-draft') {
      studioDraftOpenerRef.current?.(record.original.draft);
    } else if (record.original.kind === 'planner-draft') {
      setMessageEntities(record.original.entities);
      setMessage(record.original.text);
      setPlannerAttachments([]);
    } else if (record.original.kind === 'saved-planner-draft') {
      setMessageEntities(record.original.draft.entities);
      setPlannerAttachments(record.original.draft.attachments);
      setMessage(record.original.draft.message);
    }
  };

  const useHistoryDraft = async (record: HistoryItem, destination?: 'planner' | 'studio'): Promise<boolean> => {
    const target = destination ?? getBackgroundProductView(
      productViewRef.current,
      browserDraftMode ? 'planner' : 'studio',
    );
    if (record.original.kind === 'saved-draft' && target === 'studio') {
      setProductView('studio');
      const applyDraft = studioDraftUseRef.current ?? await new Promise<((draft: SavedDraft) => Promise<boolean>) | null>((resolve) => {
        const resolveHandler = (handler: (draft: SavedDraft) => Promise<boolean>) => {
          window.clearTimeout(timeoutId);
          resolve(handler);
        };
        const timeoutId = window.setTimeout(() => {
          pendingStudioDraftUseWaitersRef.current.delete(resolveHandler);
          resolve(null);
        }, 10_000);
        pendingStudioDraftUseWaitersRef.current.add(resolveHandler);
      });
      if (!applyDraft) {
        showNotification(t('studio.draftCouldNotBeOpened'), 'error', 'Studio');
        return false;
      }
      try {
        const applied = await applyDraft(record.original.draft);
        if (!applied) return false;
        return true;
      } catch (error) {
        console.error('Failed to use a saved Studio draft from Posts.', error);
        showNotification(t('studio.draftCouldNotBeOpened'), 'error', 'Studio');
        return false;
      }
    }

    const plannerPayload = record.original.kind === 'planner-draft'
      ? { text: record.original.text, attachments: record.original.attachments, entities: record.original.entities }
      : record.original.kind === 'saved-planner-draft'
        ? { text: record.original.draft.message, attachments: record.original.draft.attachments, entities: record.original.draft.entities }
        : record.original.kind === 'saved-draft'
          ? {
            text: record.original.draft.body,
            attachments: getPlannerAttachmentPaths(record.original.draft.attachments ?? []),
            entities: record.original.draft.entities ?? [],
          }
          : record.original.kind === 'scheduled'
            ? {
              text: record.original.message.text,
              attachments: record.original.message.attachments ?? [],
              entities: record.original.message.entities ?? [],
            }
          : null;
    if (!plannerPayload) return false;

    if (target === 'studio') {
      const savedDraftId = record.original.kind === 'saved-planner-draft' ? record.original.draft.id : null;
      return new Promise<boolean>((resolve) => {
        const started = openPlannerTextInStudio(plannerPayload, (opened) => {
          if (opened && savedDraftId) {
            const remainingDrafts = readSavedPlannerDrafts().filter(({ id }) => id !== savedDraftId);
            if (!writeSavedPlannerDrafts(remainingDrafts)) {
              showNotification(t('quickPlanner.couldNotRemoveDraft'), 'error', t('quickPlanner.draftRemovalFailed'));
            }
          }
          resolve(opened);
        });
        if (!started) resolve(false);
      });
    }

    if (!flushPlannerDraftWrite()) {
      showNotification(t('quickPlanner.couldNotSaveDraft'), 'error', 'Posts');
      return false;
    }
    setProductView('planner');
    const currentDraft = {
      text: readPlannerDraft(),
      attachments: readPlannerDraftAttachments(),
      entities: readPlannerDraftEntities(),
    };
    const restoreDraft = plannerDraftLoadRequest
      ? plannerDraftLoadRequest.restoreDraft
      : currentDraft.text.trim() || currentDraft.attachments.length > 0
        ? currentDraft
        : null;
    setMessageEntities(plannerPayload.entities);
    setPlannerAttachments(plannerPayload.attachments);
    setMessage(plannerPayload.text);
    setPlannerDraftLoadRequest((current) => ({
      revision: (current?.revision ?? 0) + 1,
      text: plannerPayload.text,
      attachments: [...plannerPayload.attachments],
      entities: [...plannerPayload.entities],
      restoreDraft,
    }));
    if (record.original.kind === 'saved-planner-draft' || record.original.kind === 'saved-draft') {
      const isStudioDraft = record.original.kind === 'saved-draft';
      const savedDraftId = record.original.draft.id;
      if (isStudioDraft) {
        const removed = await deleteSavedStudioDraft(savedDraftId);
        if (!removed) showNotification(t('studio.draftsCouldNotSave'), 'error', 'Studio');
      } else {
        const remainingDrafts = readSavedPlannerDrafts().filter(({ id }) => id !== savedDraftId);
        if (!writeSavedPlannerDrafts(remainingDrafts)) {
          showNotification(t('quickPlanner.couldNotRemoveDraft'), 'error', t('quickPlanner.draftRemovalFailed'));
        }
      }
    }
    return true;
  };

  const restorePlannerDraft = (draft: { text: string; attachments: string[]; entities: RichTextEntity[] } | null) => {
    setMessageEntities(draft?.entities ?? []);
    setPlannerAttachments(draft?.attachments ?? []);
    setMessage(draft?.text ?? '');
    setPlannerDraftLoadRequest(null);
  };

  const studioConnected = connected && !signedOut && activeAccountId === 'account-1';
  const plannerSurface = getPlannerSurface({
    browserDraftMode,
    connected,
    sessionAvailable,
    sessionResolved,
    signedOut,
    connecting,
    connectionResolved,
    welcomeBackInProgress,
  });
  const backgroundProductView = getBackgroundProductView(
    productView,
    browserDraftMode ? 'planner' : 'studio',
  );
  const studioSurfaceAvailable = studioHasBeenOpened
    && (browserDraftMode || (sessionResolved && (sessionAvailable || (connectionResolved && connected)) && !signedOut));
  const studioSurfaceVisible = backgroundProductView === 'studio'
    && studioSurfaceAvailable;

  useEffect(() => {
    if (isSettingsOpen) {
      setIsConfirmingLogout(false);
    }
  }, [isSettingsOpen, setIsConfirmingLogout]);

  useEffect(() => {
    const handleHashChange = () => {
      setRoute(getCurrentHashPath());
    };

    handleHashChange();
    window.addEventListener('hashchange', handleHashChange);

    return () => {
      window.removeEventListener('hashchange', handleHashChange);
    };
  }, [setRoute]);

  useLayoutEffect(() => {
    if (route === '/settings') {
      if (settingsReturnViewRef.current === null) {
        settingsReturnViewRef.current = productView;
      }
      setIsSettingsOpen(true);
      setProductView('planner');
    } else {
      setIsSettingsOpen(false);
      const returnView = settingsReturnViewRef.current;
      if (returnView !== null) {
        settingsReturnViewRef.current = null;
        setProductView(returnView);
      }
    }
  }, [productView, route, setProductView]);

  const navigate = (nextRoute: AppRoute) => {
    const target = nextRoute === '/' ? '#/' : `#${nextRoute}`;
    if (window.location.hash !== target) {
      window.location.hash = target;
    }
    setRoute(nextRoute);
  };

  const closeSettings = () => {
    setShowAuthForm(false);
    setIsSettingsOpen(false);
    navigate('/');
  };

  const finishWelcomeBack = async () => {
    if (!hasTelegramBridge()) return false;

    try {
      const authResult = await telegramGetAuthState();
      if (!authResult.success || !authResult.authState?.connected || authResult.authState.signedOut) return false;
      setProductView('studio');
      settingsReturnViewRef.current = 'studio';
      return true;
    } catch {
      return false;
    }
  };

  const openCredentialSettingsIfMissing = async () => {
    if (!hasTelegramBridge()) return;

    try {
      const configResult = await telegramGetConfig();
      if (configResult.success && configResult.config && !configResult.config.hasCredentials) {
        navigate('/settings');
      }
    } catch {
      return;
    }
  };

  const handleWelcomeBackFromReturn = async () => {
    setWelcomeBackInProgress(true);
    let restored = false;
    try {
      restored = await handleWelcomeBack(() => setProductView('studio'));
    } finally {
      setWelcomeBackInProgress(false);
    }
    if (restored) return;
    if (await finishWelcomeBack()) return;
    if (!hasTelegramBridge()) return;

    try {
      const configResult = await telegramGetConfig();
      if (configResult.success && configResult.config
        && (!configResult.config.hasCredentials || !configResult.config.hasSession)) {
        navigate('/settings');
      }
    } catch {
      return;
    }
  };

  const handleWelcomeBackFromSettings = async () => {
    const restored = await handleWelcomeBack();
    if (restored) {
      // Запомним Studio как вид для возврата: useLayoutEffect переключит
      // productView до первой отрисовки после navigate('/'), без мигания.
      settingsReturnViewRef.current = 'studio';
      navigate('/');
      return;
    }
    if (await finishWelcomeBack()) navigate('/');
  };

  const handleTelegramAuthFromLogin = async () => {
    const signedIn = await handleTelegramAuth();
    if (signedIn) {
      setProductView('studio');
      return;
    }
    await openCredentialSettingsIfMissing();
  };

  const handleTelegramAuthFromSettings = async () => {
    const signedIn = await handleTelegramAuth();
    if (signedIn) {
      settingsReturnViewRef.current = 'studio';
      navigate('/');
      return;
    }
    if (await finishWelcomeBack()) navigate('/');
  };

  const renderSettingsPage = () => (
    <SettingsPage
      onClose={closeSettings}
      accountName={returningUserName}
      telegramUsername={returningUserUsername}
      telegramConnected={connected && !signedOut}
      telegramConnecting={connecting}
      telegramAuthStep={authStep}
      telegramPhoneNumber={phoneNumber}
      telegramPhoneCode={phoneCode}
      telegramTwoFactorPassword={twoFactorPassword}
      telegramAuthBusy={authBusy}
      telegramAuthError={authError}
      telegramAuthNotice={authNotice}
      telegramStatus={telegramStatus}
      telegramCredentials={telegramCredentials}
      telegramApiId={telegramApiId}
      telegramApiHash={telegramApiHash}
      telegramCredentialsBusy={telegramCredentialsBusy}
      telegramCredentialsError={telegramCredentialsError}
      onTelegramApiIdChange={setTelegramApiId}
      onTelegramApiHashChange={setTelegramApiHash}
      onTelegramPhoneNumberChange={setPhoneNumber}
      onTelegramPhoneCodeChange={setPhoneCode}
      onTelegramTwoFactorPasswordChange={setTwoFactorPassword}
      onTelegramAuth={handleTelegramAuthFromSettings}
      onTelegramReconnect={handleWelcomeBackFromSettings}
      onTelegramDisconnect={handleDisconnect}
      onSaveTelegramCredentials={async () => {
        setTelegramCredentialsBusy(true);
        setTelegramCredentialsError('');
        try {
          const result = await telegramSaveCredentials({
            API_ID: String(telegramApiId.trim()),
            API_HASH: String(telegramApiHash.trim()),
          });
          if (!result.success || !result.config || !result.config.hasCredentials) {
            throw new Error(result.error || 'Telegram API credentials could not be saved.');
          }
          setTelegramCredentials({
            hasCredentials: Boolean(result.config.hasCredentials),
            apiId: result.config.apiId || telegramApiId.trim(),
            hasSession: Boolean(result.config.hasSession),
            connected: Boolean(result.config.connected),
            signedOut: Boolean(result.config.signedOut),
          });
          setTelegramApiId('');
          setTelegramApiHash('');
        } catch (error) {
          setTelegramCredentialsError(error instanceof Error ? error.message : 'Telegram API credentials could not be saved.');
        } finally {
          setTelegramCredentialsBusy(false);
        }
      }}
    />
  );

  useEffect(() => {
    let active = true;
    if (!hasTelegramBridge()) return;
    telegramGetConfig().then((result) => {
      if (!active || !result.success || !result.config) return;
      setTelegramCredentials({
        hasCredentials: Boolean(result.config.hasCredentials),
        apiId: result.config.apiId || '',
        hasSession: Boolean(result.config.hasSession),
        connected: Boolean(result.config.connected),
        signedOut: Boolean(result.config.signedOut),
      });
    }).catch(() => undefined);
    return () => { active = false; };
  }, [connected, signedOut]);

  return (
    <AppShell
      view={productView}
      browserDraftMode={browserDraftMode}
      onViewChange={(view) => {
        if (view !== 'studio') pendingPlannerTextRef.current = null;
        setProductView(view);
      }}
      settingsOpen={route === '/settings'}
      onCloseSettings={closeSettings}
      notification={notification}
      closeNotification={closeNotification}
      connected={sessionResolved && (connected || sessionAvailable) && !signedOut}
      connectionRecoveryStatus={connectionRecoveryStatus}
      headerPending={connecting || !connectionResolved}
      authBusy={authBusy}
      isConfirmingLogout={isConfirmingLogout}
      setIsConfirmingLogout={setIsConfirmingLogout}
      setShowAuthForm={setShowAuthForm}
      handleDisconnect={async () => {
        if (await handleDisconnect()) setProductView('planner');
      }}
      handleForgetAccount={handleForgetAccount}
      onOpenSettings={() => {
        setShowAuthForm(false);
        setIsConfirmingLogout(false);
        setIsSettingsOpen(true);
        navigate('/settings');
      }}
      historyRecords={historyRecords}
      onHistoryCancel={cancelHistoryRecord}
      onHistoryReschedule={rescheduleHistoryRecord}
      onHistorySendNow={sendHistoryRecordNow}
      onHistoryDelete={deleteHistoryRecord}
      onHistoryOpenDraft={openHistoryDraft}
      onHistoryUseDraft={useHistoryDraft}
      onHistoryClearSent={clearHistorySent}
      onHistoryClearDrafts={clearHistoryDrafts}
      onHistoryCancelQueue={cancelHistoryQueue}
    >
      <div
        className={`product-view ${studioSurfaceVisible ? 'is-active' : ''}`}
        aria-hidden={productView !== 'studio' || !studioSurfaceAvailable}
      >
        {studioSurfaceAvailable ? (
          <StudioMount
            connected={studioConnected}
            connectionRecoveryStatus={connectionRecoveryStatus}
            activeAccountId={activeAccountId}
            chats={studioConnected ? chats : []}
            selectedChat={selectedChat}
            onSelectChat={setSelectedChat}
            scheduler={studioBridgeScheduler}
            onRegisterPlannerTextOpener={registerPlannerTextOpener}
            onRegisterBeforeLeaveStudio={(flush) => { studioFlushBeforeLeaveRef.current = flush; }}
            onRegisterHistoryDraftOpener={registerHistoryDraftOpener}
            onRegisterHistoryDraftUseHandler={registerHistoryDraftUseHandler}
            onRegisterHistoryDraftClearHandler={registerHistoryDraftClearHandler}
            onRegisterHistoryDraftDeleteHandler={registerHistoryDraftDeleteHandler}
            onRegisterHistoryRescheduleHandler={registerHistoryRescheduleHandler}
          />
        ) : null}
      </div>
      <div
        className={`product-view ${backgroundProductView === 'planner' ? 'is-active' : ''}`}
        aria-hidden={productView !== 'planner'}
      >
        {route === '/settings' ? renderSettingsPage() : (
          plannerSurface === 'pending' ? null : plannerSurface === 'quick' ? (
            <QuickPlanner
              draftLoadRequest={plannerDraftLoadRequest}
              onRestoreDraft={restorePlannerDraft}
              chats={chats}
              selectedChat={selectedChat}
              upcoming={personalUpcoming}
              sent={personalSent}
              historyReady={personalHistoryReady}
              historyError={Boolean(personalHistoryLoadError)}
              connectionRecoveryStatus={connectionRecoveryStatus}
              onSelectChat={setSelectedChat}
              onRemoveChat={handleRemoveChat}
              onSendNow={(chat, text, attachments, effect, entities) => handlePersonalSendDraftNow(
                chat,
                text,
                attachments ?? [],
                entities ?? [],
                undefined,
                false,
                effect,
                { clearMessageOnSuccess: false },
              )}
              onSchedule={async (request) => (
                await handlePersonalSchedule({
                  ...request,
                  clearMessageOnSuccess: false,
                  waitForConfirmation: true,
                }) === true
              )}
              onSaveDraft={({ message: draftMessage, attachments, entities }) => writeSavedPlannerDrafts([
                ...readSavedPlannerDrafts(),
                {
                  id: crypto.randomUUID(),
                  message: draftMessage,
                  attachments,
                  entities,
                  reminderType: null,
                  savedAt: new Date().toISOString(),
                },
              ])}
              onOpenInStudio={(payload) => { void openPlannerTextInStudio(payload); }}
            />
          ) : <LoginPage
            connecting={connecting}
            openingStudio={welcomeBackInProgress}
            signedOut={signedOut}
            returningUserName={returningUserName}
            returningUserUsername={returningUserUsername}
            authStep={authStep}
            showAuthForm={showAuthForm}
            phoneNumber={phoneNumber}
            phoneCode={phoneCode}
            twoFactorPassword={twoFactorPassword}
            authBusy={authBusy}
            authError={authError}
            authNotice={authNotice}
            setShowAuthForm={setShowAuthForm}
            setAuthStep={setAuthStep}
            setPhoneNumber={setPhoneNumber}
            setPhoneCode={setPhoneCode}
            setTwoFactorPassword={setTwoFactorPassword}
            setAuthError={setAuthError}
            handleTelegramAuth={handleTelegramAuthFromLogin}
            handleWelcomeBack={handleWelcomeBackFromReturn}
          />
        )}
      </div>
    </AppShell>
  );
}

function App() {
  return (
    <ConfirmDialogProvider>
      <AppContent />
    </ConfirmDialogProvider>
  );
}

export default App;