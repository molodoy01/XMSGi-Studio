import { useEffect, useRef, useState } from 'react';
import { useAssistant, useChats, useNotifications, useScheduler, useTelegramAuth } from './core';
import type { Chat } from '@/types';
import { AppShell, StudioMount } from './workspace';
import { SchedulePage } from './pages/SchedulePage';
import { SettingsPage } from './pages/SettingsPage';
import type { TelegramStatusSnapshot } from './hooks/useTelegramAuth';

type AppRoute = '/' | '/settings';
type ProductView = 'studio' | 'planner';

function getCurrentHashPath(): AppRoute {
  const hash = window.location.hash.replace(/^#/, '').trim();
  const path = hash ? (hash.startsWith('/') ? hash : `/${hash}`) : '/';

  if (path === '/settings') {
    return path;
  }

  return '/';
}

function App() {
  const [message, setMessage] = useState('');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [route, setRoute] = useState<AppRoute>(getCurrentHashPath());
  const [productView, setProductView] = useState<ProductView>('studio');
  const [activeAccountId, setActiveAccountId] = useState<'account-1' | 'account-2'>(() => 'account-1');
  const [scheduleActiveTab, setScheduleActiveTab] = useState<'upcoming' | 'sent'>('upcoming');

  const {
    notification,
    showNotification,
    closeNotification,
  } = useNotifications();
  const studioNotifications = useNotifications();
  const [studioMessage, setStudioMessage] = useState('');

  const chatsApiRef = useRef<{
    setChats: React.Dispatch<React.SetStateAction<Chat[]>>;
    setSelectedChat: React.Dispatch<React.SetStateAction<Chat | null>>;
  } | null>(null);

  const {
    connected,
    signedOut,
    returningUserName,
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
    revealingId: personalRevealingId,
    cancelingIds: personalCancelingIds,
    sendingIds: personalSendingIds,
    dateEditedRef: personalDateEditedRef,
    timeEditedRef: personalTimeEditedRef,
    openPickerRef: personalOpenPickerRef,
    handleSchedule: handlePersonalSchedule,
    handleCancelMessage: handlePersonalCancelMessage,
    handleSendNow: handlePersonalSendNow,
    handleDeleteMessage: handlePersonalDeleteMessage,
    handleClearSent: handlePersonalClearSent,
    handleClearAll: handlePersonalClearAll,
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

  const studioConnected = connected && !signedOut && activeAccountId === 'account-1';
  const activeStudioStatus: TelegramStatusSnapshot = activeAccountId === 'account-1'
    ? telegramStatus
    : {
      accountId: 'account-2',
      status: 'auth required',
      category: 'auth',
      error: 'Account 2 is not connected.',
    };
  const handleAccountChange = (accountId: 'account-1' | 'account-2') => {
    if (accountId !== 'account-1') {
      return;
    }

    setActiveAccountId('account-1');
    try {
      window.localStorage.setItem('xmsgi_active_account_id', 'account-1');
    } catch {
      // Keep the active slot for the current session if storage is unavailable.
    }
  };

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
    if (route === '/settings') {
      setIsSettingsOpen(true);
    } else {
      setIsSettingsOpen(false);
    }
  }, [route]);

  const navigate = (nextRoute: AppRoute) => {
    const target = nextRoute === '/' ? '#/' : `#${nextRoute}`;
    if (window.location.hash !== target) {
      window.location.hash = target;
    }
    setRoute(nextRoute);
  };

  const renderSettingsPage = () => (
    <SettingsPage
      onClose={() => {
        setShowAuthForm(false);
        setIsSettingsOpen(false);
        navigate('/');
      }}
      accountName={returningUserName}
      telegramStatus={activeStudioStatus}
      activeAccountId={activeAccountId}
      onAccountChange={handleAccountChange}
      geminiSettings={geminiSettings}
      settingsKey={settingsKey}
      settingsBusy={settingsBusy}
      settingsError={settingsError}
      onSettingsKeyChange={setSettingsKey}
      onSaveGeminiKey={handleSaveGeminiKey}
      onRemoveGeminiKey={handleRemoveGeminiKey}
      onToggleAssistant={handleToggleAssistant}
    />
  );

  return (
    <AppShell
      view={productView}
      onViewChange={setProductView}
      connected={connected && !signedOut}
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
        setProductView('planner');
        navigate('/settings');
      }}
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
          handleTelegramAuth={async () => {
            await handleTelegramAuth();
            if (typeof window.telegram?.getAuthState === 'function') {
              const authResult = await window.telegram.getAuthState();
              if (authResult.success && authResult.authState?.connected && !authResult.authState.signedOut) {
                setProductView('studio');
              }
            }
          }}
          handleWelcomeBack={async () => {
            await handleWelcomeBack();
            if (typeof window.telegram?.getAuthState === 'function') {
              const authResult = await window.telegram.getAuthState();
              if (authResult.success && authResult.authState?.connected && !authResult.authState.signedOut) {
                setProductView('studio');
              }
            }
          }}
          handleForgetAccount={handleForgetAccount}
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
          upcoming={personalUpcoming}
          sent={personalSent}
          activeTab={scheduleActiveTab}
          scheduling={personalScheduling}
          successPulse={personalSuccessPulse}
          revealingId={personalRevealingId}
          cancelingIds={personalCancelingIds}
          sendingIds={personalSendingIds}
          dateEditedRef={personalDateEditedRef}
          timeEditedRef={personalTimeEditedRef}
          openPickerRef={personalOpenPickerRef}
          handleSchedule={handlePersonalSchedule}
          handleCancelMessage={handlePersonalCancelMessage}
          handleSendNow={handlePersonalSendNow}
          handleDeleteMessage={handlePersonalDeleteMessage}
          handleClearSent={handlePersonalClearSent}
          handleClearAll={handlePersonalClearAll}
          setActiveTab={setScheduleActiveTab}
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