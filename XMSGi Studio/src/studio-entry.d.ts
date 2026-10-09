declare module '$studio' {
  import type { ComponentType } from 'react';
  import type { ScheduledMessage } from '@shared/types';
  import type { StudioBridgeProps } from '@shared/bridge';

  export type { DraftColor, PersistedDraftStore, SavedDraft, SavedDraftAttachment } from '@shared/types';
  export type { StudioBridgeProps, StudioSchedulerRuntime } from '@shared/bridge';

  export type StudioScheduledMessage = ScheduledMessage;

  const StudioApp: ComponentType<StudioBridgeProps>;

  export default StudioApp;
}