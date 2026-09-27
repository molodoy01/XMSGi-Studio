import type { InlineKeyboardMarkup } from '@/lib/inlineKeyboard';
import './ChatPreviewStand.css';

type InlineKeyboardPreviewProps = {
  markup?: InlineKeyboardMarkup;
};

export function InlineKeyboardPreview({ markup }: InlineKeyboardPreviewProps) {
  if (!markup?.inline_keyboard.length) return null;

  return (
    <div className="chat-preview-inline-keyboard" aria-label="Inline keyboard preview">
      {markup.inline_keyboard.map((row, rowIndex) => (
        <div className="chat-preview-inline-keyboard-row" key={`inline-preview-row-${rowIndex}`}>
          {row.map((button, buttonIndex) => (
            <button
              type="button"
              className="chat-preview-inline-keyboard-button"
              key={`${button.text}-${buttonIndex}`}
              title={button.url || button.callback_data || button.text}
            >
              {button.text}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
