interface Props {
  show: boolean;
  chatName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ChatRemoveModal({
  show,
  chatName,
  onConfirm,
  onCancel,
}: Props) {
  return (
    <div className={`chat-remove-modal ${show ? 'show' : ''}`}>
      <div className="chat-remove-title">Remove this chat?</div>

      <div className="chat-remove-message">
        "{chatName}" will leave your saved chats. Scheduled and sent messages will stay in your archive.
      </div>

      <div className="chat-remove-actions">
        <button
          className="chat-remove-cancel"
          onClick={onCancel}
        >
          Cancel
        </button>

        <button
          className="chat-remove-confirm"
          onClick={onConfirm}
        >
          Remove
        </button>
      </div>
    </div>
  );
}