import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  DIALOG_SEARCH_FOLDERS,
  MAX_DIALOG_SEARCH_RESULTS,
  findDialogByTitle,
} = require('./telegram-dialog-search.cjs');

function makeClient(dialogsByFolder) {
  return {
    iterDialogs({ archived, limit }) {
      const dialogs = dialogsByFolder[archived ? 'archived' : 'regular'] || [];
      return (async function* () {
        for (const dialog of dialogs.slice(0, limit)) yield dialog;
      })();
    },
  };
}

function dialog(id, name, type = 'private') {
  return {
    id: String(id),
    name,
    entity: { id: String(id), firstName: name, className: type === 'private' ? 'User' : 'Channel', username: `${name.toLowerCase().replace(/\s+/g, '_')}` },
    type,
  };
}

describe('paginated Telegram dialog search', () => {
  it('uses regular and archived folders with a bounded result limit', async () => {
    const client = makeClient({ regular: [dialog(1, 'Recent')], archived: [dialog(2, 'Archived')] });
    const result = await findDialogByTitle(client, 'Archived', { getType: (entity) => entity.className === 'User' ? 'private' : 'channel' });

    expect(result?.id).toBe('2');
    expect(DIALOG_SEARCH_FOLDERS).toEqual([false, true]);
    expect(MAX_DIALOG_SEARCH_RESULTS).toBe(500);
  });

  it('finds dialogs after the first 100 and 200 entries', async () => {
    const dialogs = Array.from({ length: 250 }, (_, index) => dialog(index, `Chat ${index}`));
    const client = makeClient({ regular: dialogs, archived: [] });

    await expect(findDialogByTitle(client, 'Chat 150', { getType: () => 'private' })).resolves.toMatchObject({ id: '150' });
    await expect(findDialogByTitle(client, 'Chat 225', { getType: () => 'private' })).resolves.toMatchObject({ id: '225' });
  });

  it('does not return a duplicate when the caller excludes an existing stable ID', async () => {
    const client = makeClient({ regular: [dialog(42, 'Existing Chat')], archived: [] });
    await expect(findDialogByTitle(client, 'Existing Chat', { excludeId: '42', getType: () => 'private' })).resolves.toBeNull();
  });

  it('does not search beyond the protective limit', async () => {
    const dialogs = Array.from({ length: MAX_DIALOG_SEARCH_RESULTS + 10 }, (_, index) => dialog(index, `Chat ${index}`));
    const client = makeClient({ regular: dialogs, archived: [] });
    await expect(findDialogByTitle(client, `Chat ${MAX_DIALOG_SEARCH_RESULTS + 5}`, { getType: () => 'private' })).resolves.toBeNull();
  });
});
