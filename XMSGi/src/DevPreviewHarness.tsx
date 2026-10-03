import { useState } from 'react';
import type { Chat, NotificationState } from '@/types';
import type { StudioSchedulerRuntime } from '$studio';
import { AppShell, StudioMount } from './workspace';
import { DRAFT_STORE_SCHEMA_VERSION } from '../../Studio/Studio module/src/lib/draftStoreVersion';

const demoChats: Chat[] = [
  { id: 'dev-saved', name: 'Saved Messages', type: 'private' },
  { id: 'dev-group', name: 'Studio Team', username: 'studio_team', type: 'group' },
  { id: 'dev-channel', name: 'XMSGi Updates', username: 'xmsgi_updates', type: 'channel' },
];

const DEV_DRAFT_STORE_KEY = 'xmsgi-draft-store-fallback';
const emptyNotification: NotificationState = { message: '', title: '', type: 'info', visible: false };
const noOperation = () => {};

try {
  const hasDraftFallback = window.localStorage.getItem(DEV_DRAFT_STORE_KEY)
    || window.localStorage.getItem('awaitmsg-draft-store-fallback');
  if (!hasDraftFallback) {
    window.localStorage.setItem(DEV_DRAFT_STORE_KEY, JSON.stringify({
      schemaVersion: DRAFT_STORE_SCHEMA_VERSION,
      migrationVersion: 1,
      savedDrafts: [],
      workspaceDraft: null,
    }));
  }
} catch {
  // Keep the dev preview usable if browser storage is unavailable.
}
const demoScheduler: StudioSchedulerRuntime = {
  upcoming: [],
  sent: [],
  scheduling: false,
  successPulse: false,
  lastAction: null,
  revealingId: null,
  cancelingIds: new Set(),
  sendingIds: new Set(),
  publishingDraft: false,
  notification: emptyNotification,
  closeNotification: noOperation,
  handleSchedule: noOperation,
  handleSendDraftNow: async () => false,
  handleSendNow: noOperation,
  handleDeleteMessage: noOperation,
  handleClearSent: noOperation,
  handleClearAll: async () => {},
  handleCancelMessage: async () => {},
};

export default function DevPreviewHarness() {
  const [isConfirmingLogout, setIsConfirmingLogout] = useState(false);
  const [, setShowAuthForm] = useState(false);

  return (
    <AppShell
      view="studio"
      onViewChange={noOperation}
      connected={true}
      authBusy={false}
      isConfirmingLogout={isConfirmingLogout}
      setIsConfirmingLogout={setIsConfirmingLogout}
      setShowAuthForm={setShowAuthForm}
      handleDisconnect={async () => {}}
      handleForgetAccount={async () => {}}
      onOpenSettings={noOperation}
      historyRecords={[]}
      onHistoryCancel={noOperation}
      onHistoryReschedule={noOperation}
      onHistorySendNow={noOperation}
      onHistoryDelete={noOperation}
      onHistoryOpenDraft={noOperation}
      onHistoryClearSent={noOperation}
      onHistoryClearAll={noOperation}
    >
      <div className="product-view is-active">
        <StudioMount
          connected={false}
          activeAccountId="account-1"
          chats={demoChats}
          scheduler={demoScheduler}
        />
      </div>
    </AppShell>
  );
}