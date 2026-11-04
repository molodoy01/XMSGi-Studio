import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { Chat } from '@/types';
import { savePersistentChats } from '@/lib/storage';
import { useLocale, type TranslationKey } from '@/lib/i18n';
import {
  hasTelegramBridge,
  telegramConnect,
  telegramForgetAccount,
  telegramGetAuthState,
  telegramGetRateLimitState,
  telegramGetStatus,
  telegramLogin,
  telegramOnStatus,
  telegramSignOutKeepSession,
  telegramWelcomeBack,
} from '../services/telegramAppService';

export type TelegramAuthOptions = {
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

function sameTelegramStatus(left: TelegramStatusSnapshot, right: TelegramStatusSnapshot) {
  return left.accountId === right.accountId
    && left.status === right.status
    && (left.category ?? null) === (right.category ?? null)
    && left.error === right.error
    && left.waitSecondsText === right.waitSecondsText;
}

function getFriendlyAuthError(error: string): TranslationKey {
  if (/desktopBridgeRequired|desktop runtime|desktop app/i.test(error)) return 'auth.desktopBridgeRequired';
  if (/PHONE_NUMBER_INVALID|phone number.{0,24}invalid/i.test(error)) return 'auth.invalidPhone';
  if (/PHONE_CODE_EXPIRED|phone code.{0,24}expired/i.test(error)) return 'auth.expiredCode';
  if (/PHONE_CODE_INVALID|phone code.{0,24}invalid/i.test(error)) return 'auth.invalidCode';
  if (/PASSWORD_HASH_INVALID|password.{0,24}invalid/i.test(error)) return 'auth.invalidPassword';
  if (/PHONE_NUMBER_FLOOD|PHONE_PASSWORD_FLOOD|FLOOD_WAIT|too many attempts/i.test(error)) {
    return 'auth.tooManyAttempts';
  }
  if (/NETWORK|TIME.?OUT|ECONN|CONNECTION|FAILED TO FETCH|ERR_INTERNET|ERR_NETWORK|ENOTFOUND|EAI_AGAIN|SOCKET/i.test(error)) {
    return 'auth.networkSignInError';
  }
  return 'auth.genericSignInError';
}

function isConfirmedAuthFailure(error: string) {
  return /auth required|reauth_required|session expired|authorization revoked|not authorized/i.test(error);
}

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
  setIsSettingsOpen,
  setChats,
  setSelectedChat,
}: TelegramAuthOptions) {
  const { t } = useLocale();
  const [connected, setConnected] = useState(false);
  const [sessionAvailable, setSessionAvailable] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const signedOutRef = useRef(false);
  const [returningUserName, setReturningUserName] = useState('');
  const [returningUserUsername, setReturningUserUsername] = useState('');
  const [connecting, setConnecting] = useState(true);
  const [sessionResolved, setSessionResolved] = useState(false);
  const [connectionResolved, setConnectionResolved] = useState(false);
  const [authStep, setAuthStep] = useState<'phone' | 'code' | 'password'>('phone');
  const [showAuthForm, setShowAuthForm] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [phoneCode, setPhoneCode] = useState('');
  const [twoFactorPassword, setTwoFactorPassword] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthErrorValue] = useState('');
  const [authErrorTranslationKey, setAuthErrorTranslationKey] = useState<TranslationKey | null>(null);
  const setAuthError = useCallback<Dispatch<SetStateAction<string>>>((value) => {
    setAuthErrorTranslationKey(null);
    setAuthErrorValue(value);
  }, []);
  const setLocalizedAuthError = useCallback((key: TranslationKey) => {
    setAuthErrorTranslationKey(key);
    setAuthErrorValue(t(key));
  }, [t]);
  const visibleAuthError = authErrorTranslationKey ? t(authErrorTranslationKey) : authError;
  const authNotice = authErrorTranslationKey === 'auth.enterTwoFactor';
  const [isConfirmingLogout, setIsConfirmingLogout] = useState(false);
  const [telegramStatus, setTelegramStatus] = useState<TelegramStatusSnapshot>({
    accountId: '',
    status: 'normal',
  });

  const refreshTelegramStatus = useCallback(async () => {
    if (!hasTelegramBridge()) {
      setTelegramStatus({ accountId: '', status: 'normal' });
      return;
    }

    try {
      const [statusResult, rateLimitResult] = await Promise.all([
        telegramGetStatus() as Promise<TelegramStatusApiResult>,
        telegramGetRateLimitState() as Promise<TelegramRateLimitApiResult>,
      ]);
      const current = rateLimitResult.current;
      const status = current?.status || statusResult.status || 'normal';

      const nextStatus: TelegramStatusSnapshot = {
        accountId: current?.accountId || statusResult.accountId || '',
        status,
        category: current?.category ?? statusResult.category ?? null,
        error: current?.error || statusResult.error,
        waitSecondsText: current?.waitSecondsText,
      };
      setTelegramStatus((previous) => sameTelegramStatus(previous, nextStatus) ? previous : nextStatus);
    } catch {
      // Status polling is advisory and must not interrupt auth or scheduling.
    }
  }, []);

  /**
   * Выполняет полный вход через Telegram.
   * Возвращает true только при полном успехе (нет необходимости запрашивать
   * код/2FA). Вызывающий переключает productView в том же microtask-батче,
   * что и setConnected(true), иначе Planner успевает отрисоваться на время
   * следующего IPC-запроса (микро-мигание перед Studio).
   */
  const handleTelegramAuth = useCallback(async (): Promise<boolean> => {
    setAuthBusy(true);
    setAuthError('');

    try {
      if (!hasTelegramBridge()) {
        setLocalizedAuthError('auth.desktopBridgeRequired');
        return false;
      }

      const result = await telegramLogin({
        phoneNumber,
        phoneCode: authStep === 'phone' ? undefined : phoneCode,
        password: authStep === 'password' ? twoFactorPassword : undefined,
      });

      if (!result.success) {
        const error = result.error || t('auth.authorizationFailed');

        if (error === 'desktopBridgeRequired') {
          setLocalizedAuthError('auth.desktopBridgeRequired');
          return false;
        }

        if (
          authStep === 'code' &&
          /password|2fa|session_password_needed/i.test(error)
        ) {
          setAuthStep('password');
          setLocalizedAuthError('auth.enterTwoFactor');
        } else {
          setLocalizedAuthError(getFriendlyAuthError(error));
        }

        return false;
      }

      if (result.requiresPassword || result.nextStep === 'password') {
        setAuthStep('password');
        setLocalizedAuthError('auth.enterTwoFactor');
        return false;
      }

      if (result.requiresCode || result.nextStep === 'code') {
        setAuthStep('code');
        return false;
      }

      // Сначала дозапрашиваем имя аккаунта, затем переключаем connected —
      // так между setConnected(true) и resolve промиса не будет macrotask
      // (IPC), иначе вызывающий код не сможет сменить вид без мигания.
      const authResult = await telegramGetAuthState();
      if (authResult.success && authResult.authState) {
        setReturningUserName(authResult.authState.userName || '');
        setReturningUserUsername(authResult.authState.username || '');
      }

      setConnecting(false);
      setConnected(true);
      setSessionAvailable(true);
      setSessionResolved(true);
      signedOutRef.current = false;
      setSignedOut(false);
      setShowAuthForm(false);
      setAuthError('');
      return true;
    } catch (error) {
      setLocalizedAuthError(getFriendlyAuthError(error instanceof Error ? error.message : ''));
      return false;
    } finally {
      setAuthBusy(false);
    }
  }, [authStep, phoneCode, phoneNumber, setAuthError, setLocalizedAuthError, twoFactorPassword, t]);

  const handleDisconnect = useCallback(async (): Promise<boolean> => {
    setAuthBusy(true);
    setAuthError('');

    try {
      const result = await telegramSignOutKeepSession();

      if (!result.success) {
        setAuthError(result.error || t('auth.disconnectFailed'));
        return false;
      }

      setConnected(false);
      setSessionAvailable(false);
      signedOutRef.current = true;
      setSignedOut(true);
      setShowAuthForm(false);
      setReturningUserName(result.authState?.userName || returningUserName);
      setReturningUserUsername(result.authState?.username || returningUserUsername);
      setIsConfirmingLogout(false);
      setIsSettingsOpen(false);
      setChats([]);
      await savePersistentChats([]);
      setSelectedChat(null);
      setAuthStep('phone');
      setPhoneCode('');
      setTwoFactorPassword('');
      return true;
    } catch (error) {
      setAuthError(
        error instanceof Error
          ? error.message
          : t('auth.disconnectFailed')
      );
      return false;
    } finally {
      setAuthBusy(false);
    }
  }, [returningUserName, returningUserUsername, setAuthError, setChats, setIsSettingsOpen, setSelectedChat, t]);

  /**
   * Однократный возврат в аккаунт (Welcome back).
   * Возвращает true при успехе; вызывающий переключает productView в том же
   * microtask-батче, что и setConnected(true), без промежуточных IPC-запросов
   * (иначе Planner мелькает перед показом Studio).
   */
  const handleWelcomeBack = useCallback(async (onRestored?: () => void): Promise<boolean> => {
    if (authBusy) return false;

    setAuthBusy(true);
    setConnecting(true);
    setAuthError('');
    const reportRestoreError = (message: string) => {
      setAuthError(message);
    };

    try {
      if (!hasTelegramBridge()) {
        reportRestoreError(t('auth.desktopBridgeRequired'));
        return false;
      }

      const result = await telegramWelcomeBack();

      if (!result.success || !result.authState || !result.authState.connected || result.authState.signedOut) {
        reportRestoreError(result.error || t('auth.restoreFailed'));
        return false;
      }

      onRestored?.();
      signedOutRef.current = false;
      setSignedOut(false);
      setConnected(true);
      setSessionAvailable(true);
      setSessionResolved(true);
      setShowAuthForm(false);
      setReturningUserName(result.authState.userName || returningUserName);
      setReturningUserUsername(result.authState.username || returningUserUsername);
      setConnectionResolved(true);
      return true;
    } catch (error) {
      reportRestoreError(
        error instanceof Error
          ? error.message
          : t('auth.restoreFailed')
      );
      return false;
    } finally {
      setConnecting(false);
      setAuthBusy(false);
    }
  }, [authBusy, returningUserName, returningUserUsername, setAuthError, t]);

  const handleForgetAccount = useCallback(async () => {
    if (authBusy) return;

    setAuthBusy(true);
    setAuthError('');

    try {
      const result = await telegramForgetAccount();

      if (!result.success || !result.authState) {
        setAuthError(result.error || t('auth.removeFailed'));
        return;
      }

      setConnected(false);
      setSessionAvailable(false);
      signedOutRef.current = false;
      setSignedOut(false);
      setReturningUserName('');
      setReturningUserUsername('');
      setIsConfirmingLogout(false);
      setChats([]);
      await savePersistentChats([]);
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
  }, [authBusy, setAuthError, setChats, setSelectedChat, t]);

  useEffect(() => {
    const loadAuth = async () => {
      if (!hasTelegramBridge()) {
        setConnecting(false);
        setConnected(false);
        setSessionResolved(true);
        setConnectionResolved(true);
        return;
      }

      telegramGetAuthState()
        .then((authResult) => {
          if (!authResult.success || !authResult.authState) {
            throw new Error(authResult.error || t('auth.readStateFailed'));
          }

          const authState = authResult.authState;
          const hasSession = authState.hasSession;

          setSessionResolved(true);
          signedOutRef.current = hasSession && authState.signedOut;
          setSignedOut(signedOutRef.current);
          setSessionAvailable(hasSession && !authState.signedOut);
          setConnected(authState.connected);
          setReturningUserName(authState.userName || '');
          setReturningUserUsername(authState.username || '');

          if (!hasSession || (hasSession && authState.signedOut)) {
            setConnecting(false);
            setConnectionResolved(true);
            return;
          }

          return telegramConnect().then((result) => {
            setConnecting(false);
            setConnected(result.success);
            setConnectionResolved(true);

            if (!result.success && isConfirmedAuthFailure(result.error || '')) {
              setSessionAvailable(false);
              setAuthError(result.error || t('auth.sessionExpired'));
            }
          }).catch((error: unknown) => {
            const message = error instanceof Error ? error.message : '';
            setConnecting(false);
            setConnected(false);
            setConnectionResolved(true);
            if (isConfirmedAuthFailure(message)) {
              setSessionAvailable(false);
              setAuthError(message || t('auth.sessionExpired'));
            }
          });
        })
        .catch(() => {
          setConnecting(false);
          setConnected(false);
          setSessionResolved(true);
          setConnectionResolved(true);
          setLocalizedAuthError('auth.readStateFailed');
        });
    };

    loadAuth();
  }, [setAuthError, setLocalizedAuthError, t]);

  useEffect(() => {
    if (!hasTelegramBridge()) return;

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
          setTelegramStatus((current) => {
            const nextStatus: TelegramStatusSnapshot = {
              ...current,
            accountId: value.accountId || current.accountId,
            status: mappedStatus,
            category: value.category ?? current.category,
            error: value.error,
            waitSecondsText: value.waitSecondsText,
            };
            return sameTelegramStatus(current, nextStatus) ? current : nextStatus;
          });
        }

        if (typeof value.connected === 'boolean' && (!value.connected || !signedOutRef.current)) {
          setConnected(value.connected);
        }

        if (value.status === 'connected' && !signedOutRef.current) {
          setConnected(true);
          setSessionAvailable(true);
          setConnecting(false);
          setConnectionResolved(true);
        }

        if (value.status === 'network/retrying' || value.status === 'reconnecting') {
          setConnected(false);
          setConnecting(false);
          setConnectionResolved(true);
        }

        if (value.status === 'reauth_required') {
          setConnected(false);
          setSessionAvailable(false);
          setConnecting(false);
          setConnectionResolved(true);
          setAuthError(value.error || t('auth.sessionExpired'));
        }

        if (value.status === 'auth required') {
          setConnected(false);
          setSessionAvailable(false);
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
        if (status === 'connected' && !signedOutRef.current) {
          setConnected(true);
          setSessionAvailable(true);
          setConnecting(false);
          setConnectionResolved(true);
        }

        if (
          status === 'disconnected' ||
          status === 'offline' ||
          status === 'network/retrying' ||
          status === 'reconnecting' ||
          status === 'error'
        ) {
          setConnected(false);
          setConnecting(false);
          setConnectionResolved(true);
        }
      }
    };

    return telegramOnStatus(handleStatus);
  }, [setAuthError, t]);

  useEffect(() => {
    if (!hasTelegramBridge()) {
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
    sessionAvailable,
    setSessionAvailable,
    sessionResolved,
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
    authError: visibleAuthError,
    authNotice,
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
