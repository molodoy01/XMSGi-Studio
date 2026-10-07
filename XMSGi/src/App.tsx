import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAssistant, useChats, useNotifications, useScheduler, useTelegramAuth } from './core';
import type { Chat } from '@/types';
import type { SavedDraft, StudioScheduledMessage } from '$studio';
import { AppShell, StudioMount } from './workspace';
import { normalizeScheduledMessages } from './workspace/historyModel';
import type { HistoryItem, HistorySource } from './workspace/historyModel';
import { SchedulePage } from './pages/SchedulePage';
import { SettingsPage } from './pages/SettingsPage';
import { readPlannerDraft, writePlannerDraft } from './lib/plannerDraft';

type AppRoute = '/' | '/settings';
type ProductView = 'studio' | 'planner';

const PRODUCT_VIEW_STORAGE_KEY = 'xmsgi-product-view';
const SETTINGS_RETURN_VIEW_STORAGE_KEY = 'xmsgi-settings-return-view';

function readStoredProductView(key: string): ProductView | null {
  try {
    const value = window.sessionStorage.getItem(key);
    return value === 'studio' || value === 'planner' ? value : null;
  } catch {
    return null;
  }
}

function writeStoredProductView(key: string, value: ProductView | null) {
  try {
    if (value) window.sessionStorage.setItem(key, value);
    else window.sessionStorage.removeItem(key);
  } catch {
    // Keep navigation usable when session storage is unavailable.
  }
}

