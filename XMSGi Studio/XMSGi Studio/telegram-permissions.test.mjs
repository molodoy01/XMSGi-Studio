import { describe, expect, it } from 'vitest';
import { deriveChatPermissions, isPermissionError } from './telegram-permissions.cjs';

describe('Telegram chat permission mapping', () => {
  it('keeps private-chat send and schedule permission unknown when Telegram provides no preflight right', () => {
    expect(deriveChatPermissions({ entityClass: 'User' })).toEqual({
      canView: true,
      canSend: null,
      canSchedule: null,
    });
  });

  it('allows a normal group when no send restriction is present', () => {
    expect(deriveChatPermissions({ entityClass: 'Chat' })).toMatchObject({ canSend: true, canSchedule: null });
  });

  it('denies a group and supergroup with real sendMessages restrictions', () => {
    const rights = { sendMessages: true };
    expect(deriveChatPermissions({ entityClass: 'Chat', defaultBannedRights: rights })).toMatchObject({ canSend: false, canSchedule: false });
    expect(deriveChatPermissions({ entityClass: 'Channel', megagroup: true, defaultBannedRights: rights })).toMatchObject({ canSend: false, canSchedule: false });
  });

  it('denies a broadcast channel to a regular member but allows an admin with postMessages', () => {
    expect(deriveChatPermissions({ entityClass: 'Channel', megagroup: false, participantClass: 'ChannelParticipantMember' })).toMatchObject({ canSend: false, canSchedule: false });
    expect(deriveChatPermissions({ entityClass: 'Channel', megagroup: false, participantClass: 'ChannelParticipantAdmin', adminRights: { postMessages: true } })).toMatchObject({ canSend: true, canSchedule: null });
  });

  it('reflects permission changes instead of caching an earlier result', () => {
    const denied = deriveChatPermissions({ entityClass: 'Channel', megagroup: true, defaultBannedRights: { sendMessages: true } });
    const allowed = deriveChatPermissions({ entityClass: 'Channel', megagroup: true, defaultBannedRights: { sendMessages: false } });
    expect(denied.canSend).toBe(false);
    expect(allowed.canSend).toBe(true);
  });

  it('recognizes Telegram permission errors from real error names', () => {
    expect(isPermissionError({ errorMessage: 'CHAT_WRITE_FORBIDDEN' })).toBe(true);
    expect(isPermissionError(new Error('temporary network failure'))).toBe(false);
  });
});
