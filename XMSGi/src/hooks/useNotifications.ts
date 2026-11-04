import { useCallback, useEffect, useRef, useState } from 'react';
import type { NotificationState, NotificationType } from '@/types';

export function useNotifications() {
  const [notification, setNotification] = useState<NotificationState>({
    message: '',
    type: 'error',
    title: '',
    visible: false,
  });

  const notificationTimeoutRef = useRef<number | null>(null);

  const showNotification = useCallback(
    (message: string, type: NotificationType, title: string) => {
      if (notificationTimeoutRef.current) {
        clearTimeout(notificationTimeoutRef.current);
      }

      setNotification({
        message,
        type,
        title,
        visible: true,
      });

      notificationTimeoutRef.current = window.setTimeout(() => {
        setNotification((prev) => ({
          ...prev,
          visible: false,
        }));
      }, 4500);
    },
    []
  );

  const closeNotification = useCallback(() => {
    if (notificationTimeoutRef.current) {
      clearTimeout(notificationTimeoutRef.current);
    }

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
