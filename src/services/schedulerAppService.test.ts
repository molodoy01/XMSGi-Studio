import { afterEach, describe, expect, it, vi } from 'vitest';
import { reconcileImmediateSendAttempt } from './schedulerAppService';

function setReconciliationResult(result: Record<string, unknown>) {
  const reconcileSendAttempt = vi.fn().mockResolvedValue(result);
  vi.stubGlobal('window', { telegram: { reconcileSendAttempt } });
  return reconcileSendAttempt;
}

describe('immediate send reconciliation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('accepts an album only when every attachment has a distinct confirmed message ID', async () => {
    const reconcileSendAttempt = setReconciliationResult({
      success: true,
      state: 'sent',
      telegramMessageId: 42,
      telegramMessageIds: [42, 43],
    });

    await expect(reconcileImmediateSendAttempt('attempt-1', 2)).resolves.toMatchObject({
      state: 'sent',
      telegramMessageId: 42,
      telegramMessageIds: [42, 43],
    });
    expect(reconcileSendAttempt).toHaveBeenCalledWith({ idempotencyKey: 'attempt-1', attachmentCount: 2 });
  });

  it('keeps an incomplete album result unknown', async () => {
    setReconciliationResult({
      success: true,
      state: 'sent',
      telegramMessageId: 42,
      telegramMessageIds: [42],
    });

    await expect(reconcileImmediateSendAttempt('attempt-1', 2)).resolves.toMatchObject({ state: 'unknown' });
  });

  it('keeps duplicate message IDs unknown', async () => {
    setReconciliationResult({
      success: true,
      state: 'sent',
      telegramMessageId: 42,
      telegramMessageIds: [42, '42'],
    });

    await expect(reconcileImmediateSendAttempt('attempt-1', 2)).resolves.toMatchObject({ state: 'unknown' });
  });

  it.each([
    { telegramMessageId: 0, telegramMessageIds: [0, 43] },
    { telegramMessageId: 42, telegramMessageIds: [42, 'not-an-id'] },
    { telegramMessageId: 41, telegramMessageIds: [42, 43] },
  ])('keeps invalid or inconsistent IDs unknown: %j', async (ids) => {
    setReconciliationResult({ success: true, state: 'sent', ...ids });

    await expect(reconcileImmediateSendAttempt('attempt-1', 2)).resolves.toMatchObject({ state: 'unknown' });
  });

  it('accepts a confirmed single-message send with its scalar ID', async () => {
    setReconciliationResult({
      success: true,
      state: 'sent',
      telegramMessageId: 42,
    });

    await expect(reconcileImmediateSendAttempt('attempt-1')).resolves.toMatchObject({
      state: 'sent',
      telegramMessageId: 42,
      telegramMessageIds: [42],
    });
  });
});
