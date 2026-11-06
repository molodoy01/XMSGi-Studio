import { beforeEach, describe, expect, it } from 'vitest';
import { loadSavedDrafts, loadUpcoming, loadSent, saveSavedDrafts } from './storage';

describe('storage stability', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('prefers xmsgi keys over legacy keys when both exist', () => {
    const legacyMessage = {
      id: 'legacy-msg',
      chatId: 'chat-legacy',
      chatName: 'Legacy',
      text: 'legacy text',
      when: '2026-01-01T12:00:00.000Z',
      createdAt: '2026-01-01T09:00:00.000Z',
      status: 'scheduled',
    };
    const newMessage = {
      id: 'new-msg',
      chatId: 'chat-new',
      chatName: 'XMSGi',
      text: 'new text',
      when: '2026-02-01T12:00:00.000Z',
      createdAt: '2026-02-01T09:00:00.000Z',
      status: 'scheduled',
    };

    localStorage.setItem('awaitmsg_upcoming', JSON.stringify([legacyMessage]));
    localStorage.setItem('xmsgi_upcoming', JSON.stringify([newMessage]));

    expect(loadUpcoming()).toEqual([newMessage]);
  });

  it('migrates legacy scheduled messages into xmsgi storage without losing data', () => {
    const validMessage = {
      id: 'msg-1',
      chatId: 'chat-1',
      chatName: 'Studio',
      text: 'hello world',
      when: '2026-01-01T12:00:00.000Z',
      createdAt: '2026-01-01T09:00:00.000Z',
      status: 'scheduled',
    };

    localStorage.setItem('awaitmsg_upcoming', JSON.stringify([validMessage]));

    expect(loadUpcoming()).toEqual([validMessage]);
    expect(localStorage.getItem('xmsgi_upcoming')).toBe(JSON.stringify([validMessage]));
  });

  it('is idempotent when legacy scheduled messages are re-read after migration', () => {
    const validMessage = {
      id: 'msg-1',
      chatId: 'chat-1',
      chatName: 'Studio',
      text: 'hello world',
      when: '2026-01-01T12:00:00.000Z',
      createdAt: '2026-01-01T09:00:00.000Z',
      status: 'scheduled',
    };

    localStorage.setItem('awaitmsg_upcoming', JSON.stringify([validMessage]));

    const firstRead = loadUpcoming();
    expect(firstRead).toEqual([validMessage]);
    expect(localStorage.getItem('xmsgi_upcoming')).toBe(JSON.stringify([validMessage]));

    const secondRead = loadUpcoming();
    expect(secondRead).toEqual(firstRead);
    expect(localStorage.getItem('xmsgi_upcoming')).toBe(JSON.stringify([validMessage]));
    expect(localStorage.getItem('awaitmsg_upcoming')).toBe(JSON.stringify([validMessage]));
  });

  it('returns the empty defaults when neither xmsgi nor legacy keys exist', () => {
    expect(loadUpcoming()).toEqual([]);
    expect(loadSent()).toEqual([]);
    expect(localStorage.getItem('xmsgi_upcoming')).toBeNull();
    expect(localStorage.getItem('awaitmsg_upcoming')).toBeNull();
    expect(localStorage.getItem('xmsgi_sent')).toBeNull();
    expect(localStorage.getItem('awaitmsg_sent')).toBeNull();
  });

  it('ignores malformed scheduled entries and keeps only valid messages', () => {
    const validMessage = {
      id: 'msg-1',
      chatId: 'chat-1',
      chatName: 'Studio',
      text: 'hello world',
      when: '2026-01-01T12:00:00.000Z',
      createdAt: '2026-01-01T09:00:00.000Z',
      status: 'scheduled',
    };

    localStorage.setItem(
      'awaitmsg_upcoming',
      JSON.stringify([
        { id: 'bad-message' },
        validMessage,
      ]),
    );

    expect(loadUpcoming()).toEqual([validMessage]);
  });

  it('ignores malformed sent entries and falls back to an empty list', () => {
    localStorage.setItem('awaitmsg_sent', JSON.stringify([{ id: 'bad-message' }]));

    expect(loadSent()).toEqual([]);
  });

  it('persists named saved drafts independently from the workspace autosave', () => {
    const drafts = [{
      id: 'draft-1',
      name: 'Follow-up',
      body: 'Saved message',
      createdAt: '2026-01-01T09:00:00.000Z',
      updatedAt: '2026-01-01T09:00:00.000Z',
    }];

    saveSavedDrafts(drafts);

    const restoredDrafts = loadSavedDrafts();
    expect(restoredDrafts).toHaveLength(1);
    expect(restoredDrafts[0]).toMatchObject(drafts[0]);
    expect(restoredDrafts[0].attachments).toEqual([]);
    expect(restoredDrafts[0].color).toBe('gray');
    expect(localStorage.getItem('awaitmsg-workspace-draft')).toBeNull();
  });
});
