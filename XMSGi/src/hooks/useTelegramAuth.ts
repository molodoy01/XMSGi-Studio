import { useCallback, useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { Chat, NotificationType } from '@/types';
import { savePersistentChats } from '@/lib/storage';
import { useLocale } from '@/lib/i18n';

export type TelegramAuthOptions = {
  showNotification: (message: string, type: NotificationType, title: string) => void;
  setIsSettingsOpen: Dispatch<SetStateAction<boolean>>;
  setChats: Dispatch<SetStateAction<Chat[]>>;
  setSelectedChat: Dispatch<SetStateAction<Chat | null>>;
};

export type TelegramStatusSnapshot = {
  accountId: string;
  status: 'normal' | 'rate-limited' | 'slowmode' | 'auth required' | 'network/retrying' | 'error';
  category?: 'flood' | 'slowmode' | 'auth' | 'permission' | 'network' | 'unknown' | null;
  error?: string;
  waitSecondsText?: string;
};

type TelegramStatusApiResult = {
  success: boolean;
  accountId?: string;
  status?: TelegramStatusSnapshot['status'];
  category?: TelegramStatusSnapshot['category'];
  error?: string;
};

type TelegramRateLimitApiResult = {
  success: boolean;
  current?: TelegramStatusSnapshot & {
    paused: boolean;
    pausedUntil: number | null;
    remainingMs: number;
    waitSecondsText?: string;
  };
};

export function useTelegramAuth({
  showNotification,
  setIsSettingsOpen,
  setChats,
  setSelectedChat,
}: TelegramAuthOptions) {
  const { t } = useLocale();
  const [connected, setConnected] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [returningUserName, setReturningUserName] = useState('');
  const [returningUserUsername, setReturningUserUsername] = useState('');
  const [connecting, setConnecting] = useState(true);
  const [connectionResolved, setConnectionResolved] = useState(false);
  const [authStep, setAuthStep] = useState<'phone' | 'code' | 'password'>('phone');
  const [showAuthForm, setShowAuthForm] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [phoneCode, setPhoneCode] = useState('');
  const [twoFactorPassword, setTwoFactorPassword] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState('');
  const [isConfirmingLogout, setIsConfirmingLogout] = useState(false);
  const [telegramStatus, setTelegramStatus] = useState<TelegramStatusSnapshot>({
    accountId: '',
    status: 'normal',
  });

  const refreshTelegramStatus = useCallback(async () => {
    if (typeof window === 'undefined' || !window.telegram) {
      setTelegramStatus({ accountId: '', status: 'normal' });
      return;
    }

    try {
      const [statusResult, rateLimitResult] = await Promise.all([
        typeof window.telegram?.getStatus === 'function'
          ? window.telegram.getStatus() as Promise<TelegramStatusApiResult>
          : Promise.resolve<TelegramStatusApiResult>({ success: false }),
        typeof window.telegram?.getRateLimitState === 'function'
          ? window.telegram.getRateLimitState() as Promise<TelegramRateLimitApiResult>
          : Promise.resolve<TelegramRateLimitApiResult>({ success: false }),
      ]);
      const current = rateLimitResult.current;
      const status = current?.status || statusResult.status || 'normal';

      setTelegramStatus({
        accountId: current?.accountId || statusResult.accountId || '',
        status,
        category: current?.category ?? statusResult.category ?? null,
        error: current?.error || statusResult.error,
        waitSecondsText: current?.waitSecondsText,
      });
    } catch {
      // Status polling is advisory and must not interrupt auth or scheduling.
    }
  }, []);

  const handleTelegramAuth = useCallback(async () => {
    setAuthBusy(true);
    setAuthError('');

    try {
      if (typeof window.telegram?.login !== 'function') {
        setAuthError(t('auth.desktopBridgeRequired'));
        return;
      }

      const result = await window.telegram.login({
        phoneNumber,
        phoneCode: authStep === 'phone' ? undefined : phoneCode,
        password: authStep === 'password' ? twoFactorPassword : undefined,
      });

      if (!result.success) {
        const error = result.error || t('auth.authorizationFailed');

        if (
          authStep === 'code' &&
          /password|2fa|session_password_needed/i.test(error)
        ) {
          setAuthStep('password');
          setAuthError(t('auth.enterTwoFactor'));
        } else {
          setAuthError(error);
        }

        return;
      }

      if (result.requiresPassword || result.nextStep === 'password') {
        setAuthStep('password');
        setAuthError(t('auth.enterTwoFactor'));
        return;
      }

      if (result.requiresCode || result.nextStep === 'code') {
        setAuthStep('code');
        return;
      }

      setConnecting(false);
      setConnected(true);
      setSignedOut(false);
      setShowAuthForm(false);
      setAuthError('');
      if (typeof window.telegram?.getAuthState === 'function') {
        const authResult = await window.telegram.getAuthState();
        if (authResult.success && authResult.authState) {
          setReturningUserName(authResult.authState.userName || '');
          setReturningUserUsername(authResult.authState.username || '');
        }
      }
    } catch (error) {
      setAuthError(
        error instanceof Error
          ? error.message
          : t('auth.authorizationFailed')
      );
    } finally {
      setAuthBusy(false);
    }
  }, [authStep, phoneCode, phoneNumber, twoFactorPassword, t]);

  const handleDisconnect = useCallback(async () => {
    setAuthBusy(true);
    setAuthError('');

    try {
      const result = await window.telegram.signOutKeepSession();

      if (!result.success) {
        setAuthError(result.error || t('auth.disconnectFailed'));
        return;
      }

      setConnected(false);
      setSignedOut(true);
      setShowAuthForm(false);
      setReturningUserName(result.authState?.userName || returningUserName);
      setReturningUserUsername(result.authState?.username || returningUserUsername);
      setIsConfirmingLogout(false);
      setIsSettingsOpen(false);
      setChats([]);
      void savePersistentChats([]);
      setSelectedChat(null);
      setAuthStep('phone');
      setPhoneCode('');
      setTwoFactorPassword('');
    } catch (error) {
      setAuthError(
        error instanceof Error
          ? error.message
          : t('auth.disconnectFailed')
      );
    } finally {
      setAuthBusy(false);
    }
  }, [returningUserName, returningUserUsername, setChats, setIsSettingsOpen, setSelectedChat, t]);

  const handleWelcomeBack = useCallback(async () => {
    if (authBusy) return;

    setAuthBusy(true);
    setConnecting(true);
    setAuthError('');

    try {
      const result = await window.telegram.welcomeBack();

      if (!result.success || !result.authState) {
        setAuthError(result.error || t('auth.restoreFailed'));
        return;
      }

      setSignedOut(result.authState.signedOut);
      setConnected(result.authState.connected);
      setShowAuthForm(false);
      setReturningUserName(result.authState.userName || returningUserName);
      setReturningUserUsername(result.authState.username || returningUserUsername);
      setConnectionResolved(true);
    } catch (error) {
      setAuthError(
        error instanceof Error
          ? error.message
          : t('auth.restoreFailed')
      );
    } finally {
      setConnecting(false);
      setAuthBusy(false);
    }
  }, [authBusy, returningUserName, returningUserUsername, t]);

  const handleForgetAccount = useCallback(async () => {
    if (authBusy) return;

    setAuthBusy(true);
    setAuthError('');

    try {
      const result = await window.telegram.forgetAccount();

      if (!result.success || !result.authState) {
        setAuthError(result.error || t('auth.removeFailed'));
        return;
      }

      setConnected(false);
      setSignedOut(false);
      setReturningUserName('');
      setReturningUserUsername('');
      setIsConfirmingLogout(false);
      setChats([]);
      void savePersistentChats([]);
      setSelectedChat(null);
      setShowAuthForm(false);
      setAuthStep('phone');
      setPhoneCode('');
      setTwoFactorPassword('');
      setConnectionResolved(true);
    } catch (error) {
      setAuthError(
        error instanceof Error
          ? error.message
          : t('auth.removeFailed')
      );
    } finally {
      setAuthBusy(false);
    }
  }, [authBusy, setChats, setSelectedChat, t]);

  useEffect(() => {
    const loadAuth = async () => {
      if (typeof window === 'undefined' || !window.telegram) {
        setConnecting(false);
        setConnected(false);
        setConnectionResolved(true);
        return;
      }

      window.telegram.getAuthState()
        .then((authResult) => {
          if (!authResult.success || !authResult.authState) {
            throw new Error(authResult.error || t('auth.readStateFailed'));
          }

          const authState = authResult.authState;
          const hasSession = authState.hasSession;

          setSignedOut(authState.signedOut);
          setConnected(authState.connected);
          setReturningUserName(authState.userName || '');
          setReturningUserUsername(authState.username || '');

          if (!hasSession || authState.signedOut) {
            setConnecting(false);
            setConnectionResolved(true);
            return;
          }

          return window.telegram.connect().then((result) => {
            setConnecting(false);
            setConnected(result.success);
            setConnectionResolved(true);

            if (!result.success) {
              setAuthError(result.error || t('auth.connectFailed'));
            }
          });
        })
        .catch((error) => {
          setConnecting(false);
          setConnected(false);
          setConnectionResolved(true);
          setAuthError(
            error instanceof Error
              ? error.message
              : t('auth.readConnectionFailed')
          );
        });
    };

    loadAuth();
  }, [showNotification, t]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.telegram?.onStatus !== 'function') return;

    const handleStatus = (status: unknown) => {
      if (typeof status === 'object' && status !== null) {
        const value = status as {
          connected?: boolean;
          accountId?: string;
          status?: string;
          category?: TelegramStatusSnapshot['category'];
          error?: string;
          waitSecondsText?: string;
        };

        const statusMap: Record<string, TelegramStatusSnapshot['status']> = {
          connected: 'normal',
          'rate-limited': 'rate-limited',
          slowmode: 'slowmode',
          'auth required': 'auth required',
          'network/retrying': 'network/retrying',
          error: 'error',
          reauth_required: 'auth required',
          reconnecting: 'network/retrying',
        };

        const mappedStatus = value.status
          ? statusMap[value.status as keyof typeof statusMap]
          : undefined;

        if (mappedStatus) {
          setTelegramStatus((current) => ({
            ...current,
            accountId: value.accountId || current.accountId,
            status: mappedStatus,
            category: value.category ?? current.category,
            error: value.error,
            waitSecondsText: value.waitSecondsText,
          }));
        }

        if (typeof value.connected === 'boolean') {
          setConnected(value.connected);
        }

        if (value.status === 'connected') {
          setConnected(true);
          setConnecting(false);
          setConnectionResolved(true);
        }

        if (value.status === 'reauth_required') {
          setConnected(false);
          setConnecting(false);
          setConnectionResolved(true);
          setAuthError(value.error || t('auth.sessionExpired'));
        }

        if (value.status === 'auth required') {
          setConnected(false);
          setConnecting(false);
          setConnectionResolved(true);
          setAuthError(value.error || t('telegramStatus.authRequiredMessage'));
        }

        if (value.status === 'disconnected' || value.status === 'offline') {
          setConnected(false);
          setConnecting(false);
          setConnectionResolved(true);
        }

        if (value.status === 'error' && !value.category) {
          setConnected(false);
          setConnecting(false);
          setConnectionResolved(true);
        }
      }

      if (typeof status === 'string') {
        if (status === 'connected') {
          setConnected(true);
          setConnecting(false);
          setConnectionResolved(true);
        }

        if (
          status === 'disconnected' ||
          status === 'offline' ||
          status === 'error'
        ) {
          setConnected(false);
          setConnecting(false);
          setConnectionResolved(true);
        }
      }
    };

    return window.telegram.onStatus(handleStatus);
  }, [t]);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.telegram) {
      setTelegramStatus({ accountId: '', status: 'normal' });
      return;
    }

    void refreshTelegramStatus();
    const intervalId = window.setInterval(() => {
      void refreshTelegramStatus();
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [refreshTelegramStatus]);

  return {
    connected,
    setConnected,
    signedOut,
    setSignedOut,
    returningUserName,
    setReturningUserName,
    returningUserUsername,
    connecting,
    setConnecting,
    connectionResolved,
    setConnectionResolved,
    authStep,
    setAuthStep,
    showAuthForm,
    setShowAuthForm,
    phoneNumber,
    setPhoneNumber,
    phoneCode,
    setPhoneCode,
    twoFactorPassword,
    setTwoFactorPassword,
    authBusy,
    setAuthBusy,
    authError,
    telegramStatus,
    setAuthError,
    isConfirmingLogout,
    setIsConfirmingLogout,
    handleTelegramAuth,
    handleDisconnect,
    handleWelcomeBack,
    handleForgetAccount,
  };
}
