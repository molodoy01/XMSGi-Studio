import { describe, expect, it } from 'vitest';
import {
  appStateReducer,
  applyMessageDraftSnapshot,
  createInitialAppState,
  createMessageSession,
  transitionMessageState,
} from './appState';

describe('appStateReducer', () => {
  it('switches the active product view and route from a single state source', () => {
    const initial = createInitialAppState({
      route: '/',
      productView: 'planner',
      activeAccountId: 'account-1',
    });

    const next = appStateReducer(initial, { type: 'SET_ROUTE', route: '/settings' });
    const selected = appStateReducer(next, { type: 'SET_SELECTED_CHAT', chatId: 'chat-7' });
    const studio = appStateReducer(selected, { type: 'SET_PRODUCT_VIEW', view: 'studio' });

    expect(studio.route).toBe('/settings');
    expect(studio.productView).toBe('studio');
    expect(studio.activeAccountId).toBe('account-1');
    expect(studio.selectedChatId).toBe('chat-7');
    expect(studio.messageSession.chatId).toBe('chat-7');
  });

  it('keeps the draft lifecycle and action in one message session', () => {
    const initial = createInitialAppState({
      route: '/',
      productView: 'planner',
      activeAccountId: 'account-1',
    });

    const draftReady = appStateReducer(initial, {
      type: 'SET_MESSAGE_DRAFT',
      text: 'hello world',
      attachments: ['a.png'],
      entities: [{ offset: 0, length: 11, type: 'bold' }],
      chatId: 'chat-42',
    });

    const scheduled = appStateReducer(draftReady, { type: 'SET_MESSAGE_ACTION', action: 'schedule' });
    const sending = appStateReducer(scheduled, { type: 'SET_MESSAGE_STATUS', status: 'scheduled' });

    expect(sending.messageSession.text).toBe('hello world');
    expect(sending.messageSession.action).toBe('schedule');
    expect(sending.messageSession.status).toBe('scheduled');
    expect(sending.messageSession.chatId).toBe('chat-42');
  });

  it('clears a stale chat id when the selected chat is cleared', () => {
    const initial = createInitialAppState({
      route: '/',
      productView: 'planner',
      messageSession: createMessageSession({ chatId: 'chat-42' }),
    });

    const cleared = appStateReducer(initial, {
      type: 'SET_MESSAGE_DRAFT',
      text: initial.messageSession.text,
      attachments: initial.messageSession.attachments,
      entities: initial.messageSession.entities,
      chatId: null,
    });

    expect(cleared.messageSession.chatId).toBeNull();
    expect(appStateReducer(cleared, {
      type: 'SET_MESSAGE_DRAFT',
      text: cleared.messageSession.text,
      attachments: cleared.messageSession.attachments,
      entities: cleared.messageSession.entities,
      chatId: null,
    }).messageSession.chatId).toBeNull();
  });

  it('clears the message session chat id when the selected chat is cleared', () => {
    const initial = createInitialAppState({
      route: '/',
      productView: 'planner',
      selectedChatId: 'chat-42',
      messageSession: createMessageSession({ chatId: 'chat-42' }),
    });

    const cleared = appStateReducer(initial, { type: 'SET_SELECTED_CHAT', chatId: null });

    expect(cleared.selectedChatId).toBeNull();
    expect(cleared.messageSession.chatId).toBeNull();
  });

  it('stores a single unified operation contract for schedule and cancel flows', () => {
    const initial = createInitialAppState({
      route: '/',
      productView: 'planner',
      activeAccountId: 'account-1',
    });

    const scheduledOperation = appStateReducer(initial, {
      type: 'APPEND_OPERATION',
      operation: {
        id: 'op-1',
        type: 'schedule',
        status: 'queued',
        source: 'planner',
        chatId: 'chat-42',
        messageText: 'hello world',
        createdAt: 123,
        error: null,
      },
    });

    const cancelled = appStateReducer(scheduledOperation, {
      type: 'UPDATE_OPERATION',
      operationId: 'op-1',
      status: 'cancelled',
      error: 'user cancelled',
    });

    expect(cancelled.currentOperation?.status).toBe('cancelled');
    expect(cancelled.operations[0].status).toBe('cancelled');
    expect(cancelled.operations[0].error).toBe('user cancelled');
  });

  it('uses a single message-session helper for draft and scheduled transitions', () => {
    const initial = createInitialAppState({
      route: '/',
      productView: 'planner',
      activeAccountId: 'account-1',
    });

    const draftReady = applyMessageDraftSnapshot(initial, {
      text: 'final message',
      attachments: ['clip.pdf'],
      entities: [{ offset: 0, length: 13, type: 'bold' }],
      chatId: 'chat-99',
    });

    const scheduled = transitionMessageState(draftReady, {
      status: 'scheduled',
      action: 'schedule',
      lastOperationId: 'op-99',
    });

    expect(scheduled.messageSession.text).toBe('final message');
    expect(scheduled.messageSession.status).toBe('scheduled');
    expect(scheduled.messageSession.lastOperationId).toBe('op-99');
  });
});
