function isSendBanned(rights) {
  return rights?.sendMessages === true;
}

function isChannelPostAllowed(rights) {
  return rights?.postMessages === true || rights?.postStories === true;
}

function deriveChatPermissions({
  entityClass,
  megagroup = false,
  defaultBannedRights,
  participantClass,
  participantRights,
  adminRights,
} = {}) {
  if (entityClass === 'User') {
    return { canView: true, canSend: null, canSchedule: null };
  }

  if (entityClass === 'Chat') {
    const canSend = defaultBannedRights ? !isSendBanned(defaultBannedRights) : true;
    return { canView: true, canSend, canSchedule: canSend ? null : false };
  }

  if (entityClass === 'Channel') {
    let canSend;

    if (participantClass === 'ChannelParticipantBanned') {
      canSend = false;
    } else if (participantRights) {
      canSend = !isSendBanned(participantRights);
    } else if (participantClass === 'ChannelParticipantCreator') {
      canSend = true;
    } else if (participantClass === 'ChannelParticipantAdmin') {
      canSend = megagroup ? !isSendBanned(adminRights) : isChannelPostAllowed(adminRights);
    } else if (!megagroup) {
      canSend = false;
    } else {
      canSend = defaultBannedRights ? !isSendBanned(defaultBannedRights) : true;
    }

    return { canView: true, canSend, canSchedule: canSend ? null : false };
  }

  return { canView: true, canSend: null, canSchedule: null };
}

function isPermissionError(error) {
  const code = String(error?.code || error?.errorMessage || error?.message || '').toUpperCase();
  return /CHAT_WRITE_FORBIDDEN|CHAT_ADMIN_REQUIRED|USER_IS_BLOCKED|USER_BANNED_IN_CHANNEL|CHANNEL_PRIVATE|CHAT_RESTRICTED|CHAT_FORBIDDEN/.test(code);
}

module.exports = { deriveChatPermissions, isPermissionError };
