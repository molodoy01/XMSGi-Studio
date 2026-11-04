import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  classifyTelegramError,
  createTelegramRateLimitInterceptor,
  getTelegramErrorText,
  isInvalidMediaAlbumError,
  isInvalidTelegramSessionError,
  MAX_FLOOD_WAIT_SECONDS,
  normalizeRateLimitError,
} from './telegram-errors.cjs';

function createFloodError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function createDeferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

describe('Telegram account rate-limit interceptor', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('normalizes FLOOD_WAIT_10 into a ten-second flood wait', () => {
    const normalized = normalizeRateLimitError(createFloodError('FLOOD_WAIT_10'));

    expect(normalized?.type).toBe('flood');
    expect(normalized?.error).toMatchObject({
      code: 'TELEGRAM_FLOOD_WAIT',
      waitSeconds: 10,
    });
  });

  it('tracks a long FloodWait deadline without shortening it', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const interceptor = createTelegramRateLimitInterceptor();

    const state = interceptor.pauseAccount('account-a', 3600);

    expect(state).toMatchObject({
      accountId: 'account-a',
      paused: true,
      pausedUntil: 4_600_000,
      remainingMs: 3_600_000,
      waitSeconds: 3600,
    });
  });

  it('tracks a very large FloodWait without Infinity or timer overflow', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const interceptor = createTelegramRateLimitInterceptor();
    const waitSeconds = '9'.repeat(308);

    const state = interceptor.pauseAccount('account-a', waitSeconds);

    expect(state).toMatchObject({
      accountId: 'account-a',
      paused: true,
      pausedUntil: null,
      remainingMs: Number.MAX_SAFE_INTEGER,
      waitSeconds: Math.ceil(Number.MAX_SAFE_INTEGER / 1000),
    });
    expect(state.pausedUntilText).not.toBe('Infinity');
    expect(state.remainingMsText).not.toBe('Infinity');
    expect(BigInt(state.waitSecondsText)).toBe(BigInt(waitSeconds));
    expect(vi.getTimerCount()).toBe(1);
  });

  it('chunks a wait above the Node timer limit while staying below the app maximum', () => {
    const delays = [];
    const interceptor = createTelegramRateLimitInterceptor({
      now: () => 0,
      setTimeout: (callback, delay) => {
        delays.push(delay);
        return { callback };
      },
      clearTimeout: vi.fn(),
    });

    interceptor.pauseAccount('account-a', 2_147_484);

    expect(delays[0]).toBe(2_147_483_647);
    expect(interceptor.getState('account-a').paused).toBe(true);
  });

  it.each([
    [`FLOOD_WAIT_${MAX_FLOOD_WAIT_SECONDS + 1}`, 'TELEGRAM_FLOOD_WAIT_EXCEEDS_MAX'],
    [`FLOOD_WAIT_${'1'.padEnd(307, '0')}`, 'TELEGRAM_FLOOD_WAIT_EXCEEDS_MAX'],
    [`FLOOD_WAIT_${'9'.repeat(306)}`, 'TELEGRAM_FLOOD_WAIT_EXCEEDS_MAX'],
    [`FLOOD_WAIT_${'9'.repeat(309)}`, 'TELEGRAM_FLOOD_WAIT_EXCEEDS_MAX'],
    ['FLOOD_WAIT_0', 'TELEGRAM_FLOOD_WAIT_INVALID'],
    ['FLOOD_WAIT_-1', 'TELEGRAM_FLOOD_WAIT_INVALID'],
    ['FLOOD_WAIT_not-a-number', 'TELEGRAM_FLOOD_WAIT_INVALID'],
  ])('rejects unsafe or malformed %s without creating a pause', async (code, expectedCode) => {
    const interceptor = createTelegramRateLimitInterceptor();

    await expect(interceptor.run('account-a', () => { throw createFloodError(code); }))
      .rejects.toMatchObject({ code: expectedCode });
    expect(interceptor.getState('account-a').paused).toBe(false);
  });

  it('bounds repeated FloodWait retries, extends the pause, and uses one timer', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const interceptor = createTelegramRateLimitInterceptor();
    let attempts = 0;
    const operation = vi.fn(() => {
      attempts += 1;
      if (attempts === 1) throw createFloodError('FLOOD_WAIT_10');
      if (attempts === 2) throw createFloodError('FLOOD_WAIT_60');
      return 'completed';
    });

    const result = interceptor.run('account-a', operation);
    const rejected = expect(result).rejects.toMatchObject({
      code: 'TELEGRAM_FLOOD_WAIT',
      waitSeconds: 60,
      category: 'flood',
      retryable: true,
    });
    await flushPromises();
    expect(operation).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(operation).toHaveBeenCalledTimes(2);
    expect(interceptor.getState('account-a').pausedUntil).toBe(70_000);
    expect(vi.getTimerCount()).toBe(1);
    await rejected;

    await vi.advanceTimersByTimeAsync(59_999);
    expect(operation).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(operation).toHaveBeenCalledTimes(2);
    expect(interceptor.getState('account-a').paused).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('holds multiple jobs for one account behind the same pause', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const interceptor = createTelegramRateLimitInterceptor();
    const firstJob = vi.fn()
      .mockImplementationOnce(() => { throw createFloodError('FLOOD_WAIT_10'); })
      .mockResolvedValue('first');
    const secondJob = vi.fn().mockResolvedValue('second');

    const firstResult = interceptor.run('account-a', firstJob);
    await flushPromises();
    const secondResult = interceptor.run('account-a', secondJob);
    await flushPromises();

    expect(firstJob).toHaveBeenCalledTimes(1);
    expect(secondJob).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(10_000);
    await expect(firstResult).resolves.toBe('first');
    await expect(secondResult).resolves.toBe('second');
    expect(firstJob).toHaveBeenCalledTimes(2);
    expect(secondJob).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('queues whole send and schedule jobs through a FloodWait pause', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const interceptor = createTelegramRateLimitInterceptor();
    const events = [];
    const sendRequest = vi.fn()
      .mockImplementationOnce(() => {
        events.push('send-flood');
        throw createFloodError('FLOOD_WAIT_10');
      })
      .mockImplementationOnce(() => {
        events.push('send-retry');
        return 'sent';
      });
    const scheduleRequest = vi.fn(() => {
      events.push('schedule');
      return 'scheduled';
    });
    const sendJob = interceptor.enqueue('account-a', () => interceptor.run('account-a', sendRequest));
    await flushPromises();
    const scheduleJob = interceptor.enqueue('account-a', () => interceptor.run('account-a', scheduleRequest));
    await flushPromises();

    expect(events).toEqual(['send-flood']);
    expect(scheduleRequest).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(10_000);
    await expect(sendJob).resolves.toBe('sent');
    await expect(scheduleJob).resolves.toBe('scheduled');
    expect(events).toEqual(['send-flood', 'send-retry', 'schedule']);
    expect(scheduleRequest).toHaveBeenCalledOnce();
  });

  it('releases the publish queue after cancellation or another operation error', async () => {
    const interceptor = createTelegramRateLimitInterceptor();
    const cancelled = Object.assign(new Error('Telegram request was cancelled.'), { code: 'TELEGRAM_REQUEST_CANCELLED' });
    const firstJob = vi.fn(() => { throw cancelled; });
    const secondJob = vi.fn().mockResolvedValue('next job');
    const firstResult = interceptor.enqueue('account-a', firstJob);
    const secondResult = interceptor.enqueue('account-a', secondJob);

    await expect(firstResult).rejects.toMatchObject({ code: 'TELEGRAM_REQUEST_CANCELLED' });
    await expect(secondResult).resolves.toBe('next job');
    expect(firstJob).toHaveBeenCalledOnce();
    expect(secondJob).toHaveBeenCalledOnce();
  });

  it('keeps send queues independent between Telegram accounts', async () => {
    const interceptor = createTelegramRateLimitInterceptor();
    const firstGate = createDeferred();
    const accountAJob = vi.fn(() => firstGate.promise);
    const accountBJob = vi.fn().mockResolvedValue('account-b');
    const accountA = interceptor.enqueue('account-a', accountAJob);
    const accountB = interceptor.enqueue('account-b', accountBJob);

    await expect(accountB).resolves.toBe('account-b');
    expect(accountAJob).toHaveBeenCalledOnce();
    firstGate.resolve('account-a');
    await expect(accountA).resolves.toBe('account-a');
  });

  it('keeps pauses independent between Telegram accounts', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const interceptor = createTelegramRateLimitInterceptor();
    const accountA = vi.fn()
      .mockImplementationOnce(() => { throw createFloodError('FLOOD_WAIT_10'); })
      .mockResolvedValue('account-a');
    const accountB = vi.fn().mockResolvedValue('account-b');

    const accountAResult = interceptor.run('account-a', accountA);
    await flushPromises();
    await expect(interceptor.run('account-b', accountB)).resolves.toBe('account-b');

    expect(interceptor.getState('account-a').paused).toBe(true);
    expect(interceptor.getState('account-b').paused).toBe(false);
    expect(accountA).toHaveBeenCalledTimes(1);
    expect(accountB).toHaveBeenCalledTimes(1);
    expect(interceptor.getSnapshot()).toEqual([
      expect.objectContaining({ accountId: 'account-a', pausedUntil: 10_000 }),
    ]);

    await vi.advanceTimersByTimeAsync(10_000);
    await expect(accountAResult).resolves.toBe('account-a');
  });

  it('automatically resumes waiters at the account deadline', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const interceptor = createTelegramRateLimitInterceptor();
    interceptor.pauseAccount('account-a', 10);
    let resumed = false;
    const waiting = interceptor.waitUntilAvailable('account-a').then(() => { resumed = true; });

    await vi.advanceTimersByTimeAsync(9_999);
    expect(resumed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await waiting;

    expect(resumed).toBe(true);
    expect(interceptor.getState('account-a').paused).toBe(false);
  });

  it('keeps SLOWMODE_WAIT separate from account FloodWait pauses', async () => {
    vi.useFakeTimers();
    const interceptor = createTelegramRateLimitInterceptor();
    const error = createFloodError('SLOWMODE_WAIT_12');

    await expect(interceptor.run('account-a', () => { throw error; })).rejects.toMatchObject({
      code: 'TELEGRAM_SLOWMODE_WAIT',
      waitSeconds: 12,
    });

    expect(interceptor.getState('account-a').paused).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves ordinary auth, network, and permission errors', async () => {
    const interceptor = createTelegramRateLimitInterceptor();
    const errors = [
      Object.assign(new Error('AUTH_KEY_INVALID'), { code: 'AUTH_KEY_INVALID' }),
      Object.assign(new Error('Network timeout'), { code: 'ETIMEDOUT' }),
      Object.assign(new Error('CHAT_ADMIN_REQUIRED'), { code: 'CHAT_ADMIN_REQUIRED' }),
    ];

    for (const error of errors) {
      await expect(interceptor.run('account-a', () => { throw error; })).rejects.toBe(error);
    }

    expect(interceptor.getState('account-a').paused).toBe(false);
  });

  it.each([
    [Object.assign(new Error('AUTH_KEY_INVALID'), { code: 'AUTH_KEY_INVALID' }), 'auth', false],
    [Object.assign(new Error('CHAT_WRITE_FORBIDDEN'), { code: 'CHAT_WRITE_FORBIDDEN' }), 'permission', false],
    [Object.assign(new Error('Telegram request was cancelled.'), { code: 'TELEGRAM_REQUEST_CANCELLED' }), 'cancelled', false],
    [Object.assign(new Error('Network timeout'), { code: 'ETIMEDOUT' }), 'network', true],
    [new Error('unexpected failure'), 'unknown', false],
  ])('classifies %s as %s', (error, category, retryable) => {
    expect(classifyTelegramError(error)).toMatchObject({ category, retryable });
  });

  it('detects invalid Telegram sessions from structured error fields', () => {
    expect(getTelegramErrorText({ code: 'AUTH_KEY_INVALID', message: 'Session expired' }))
      .toBe('AUTH_KEY_INVALID Session expired');
    expect(isInvalidTelegramSessionError({ errorCode: 'AUTH_KEY_UNREGISTERED' })).toBe(true);
    expect(isInvalidTelegramSessionError({ message: 'Telegram session expired' })).toBe(true);
    expect(isInvalidTelegramSessionError({ code: 'ETIMEDOUT', message: 'Request timed out' })).toBe(false);
    expect(isInvalidTelegramSessionError(null)).toBe(false);
  });

  it('recognizes invalid album requests without matching unrelated media errors', () => {
    expect(isInvalidMediaAlbumError({
      code: 'MEDIA_INVALID',
      request: { className: 'messages.SendMultiMedia' },
    })).toBe(true);
    expect(isInvalidMediaAlbumError(Object.assign(new Error('Media invalid'), {
      request: { className: 'messages.SendMultiMedia' },
    }))).toBe(true);
    expect(isInvalidMediaAlbumError({ code: 'MEDIA_INVALID', request: { className: 'messages.SendMedia' } })).toBe(false);
    expect(isInvalidMediaAlbumError({ code: 'NETWORK_ERROR', request: { className: 'messages.SendMultiMedia' } })).toBe(false);
    expect(isInvalidMediaAlbumError(null)).toBe(false);
  });
});