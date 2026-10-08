const { InlineKeyboard } = require('teleproto');

function prepareInlineKeyboard(markup) {
  if (!markup?.inline_keyboard?.length) return undefined;

  const keyboard = new InlineKeyboard();
  markup.inline_keyboard.forEach((row, rowIndex) => {
    row.forEach((button) => {
      if (button.url) keyboard.url(button.text, button.url);
      else if (button.callback_data) keyboard.callback(button.text, button.callback_data);
    });
    if (rowIndex < markup.inline_keyboard.length - 1) keyboard.row();
  });

  return keyboard.build();
}

function decodeUtf8Bytes(value) {
  if (typeof value === 'string') return value;
  if (!Buffer.isBuffer(value) && !(value instanceof Uint8Array)) return undefined;

  const bytes = Buffer.from(value);
  const decoded = bytes.toString('utf8');
  return Buffer.from(decoded, 'utf8').equals(bytes) ? decoded : undefined;
}

function fromTelegramInlineKeyboard(replyMarkup) {
  if (!replyMarkup?.rows || !Array.isArray(replyMarkup.rows)) return undefined;

  const rows = replyMarkup.rows
    .map((row) => {
      if (!Array.isArray(row?.buttons)) return [];

      return row.buttons.flatMap((button) => {
        const type = button?.type;
        const typeName = type?.className || type?.constructor?.name;
        const text = typeof button?.text === 'string' ? button.text : '';
        if (!text) return [];

        if (typeName === 'InlineButtonTypeUrl' && typeof type.url === 'string' && type.url) {
          return [{ text, url: type.url }];
        }

        if (typeName === 'InlineButtonTypeCallback') {
          const callbackData = decodeUtf8Bytes(type.data);
          return callbackData === undefined ? [] : [{ text, callback_data: callbackData }];
        }

        return [];
      });
    })
    .filter((row) => row.length > 0);

  return rows.length ? { inline_keyboard: rows } : undefined;
}

module.exports = { fromTelegramInlineKeyboard, prepareInlineKeyboard };