function getCurrentHashPath(): AppRoute {
  const hash = window.location.hash.replace(/^#/, '').trim();
  const path = hash ? (hash.startsWith('/') ? hash : `/${hash}`) : '/';

  if (path === '/settings') {
    return path;
  }

  return '/';
}

function App() {
  const [message, setMessageState] = useState(readPlannerDraft);
  const messageRef = useRef(message);
  messageRef.current = message;
  const setMessage = useCallback((nextMessage: React.SetStateAction<string>) => {
    const resolvedMessage = typeof nextMessage === 'function'
      ? nextMessage(messageRef.current)
      : nextMessage;
    messageRef.current = resolvedMessage;
    writePlannerDraft(resolvedMessage);
    setMessageState(resolvedMessage);
  }, []);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [route, setRoute] = useState<AppRoute>(getCurrentHashPath());
  const [productView, setProductView] = useState<ProductView>(
    () => readStoredProductView(PRODUCT_VIEW_STORAGE_KEY) ?? 'studio',
  );
  const settingsReturnViewRef = useRef<ProductView | null>(
    readStoredProductView(SETTINGS_RETURN_VIEW_STORAGE_KEY),
  );
  const [activeAccountId] = useState<'account-1' | 'account-2'>(() => 'account-1');
  const [telegramApiId, setTelegramApiId] = useState('');
  const [telegramApiHash, setTelegramApiHash] = useState('');
  const [telegramCredentialsBusy, setTelegramCredentialsBusy] = useState(false);
  const [telegramCredentialsError, setTelegramCredentialsError] = useState('');
  const [telegramCredentials, setTelegramCredentials] = useState({
    hasCredentials: false,
    hasSession: false,
    connected: false,
    signedOut: false,
  });

  const {
    notification,
    showNotification,
    closeNotification,
  } = useNotifications();
  const studioNotifications = useNotifications();
  const [studioMessage, setStudioMessage] = useState('');
  const studioDraftOpenerRef = useRef<((draft: SavedDraft) => void) | null>(null);
  const studioDraftUseRef = useRef<((draft: SavedDraft) => void) | null>(null);
  const studioDraftClearerRef = useRef<(() => Promise<boolean>) | null>(null);
  const studioDraftDeleterRef = useRef<((draftId: string) => Promise<boolean>) | null>(null);
  const studioHistoryReschedulerRef = useRef<((message: StudioScheduledMessage) => void) | null>(null);
  const registerHistoryDraftOpener = useCallback((opener: ((draft: SavedDraft) => void) | null) => {
    studioDraftOpenerRef.current = opener;
  }, []);
  const registerHistoryDraftUseHandler = useCallback((handler: ((draft: SavedDraft) => void) | null) => {
    studioDraftUseRef.current = handler;
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
    showNotification,
    setIsSettingsOpen,
    setChats: (value) => {
      chatsApiRef.current?.setChats(value);
    },
    setSelectedChat: (value) => {
      chatsApiRef.current?.setSelectedChat(value);
    },
  });

  useEffect(() => {
    if (connectionResolved && !connected) {
      setProductView('planner');
    }
  }, [connected, connectionResolved]);

  const {
    chats,
    setChats,
    selectedChat,
    setSelectedChat,
    selectedChatPermissions,
    refreshChatPermissions,
    handleAddChat,
    handleRemoveChat,
  } = useChats({ connected });

  useEffect(() => {
    chatsApiRef.current = {
      setChats,
      setSelectedChat,
    };
  }, [setChats, setSelectedChat]);

  const {
    assistantPrompt,
    setAssistantPrompt,
    assistantResponse,
    setAssistantResponse,
    displayedAssistantResponse,
    assistantIntent,
    setAssistantIntent,
    assistantExampleIndex,
    isThinking,
    geminiSettings,
    settingsKey,
    setSettingsKey,
    settingsBusy,
    settingsError,
    assistantExamples,
    handleSaveGeminiKey,
    handleRemoveGeminiKey,
    handleToggleAssistant,
    handleAssistantSubmit,
  } = useAssistant({ chats });

  const {
    date: personalDate,
    time: personalTime,
    upcoming: personalUpcoming,
    sent: personalSent,
    scheduling: personalScheduling,
    successPulse: personalSuccessPulse,
    dateEditedRef: personalDateEditedRef,
    timeEditedRef: personalTimeEditedRef,
    openPickerRef: personalOpenPickerRef,
    handleSchedule: handlePersonalSchedule,
    handleCancelMessage: handlePersonalCancelMessage,
    handleCancelMessages: handlePersonalCancelMessages,
    handleSendNow: handlePersonalSendNow,
    handleDeleteMessage: handlePersonalDeleteMessage,
    handleClearSent: handlePersonalClearSent,
    setDate: setPersonalDate,
    setTime: setPersonalTime,
  } = useScheduler({
    historyScope: 'personal',
    connected,
    selectedChat,
    refreshChatPermissions,
    chats,
    message,
    showNotification,
    setMessage,
    setAssistantPrompt,
    setAssistantResponse,
    setAssistantIntent,
  });

  const studioScheduler = useScheduler({
    historyScope: 'workspace',
    accountId: activeAccountId,
    connected: connected && !signedOut && activeAccountId === 'account-1',
    selectedChat,
    refreshChatPermissions,
    chats,
    message: studioMessage,
    showNotification: studioNotifications.showNotification,
    setMessage: setStudioMessage,
    setAssistantPrompt,
    setAssistantResponse,
    setAssistantIntent,
  });

  const historyRecords = [
    ...normalizeScheduledMessages(personalUpcoming, 'personal', 'upcoming', chats),
    ...normalizeScheduledMessages(personalSent, 'personal', 'sent', chats),
    ...normalizeScheduledMessages(studioScheduler.upcoming, 'workspace', 'upcoming', chats),
    ...normalizeScheduledMessages(studioScheduler.sent, 'workspace', 'sent', chats),
  ];
  const savedMessagesChatId = chats.find((chat) => {
    const normalizedName = chat.name.trim().toLocaleLowerCase();
    return normalizedName === 'saved messages' || normalizedName === 'сохранённые сообщения';
  })?.id;

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

  const clearHistoryDrafts = async () => studioDraftClearerRef.current?.() ?? false;

  const cancelHistoryQueue = async (records: HistoryItem[]) => {
    const personalMessages = records.flatMap((record) => record.source === 'personal' && record.original.kind === 'scheduled' ? [record.original.message] : []);
    const workspaceMessages = records.flatMap((record) => record.source === 'workspace' && record.original.kind === 'scheduled' ? [record.original.message] : []);
    const results = await Promise.all([
      personalMessages.length ? handlePersonalCancelMessages(personalMessages) : true,
      workspaceMessages.length ? studioScheduler.handleCancelMessages(workspaceMessages) : true,
    ]);
    return results.every(Boolean);
  };

  const deleteHistoryRecord = (record: HistoryItem): void | Promise<boolean> => {
    if (record.original.kind === 'saved-draft') return studioDraftDeleterRef.current?.(record.original.draft.id);
    if (record.original.kind === 'telegram-message') {
      return window.telegram.deleteSavedMessage({
        chatId: record.original.chatId,
        messageId: record.original.message.id,
      }).then((result) => result.success);
    }
    const message = record.original.message;
    const normalizedChatName = message.chatName.trim().toLocaleLowerCase();
    const isSavedMessagesChat = normalizedChatName === 'saved messages' || normalizedChatName === 'сохранённые сообщения';
    const telegramMessageIds = [...new Set([
        message.telegramMessageId,
        ...(message.telegramMessageIds ?? []),
      ].filter((id): id is string | number => id !== undefined && id !== null).map(String))];
    if (record.source === 'personal' && record.status === 'sent' && isSavedMessagesChat && telegramMessageIds.length > 0) {
      return Promise.all(telegramMessageIds.map((messageId) => window.telegram.deleteSavedMessage({
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
    }
  };

  const useHistoryDraft = (record: HistoryItem) => {
    setProductView(record.source === 'workspace' ? 'studio' : 'planner');
    if (record.original.kind === 'saved-draft') {
      studioDraftUseRef.current?.(record.original.draft);
    }
  };

  const studioConnected = connected && !signedOut && activeAccountId === 'account-1';

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
  }, []);

  useEffect(() => {
    writeStoredProductView(PRODUCT_VIEW_STORAGE_KEY, productView);
  }, [productView]);

  useLayoutEffect(() => {
    if (route === '/settings') {
      if (settingsReturnViewRef.current === null) {
        settingsReturnViewRef.current = productView;
        writeStoredProductView(SETTINGS_RETURN_VIEW_STORAGE_KEY, productView);
      }
      setIsSettingsOpen(true);
      setProductView('planner');
    } else {
      setIsSettingsOpen(false);
      const returnView = settingsReturnViewRef.current;
      if (returnView !== null) {
        settingsReturnViewRef.current = null;
        writeStoredProductView(SETTINGS_RETURN_VIEW_STORAGE_KEY, null);
        setProductView(returnView);
      }
    }
  }, [productView, route]);

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
    if (typeof window.telegram?.getAuthState !== 'function') return false;

    try {
      const authResult = await window.telegram.getAuthState();
      if (!authResult.success || !authResult.authState?.connected || authResult.authState.signedOut) return false;
      setProductView('studio');
      settingsReturnViewRef.current = 'studio';
      writeStoredProductView(SETTINGS_RETURN_VIEW_STORAGE_KEY, 'studio');
      return true;
    } catch {
      return false;
    }
  };

  const openCredentialSettingsIfMissing = async () => {
    if (typeof window.telegram?.getConfig !== 'function') return;

    try {
      const configResult = await window.telegram.getConfig();
      if (configResult.success && configResult.config && !configResult.config.hasCredentials) {
        navigate('/settings');
      }
    } catch {
      return;
    }
  };

  const handleWelcomeBackFromReturn = async () => {
    await handleWelcomeBack();
    if (await finishWelcomeBack()) return;
    if (typeof window.telegram?.getConfig !== 'function') return;

    try {
      const configResult = await window.telegram.getConfig();
      if (configResult.success && configResult.config
        && (!configResult.config.hasCredentials || !configResult.config.hasSession)) {
        navigate('/settings');
      }
    } catch {
      return;
    }
  };

  const handleWelcomeBackFromSettings = async () => {
    await handleWelcomeBack();
    if (await finishWelcomeBack()) navigate('/');
  };

  const handleTelegramAuthFromPlanner = async () => {
    await handleTelegramAuth();
    if (await finishWelcomeBack()) return;
    await openCredentialSettingsIfMissing();
  };

  const handleTelegramAuthFromSettings = async () => {
    await handleTelegramAuth();
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
      telegramStatus={telegramStatus}
      geminiSettings={geminiSettings}
      settingsKey={settingsKey}
      settingsBusy={settingsBusy}
      settingsError={settingsError}
      onSettingsKeyChange={setSettingsKey}
      onSaveGeminiKey={handleSaveGeminiKey}
      onRemoveGeminiKey={handleRemoveGeminiKey}
      onToggleAssistant={handleToggleAssistant}
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
          const result = await window.telegram.saveCredentials({
            API_ID: telegramApiId.trim(),
            API_HASH: telegramApiHash.trim(),
          });
          if (!result.success || !result.config || !result.config.hasCredentials) {
            throw new Error(result.error || 'Telegram API credentials could not be saved.');
          }
          setTelegramCredentials({
            hasCredentials: Boolean(result.config.hasCredentials),
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
    if (typeof window.telegram?.getConfig !== 'function') return;
    window.telegram.getConfig().then((result) => {
      if (!active || !result.success || !result.config) return;
      setTelegramCredentials({
        hasCredentials: Boolean(result.config.hasCredentials),
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
      onViewChange={setProductView}
      settingsOpen={route === '/settings'}
      onCloseSettings={closeSettings}
      connected={connected && !signedOut}
      headerPending={connecting || !connectionResolved}
      authBusy={authBusy}
      isConfirmingLogout={isConfirmingLogout}
      setIsConfirmingLogout={setIsConfirmingLogout}
      setShowAuthForm={setShowAuthForm}
      handleDisconnect={async () => {
        await handleDisconnect();
        if (typeof window.telegram?.getAuthState === 'function') {
          const authResult = await window.telegram.getAuthState();
          if (authResult.success && authResult.authState?.signedOut) {
            setProductView('planner');
          }
        }
      }}
      handleForgetAccount={handleForgetAccount}
      onOpenSettings={() => {
        setShowAuthForm(false);
        setIsConfirmingLogout(false);
        setIsSettingsOpen(true);
        navigate('/settings');
      }}
      historyRecords={historyRecords}
      savedMessagesChatId={savedMessagesChatId}
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
      <div className={`product-view ${productView === 'studio' ? 'is-active' : ''}`} aria-hidden={productView !== 'studio'}>
        <StudioMount
          connected={studioConnected}
          activeAccountId={activeAccountId}
          chats={studioConnected ? chats : []}
          scheduler={{
            ...studioScheduler,
            notification: studioNotifications.notification,
            closeNotification: studioNotifications.closeNotification,
          }}
          onRegisterHistoryDraftOpener={registerHistoryDraftOpener}
          onRegisterHistoryDraftUseHandler={registerHistoryDraftUseHandler}
          onRegisterHistoryDraftClearHandler={registerHistoryDraftClearHandler}
          onRegisterHistoryDraftDeleteHandler={registerHistoryDraftDeleteHandler}
          onRegisterHistoryRescheduleHandler={registerHistoryRescheduleHandler}
        />
      </div>
      <div className={`product-view ${productView === 'planner' ? 'is-active' : ''}`} aria-hidden={productView !== 'planner'}>
        {route === '/settings' ? renderSettingsPage() : (
          <SchedulePage
          message={message}
          setMessage={setMessage}
          isSettingsOpen={isSettingsOpen}
          setIsSettingsOpen={setIsSettingsOpen}
          notification={notification}
          closeNotification={closeNotification}
          connected={connected}
          signedOut={signedOut}
          returningUserName={returningUserName}
          returningUserUsername={returningUserUsername}
          connecting={connecting}
          connectionResolved={connectionResolved}
          authStep={authStep}
          showAuthForm={showAuthForm}
          phoneNumber={phoneNumber}
          phoneCode={phoneCode}
          twoFactorPassword={twoFactorPassword}
          authBusy={authBusy}
          authError={authError}
          setShowAuthForm={setShowAuthForm}
          setAuthStep={setAuthStep}
          setPhoneNumber={setPhoneNumber}
          setPhoneCode={setPhoneCode}
          setTwoFactorPassword={setTwoFactorPassword}
          setAuthError={setAuthError}
          handleTelegramAuth={handleTelegramAuthFromPlanner}
          handleWelcomeBack={handleWelcomeBackFromReturn}
          chats={chats}
          selectedChat={selectedChat}
          selectedChatPermissions={selectedChatPermissions}
          setSelectedChat={setSelectedChat}
          handleAddChat={handleAddChat}
          handleRemoveChat={handleRemoveChat}
          assistantPrompt={assistantPrompt}
          setAssistantPrompt={setAssistantPrompt}
          assistantResponse={assistantResponse}
          setAssistantResponse={setAssistantResponse}
          displayedAssistantResponse={displayedAssistantResponse}
          assistantIntent={assistantIntent}
          setAssistantIntent={setAssistantIntent}
          assistantExampleIndex={assistantExampleIndex}
          isThinking={isThinking}
          geminiSettings={geminiSettings}
          settingsKey={settingsKey}
          setSettingsKey={setSettingsKey}
          settingsBusy={settingsBusy}
          settingsError={settingsError}
          assistantExamples={assistantExamples}
          handleSaveGeminiKey={handleSaveGeminiKey}
          handleRemoveGeminiKey={handleRemoveGeminiKey}
          handleToggleAssistant={handleToggleAssistant}
          handleAssistantSubmit={handleAssistantSubmit}
          date={personalDate}
          time={personalTime}
          scheduling={personalScheduling}
          successPulse={personalSuccessPulse}
          dateEditedRef={personalDateEditedRef}
          timeEditedRef={personalTimeEditedRef}
          openPickerRef={personalOpenPickerRef}
          handleSchedule={handlePersonalSchedule}
          setDate={setPersonalDate}
          setTime={setPersonalTime}
            showNotification={showNotification}
          />
        )}
      </div>
    </AppShell>
  );
}

export default App;