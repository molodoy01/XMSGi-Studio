const MAX_DIALOG_SEARCH_RESULTS = 500;
const DIALOG_SEARCH_FOLDERS = [false, true];

function normalizeDialogSearchQuery(value) {
  return String(value || '').trim().toLowerCase();
}

async function findDialogByTitle(client, query, options = {}) {
  const normalizedQuery = normalizeDialogSearchQuery(query);
  const excludeId = options.excludeId ? String(options.excludeId) : '';
  const getName = options.getName || ((entity, dialog) => dialog?.name || entity?.title || [entity?.firstName, entity?.lastName].filter(Boolean).join(' '));
  const getType = options.getType || (() => null);
  const getUsername = options.getUsername || ((entity) => entity?.username || '');
  const getPhone = options.getPhone || ((entity) => entity?.phone || '');
  const maxResults = Math.max(1, Math.min(
    Number(options.maxResults) || MAX_DIALOG_SEARCH_RESULTS,
    MAX_DIALOG_SEARCH_RESULTS,
  ));

  if (!normalizedQuery) return null;

  for (const archived of DIALOG_SEARCH_FOLDERS) {
    const dialogs = client.iterDialogs({
      limit: maxResults,
      archived,
    });

    for await (const dialog of dialogs) {
      const entity = dialog?.entity || null;
      const id = entity?.id?.toString() || dialog?.id?.toString() || '';
      const type = getType(entity);

      if (!entity || !type || (excludeId && id === excludeId)) continue;

      const name = getName(entity, dialog) || '';
      if (normalizeDialogSearchQuery(name) !== normalizedQuery) continue;

      return {
        id,
        name,
        username: getUsername(entity),
        phone: getPhone(entity),
        type,
      };
    }
  }

  return null;
}

module.exports = {
  MAX_DIALOG_SEARCH_RESULTS,
  DIALOG_SEARCH_FOLDERS,
  normalizeDialogSearchQuery,
  findDialogByTitle,
};
