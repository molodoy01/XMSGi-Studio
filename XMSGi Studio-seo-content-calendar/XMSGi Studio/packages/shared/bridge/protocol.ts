import type { StudioSchedulerActions, StudioSchedulerRuntime } from './types';

export const BRIDGE_PROTOCOL_VERSION = 1 as const;
export type BridgeProtocolVersion = typeof BRIDGE_PROTOCOL_VERSION;

export function createStudioSchedulerRuntime(
  actions: StudioSchedulerActions,
  showNotification: StudioSchedulerRuntime['showNotification'],
): StudioSchedulerRuntime {
  return {
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
    ...actions,
    showNotification,
  };
}