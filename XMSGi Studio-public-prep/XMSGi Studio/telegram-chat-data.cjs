const {
  getStableChatId,
  normalizeDialogChats,
  getPublicChatType,
  getEntityDisplayName,
} = require('./telegram-dialogs.cjs');
const { deriveChatPermissions, isPermissionError } = require('./telegram-permissions.cjs');
const { getPreviewMedia, toPreviewNumber } = require('./telegram-media-preview.cjs');
const { getTelegramEntityType } = require('./telegram-message-entities.cjs');
const { fromTelegramInlineKeyboard } = require('./telegram-inline-keyboard.cjs');
const { normalizeHistoryMessage, resolveMessageDirection } = require('./telegram-message-direction.cjs');

const REQUEST_TIMEOUT = 15000;
const MAX_PREVIEW_ORIGINAL_PHOTO_BYTES = 12 * 1024 * 1024;

function createTelegramChatData({ Api, connectTelegram, getClient, telegramRequest, withTimeout }) {
  async function getChatAvatarDataUrl(entity) {
    if (!entity) return '';
    try {
      const avatar = await telegramRequest(() => withTimeout(
        getClient().downloadProfilePhoto(entity), REQUEST_TIMEOUT, 'Loading Telegram chat avatar'
      ));
      if (avatar && (Buffer.isBuffer(avatar) || avatar instanceof Uint8Array)) {
        return `data:image/jpeg;base64,${Buffer.from(avatar).toString('base64')}`;
      }
    } catch (error) {
      console.error('Telegram chat avatar unavailable:', error?.code || error?.name || 'unknown');
    }
    return '';
  }

  async function getChatsInternal() {
    if (!getClient()) await connectTelegram();
    const dialogs = await telegramRequest(() => getClient().getDialogs({ limit: undefined }));
    const chats = normalizeDialogChats(dialogs, getPublicChatType, getEntityDisplayName);
    try {
      const me = await telegramRequest(() => getClient().getMe());
      const myId = me.id?.toString();
      if (myId) {
        const filteredChats = chats.filter((chat) => chat.id !== myId);
        filteredChats.unshift({
          id: myId, name: 'Saved Messages', username: '', type: 'private', avatarDataUrl: '',
        });
        return filteredChats;
      }
    } catch (error) {
      if (error?.code === 'TELEGRAM_SESSION_INVALID') throw error;
      console.error('Failed to add Saved Messages:', error?.code || error?.name || 'unknown');
    }
    return chats;
  }

  async function getChatAvatarInternal(chatId) {
    if (!getClient()) await connectTelegram();
    return getChatAvatarDataUrl(await telegramRequest(() => getClient().getEntity(chatId)));
  }

  async function getAccountAvatarInternal() {
    if (!getClient()) await connectTelegram();
    return getChatAvatarDataUrl(await telegramRequest(() => getClient().getMe()));
  }

  function getPermissionStatus({ canView = true, canSend = null, canSchedule = null, error = '' } = {}) {
    return { canView, canSend, canSchedule, ...(error ? { error } : {}) };
  }

  async function getChatPermissionsInternal(chatId) {
    if (!getClient()) await connectTelegram();
    try {
      const entity = await telegramRequest(() => getClient().getEntity(chatId));
      if (!entity) return getPermissionStatus({ canView: false });
      if (entity instanceof Api.User || entity?.className === 'User') {
        return getPermissionStatus(deriveChatPermissions({ entityClass: 'User' }));
      }
      if (entity instanceof Api.Chat || entity?.className === 'Chat') {
        const full = await telegramRequest(() => getClient().api.messages.getFullChat({ chatId: entity.id }));
        const rights = entity.defaultBannedRights || full?.fullChat?.defaultBannedRights;
        return getPermissionStatus(deriveChatPermissions({ entityClass: 'Chat', defaultBannedRights: rights }));
      }
      if (entity instanceof Api.Channel || entity?.className === 'Channel') {
        const full = await telegramRequest(() => getClient().api.channels.getFullChannel({ channel: entity }));
        let participant = null;
        try {
          participant = await telegramRequest(() => getClient().getParticipant(entity, 'me'));
        } catch (error) {
          if (isPermissionError(error)) {
            return getPermissionStatus({ canView: true, canSend: false, canSchedule: false, error: 'CHAT_WRITE_FORBIDDEN' });
          }
        }
        const participantClass = participant?.participant?.className || participant?.className || '';
        const participantRights = participant?.participant?.bannedRights || participant?.bannedRights;
        const adminRights = participant?.participant?.adminRights || participant?.adminRights;
        const isCreator = participantClass === 'ChannelParticipantCreator';
        const isAdmin = participantClass === 'ChannelParticipantAdmin';
        const defaultRights = entity.defaultBannedRights || full?.fullChat?.defaultBannedRights;
        return getPermissionStatus(deriveChatPermissions({
          entityClass: 'Channel',
          megagroup: entity.megagroup === true,
          defaultBannedRights: defaultRights,
          participantClass: isCreator ? 'ChannelParticipantCreator' : isAdmin ? 'ChannelParticipantAdmin' : participantClass,
          participantRights,
          adminRights,
        }));
      }
      return getPermissionStatus();
    } catch (error) {
      if (isPermissionError(error)) {
        return getPermissionStatus({ canView: true, canSend: false, canSchedule: false, error: 'CHAT_WRITE_FORBIDDEN' });
      }
      return getPermissionStatus({ error: 'PERMISSION_UNKNOWN' });
    }
  }

  async function getChatHistoryInternal(chatId, limit = 50, offsetId) {
    if (!getClient()) await connectTelegram();
    const target = chatId === 'me' ? 'me' : chatId;
    const entity = await telegramRequest(() => withTimeout(getClient().getEntity(target), REQUEST_TIMEOUT, 'Resolving Telegram chat for history'));
    const currentUser = await telegramRequest(() => withTimeout(getClient().getMe(), REQUEST_TIMEOUT, 'Loading current Telegram account'));
    const currentUserId = currentUser?.id != null ? String(currentUser.id) : '';
    const messages = await telegramRequest(() => withTimeout(
      getClient().getMessages(entity, { limit, ...(offsetId ? { offsetId } : {}) }),
      REQUEST_TIMEOUT,
      'Loading Telegram chat history',
    ));
    let avatarDataUrl = '';
    try {
      const avatar = await telegramRequest(() => withTimeout(getClient().downloadProfilePhoto(entity), REQUEST_TIMEOUT, 'Loading Telegram chat avatar'));
      if (avatar && (Buffer.isBuffer(avatar) || avatar instanceof Uint8Array)) {
        avatarDataUrl = `data:image/jpeg;base64,${Buffer.from(avatar).toString('base64')}`;
      }
    } catch (error) {
      console.error('Telegram chat avatar unavailable:', error?.code || error?.name || 'unknown');
    }

    let originalPhotoBytesRemaining = MAX_PREVIEW_ORIGINAL_PHOTO_BYTES;
    const normalizedMessages = (await Promise.all([...(messages || [])]
      .filter((message) => message && message.id !== undefined)
      .map(async (message) => {
        const normalizedMessage = normalizeHistoryMessage(message, currentUserId);
        const photoSize = toPreviewNumber(message.file?.size);
        const includeOriginalPhoto = Boolean(message.photo && photoSize !== undefined && photoSize > 0
          && photoSize <= 8 * 1024 * 1024 && photoSize <= originalPhotoBytesRemaining);
        if (includeOriginalPhoto) originalPhotoBytesRemaining -= photoSize;
        return {
          id: String(normalizedMessage.id),
          text: String(normalizedMessage.text || ''),
          date: normalizedMessage.date,
          outgoing: resolveMessageDirection(message, currentUserId),
          senderName: getEntityDisplayName(message.sender) || normalizedMessage.senderName,
          entities: (message.entities || []).flatMap((messageEntity) => {
            const type = getTelegramEntityType(messageEntity);
            return type && Number.isInteger(messageEntity.offset) && Number.isInteger(messageEntity.length)
              ? [{
                type,
                offset: messageEntity.offset,
                length: messageEntity.length,
                ...(type === 'text_url' && messageEntity.url ? { url: messageEntity.url } : {}),
                ...(type === 'pre' && messageEntity.language ? { language: messageEntity.language } : {}),
              }]
              : [];
          }),
          mediaType: message.media?.className || '',
          mediaName: message.file?.name || '',
          media: await getPreviewMedia(message, includeOriginalPhoto),
          replyMarkup: fromTelegramInlineKeyboard(message.replyMarkup),
          groupId: message.groupedId ? String(message.groupedId) : '',
        };
      }))).sort((left, right) => new Date(left.date).getTime() - new Date(right.date).getTime());

    return {
      chat: {
        id: getStableChatId(chatId, entity.id),
        title: getEntityDisplayName(entity),
        username: entity.username || '',
        type: getPublicChatType(entity) || 'private',
        avatarDataUrl,
        topic: '',
      },
      messages: normalizedMessages,
    };
  }

  async function deleteSavedMessageInternal(chatId, messageId) {
    if (!getClient()) await connectTelegram();
    const entity = await telegramRequest(() => withTimeout(getClient().getEntity(chatId === 'me' ? 'me' : chatId), REQUEST_TIMEOUT, 'Resolving Telegram Saved Messages'));
    const currentUser = await telegramRequest(() => withTimeout(getClient().getMe(), REQUEST_TIMEOUT, 'Verifying Telegram Saved Messages'));
    if (String(entity.id) !== String(currentUser.id)) throw new Error('Only messages from Saved Messages can be deleted here.');
    await telegramRequest(() => withTimeout(getClient().deleteMessages(entity, [messageId], { revoke: true }), REQUEST_TIMEOUT, 'Deleting Telegram Saved Message'));
    return { success: true };
  }

  async function getContactsInternal() {
    if (!getClient()) await connectTelegram();
    try {
      const result = await telegramRequest(() => getClient().invoke(new Api.contacts.GetContacts({ hash: 0 })));
      return (result.users || []).map((user) => ({
        id: user.id?.toString(),
        name: [user.firstName, user.lastName].filter(Boolean).join(' ') || 'Unnamed contact',
        username: user.username || '',
        phone: user.phone || '',
      }));
    } catch (error) {
      console.error('Failed to get Telegram contacts:', error?.code || error?.name || 'unknown');
      throw error;
    }
  }

  async function getAvailableEffectsInternal() {
    if (!getClient()) await connectTelegram();
    const result = await telegramRequest(() => withTimeout(
      getClient().invoke(new Api.messages.GetAvailableEffects({ hash: 0 })), REQUEST_TIMEOUT, 'Loading Telegram effects'
    ));
    return Array.isArray(result?.effects)
      ? result.effects.map((effect) => ({
        id: effect?.id != null ? String(effect.id) : '',
        emoticon: typeof effect?.emoticon === 'string' && effect.emoticon.trim() ? effect.emoticon : '✨',
        premiumRequired: Boolean(effect?.premiumRequired),
      })).filter((effect) => effect.id)
      : [];
  }

  return {
    getChatAvatarDataUrl,
    getChatsInternal,
    getChatAvatarInternal,
    getAccountAvatarInternal,
    getChatPermissionsInternal,
    getChatHistoryInternal,
    deleteSavedMessageInternal,
    getContactsInternal,
    getAvailableEffectsInternal,
  };
}

module.exports = { createTelegramChatData };