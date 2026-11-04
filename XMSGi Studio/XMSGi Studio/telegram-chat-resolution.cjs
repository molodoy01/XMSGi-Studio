const {
  normalizeQuery,
  normalizePhone,
  isPhoneLikeQuery,
  isUsernameQuery,
} = require('./telegram-search.cjs');
const { findDialogByTitle } = require('./telegram-dialog-search.cjs');
const { getResolvedChatType, getEntityDisplayName } = require('./telegram-dialogs.cjs');

const REQUEST_TIMEOUT = 15000;

function createTelegramChatResolver({
  connectTelegram,
  getChatAvatarDataUrl,
  getClient,
  getContacts,
  telegramRequest,
  withTimeout,
}) {
  async function resolveChatByTitleInDialogs(query) {
    const normalized = normalizeQuery(query);

    if (!normalized) return null;

    let me = null;

    try {
      me = await telegramRequest(() => getClient().getMe());
    } catch (error) {
      if (error?.code === 'TELEGRAM_SESSION_INVALID') throw error;
      console.error('Could not load Telegram profile for dialog title lookup:', error?.code || error?.name || 'unknown');
    }

    const myId = me?.id?.toString();

    try {
      return await findDialogByTitle(getClient(), normalized, {
        excludeId: myId,
        maxResults: 500,
        getName: (entity, dialog) => dialog?.name || getEntityDisplayName(entity),
        getType: (entity) => getResolvedChatType(entity),
        getUsername: (entity) => entity?.username || '',
        getPhone: (entity) => entity?.phone || '',
      });
    } catch (error) {
      if (error?.code === 'TELEGRAM_SESSION_INVALID') throw error;
      console.error('Telegram dialog title lookup failed:', error?.code || error?.name || 'unknown');
    }

    return null;
  }

  async function resolveChatInternal(query) {
    if (!getClient()) {
      await connectTelegram();
    }

    const originalQuery = String(query || '').trim();
    if (!originalQuery) {
      throw new Error('Username, name or phone is empty');
    }

    let contacts = [];

    try {
      contacts = await getContacts();
    } catch (error) {
      if (error?.code === 'TELEGRAM_SESSION_INVALID') throw error;
      console.error('Could not load Telegram contacts:', error?.code || error?.name || 'unknown');
    }

    const normalized = normalizeQuery(originalQuery);
    const normalizedPhone = normalizePhone(originalQuery);

    if (normalizedPhone.length >= 5) {
      const phoneMatch = contacts.find((contact) => {
        const contactPhone = normalizePhone(contact.phone);
        return contactPhone && contactPhone === normalizedPhone;
      });

      if (phoneMatch) {
        return {
          id: String(phoneMatch.id),
          name: phoneMatch.name,
          username: phoneMatch.username || '',
          phone: phoneMatch.phone || '',
        };
      }
    }

    const usernameMatch = contacts.find((contact) => {
      const username = String(contact.username || '').trim().toLowerCase().replace(/^@/, '');
      return username && username === normalized;
    });

    if (usernameMatch) {
      return {
        id: String(usernameMatch.id),
        name: usernameMatch.name,
        username: usernameMatch.username || '',
        phone: usernameMatch.phone || '',
      };
    }

    const nameMatch = contacts.find((contact) => (
      String(contact.name || '').trim().toLowerCase() === normalized
    ));

    if (nameMatch) {
      return {
        id: String(nameMatch.id),
        name: nameMatch.name,
        username: nameMatch.username || '',
        phone: nameMatch.phone || '',
      };
    }

    const partialNameMatch = contacts.find((contact) => {
      const name = String(contact.name || '').trim().toLowerCase();
      return name && normalized && name.includes(normalized);
    });

    if (partialNameMatch) {
      return {
        id: String(partialNameMatch.id),
        name: partialNameMatch.name,
        username: partialNameMatch.username || '',
        phone: partialNameMatch.phone || '',
      };
    }

    if (isPhoneLikeQuery(originalQuery)) {
      throw new Error(`Could not find a Telegram contact for phone: ${originalQuery}`);
    }

    const cleanUsername = normalizeQuery(originalQuery);
    if (!cleanUsername) {
      throw new Error('Invalid Telegram username or link');
    }

    const dialogMatch = await resolveChatByTitleInDialogs(originalQuery);
    if (dialogMatch) return dialogMatch;

    if (!isUsernameQuery(originalQuery)) {
      throw new Error(`Could not find a Telegram chat: ${originalQuery}`);
    }

    try {
      const entity = await telegramRequest(() => withTimeout(
        getClient().getEntity(cleanUsername),
        REQUEST_TIMEOUT,
        'Telegram entity search'
      ));

      if (!entity) {
        throw new Error('Telegram returned no result');
      }

      const type = getResolvedChatType(entity);
      if (!type) {
        throw new Error('Resolved Telegram entity is not a supported chat');
      }

      return {
        id: entity.id?.toString(),
        name: getEntityDisplayName(entity),
        username: entity.username || '',
        phone: entity.phone || '',
        type,
        avatarDataUrl: await getChatAvatarDataUrl(entity),
      };
    } catch (error) {
      if (error?.code === 'TELEGRAM_SESSION_INVALID') throw error;
      console.error('Telegram direct search failed:', error?.code || error?.name || 'unknown');
      throw new Error(`Could not find Telegram chat: ${originalQuery}`);
    }
  }

  return { resolveChatInternal };
}

module.exports = { createTelegramChatResolver };