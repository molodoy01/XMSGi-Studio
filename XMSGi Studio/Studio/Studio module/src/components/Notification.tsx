import type { NotificationState } from '@/types';

interface Props extends NotificationState {
  onClose: () => void;
}

export function Notification({ message, type, title, visible, onClose }: Props) {
  return (
    <div className={`app-notification ${type} ${visible ? 'show' : ''}`}>
      <div className="notification-icon">
        {type === 'error' ? '!' : type === 'warning' ? '!' : type === 'success' ? '✓' : 'i'}
      </div>
      <div className="notification-content">
        <div className="notification-title">{title}</div>
        <div className="notification-message">{message}</div>
      </div>
      <button className="notification-close" onClick={onClose} aria-label="Close notification">
        ×
      </button>
    </div>
  );
}
