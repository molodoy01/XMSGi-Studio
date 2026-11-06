import { useCallback, useEffect, useRef, useState } from 'react';
import type { NotificationState, NotificationType } from '@shared/types';
import type { BridgeErrorDetails } from '@shared/bridge';

export function useNotifications() {
  const [notification, setNotification] = useState<NotificationState>({
    message: '',
    type: 'error',
    title: '',
    visible: false,
  });

  const notificationTimeoutRef = useRef<number | null>(null);
  const notificationRevisionRef = useRef(0);

  const showNotification = useCallback(
    (
      message: string,
      type: NotificationType,
      title: string,
      errorDetails?: BridgeErrorDetails,
      durationMs = 4500,
    ) => {
      if (notificationTimeoutRef.current) {
        clearTimeout(notificationTimeoutRef.current);
      }
      notificationTimeoutRef.current = null;

      setNotification({
        message,
        type,
        title,
        visible: true,
        revision: ++notificationRevisionRef.current,
        ...(errorDetails ? { errorDetails } : {}),
      });

      notificationTimeoutRef.current = window.setTimeout(() => {
        notificationTimeoutRef.current = null;
        setNotification((prev) => ({
          ...prev,
          visible: false,
        }));
      }, durationMs);
    },
    []
  );

  const closeNotification = useCallback(() => {
    if (notificationTimeoutRef.current) {
      clearTimeout(notificationTimeoutRef.current);
    }
    notificationTimeoutRef.current = null;

    setNotification((prev) => ({
      ...prev,
      visible: false,
    }));
  }, []);

  useEffect(() => {
    return () => {
      if (notificationTimeoutRef.current) {
        clearTimeout(notificationTimeoutRef.current);
      }
    };
  }, []);

  return {
    notification,
    showNotification,
    closeNotification,
  };
}
