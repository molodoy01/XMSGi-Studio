const { Api } = require('teleproto');

function getStableChatId(requestedId, entityId) {
  const id = requestedId ?? entityId;
  return id == null ? '' : String(id);
}

function normalizeDialogChats(dialogs, getChatType, getDisplayName) {
  const chatsById = new Map();

  for (const dialog of dialogs || []) {
    const id = getStableChatId(dialog?.id);
    if (!id) continue;

    const entity = dialog.entity || null;
    chatsById.set(id, {
      id,
      name: dialog.name || getDisplayName(entity) || id,
      username: entity?.username || '',
      type: getChatType(entity) || 'private'
    });
  }

  return [...chatsById.values()];
}

function getPublicChatType(entity) {
  if (!entity) {
    return null;
  }

  if (entity instanceof Api.User || entity?.className === 'User') {
    return null;
  }

  if (entity instanceof Api.Channel || entity?.className === 'Channel') {
    return entity.megagroup ? 'supergroup' : 'channel';
  }

  if (entity instanceof Api.Chat || entity?.className === 'Chat') {
    return 'group';
  }

  if (entity instanceof Api.ChatForbidden || entity?.className === 'ChatForbidden') {
    return 'group';
  }

  return null;
}

function getResolvedChatType(entity) {
  const publicType = getPublicChatType(entity);
  if (publicType) return publicType;

  if (entity instanceof Api.User || entity?.className === 'User') {
    return 'private';
  }

  return null;
}

function getEntityDisplayName(entity) {
  if (!entity) return '';

  return (
    entity.title ||
    [entity.firstName, entity.lastName].filter(Boolean).join(' ') ||
    entity.username ||
    'Unnamed chat'
  );
}

module.exports = {
  getStableChatId,
  normalizeDialogChats,
  getPublicChatType,
  getResolvedChatType,
  getEntityDisplayName,
};