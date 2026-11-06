import { describe, expect, it, vi } from 'vitest';
import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeJsonFile } from './chat-storage.cjs';
import {
  applyConfirmedImmediateSend,
  commitConfirmedImmediateSend,
  findRecentSentMessage,
  loadScheduleHistoryScope,
  normalizeScheduleMessages,
} from './schedule-history.cjs';

function record(id, status) {
  return {
    id,
    chatId: 'chat-1',
    text: `Message ${id}`,
    when: '2035-01-15T18:00:00.000Z',
    createdAt: '2035-01-15T17:00:00.000Z',
    status,
  };
}

describe('schedule history persistence migration', () => {
  it('preserves terminal/current states and migrates legacy confirmed', () => {
    expect(normalizeScheduleMessages([
      record('scheduled', 'scheduled'),
      record('sent', 'sent'),
      record('confirmed', 'confirmed'),
      record('failed', 'failed'),
    ], { recoverInterrupted: true }).map(({ id, status }) => ({ id, status }))).toEqual([
      { id: 'scheduled', status: 'scheduled' },
      { id: 'sent', status: 'sent' },
      { id: 'confirmed', status: 'scheduled' },
      { id: 'failed', status: 'failed' },
    ]);
  });

  it('preserves interrupted Pending for Telegram reconciliation and migrates Sending/unknown states', () => {
    expect(normalizeScheduleMessages([
      { ...record('sending-schedule', 'sending'), retryAction: 'schedule' },
      { ...record('sending-send', 'sending'), retryAction: 'send', sendAttemptId: 'attempt-1' },
      record('pending', 'pending'),
      record('unknown', 'future-state'),
    ], { recoverInterrupted: true })).toMatchObject([
      { id: 'sending-schedule', status: 'failed', retryAction: 'schedule' },
      {
        id: 'sending-send',
        status: 'unknown',
        retryAction: undefined,
        sendAttemptId: 'attempt-1',
        lastError: 'The app closed while this message was sending. Studio cannot verify the result automatically after restart; check Telegram before sending again.',
      },
      { id: 'pending', status: 'pending' },
      { id: 'unknown', status: 'failed', retryAction: 'send' },
    ]);
  });

  it('moves only the confirmed operation from Upcoming to Sent and retains scope isolation', () => {
    const history = {
      schemaVersion: 1,
      personal: { upcoming: [], sent: [] },
      workspace: {
        upcoming: [{ ...record('send-1', 'sending'), retryAction: 'send', sendAttemptId: 'attempt-1' }],
        sent: [],
      },
    };

    const updated = applyConfirmedImmediateSend(history, 'attempt-1', {
      telegramMessageId: 42,
      telegramMessageIds: [42],
      sentAt: '2035-01-15T18:00:10.000Z',
    });

    expect(updated.personal).toEqual(history.personal);
    expect(updated.workspace).toMatchObject({
      upcoming: [],
      sent: [{
        id: 'send-1',
        status: 'sent',
        sendAttemptId: 'attempt-1',
        telegramMessageId: 42,
        telegramMessageIds: [42],
        sentAt: '2035-01-15T18:00:10.000Z',
      }],
    });
    expect(applyConfirmedImmediateSend(history, 'missing', { telegramMessageId: 7 })).toBeNull();
    expect(applyConfirmedImmediateSend(history, 'attempt-1', {})).toBeNull();
    expect(applyConfirmedImmediateSend(history, 'attempt-1', {
      telegramMessageId: 42,
      telegramMessageIds: [42, 42],
    })).toBeNull();
    expect(history.workspace.upcoming).toHaveLength(1);
  });

  it('retains the original pending history when writing a Telegram confirmation fails', () => {
    const history = {
      schemaVersion: 1,
      workspace: {
        upcoming: [{ ...record('send-1', 'sending'), retryAction: 'send', sendAttemptId: 'attempt-1' }],
        sent: [],
      },
    };
    const writer = vi.fn(() => {
      throw new Error('Disk full');
    });

    const result = commitConfirmedImmediateSend(history, 'attempt-1', {
      telegramMessageId: 42,
      telegramMessageIds: [42],
    }, writer);

    expect(result).toEqual({ success: false, error: 'Disk full' });
    expect(writer).toHaveBeenCalledWith(expect.objectContaining({
      workspace: expect.objectContaining({
        upcoming: [],
        sent: [expect.objectContaining({ status: 'sent', telegramMessageId: 42 })],
      }),
    }));
    expect(history.workspace.upcoming).toHaveLength(1);
    expect(history.workspace.upcoming[0]).toMatchObject({
      status: 'sending',
      sendAttemptId: 'attempt-1',
    });
    expect(history.workspace.sent).toHaveLength(0);
  });

  it('does not duplicate history when the same Telegram confirmation is persisted again', () => {
    const history = {
      schemaVersion: 1,
      workspace: {
        upcoming: [],
        sent: [{
          ...record('send-1', 'sent'),
          sendAttemptId: 'attempt-1',
          telegramMessageId: 42,
          telegramMessageIds: [42],
        }],
      },
    };

    const updated = applyConfirmedImmediateSend(history, 'attempt-1', {
      telegramMessageId: 42,
      telegramMessageIds: [42],
    });

    expect(updated.workspace.upcoming).toEqual([]);
    expect(updated.workspace.sent).toHaveLength(1);
    expect(updated.workspace.sent[0]).toMatchObject({
      id: 'send-1',
      sendAttemptId: 'attempt-1',
      telegramMessageId: 42,
    });
  });

  it('rejects corrupt records without rewriting or silently dropping the store', () => {
    expect(() => normalizeScheduleMessages([
      record('valid', 'scheduled'),
      { id: 'corrupt', status: 'sent' },
    ])).toThrow('invalid message');
  });

  it('treats a missing scope as migration but rejects an incomplete persisted scope', () => {
    const workspaceHistory = { upcoming: [], sent: [] };
    expect(loadScheduleHistoryScope({ schemaVersion: 1, workspace: workspaceHistory }, 'personal'))
      .toEqual({
        success: true,
        history: { upcoming: [], sent: [] },
        needsMigration: true,
      });
    expect(loadScheduleHistoryScope({
      schemaVersion: 1,
      personal: { upcoming: [] },
      workspace: workspaceHistory,
    }, 'personal')).toMatchObject({ success: false, error: 'Schedule history scope "personal" is incomplete.' });
    expect(loadScheduleHistoryScope({
      schemaVersion: 1,
      personal: { upcoming: [], sent: null },
    }, 'personal')).toMatchObject({ success: false });
    expect(loadScheduleHistoryScope({ schemaVersion: 2 }, 'personal')).toMatchObject({ success: false });
  });

  it('keeps the new confirmed send and trims only the oldest sent record at the count limit', () => {
    const history = {
      schemaVersion: 1,
      workspace: {
        upcoming: [{ ...record('new-send', 'sending'), sendAttemptId: 'attempt-new' }],
        sent: Array.from({ length: 2000 }, (_, index) => ({
          ...record(`old-${index}`, 'sent'),
          sendAttemptId: `attempt-old-${index}`,
        })),
      },
    };

    const updated = applyConfirmedImmediateSend(history, 'attempt-new', { telegramMessageId: 42 });

    expect(updated.workspace.sent).toHaveLength(2000);
    expect(updated.workspace.sent[0]).toMatchObject({
      id: 'new-send',
      status: 'sent',
      telegramMessageId: 42,
    });
    expect(updated.workspace.sent.at(-1).id).toBe('old-1998');
    expect(updated.workspace.upcoming).toEqual([]);
    expect(loadScheduleHistoryScope(updated, 'workspace').success).toBe(true);
  });

  it('trims oldest sent records to stay within the serialized byte limit', () => {
    const history = {
      schemaVersion: 1,
      workspace: {
        upcoming: [{ ...record('new-send', 'sending'), sendAttemptId: 'attempt-new' }],
        sent: Array.from({ length: 1400 }, (_, index) => ({
          ...record(`old-${index}`, 'sent'),
          sendAttemptId: `attempt-old-${index}`,
          text: 'x'.repeat(5500),
        })),
      },
    };
    expect(Buffer.byteLength(JSON.stringify(history.workspace.sent), 'utf8')).toBeLessThan(8 * 1024 * 1024);

    const updated = applyConfirmedImmediateSend(history, 'attempt-new', { telegramMessageId: 42 });

    expect(updated).not.toBeNull();
    expect(updated.workspace.sent[0]).toMatchObject({ id: 'new-send', status: 'sent' });
    expect(Buffer.byteLength(JSON.stringify(updated.workspace.sent), 'utf8')).toBeLessThanOrEqual(8 * 1024 * 1024);
    expect(loadScheduleHistoryScope(updated, 'workspace').success).toBe(true);
  });

  it('writes a bounded confirmation atomically and reloads it through the schedule-history loader', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'xmsg-schedule-history-'));
    const filePath = path.join(directory, 'history.json');
    try {
      const history = {
        schemaVersion: 1,
        workspace: {
          upcoming: [{ ...record('send-1', 'sending'), sendAttemptId: 'attempt-1' }],
          sent: Array.from({ length: 2000 }, (_, index) => ({
            ...record(`old-${index}`, 'sent'),
            sendAttemptId: `old-attempt-${index}`,
          })),
        },
      };

      const result = commitConfirmedImmediateSend(history, 'attempt-1', {
        telegramMessageId: 42,
        telegramMessageIds: [42],
      }, (updated) => writeJsonFile(filePath, updated));

      expect(result).toEqual({ success: true });
      const loaded = loadScheduleHistoryScope(JSON.parse(fs.readFileSync(filePath, 'utf8')), 'workspace', {
        recoverInterrupted: true,
      });
      expect(loaded).toMatchObject({
        success: true,
        needsMigration: false,
        history: { upcoming: [] },
      });
      expect(loaded.history.sent[0]).toMatchObject({
        id: 'send-1',
        status: 'sent',
        sendAttemptId: 'attempt-1',
        telegramMessageId: 42,
        telegramMessageIds: [42],
      });
      expect(loaded.history.sent).toHaveLength(2000);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe('scheduled message reconciliation', () => {
  it('matches only outgoing history with the same text and near schedule time', () => {
    const timestamp = 2052547200;
    const sent = { id: 42, message: 'Scheduled text', date: timestamp + 30, out: true };

    expect(findRecentSentMessage([
      { ...sent, id: 40, out: false },
      { ...sent, id: 41, message: 'Different text' },
      { ...sent, id: 42 },
    ], 'Scheduled text', timestamp)).toEqual(sent);
    expect(findRecentSentMessage([{ ...sent, date: timestamp + 400 }], 'Scheduled text', timestamp)).toBeNull();
  });
});