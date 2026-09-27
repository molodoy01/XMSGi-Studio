function normalizeDialogChats(dialogs, getChatType, getDisplayName) {
  const chatsById = new Map();

  for (const dialog of dialogs || []) {
    const id = dialog?.id?.toString();
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

module.exports = { normalizeDialogChats };