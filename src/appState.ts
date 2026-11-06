import type { ProductView } from './lib/productView';

export type AppRoute = '/' | '/settings';
export type AppAccountId = 'account-1' | 'account-2';
export type AppActionType = 'send-now' | 'schedule' | 'draft';
export type MessageStatus = 'draft' | 'preview' | 'sending' | 'scheduled' | 'sent' | 'failed' | 'cancelled';
export type AppOperationType = 'send-now' | 'schedule' | 'reschedule' | 'cancel' | 'retry' | 'clear' | 'save-draft';
export type AppOperationStatus = 'idle' | 'loading' | 'queued' | 'sent' | 'failed' | 'cancelled';
export type AppOperationSource = 'planner' | 'studio' | 'history';

export type MessageSession = {
  status: MessageStatus;
  action: AppActionType;
  text: string;
  attachments: string[];
  entities: unknown[];
  chatId: string | null;
  lastOperationId: string | null;
};

export type AppOperation = {
  id: string;
  type: AppOperationType;
  status: AppOperationStatus;
  source: AppOperationSource;
  chatId: string | null;
  messageText: string;
  createdAt: number;
  error: string | null;
};

export type AppState = {
  route: AppRoute;
  productView: ProductView;
  activeAccountId: AppAccountId;
  selectedChatId: string | null;
  currentAction: AppActionType;
  messageSession: MessageSession;
  currentOperation: AppOperation | null;
  operations: AppOperation[];
};

export type AppAction =
  | { type: 'SET_ROUTE'; route: AppRoute }
  | { type: 'SET_PRODUCT_VIEW'; view: ProductView }
  | { type: 'SET_ACTIVE_ACCOUNT'; accountId: AppAccountId }
  | { type: 'SET_SELECTED_CHAT'; chatId: string | null }
  | { type: 'SET_CURRENT_ACTION'; action: AppActionType }
  | { type: 'SET_MESSAGE_STATUS'; status: MessageStatus }
  | { type: 'SET_MESSAGE_ACTION'; action: AppActionType }
  | { type: 'SET_MESSAGE_DRAFT'; text: string; attachments?: string[]; entities?: unknown[]; chatId?: string | null }
  | { type: 'SET_CURRENT_OPERATION'; operation: AppOperation | null }
  | { type: 'APPEND_OPERATION'; operation: AppOperation }
  | { type: 'UPDATE_OPERATION'; operationId: string; status?: AppOperationStatus; error?: string | null }
  | { type: 'CLEAR_MESSAGE_SESSION' }
  | { type: 'CLEAR_OPERATIONS' };

export function createMessageSession({
  text = '',
  attachments = [],
  entities = [],
  chatId = null,
  status = 'draft',
  action = 'schedule',
  lastOperationId = null,
}: Partial<MessageSession> = {}): MessageSession {
  return {
    status,
    action,
    text,
    attachments,
    entities,
    chatId,
    lastOperationId,
  };
}

export function createInitialAppState({
  route,
  productView,
  activeAccountId = 'account-1',
  selectedChatId = null,
  currentAction = 'schedule',
  messageSession = createMessageSession({
    action: currentAction,
  }),
}: {
  route: AppRoute;
  productView: ProductView;
  activeAccountId?: AppAccountId;
  selectedChatId?: string | null;
  currentAction?: AppActionType;
  messageSession?: MessageSession;
}): AppState {
  return {
    route,
    productView,
    activeAccountId,
    selectedChatId,
    currentAction,
    messageSession,
    currentOperation: null,
    operations: [],
  };
}

export function applyMessageDraftSnapshot(state: AppState, draft: Partial<MessageSession>): AppState {
  return appStateReducer(state, {
    type: 'SET_MESSAGE_DRAFT',
    text: draft.text ?? state.messageSession.text,
    attachments: draft.attachments ?? state.messageSession.attachments,
    entities: draft.entities ?? state.messageSession.entities,
    chatId: draft.chatId ?? state.messageSession.chatId,
  });
}

export function transitionMessageState(state: AppState, next: Partial<MessageSession>): AppState {
  const merged = {
    ...state.messageSession,
    ...next,
  };

  return {
    ...state,
    messageSession: merged,
    currentAction: merged.action,
  };
}

export function appStateReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_ROUTE':
      return {
        ...state,
        route: action.route,
      };
    case 'SET_PRODUCT_VIEW':
      return {
        ...state,
        productView: action.view,
      };
    case 'SET_ACTIVE_ACCOUNT':
      return {
        ...state,
        activeAccountId: action.accountId,
      };
    case 'SET_SELECTED_CHAT':
      return {
        ...state,
        selectedChatId: action.chatId,
        messageSession: {
          ...state.messageSession,
          chatId: action.chatId,
        },
      };
    case 'SET_CURRENT_ACTION':
      return {
        ...state,
        currentAction: action.action,
        messageSession: {
          ...state.messageSession,
          action: action.action,
        },
      };
    case 'SET_MESSAGE_STATUS':
      return {
        ...state,
        messageSession: {
          ...state.messageSession,
          status: action.status,
        },
      };
    case 'SET_MESSAGE_ACTION':
      return {
        ...state,
        currentAction: action.action,
        messageSession: {
          ...state.messageSession,
          action: action.action,
        },
      };
    case 'SET_MESSAGE_DRAFT':
      return {
        ...state,
        messageSession: {
          ...state.messageSession,
          text: action.text,
          attachments: action.attachments ?? state.messageSession.attachments,
          entities: action.entities ?? state.messageSession.entities,
          chatId: action.chatId === undefined ? state.messageSession.chatId : action.chatId,
        },
      };
    case 'SET_CURRENT_OPERATION':
      return {
        ...state,
        currentOperation: action.operation,
      };
    case 'APPEND_OPERATION':
      return {
        ...state,
        currentOperation: action.operation,
        operations: [action.operation, ...state.operations],
      };
    case 'UPDATE_OPERATION': {
      const nextOperations = state.operations.map((operation) => operation.id === action.operationId
        ? {
            ...operation,
            ...(action.status !== undefined ? { status: action.status } : {}),
            ...(action.error !== undefined ? { error: action.error } : {}),
          }
        : operation);

      const nextCurrentOperation = state.currentOperation && state.currentOperation.id === action.operationId
        ? {
            ...state.currentOperation,
            ...(action.status !== undefined ? { status: action.status } : {}),
            ...(action.error !== undefined ? { error: action.error } : {}),
          }
        : state.currentOperation;

      return {
        ...state,
        operations: nextOperations,
        currentOperation: nextCurrentOperation,
      };
    }
    case 'CLEAR_MESSAGE_SESSION':
      return {
        ...state,
        messageSession: {
          status: 'draft',
          action: state.currentAction,
          text: '',
          attachments: [],
          entities: [],
          chatId: null,
          lastOperationId: null,
        },
      };
    case 'CLEAR_OPERATIONS':
      return {
        ...state,
        currentOperation: null,
        operations: [],
      };
    default:
      return state;
  }
}

export function createOperation({
  type,
  source,
  messageText,
  chatId,
  id = `${type}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
}: {
  type: AppOperationType;
  source: AppOperationSource;
  messageText: string;
  chatId: string | null;
  id?: string;
}): AppOperation {
  return {
    id,
    type,
    status: 'idle',
    source,
    chatId,
    messageText,
    createdAt: Date.now(),
    error: null,
  };
}
