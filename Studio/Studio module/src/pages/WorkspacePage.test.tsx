import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Chat, NotificationState, ScheduledMessage } from '@/types';
import { readWorkspaceDraftStoreFallback, WorkspacePage, writeWorkspaceDraftStoreFallback } from './WorkspacePage';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const chatA: Chat = {
  id: 'chat-1',
  name: 'Alpha Team',
  username: 'alpha',
  type: 'group',
  avatarDataUrl: '',
};

const baseNotification: NotificationState = {
  message: '',
  type: 'info',
  title: '',
  visible: false,
};

let inMemoryDraftStore: any;

async function renderWorkspacePage(overrides: Partial<React.ComponentProps<typeof WorkspacePage>> = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);

  const defaults: React.ComponentProps<typeof WorkspacePage> = {
    connected: false,
    chats: [chatA],
    selectedChat: chatA,
    setSelectedChat: vi.fn(),
    onAddChat: vi.fn(),
    onRemoveChat: vi.fn(),
    removeModal: { show: false, chat: null },
    setRemoveModal: vi.fn(),
    confirmRemoveChat: vi.fn(),
    date: '2026-01-10',
    time: '09:00',
    scheduling: false,
    successPulse: false,
    lastAction: null,
    notification: baseNotification,
    closeNotification: vi.fn(),
    upcoming: [],
    sent: [],
    activeTab: 'upcoming',
    revealingId: null,
    cancelingIds: new Set(),
    sendingIds: new Set(),
    setDate: vi.fn(),
    setTime: vi.fn(),
    handleSchedule: vi.fn(),
    handleSendDraftNow: vi.fn().mockResolvedValue(true),
    handleSendNow: vi.fn(),
    handleDeleteMessage: vi.fn(),
    handleClearSent: vi.fn(),
    handleClearAll: vi.fn(),
    setActiveTab: vi.fn(),
    publishingDraft: false,
    handleCancelMessage: vi.fn(),
  };

  await act(async () => {
    root.render(<WorkspacePage {...defaults} {...overrides} />);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

  return {
    root,
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

  async function openDraftsStage() {
    await act(async () => {
      (document.querySelector('.workspace-page-publish-menu-toggle') as HTMLButtonElement).click();
    });
    const saveDraftOption = Array.from(document.querySelectorAll('.workspace-page-publish-option'))
      .find((button) => button.textContent?.trim() === 'Save draft') as HTMLButtonElement;
    await act(async () => {
      saveDraftOption.click();
    });
    const draftButton = Array.from(document.querySelectorAll('.workspace-page-action-left-group > button'))
      .find((button) => button.textContent?.trim() === 'Draft') as HTMLButtonElement;
    await act(async () => {
      draftButton.click();
    });
  }

describe('WorkspacePage main-screen flows', () => {
  it('falls back to localStorage when the Electron bridge is unavailable', async () => {
    const store = {
      schemaVersion: 2,
      migrationVersion: 1,
      savedDrafts: [],
      workspaceDraft: { body: 'fallback content', savedAt: '12:00' },
    };

    writeWorkspaceDraftStoreFallback(store);

    expect(readWorkspaceDraftStoreFallback()).toEqual(store);

    const { unmount } = await renderWorkspacePage();

    expect(document.querySelector('.workspace-page-publish-menu-toggle')).not.toBeNull();
    unmount();
  });

  it('opens the compact schedule shell by default for the active preview state', async () => {
    document.body.dataset.livePreview = 'true';

    const { unmount } = await renderWorkspacePage();

    expect(document.querySelector('.workspace-page-rich-text-schedule-stage.is-active')).not.toBeNull();
    expect(document.querySelector('.workspace-page-schedule-empty-panel')).not.toBeNull();

    document.body.removeAttribute('data-live-preview');
    unmount();
  });

  it('allows selecting publish modes before the message is ready without executing them', async () => {
    localStorage.setItem('awaitmsg-workspace-draft', JSON.stringify({
      body: '',
      entities: [],
      attachments: [],
      savedAt: '12:00',
      date: '',
      time: '',
      repeatMode: 'none',
      repeatDays: [],
      repeatOccurrences: 1,
    }));
    const handleSchedule = vi.fn();
    const handleSendDraftNow = vi.fn().mockResolvedValue(true);
    const { unmount } = await renderWorkspacePage({
      chats: [],
      selectedChat: null,
      date: '',
      time: '',
      handleSchedule,
      handleSendDraftNow,
    });
    const menuToggle = document.querySelector('.workspace-page-publish-menu-toggle') as HTMLButtonElement;

    for (const label of ['Schedule', 'Save draft', 'Send now']) {
      await act(async () => {
        menuToggle.click();
      });
      const option = Array.from(document.querySelectorAll('.workspace-page-publish-option'))
        .find((button) => button.textContent?.trim() === label) as HTMLButtonElement;

      expect(option).toBeTruthy();
      expect(option.disabled).toBe(false);

      await act(async () => {
        option.click();
      });

      const primaryLabel = document.querySelector('.workspace-page-publish-trigger-main')?.textContent?.trim();
      expect(primaryLabel).toBe(label);
      expect((document.querySelector('.workspace-page-publish-main') as HTMLButtonElement).disabled).toBe(false);

      if (label === 'Schedule') {
        expect(document.querySelector('.workspace-page-rich-text-schedule-stage.is-active')).toBeNull();
        const timeButton = Array.from(document.querySelectorAll('.workspace-page-schedule-compact-button'))
          .find((button) => button.textContent?.trim() === 'Time') as HTMLButtonElement;
        expect(timeButton).toBeTruthy();
        await act(async () => {
          timeButton.click();
        });
        expect(document.querySelector('.workspace-page-rich-text-schedule-stage.is-active')).not.toBeNull();
      }

      if (label === 'Save draft') {
        expect(document.querySelector('.workspace-page-rich-text-schedule-stage.is-active')).toBeNull();
      }
    }

    await act(async () => {
      menuToggle.click();
    });
    const selectedSendOption = Array.from(document.querySelectorAll('.workspace-page-publish-option'))
      .find((button) => button.textContent?.trim() === 'Send now');
    expect(selectedSendOption?.getAttribute('aria-checked')).toBe('true');
    expect(handleSchedule).not.toHaveBeenCalled();
    expect(handleSendDraftNow).not.toHaveBeenCalled();
    expect(inMemoryDraftStore.savedDrafts).toHaveLength(0);
    unmount();
  });

  it('temporarily replaces the draft color picker with a prerequisite hint', async () => {
    localStorage.setItem('awaitmsg-workspace-draft', JSON.stringify({
      body: '',
      entities: [],
      attachments: [],
      savedAt: '12:00',
      date: '2026-01-10',
      time: '09:00',
      repeatMode: 'none',
      repeatDays: [],
      repeatOccurrences: 1,
    }));
    const { unmount } = await renderWorkspacePage();
    const menuToggle = document.querySelector('.workspace-page-publish-menu-toggle') as HTMLButtonElement;

    await act(async () => {
      menuToggle.click();
    });
    const draftOption = Array.from(document.querySelectorAll('.workspace-page-publish-option'))
      .find((button) => button.textContent?.trim() === 'Save draft') as HTMLButtonElement;
    await act(async () => {
      draftOption.click();
    });

    expect(document.querySelector('.draft-color-picker')).not.toBeNull();
    vi.useFakeTimers();
    await act(async () => {
      (document.querySelector('.workspace-page-publish-main') as HTMLButtonElement).click();
    });

    expect(document.querySelector('.workspace-page-publish-transient-feedback')?.textContent).toBe('Введите текст сообщения');
    expect(document.querySelector('.workspace-page-publish-transient-feedback')?.parentElement?.classList.contains('workspace-page-draft-footer')).toBe(true);
    expect(document.querySelector('.workspace-page-publish-footer-content')?.classList.contains('is-feedback-hidden')).toBe(true);
    expect(inMemoryDraftStore.savedDrafts).toHaveLength(0);

    const firstFeedback = document.querySelector('.workspace-page-publish-transient-feedback');
    await act(async () => {
      (document.querySelector('.workspace-page-publish-main') as HTMLButtonElement).click();
    });
    const repeatedFeedback = document.querySelector('.workspace-page-publish-transient-feedback');
    expect(repeatedFeedback?.textContent).toBe('Введите текст сообщения');
    expect(repeatedFeedback).not.toBe(firstFeedback);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(document.querySelector('.workspace-page-publish-transient-feedback')).not.toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1999);
    });
    expect(document.querySelector('.workspace-page-publish-transient-feedback')).not.toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(document.querySelector('.workspace-page-publish-transient-feedback')).toBeNull();
    expect(document.querySelector('.workspace-page-publish-footer-content')?.classList.contains('is-feedback-hidden')).toBe(false);
    expect(document.querySelector('.draft-color-picker')).not.toBeNull();
    vi.useRealTimers();
    unmount();
  });

  it('does not show footer hints for missing schedule time or optional repeat days', async () => {
    localStorage.setItem('awaitmsg-workspace-draft', JSON.stringify({
      body: 'Hello world',
      entities: [],
      attachments: [],
      savedAt: '12:00',
      date: '2026-01-10',
      time: '',
      repeatMode: 'weekly',
      repeatDays: [],
      repeatOccurrences: 1,
    }));
    const handleSchedule = vi.fn();
    const { unmount } = await renderWorkspacePage({
      date: '2026-01-10',
      time: '',
      handleSchedule,
    });
    const menuToggle = document.querySelector('.workspace-page-publish-menu-toggle') as HTMLButtonElement;

    await act(async () => {
      menuToggle.click();
    });
    const scheduleOption = Array.from(document.querySelectorAll('.workspace-page-publish-option'))
      .find((button) => button.textContent?.trim() === 'Schedule') as HTMLButtonElement;
    await act(async () => {
      scheduleOption.click();
    });
    await act(async () => {
      (document.querySelector('.workspace-page-publish-main') as HTMLButtonElement).click();
    });

    expect(document.querySelector('.workspace-page-publish-transient-feedback')).toBeNull();
    expect(handleSchedule).not.toHaveBeenCalled();
    unmount();
  });

  it('renders app notifications in the footer instead of a floating toast', async () => {
    vi.useFakeTimers();
    const closeNotification = vi.fn();
    const { unmount } = await renderWorkspacePage({
      notification: {
        ...baseNotification,
        message: 'Saved to local queue.',
        title: 'Studio',
        type: 'success',
        visible: true,
      },
      closeNotification,
    });

    expect(document.querySelector('.app-notification')).toBeNull();
    expect(document.querySelector('.workspace-page-publish-transient-feedback')?.textContent).toContain('Saved to local queue.');
    expect(document.querySelector('.workspace-page-publish-transient-feedback')?.classList.contains('is-success')).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3360);
    });
    expect(closeNotification).toHaveBeenCalledTimes(1);

    unmount();
    vi.useRealTimers();
  });

  it('keeps the queue, templates, time and repeat controls in the compact action family', async () => {
    const { unmount } = await renderWorkspacePage();

    await act(async () => {
      (document.querySelector('.workspace-page-publish-menu-toggle') as HTMLButtonElement).click();
    });

    const scheduleOption = Array.from(document.querySelectorAll('.workspace-page-publish-option'))
      .find((button) => button.textContent?.trim() === 'Schedule') as HTMLButtonElement;

    expect(scheduleOption).toBeTruthy();

    await act(async () => {
      scheduleOption.click();
    });

    const actionGroup = document.querySelector('.workspace-page-action-left-group');
    const actionButtons = Array.from(actionGroup?.querySelectorAll('button') ?? []);
    const queueButton = actionButtons.find((button) => button.textContent?.trim() === 'Queue / History') as HTMLButtonElement | undefined;
    const templateButton = actionButtons.find((button) => button.textContent?.trim() === 'Templates') as HTMLButtonElement | undefined;
    const compactGroup = document.querySelector('.workspace-page-schedule-compact-group');
    const compactButtons = Array.from(compactGroup?.querySelectorAll('.workspace-page-schedule-compact-button') ?? []);
    const timeButton = compactButtons.find((button) => button.textContent?.trim() === 'Time') as HTMLButtonElement | undefined;
    const repeatButton = compactButtons.find((button) => button.textContent?.trim() === 'Repeat') as HTMLButtonElement | undefined;

    expect(queueButton).toBeTruthy();
    expect(templateButton).toBeTruthy();
    expect(compactGroup).toBeTruthy();
    expect(compactButtons).toHaveLength(2);
    expect(timeButton).toBeTruthy();
    expect(repeatButton).toBeTruthy();
    expect(timeButton?.classList.contains('workspace-page-schedule-compact-button')).toBe(true);
    expect(repeatButton?.classList.contains('workspace-page-schedule-compact-button')).toBe(true);
    expect(templateButton?.classList.contains('workspace-page-mode-button')).toBe(true);
    expect(queueButton?.classList.contains('workspace-page-mode-button')).toBe(true);

    const queueIndex = actionButtons.indexOf(queueButton as HTMLButtonElement);
    const templateIndex = actionButtons.indexOf(templateButton as HTMLButtonElement);
    expect(queueIndex).toBeGreaterThan(-1);
    expect(templateIndex).toBe(queueIndex + 1);
    expect(actionGroup?.textContent).toContain('Queue / History');
    expect(actionGroup?.textContent).toContain('Templates');
    expect(compactGroup?.textContent).toContain('Time');
    expect(compactGroup?.textContent).toContain('Repeat');

    unmount();
  });

  it('hides Cancel in Queue / History while keeping Reschedule available', async () => {
    const scheduledMessage: ScheduledMessage = {
      id: 'scheduled-1',
      chatId: chatA.id,
      chatName: chatA.name,
      text: 'Scheduled message',
      when: '2026-09-29T17:00:00.000Z',
      createdAt: '2026-09-29T16:00:00.000Z',
      status: 'confirmed',
    };
    const { unmount } = await renderWorkspacePage({ upcoming: [scheduledMessage] });

    await act(async () => {
      (document.querySelector('.workspace-page-publish-menu-toggle') as HTMLButtonElement).click();
    });
    const scheduleOption = Array.from(document.querySelectorAll('.workspace-page-publish-option'))
      .find((button) => button.textContent?.trim() === 'Schedule') as HTMLButtonElement;
    await act(async () => {
      scheduleOption.click();
    });
    const queueButton = Array.from(document.querySelectorAll('.workspace-page-mode-button-history'))[0] as HTMLButtonElement;
    await act(async () => {
      queueButton.click();
    });

    const queueActions = Array.from(document.querySelectorAll('.workspace-page-queue-content .msg-btn'))
      .map((button) => button.textContent?.trim());
    expect(queueActions).not.toContain('Cancel');
    expect(queueActions).toContain('Reschedule');

    unmount();
  });

  it('shows send progress and a persistent retry action in the footer on failure', async () => {
    let resolveFirstSend: ((sent: boolean) => void) | null = null;
    const handleSendDraftNow = vi.fn()
      .mockImplementationOnce(() => new Promise<boolean>((resolve) => {
        resolveFirstSend = resolve;
      }))
      .mockResolvedValueOnce(true);
    const { unmount } = await renderWorkspacePage({ handleSendDraftNow });

    await act(async () => {
      (document.querySelector('.workspace-page-publish-main') as HTMLButtonElement).click();
      await Promise.resolve();
    });
    expect(document.querySelector('.workspace-page-publish-transient-feedback')?.textContent).toBe('Отправка…');
    expect((document.querySelector('.workspace-page-publish-main') as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      resolveFirstSend?.(false);
      await Promise.resolve();
    });
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Не удалось отправить сообщение.');
    expect(document.querySelector('[role="textbox"]')?.textContent).toContain('Hello world');
    const retryButton = document.querySelector('.workspace-page-publish-transient-feedback .workspace-page-send-retry') as HTMLButtonElement;
    expect(retryButton).toBeTruthy();

    vi.useFakeTimers();
    await act(async () => {
      retryButton.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(handleSendDraftNow).toHaveBeenCalledTimes(2);
    expect(document.querySelector('[role="textbox"]')?.textContent?.trim()).toBe('');
    expect(document.querySelector('.workspace-page-publish-transient-feedback')?.textContent).toBe('Сообщение отправлено');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3360);
    });
    expect(document.querySelector('.workspace-page-publish-transient-feedback')).toBeNull();
    vi.useRealTimers();
    unmount();
  });

  it('clears send errors after their longer status period', async () => {
    const handleSendDraftNow = vi.fn().mockResolvedValue(false);
    const { unmount } = await renderWorkspacePage({ handleSendDraftNow });
    vi.useFakeTimers();

    await act(async () => {
      (document.querySelector('.workspace-page-publish-main') as HTMLButtonElement).click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(document.querySelector('.workspace-page-publish-transient-feedback.is-error')).not.toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(7999);
    });
    expect(document.querySelector('.workspace-page-publish-transient-feedback.is-error')).not.toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(document.querySelector('.workspace-page-publish-transient-feedback.is-error')).toBeNull();

    vi.useRealTimers();
    unmount();
  });

  it('clears prerequisite warnings after their shorter status period', async () => {
    localStorage.setItem('awaitmsg-workspace-draft', JSON.stringify({
      body: '',
      entities: [],
      attachments: [],
      savedAt: '12:00',
      date: '2026-01-10',
      time: '09:00',
      repeatMode: 'none',
      repeatDays: [],
      repeatOccurrences: 1,
    }));
    const { unmount } = await renderWorkspacePage();
    vi.useFakeTimers();

    await act(async () => {
      (document.querySelector('.workspace-page-publish-main') as HTMLButtonElement).click();
    });
    expect(document.querySelector('.workspace-page-publish-transient-feedback.is-warning')?.textContent).toBe('Введите текст сообщения');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4999);
    });
    expect(document.querySelector('.workspace-page-publish-transient-feedback.is-warning')).not.toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(document.querySelector('.workspace-page-publish-transient-feedback.is-warning')).toBeNull();

    vi.useRealTimers();
    unmount();
  });

  it('renders the Add file attachment button', async () => {
    const { unmount } = await renderWorkspacePage();

    const attachmentButton = document.querySelector('.workspace-page-attachment-toggle') as HTMLButtonElement | null;

    expect(attachmentButton).toBeTruthy();
    expect(attachmentButton?.getAttribute('aria-label')).toBe('Add file');
    expect(attachmentButton?.querySelector('svg')).not.toBeNull();

    unmount();
  });

  it('shows send progress and success ahead of an earlier draft-store error', async () => {
    vi.mocked(window.draftStorage.save).mockResolvedValueOnce({
      success: false,
      code: 'WRITE_FAILED',
      error: 'Disk full',
    });
    let resolveSend: ((sent: boolean) => void) | null = null;
    const handleSendDraftNow = vi.fn().mockImplementation(() => new Promise<boolean>((resolve) => {
      resolveSend = resolve;
    }));
    const { unmount } = await renderWorkspacePage({ handleSendDraftNow });

    await act(async () => {
      (document.querySelector('.workspace-page-publish-menu-toggle') as HTMLButtonElement).click();
    });
    const saveDraftOption = Array.from(document.querySelectorAll('.workspace-page-publish-option'))
      .find((button) => button.textContent?.trim() === 'Save draft') as HTMLButtonElement;
    await act(async () => {
      saveDraftOption.click();
    });
    await act(async () => {
      (document.querySelector('.workspace-page-publish-main') as HTMLButtonElement).click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(document.querySelector('.workspace-page-publish-transient-feedback.is-error')?.textContent).toContain('Disk full');

    await act(async () => {
      (document.querySelector('.workspace-page-publish-menu-toggle') as HTMLButtonElement).click();
    });
    const sendOption = Array.from(document.querySelectorAll('.workspace-page-publish-option'))
      .find((button) => button.textContent?.trim() === 'Send now') as HTMLButtonElement;
    await act(async () => {
      sendOption.click();
    });
    await act(async () => {
      (document.querySelector('.workspace-page-publish-main') as HTMLButtonElement).click();
      await Promise.resolve();
    });
    expect(document.querySelector('.workspace-page-publish-transient-feedback')?.textContent).toBe('Отправка…');

    await act(async () => {
      resolveSend?.(true);
      await Promise.resolve();
    });
    expect(document.querySelector('.workspace-page-publish-transient-feedback.is-success')?.textContent).toBe('Сообщение отправлено');
    unmount();
  });

  it('shows the unhighlighted Draft button after Queue / History only for the draft action', async () => {
    const { unmount } = await renderWorkspacePage();

    const actionGroup = document.querySelector('.workspace-page-action-left-group');
    const leftGroupButtons = Array.from(actionGroup?.querySelectorAll(':scope > button') ?? [])
      .map((button) => button.textContent?.trim());

    expect(leftGroupButtons).not.toContain('Drafts');
    expect(leftGroupButtons.indexOf('Templates')).toBe(leftGroupButtons.indexOf('Queue / History') + 1);
    expect((Array.from(actionGroup?.querySelectorAll(':scope > button') ?? [])
      .find((button) => button.textContent?.trim() === 'Queue / History') as HTMLButtonElement).title)
      .toBe('View scheduled messages and sent history');
    expect((Array.from(actionGroup?.querySelectorAll(':scope > button') ?? [])
      .find((button) => button.textContent?.trim() === 'Templates') as HTMLButtonElement).title)
      .toBe('Open and manage reusable message templates');

    const menuToggle = document.querySelector('.workspace-page-publish-menu-toggle') as HTMLButtonElement;
    expect(menuToggle).not.toBeNull();
    expect(menuToggle.title).toBe('Choose Send now, Schedule, or Save draft');

    await act(async () => {
      menuToggle.click();
    });

    const draftMenuItem = Array.from(document.querySelectorAll('.workspace-page-publish-option'))
      .find((button) => button.textContent?.trim() === 'Save draft');

    expect(draftMenuItem).not.toBeNull();

    await act(async () => {
      (draftMenuItem as HTMLButtonElement).click();
    });

    const draftColorPicker = document.querySelector('.workspace-page-draft-footer .draft-color-picker');
    expect(draftColorPicker).not.toBeNull();
    const greenDraftColor = draftColorPicker?.querySelector('[aria-label="Green draft color"]') as HTMLButtonElement;
    await act(async () => {
      greenDraftColor.click();
    });
    expect(draftColorPicker?.parentElement?.firstElementChild?.textContent).toBe('Green');

    await act(async () => {
      (document.querySelector('.workspace-page-publish-main') as HTMLButtonElement).click();
    });

    expect(inMemoryDraftStore.savedDrafts[0]).toMatchObject({
      body: 'Hello world',
      color: 'green',
      entities: [],
      attachments: [],
      selectedChat: { id: chatA.id, name: chatA.name },
      inlineButtons: [],
      date: '2026-01-10',
      time: '09:00',
      repeatMode: 'none',
    });
    expect(document.querySelector('.workspace-page-publish-transient-feedback')?.textContent).toBe('Черновик сохранён');
    expect(document.querySelector('.workspace-page-publish-transient-feedback')?.classList.contains('is-success')).toBe(true);

    const activeActionGroup = document.querySelector('.workspace-page-action-left-group');
    const actionButtons = Array.from(activeActionGroup?.querySelectorAll(':scope > button') ?? []);
    const queueButtonIndex = actionButtons.findIndex((button) => button.textContent?.trim() === 'Queue / History');
    const draftToggle = actionButtons.find((button) => button.textContent?.trim() === 'Draft');
    const templatesButtonIndex = actionButtons.findIndex((button) => button.textContent?.trim() === 'Templates');

    expect(draftToggle).not.toBeNull();
    expect(templatesButtonIndex).toBe(queueButtonIndex + 1);
    expect(actionButtons.indexOf(draftToggle as HTMLButtonElement)).toBe(queueButtonIndex + 2);
    expect(draftToggle?.classList.contains('workspace-page-mode-button-template')).toBe(true);
    expect(draftToggle?.classList.contains('is-active')).toBe(false);
    expect(draftToggle?.classList.contains('workspace-page-schedule-compact-button')).toBe(false);
    expect((draftToggle as HTMLButtonElement | undefined)?.title).toBe('Open saved drafts');

    await act(async () => {
      (draftToggle as HTMLButtonElement).click();
    });

    expect(document.querySelector('.workspace-page-rich-text-draft-stage.is-active strong')?.textContent).toBe('Saved Drafts');
    expect(document.querySelector('.workspace-page-rich-text-draft-stage .workspace-page-template-stage-item strong')?.textContent).toMatch(/^Draft /);

    unmount();
  });

  it('keeps legacy data untouched when file-store migration fails', async () => {
    const legacyWorkspace = localStorage.getItem('awaitmsg-workspace-draft');
    vi.mocked(window.draftStorage.migrate).mockResolvedValueOnce({
      success: false,
      code: 'WRITE_FAILED',
      error: 'Disk unavailable',
    });

    const { unmount } = await renderWorkspacePage();

    expect(localStorage.getItem('awaitmsg-workspace-draft')).toBe(legacyWorkspace);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Disk unavailable');
    unmount();
  });

  it('uses one backup flow to export and import all drafts', async () => {
    const { unmount } = await renderWorkspacePage();
    await openDraftsStage();
    const footer = document.querySelector('.workspace-page-draft-stage-footer');
    const exportButton = Array.from(footer?.querySelectorAll('button') ?? [])
      .find((button) => button.textContent?.trim() === 'Export all drafts') as HTMLButtonElement;
    const importButton = Array.from(footer?.querySelectorAll('button') ?? [])
      .find((button) => button.textContent?.trim() === 'Import drafts') as HTMLButtonElement;

    expect(exportButton).toBeTruthy();
    expect(importButton).toBeTruthy();
    expect(footer?.querySelector('[title="Export .txt"]')).toBeNull();
    const editor = document.querySelector('[role="textbox"]') as HTMLDivElement;
    await act(async () => {
      editor.textContent = 'Latest unsaved text';
      editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
    });
    await act(async () => {
      exportButton.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(document.querySelector('.workspace-page-publish-transient-feedback')?.textContent).toBe('Резервная копия экспортирована');

    vi.mocked(window.draftStorage.importBackup).mockResolvedValueOnce({
      success: true,
      store: JSON.parse(JSON.stringify(inMemoryDraftStore)),
    });
    await act(async () => {
      importButton.click();
      await Promise.resolve();
    });

    expect(window.draftStorage.exportBackup).toHaveBeenCalledTimes(1);
    expect(window.draftStorage.importBackup).toHaveBeenCalledTimes(1);
    expect(inMemoryDraftStore.workspaceDraft.body).toBe('Latest unsaved text');
    expect(document.querySelector('.workspace-page-publish-transient-feedback')?.textContent).toBe('Черновики импортированы');
    unmount();
  });

  it('shows a success status after a saved draft is deleted', async () => {
    const confirmDelete = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { unmount } = await renderWorkspacePage();
    await act(async () => {
      (document.querySelector('.workspace-page-publish-menu-toggle') as HTMLButtonElement).click();
    });
    const saveDraftOption = Array.from(document.querySelectorAll('.workspace-page-publish-option'))
      .find((button) => button.textContent?.trim() === 'Save draft') as HTMLButtonElement;
    await act(async () => {
      saveDraftOption.click();
    });
    await act(async () => {
      (document.querySelector('.workspace-page-publish-main') as HTMLButtonElement).click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const draftModeButton = Array.from(document.querySelectorAll('.workspace-page-action-left-group > button'))
      .find((button) => button.textContent?.trim() === 'Draft') as HTMLButtonElement;
    await act(async () => {
      draftModeButton.click();
    });
    expect(document.querySelectorAll('.workspace-page-template-stage-item')).toHaveLength(1);

    const deleteButton = document.querySelector('.workspace-page-rich-text-draft-stage .workspace-page-template-stage-item > div button:last-child') as HTMLButtonElement;
    await act(async () => {
      deleteButton.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(confirmDelete).toHaveBeenCalledWith(expect.stringContaining('Draft'));
    expect(document.querySelector('.workspace-page-template-stage-item')).toBeNull();
    expect(document.querySelector('.workspace-page-publish-transient-feedback.is-success')?.textContent).toBe('Черновик удалён');
    confirmDelete.mockRestore();
    unmount();
  });

  it('shows a success status after a template is deleted', async () => {
    localStorage.setItem('awaitmsg_domain_templates', JSON.stringify([{
      id: 'template-1',
      accountId: 'default-account',
      name: 'Welcome',
      body: 'Hello there',
      createdAt: '2026-09-26T10:00:00.000Z',
      updatedAt: '2026-09-26T10:00:00.000Z',
    }]));
    const confirmDelete = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { unmount } = await renderWorkspacePage();
    const templatesButton = Array.from(document.querySelectorAll('.workspace-page-action-left-group > button'))
      .find((button) => button.textContent?.trim() === 'Templates') as HTMLButtonElement;
    await act(async () => {
      templatesButton.click();
    });

    const deleteButton = document.querySelector('.workspace-page-rich-text-template-stage .workspace-page-template-stage-item > div button:last-child') as HTMLButtonElement;
    await act(async () => {
      deleteButton.click();
    });

    expect(confirmDelete).toHaveBeenCalledWith('Delete template "Welcome"?');
    expect(document.querySelector('.workspace-page-rich-text-template-stage .workspace-page-template-stage-item')).toBeNull();
    expect(document.querySelector('.workspace-page-publish-transient-feedback.is-success')?.textContent).toBe('Шаблон удалён');
    confirmDelete.mockRestore();
    unmount();
  });

  it('shows success statuses after creating and updating a template', async () => {
    const { unmount } = await renderWorkspacePage();
    const templatesButton = Array.from(document.querySelectorAll('.workspace-page-action-left-group > button'))
      .find((button) => button.textContent?.trim() === 'Templates') as HTMLButtonElement;
    await act(async () => {
      templatesButton.click();
    });
    await act(async () => {
      (document.querySelector('.workspace-page-rich-text-template-stage .workspace-page-template-stage-footer-actions button') as HTMLButtonElement).click();
    });

    const nameInput = document.querySelector('[aria-label="Template name"]') as HTMLInputElement;
    const bodyInput = document.querySelector('#workspace-template-editor-form textarea') as HTMLTextAreaElement;
    await act(async () => {
      const nameSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      const bodySetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      nameSetter?.call(nameInput, 'Greeting');
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));
      bodySetter?.call(bodyInput, 'Hello!');
      bodyInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      (document.querySelector('[form="workspace-template-editor-form"]') as HTMLButtonElement).click();
    });

    expect(document.querySelector('.workspace-page-publish-transient-feedback.is-success')?.textContent).toBe('Шаблон создан');
    const editButton = Array.from(document.querySelectorAll('.workspace-page-rich-text-template-stage .workspace-page-template-stage-item > div button'))
      .find((button) => button.textContent?.trim() === 'Edit') as HTMLButtonElement;
    await act(async () => {
      editButton.click();
    });
    const editedNameInput = document.querySelector('[aria-label="Template name"]') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(editedNameInput, 'Updated greeting');
      editedNameInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      (document.querySelector('[form="workspace-template-editor-form"]') as HTMLButtonElement).click();
    });

    expect(document.querySelector('.workspace-page-publish-transient-feedback.is-success')?.textContent).toBe('Шаблон обновлён');
    expect(document.querySelector('.workspace-page-rich-text-template-stage .workspace-page-template-stage-item strong')?.textContent).toContain('Updated greeting');
    unmount();
  });

  it('imports plain text into the editor without removing attached media', async () => {
    localStorage.setItem('awaitmsg-workspace-draft', JSON.stringify({
      body: 'Old editor text',
      entities: [{ type: 'bold', offset: 0, length: 3 }],
      attachments: [{ name: 'photo.png', path: '/managed/photo.png', size: 5 }],
      savedAt: '12:00',
      date: '2026-01-10',
      time: '09:00',
      repeatMode: 'none',
      repeatDays: [],
      repeatOccurrences: 1,
    }));
    const confirmReplace = vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(window.draftStorage.importText).mockResolvedValueOnce({ success: true, text: 'Imported plain text' });
    const { unmount } = await renderWorkspacePage();
    await openDraftsStage();
    const importButton = document.querySelector('.workspace-page-rich-text-draft-stage [aria-label="Import text into editor"]') as HTMLButtonElement;
    expect(importButton.textContent).toContain('Import .txt');
    expect(importButton.title).toBe('Import a .txt file into the editor');

    await act(async () => {
      importButton.click();
      await Promise.resolve();
    });

    expect(confirmReplace).toHaveBeenCalled();
    expect(document.querySelector('.workspace-page-rich-text-draft-stage.is-active')).toBeNull();
    expect((document.querySelector('[role="textbox"]') as HTMLDivElement).textContent).toContain('Imported plain text');
    expect(document.querySelector('.workspace-page-attachment-name')?.textContent).toBe('photo.png');
    expect(document.querySelector('.workspace-page-publish-transient-feedback')?.textContent).toBe('Текст импортирован в редактор');
    confirmReplace.mockRestore();
    unmount();
  });

  it('duplicates text import failures in the shared footer status', async () => {
    vi.mocked(window.draftStorage.importText).mockResolvedValueOnce({
      success: false,
      cancelled: false,
      error: 'Text file is not valid UTF-8.',
    });
    const { unmount } = await renderWorkspacePage();
    await openDraftsStage();

    await act(async () => {
      (document.querySelector('[aria-label="Import text into editor"]') as HTMLButtonElement).click();
      await Promise.resolve();
    });

    expect(document.querySelector('.workspace-page-send-feedback[role="alert"]')).toBeNull();
    expect(document.querySelector('.workspace-page-publish-transient-feedback.is-error')?.textContent).toContain('Text file is not valid UTF-8.');
    unmount();
  });

  it('duplicates chat lookup errors in the shared footer status', async () => {
    vi.mocked(window.telegram.findChat).mockResolvedValueOnce({ success: false, error: 'Chat not found.' });
    const { unmount } = await renderWorkspacePage();
    await act(async () => {
      (document.querySelector('.workspace-page-chat-trigger') as HTMLButtonElement).click();
    });
    await act(async () => {
      (document.querySelector('.workspace-page-chat-stage-add') as HTMLButtonElement).click();
    });
    const queryInput = document.querySelector('.workspace-page-chat-stage-add-form input') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(queryInput, '@missing');
      queryInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      (document.querySelector('.workspace-page-chat-stage-add-form button') as HTMLButtonElement).click();
      await Promise.resolve();
    });

    expect(document.querySelector('.workspace-page-chat-stage-add-form [role="alert"]')).toBeNull();
    expect(document.querySelector('.workspace-page-publish-transient-feedback.is-error')?.textContent).toContain('Chat not found.');
    unmount();
  });

  it('duplicates preview history errors in the shared footer with a retry action', async () => {
    vi.mocked(window.telegram.getChatHistory).mockResolvedValueOnce({ success: false, error: 'History unavailable.' });
    const { unmount } = await renderWorkspacePage({ connected: true });

    expect(document.querySelector('.chat-preview-state.is-error')).toBeNull();
    expect(document.querySelector('.workspace-page-publish-transient-feedback.is-error')?.textContent).toContain('History unavailable.');
    expect(document.querySelector('.workspace-page-publish-transient-feedback .workspace-page-send-retry')?.textContent).toBe('Retry');
    unmount();
  });

  it('duplicates attachment size errors in the shared footer status', async () => {
    const { unmount } = await renderWorkspacePage();
    vi.useFakeTimers();
    const oversizedFile = new File(['image'], 'large-photo.png', { type: 'image/png' });
    Object.defineProperty(oversizedFile, 'size', { value: 50 * 1024 * 1024 + 1 });
    const fileInput = document.querySelector('.workspace-page-hidden-file-input') as HTMLInputElement;
    Object.defineProperty(fileInput, 'files', { value: [oversizedFile], configurable: true });

    await act(async () => {
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });

    expect(document.querySelector('.workspace-page-empty-attachments')).toBeNull();
    expect(document.querySelector('.workspace-page-publish-transient-feedback.is-error')?.textContent).toContain('large-photo.png');
    expect(window.draftStorage.copyAttachment).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3360);
    });
    expect(document.querySelector('.workspace-page-publish-transient-feedback.is-error')).toBeNull();
    vi.useRealTimers();
    unmount();
  });

  it('shows an enlarged preview when hovering or focusing an attached image', async () => {
    localStorage.setItem('awaitmsg-workspace-draft', JSON.stringify({
      body: 'Photo caption',
      entities: [],
      attachments: [{ name: 'photo.png', path: '/managed/photo.png', size: 5 }],
      savedAt: '12:00',
      date: '2026-01-10',
      time: '09:00',
      repeatMode: 'none',
      repeatDays: [],
      repeatOccurrences: 1,
    }));
    const { unmount } = await renderWorkspacePage();
    const thumbnail = document.querySelector('.workspace-page-attachment-thumbnail') as HTMLImageElement;

    expect(thumbnail).toBeTruthy();
    vi.useFakeTimers();
    await act(async () => {
      thumbnail.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    expect(document.querySelector('.workspace-page-attachment-preview')).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(999);
    });
    expect(document.querySelector('.workspace-page-attachment-preview')).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(document.querySelector('.workspace-page-attachment-preview img')?.getAttribute('alt')).toBe('photo.png');

    await act(async () => {
      thumbnail.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    });
    expect(document.querySelector('.workspace-page-attachment-preview')).toBeNull();

    await act(async () => {
      thumbnail.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      await vi.advanceTimersByTimeAsync(999);
      thumbnail.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(document.querySelector('.workspace-page-attachment-preview')).toBeNull();

    await act(async () => {
      thumbnail.focus();
    });
    expect(document.querySelector('.workspace-page-attachment-preview')).not.toBeNull();
    await act(async () => {
      thumbnail.blur();
    });
    expect(document.querySelector('.workspace-page-attachment-preview')).toBeNull();
    unmount();
    vi.useRealTimers();
  });

  it('does not report a named draft as saved when the file-store write fails', async () => {
    vi.mocked(window.draftStorage.save).mockResolvedValueOnce({
      success: false,
      code: 'WRITE_FAILED',
      error: 'Disk full',
    });
    const { unmount } = await renderWorkspacePage();

    await act(async () => {
      (document.querySelector('.workspace-page-publish-menu-toggle') as HTMLButtonElement).click();
    });
    const saveDraftOption = Array.from(document.querySelectorAll('.workspace-page-publish-option'))
      .find((button) => button.textContent?.trim() === 'Save draft') as HTMLButtonElement;
    await act(async () => {
      saveDraftOption.click();
    });
    await act(async () => {
      (document.querySelector('.workspace-page-publish-main') as HTMLButtonElement).click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(inMemoryDraftStore.savedDrafts).toHaveLength(0);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Disk full');
    expect(document.querySelector('.workspace-page-publish-transient-feedback.is-error')?.textContent).toContain('Disk full');
    expect(document.querySelector('.workspace-page-publish-transient-feedback.is-success')).toBeNull();
    unmount();
  });

  it('keeps the window open when the final synchronous flush fails', async () => {
    vi.mocked(window.draftStorage.flush).mockReturnValueOnce({
      success: false,
      code: 'WRITE_FAILED',
      error: 'Flush failed',
    });
    const { unmount } = await renderWorkspacePage();
    const closeEvent = new Event('beforeunload', { cancelable: true });

    act(() => {
      window.dispatchEvent(closeEvent);
    });

    expect(closeEvent.defaultPrevented).toBe(true);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Flush failed');
    unmount();
  });

  beforeEach(() => {
    (globalThis as typeof globalThis & { ResizeObserver?: { new (): { observe: (node: Element) => void; unobserve: (node: Element) => void; disconnect: () => void } } }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.scrollTo = vi.fn<[ScrollToOptions?] | [number, number], void>();

    document.body.innerHTML = '';
    localStorage.clear();
    localStorage.setItem('awaitmsg-workspace-draft', JSON.stringify({
      body: 'Hello world',
      entities: [],
      attachments: [],
      savedAt: '12:00',
      date: '2026-01-10',
      time: '09:00',
      repeatMode: 'none',
      repeatDays: [],
      repeatOccurrences: 5,
    }));
    Object.defineProperty(window, 'telegram', {
      value: {
        findChat: vi.fn().mockResolvedValue({ success: false, error: 'Chat not found.' }),
        getChatHistory: vi.fn().mockResolvedValue({
          success: true,
          history: {
            chat: { id: chatA.id, title: chatA.name },
            messages: [],
          },
        }),
        getFilePath: vi.fn((file: File) => `/${file.name}`),
      },
      configurable: true,
    });
    inMemoryDraftStore = {
      schemaVersion: 2,
      migrationVersion: 0,
      savedDrafts: [],
      workspaceDraft: null,
    };
    Object.defineProperty(window, 'draftStorage', {
      value: {
        load: vi.fn(async () => ({
          success: true,
          store: JSON.parse(JSON.stringify(inMemoryDraftStore)),
          needsMigration: inMemoryDraftStore.migrationVersion === 0,
        })),
        migrate: vi.fn(async (legacy) => {
          inMemoryDraftStore = {
            schemaVersion: 2,
            migrationVersion: 1,
            savedDrafts: legacy.savedDrafts,
            workspaceDraft: legacy.workspaceDraft,
          };
          return { success: true, migrated: true, store: JSON.parse(JSON.stringify(inMemoryDraftStore)) };
        }),
        save: vi.fn(async (store) => {
          inMemoryDraftStore = JSON.parse(JSON.stringify(store));
          return { success: true, store: JSON.parse(JSON.stringify(inMemoryDraftStore)) };
        }),
        flush: vi.fn((store) => {
          inMemoryDraftStore = JSON.parse(JSON.stringify(store));
          return { success: true, store: JSON.parse(JSON.stringify(inMemoryDraftStore)) };
        }),
        restoreBackup: vi.fn(async () => ({ success: false, error: 'No backup' })),
        exportBackup: vi.fn(async () => ({ success: true })),
        importBackup: vi.fn(async () => ({ success: false, cancelled: true })),
        exportText: vi.fn(async () => ({ success: true })),
        importText: vi.fn(async () => ({ success: true, text: 'Imported from text file' })),
        copyAttachment: vi.fn(async (file: File) => ({
          success: true,
          attachment: { name: file.name, path: `/stored/${file.name}`, size: file.size },
        })),
      },
      configurable: true,
    });
  });

  it('recovers the complete draft after autosave and reload', async () => {
    vi.useFakeTimers();

    try {
      localStorage.setItem('awaitmsg-workspace-draft', JSON.stringify({
        body: 'Initial draft',
        entities: [{ type: 'bold', offset: 0, length: 7 }],
        attachments: [{ name: 'photo.png', path: '/tmp/photo.png', size: 1234 }],
        savedAt: '12:00',
        date: '2026-02-14',
        time: '18:30',
        repeatMode: 'weekly',
        repeatDays: ['Sat'],
        repeatOccurrences: 3,
      }));

      const setSelectedChat = vi.fn();
      const { unmount } = await renderWorkspacePage({
        selectedChat: chatA,
        setSelectedChat,
        date: '2026-02-14',
        time: '18:30',
      });

      const editor = document.querySelector('[role="textbox"]') as HTMLDivElement;
      await act(async () => {
        editor.innerHTML = '<strong>Recovered rich draft</strong>';
        editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
        await Promise.resolve();
      });

      await act(async () => {
        vi.advanceTimersByTime(500);
        await Promise.resolve();
        await Promise.resolve();
      });

      const savedDraft = inMemoryDraftStore.workspaceDraft;
      expect(savedDraft.body).toBe('Recovered rich draft');
      expect(savedDraft.entities).toEqual([{ type: 'bold', offset: 0, length: 20 }]);
      expect(savedDraft.selectedChat).toMatchObject({ id: chatA.id, name: chatA.name });
      expect(savedDraft.attachments).toEqual([{ name: 'photo.png', path: '/tmp/photo.png', size: 1234 }]);
      expect(savedDraft.date).toBe('2026-02-14');
      expect(savedDraft.time).toBe('18:30');
      expect(savedDraft.repeatMode).toBe('weekly');
      expect(savedDraft.repeatDays).toEqual(['Sat']);

      unmount();

      const reloaded = await renderWorkspacePage({
        selectedChat: null,
        setSelectedChat,
        date: '',
        time: '',
      });

      expect((document.querySelector('[role="textbox"]') as HTMLDivElement).textContent).toContain('Recovered rich draft');
      expect(setSelectedChat).toHaveBeenCalledWith(expect.objectContaining({ id: chatA.id }));

      reloaded.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('autosaves the latest draft text after debounce and restores it after reload without a manual action', async () => {
    vi.useFakeTimers();

    try {
      const { unmount } = await renderWorkspacePage({
        selectedChat: null,
        date: '',
        time: '',
      });

      const editor = document.querySelector('[role="textbox"]') as HTMLDivElement;
      await act(async () => {
        editor.textContent = 'Autosave draft 1';
        editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
        await Promise.resolve();
      });

      act(() => {
        vi.advanceTimersByTime(200);
      });

      let savedDraft = inMemoryDraftStore.workspaceDraft;
      expect(savedDraft.body).toBe('Hello world');

      await act(async () => {
        vi.advanceTimersByTime(400);
        await Promise.resolve();
        await Promise.resolve();
      });

      savedDraft = inMemoryDraftStore.workspaceDraft;
      expect(savedDraft.body).toBe('Autosave draft 1');

      unmount();

      const reloaded = await renderWorkspacePage({
        selectedChat: null,
        date: '',
        time: '',
      });

      const restoredEditor = document.querySelector('[role="textbox"]') as HTMLDivElement;
      expect(restoredEditor.textContent).toContain('Autosave draft 1');

      reloaded.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('flushes the latest draft on unexpected close before debounce completes', async () => {
    vi.useFakeTimers();

    try {
      const { unmount } = await renderWorkspacePage({
        selectedChat: null,
        date: '',
        time: '',
      });

      const editor = document.querySelector('[role="textbox"]') as HTMLDivElement;
      await act(async () => {
        editor.textContent = 'Draft before close';
        editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
        await Promise.resolve();
      });

      window.dispatchEvent(new Event('beforeunload'));

      const savedDraft = inMemoryDraftStore.workspaceDraft;
      expect(savedDraft.body).toBe('Draft before close');

      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('restores the saved draft text after a reload', async () => {
    vi.useFakeTimers();

    try {
      const { unmount } = await renderWorkspacePage({
        selectedChat: null,
        date: '',
        time: '',
      });

      const editor = document.querySelector('[role="textbox"]') as HTMLDivElement;
      await act(async () => {
        editor.textContent = 'Reloaded draft text';
        editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
        await Promise.resolve();
      });

      await act(async () => {
        vi.advanceTimersByTime(500);
        await Promise.resolve();
        await Promise.resolve();
      });

      const savedDraft = inMemoryDraftStore.workspaceDraft;
      expect(savedDraft.body).toContain('Reloaded draft text');

      unmount();

      const reloaded = await renderWorkspacePage({
        selectedChat: null,
        date: '',
        time: '',
      });

      const restoredEditor = document.querySelector('[role="textbox"]') as HTMLDivElement;
      expect(restoredEditor.textContent).toContain('Reloaded draft text');

      reloaded.unmount();
    } finally {
      vi.useRealTimers();
    }
  });
});
