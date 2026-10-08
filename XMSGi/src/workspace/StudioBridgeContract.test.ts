import { describe, expect, it, vi } from 'vitest';
import {
  BRIDGE_PROTOCOL_VERSION,
  createStudioSchedulerRuntime,
  createBridgeValidationError,
  normalizeTelegramBridgeError,
  type StudioSchedulerActions,
} from '@shared/bridge';
import type { NotificationState } from '@/types';

describe('Studio bridge contract', () => {
  it('versions the runtime and preserves host scheduler callbacks', () => {
    const handleCancelMessages = vi.fn(async () => true);
    const actions: StudioSchedulerActions = {
      upcoming: [],
      sent: [],
      scheduling: false,
      successPulse: false,
      lastAction: null,
      revealingId: null,
      cancelingIds: new Set(),
      sendingIds: new Set(),
      publishingDraft: false,
      handleSchedule: vi.fn(),
      handleSendDraftNow: vi.fn(async () => true),
      handleSendNow: vi.fn(),
      handleDeleteMessage: vi.fn(),
      handleClearSent: vi.fn(),
      handleCancelMessage: vi.fn(async () => true),
      handleCancelMessages,
    };
    const errorDetails = normalizeTelegramBridgeError({
      error: 'Wait before retrying.',
      code: 'FLOOD_WAIT_12',
      category: 'flood',
      retryable: true,
      waitSeconds: 12,
    }, 'publish', 'Publish failed.');
    const notification: NotificationState = {
      message: '',
      title: '',
      type: 'info',
      visible: false,
      errorDetails,
    };
    const closeNotification = vi.fn();

    const runtime = createStudioSchedulerRuntime(actions, notification, closeNotification);

    expect(runtime.protocolVersion).toBe(BRIDGE_PROTOCOL_VERSION);
    expect(runtime.handleCancelMessages).toBe(handleCancelMessages);
    expect(runtime.closeNotification).toBe(closeNotification);
    expect(runtime.notification.errorDetails).toBe(errorDetails);
  });

  it('normalizes existing Host error metadata without reclassifying it', () => {
    expect(normalizeTelegramBridgeError({
      error: 'Wait before retrying.',
      code: 'FLOOD_WAIT_12',
      category: 'flood',
      retryable: true,
      waitSeconds: 12,
    }, 'publish', 'Publish failed.')).toEqual({
      operation: 'publish',
      category: 'flood',
      retryable: true,
      message: 'Wait before retrying.',
      code: 'FLOOD_WAIT_12',
      waitSeconds: 12,
    });
    expect(normalizeTelegramBridgeError({ error: 'Request cancelled.', cancelled: true }, 'cancel', 'Cancel failed.'))
      .toMatchObject({ operation: 'cancel', category: 'cancelled', retryable: false });
    expect(normalizeTelegramBridgeError('unexpected failure', 'publish', 'Publish failed.'))
      .toMatchObject({ operation: 'publish', category: 'unknown', message: 'unexpected failure' });
    expect(createBridgeValidationError('Choose a future time.', 'SCHEDULE_NOT_IN_FUTURE'))
      .toEqual({ operation: 'validate', category: 'validation', retryable: false, message: 'Choose a future time.', code: 'SCHEDULE_NOT_IN_FUTURE' });
  });
});