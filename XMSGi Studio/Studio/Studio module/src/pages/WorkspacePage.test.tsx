import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Chat, NotificationState, ScheduledMessage } from '@/types';
import { LocaleProvider } from '@/lib/i18n';
import { hasDraftContent, normalizeAttachments, readWorkspaceDraftStoreFallback, remapAttachmentPositions, WorkspacePage, writeWorkspaceDraftStoreFallback } from './WorkspacePage';

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
    upcoming: [],
    date: '2026-01-10',
    time: '09:00',
    scheduling: false,
    successPulse: false,
    lastAction: null,
    notification: baseNotification,
    closeNotification: vi.fn(),
    setDate: vi.fn(),
    setTime: vi.fn(),
    handleSchedule: vi.fn(),
    handleCancelMessage: vi.fn(),
    handleSendDraftNow: vi.fn().mockResolvedValue(true),
    publishingDraft: false,
  };

  await act(async () => {
    root.render(<LocaleProvider><WorkspacePage {...defaults} {...overrides} /></LocaleProvider>);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

  return {
    root,
    rerender: (nextOverrides: Partial<React.ComponentProps<typeof WorkspacePage>> = {}) => act(() => {
      root.render(<LocaleProvider><WorkspacePage {...defaults} {...overrides} {...nextOverrides} /></LocaleProvider>);
    }),
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
  it('renders the main composer labels in the selected Russian locale', async () => {
    localStorage.setItem('awaitmsg_locale', 'ru');
    const { unmount } = await renderWorkspacePage();

    expect(document.querySelector('.workspace-page-editor-title-text')?.textContent).toBe('Создать публикацию');
    expect(document.querySelector('.workspace-page-publish-menu-toggle')?.getAttribute('aria-label'))
      .toBe('Другие действия с публикацией');
    unmount();
  });

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

  it('clears saved drafts through the history handler and preserves the workspace draft', async () => {
    const savedDraft = {
      id: 'history-clear-draft',
      name: 'Saved draft',
      body: 'Saved content',
      createdAt: '2026-09-28T10:00:00.000Z',
      updatedAt: '2026-09-29T18:35:00.000Z',
    };
    const workspaceDraft = {
      body: 'Unsaved editor content',
      savedAt: '12:00',
      attachments: [],
    };
    inMemoryDraftStore = {
      schemaVersion: 2,
      migrationVersion: 1,
      savedDrafts: [savedDraft],
      workspaceDraft,
    };
    let clearHistoryDrafts: (() => Promise<boolean>) | null = null;
    const { unmount } = await renderWorkspacePage({
      onRegisterHistoryDraftClearHandler: (handler) => { clearHistoryDrafts = handler; },
    });

    let cleared = false;
    await act(async () => {
      cleared = await clearHistoryDrafts?.() ?? false;
    });

    expect(cleared).toBe(true);
    expect(inMemoryDraftStore.savedDrafts).toEqual([]);
    expect(inMemoryDraftStore.workspaceDraft).toMatchObject({ body: 'Unsaved editor content' });
    unmount();
  });

  it('deletes one saved draft through the history handler and keeps the others', async () => {
    const drafts = [
      { id: 'delete-one', name: 'Delete one', body: 'Selected draft', createdAt: '2026-09-28T10:00:00.000Z', updatedAt: '2026-09-29T18:35:00.000Z' },
      { id: 'keep-one', name: 'Keep one', body: 'Other draft', createdAt: '2026-09-28T10:00:00.000Z', updatedAt: '2026-09-29T18:36:00.000Z' },
    ];
    inMemoryDraftStore = {
      schemaVersion: 2,
      migrationVersion: 1,
      savedDrafts: drafts,
      workspaceDraft: { body: 'Unsaved editor content', savedAt: '12:00', attachments: [] },
    };
    let deleteHistoryDraft: ((draftId: string) => Promise<boolean>) | null = null;
    const { unmount } = await renderWorkspacePage({
      onRegisterHistoryDraftDeleteHandler: (handler) => { deleteHistoryDraft = handler; },
    });

    let deleted = false;
    await act(async () => {
      deleted = await deleteHistoryDraft?.('delete-one') ?? false;
    });

    expect(deleted).toBe(true);
    expect(inMemoryDraftStore.savedDrafts.map((draft: { id: string }) => draft.id)).toEqual(['keep-one']);
    expect(inMemoryDraftStore.workspaceDraft).toMatchObject({ body: 'Unsaved editor content' });
    unmount();
  });

  it('loads a saved draft into the main editor through the history use handler', async () => {
    const savedDraft = {
      id: 'use-in-composer',
      name: 'Composer draft',
      body: 'Text copied into the composer',
      entities: [],
      attachments: [],
      selectedChat: chatA,
      inlineButtons: [],
      createdAt: '2026-09-28T10:00:00.000Z',
      updatedAt: '2026-09-29T18:35:00.000Z',
    };
    inMemoryDraftStore = {
      schemaVersion: 2,
      migrationVersion: 1,
      savedDrafts: [savedDraft],
      workspaceDraft: null,
    };
    let useHistoryDraft: ((draft: typeof savedDraft) => void) | null = null;
    const { unmount } = await renderWorkspacePage({
      onRegisterHistoryDraftUseHandler: (handler) => { useHistoryDraft = handler; },
    });

    await act(async () => {
      useHistoryDraft?.(savedDraft);
    });

    const editor = document.querySelector('[aria-label="Post content"]');
    expect(editor?.getAttribute('aria-hidden')).toBe('false');
    expect(editor?.textContent).toBe(savedDraft.body);
    expect(inMemoryDraftStore.savedDrafts[0]).toEqual(savedDraft);
    unmount();
  });

  it('activates the editor highlight from buttons and preserves it in other windows', async () => {
    const { unmount } = await renderWorkspacePage();
    const editor = document.querySelector<HTMLElement>('[aria-label="Post content"]')!;
    const editorShell = editor.closest('.workspace-page-rich-text-editor')!;

    expect(editorShell.classList.contains('is-toolbar-active')).toBe(false);
    const menuToggle = document.querySelector<HTMLButtonElement>('.workspace-page-publish-menu-toggle')!;
    const historyScrollArea = document.createElement('div');
    historyScrollArea.className = 'history-record-list';
    historyScrollArea.style.overflowY = 'auto';
    Object.defineProperties(historyScrollArea, {
      scrollHeight: { configurable: true, value: 300 },
      clientHeight: { configurable: true, value: 100 },
    });
    document.body.appendChild(historyScrollArea);
    await act(async () => {
      historyScrollArea.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    });
    expect(editorShell.classList.contains('is-toolbar-active')).toBe(false);

    await act(async () => menuToggle.click());
    expect(editorShell.classList.contains('is-toolbar-active')).toBe(true);
    await act(async () => menuToggle.click());
    expect(editorShell.classList.contains('is-toolbar-active')).toBe(true);

    await act(async () => editor.focus());
    expect(editorShell.classList.contains('is-toolbar-active')).toBe(true);

    await act(async () => menuToggle.click());
    expect(editorShell.classList.contains('is-toolbar-active')).toBe(true);

    const scheduleOption = Array.from(document.querySelectorAll('.workspace-page-publish-option'))
      .find((button) => button.textContent?.trim() === 'Schedule') as HTMLButtonElement;
    await act(async () => scheduleOption.click());
    expect(editorShell.classList.contains('is-toolbar-active')).toBe(true);

    await act(async () => {
      historyScrollArea.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    });
    expect(editorShell.classList.contains('is-toolbar-active')).toBe(true);

    await act(async () => {
      document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    });
    expect(editorShell.classList.contains('is-toolbar-active')).toBe(false);
    await act(async () => {
      historyScrollArea.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    });
    expect(editorShell.classList.contains('is-toolbar-active')).toBe(false);
    historyScrollArea.remove();
    unmount();
  });

  it('applies a distinct accent to each publish action', async () => {
    const { unmount } = await renderWorkspacePage();
    const publishButton = document.querySelector('.workspace-page-publish-main')!;
    const editorShell = document.querySelector('.workspace-page-editor-shell')!;
    const menuToggle = document.querySelector<HTMLButtonElement>('.workspace-page-publish-menu-toggle')!;
    expect(publishButton.classList.contains('is-send')).toBe(true);
    expect(editorShell.classList.contains('is-scheduled')).toBe(false);
    expect(editorShell.classList.contains('is-draft')).toBe(false);

    await act(async () => menuToggle.click());
    const scheduleOption = Array.from(document.querySelectorAll('.workspace-page-publish-option'))
      .find((button) => button.textContent?.trim() === 'Schedule') as HTMLButtonElement;
    await act(async () => scheduleOption.click());
    expect(publishButton.classList.contains('is-scheduled')).toBe(true);
    expect(editorShell.classList.contains('is-scheduled')).toBe(true);

    await act(async () => menuToggle.click());
    const draftOption = Array.from(document.querySelectorAll('.workspace-page-publish-option'))
      .find((button) => button.textContent?.trim() === 'Save draft') as HTMLButtonElement;
    await act(async () => draftOption.click());
    expect(publishButton.classList.contains('is-draft')).toBe(true);
    expect(editorShell.classList.contains('is-draft')).toBe(true);
    unmount();
  });

  it('keeps the browser runtime quiet when draft storage is unavailable', async () => {
    const originalDraftStorage = Object.getOwnPropertyDescriptor(window, 'draftStorage');
    Reflect.deleteProperty(window, 'draftStorage');
    localStorage.removeItem('xmsgi-draft-store-fallback');
    localStorage.removeItem('awaitmsg-draft-store-fallback');

    try {
      const { unmount } = await renderWorkspacePage();
      expect(document.body.textContent).not.toContain('Saved drafts are unavailable in this runtime.');
      unmount();
    } finally {
      if (originalDraftStorage) {
        Object.defineProperty(window, 'draftStorage', originalDraftStorage);
      } else {
        Reflect.deleteProperty(window, 'draftStorage');
      }
    }
  });

  it('treats attachment-only drafts as valid content', () => {
    expect(hasDraftContent('', normalizeAttachments([{ name: 'demo.png', path: 'C:/demo/demo.png' }]))).toBe(true);
    expect(hasDraftContent('', normalizeAttachments([{ name: 'demo.png', previewUrl: 'data:image/png;base64,AAA' }]))).toBe(true);
    expect(hasDraftContent('', [])).toBe(false);
  });

  it('keeps browser fallback attachments that only have previewUrl data', () => {
    expect(normalizeAttachments([{ name: 'demo.png', previewUrl: 'data:image/png;base64,AAA' }])).toEqual([
      {
        id: 'legacy-0-demo.png',
        type: 'image',
        name: 'demo.png',
        mimeType: 'image/png',
        path: 'data:image/png;base64,AAA',
        size: 0,
        previewUrl: 'data:image/png;base64,AAA',
        position: 0,
      },
    ]);
  });

  it('keeps attachments anchored to their text when the body changes', () => {
    const attachments = normalizeAttachments([
      { id: 'before', name: 'before.png', path: '/before.png', position: 3 },
      { id: 'after', name: 'after.png', path: '/after.png', position: 6 },
    ]);

    expect(remapAttachmentPositions(attachments, 'Hello world', 'Hello brave world').map(({ id, position }) => ({ id, position })))
      .toEqual([{ id: 'before', position: 3 }, { id: 'after', position: 12 }]);
  });

  it('opens the compact schedule shell by default for the active preview state', async () => {
    document.body.dataset.livePreview = 'true';

    const { unmount } = await renderWorkspacePage();

    expect(document.querySelector('.workspace-page-rich-text-schedule-stage.is-active')).not.toBeNull();
    expect(document.querySelector('.workspace-page-schedule-empty-panel')).not.toBeNull();

    document.body.removeAttribute('data-live-preview');
    unmount();
  });

  it('hides the drafts control while the composer is in schedule mode', async () => {
    document.body.dataset.livePreview = 'true';
    try {
      const { unmount } = await renderWorkspacePage();
      const draftButton = Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Draft');
      expect(draftButton).toBeUndefined();
      unmount();
    } finally {
      document.body.removeAttribute('data-live-preview');
    }
  });

  it('removes the legacy preview eyelashes and keeps the compact mode row flexible', async () => {
    localStorage.setItem('xmsgi-preview-layout', JSON.stringify({ visible: true }));
    const { unmount } = await renderWorkspacePage();
    const toggle = document.querySelector<HTMLButtonElement>('button[aria-label="Hide preview"]');

    try {
      expect(toggle?.getAttribute('aria-label')).toBe('Hide preview');
      await act(async () => {
        toggle?.click();
      });

      expect(toggle?.getAttribute('aria-label')).toBe('Show preview');
      expect(toggle?.querySelector('.workspace-page-preview-eyelashes')).toBeNull();

      const modeButtons = [...document.querySelectorAll('.workspace-page-mode-button, .workspace-page-schedule-compact-button')];
      expect(modeButtons.length).toBeGreaterThan(0);
      modeButtons.forEach((button) => {
        const style = getComputedStyle(button);
        expect(style.minWidth).not.toBe('96px');
        expect(style.flexBasis).not.toBe('96px');
      });
    } finally {
      unmount();
    }
  });

  it('registers the existing draft editor for History Drawer draft actions', async () => {
    const registerDraftOpener = vi.fn();
    const { unmount } = await renderWorkspacePage({ onRegisterHistoryDraftOpener: registerDraftOpener });
    const draft = {
      id: 'history-draft-1',
      name: 'History draft',
      body: 'Draft opened from history',
      createdAt: '2026-09-29T17:00:00.000Z',
      updatedAt: '2026-09-29T18:00:00.000Z',
    };

    expect(registerDraftOpener).toHaveBeenCalledWith(expect.any(Function));
    await act(async () => {
      registerDraftOpener.mock.calls[0][0](draft);
    });

    expect(document.querySelector('.workspace-page-rich-text-draft-stage.is-active')).not.toBeNull();
    unmount();
  });

  it('restores a scheduled post in the editor without canceling it immediately', async () => {
    const registerRescheduler = vi.fn();
    const handleCancelMessage = vi.fn();
    const setSelectedChat = vi.fn();
    const setDate = vi.fn();
    const setTime = vi.fn();
    const scheduledAt = new Date('2035-01-15T18:30:00.000Z');
    const message: ScheduledMessage = {
      id: 'studio-reschedule-1',
      chatId: chatA.id,
      chatName: chatA.name,
      text: 'Restore this scheduled post',
      when: scheduledAt.toISOString(),
      createdAt: '2035-01-15T17:00:00.000Z',
      status: 'confirmed',
      attachments: ['C:\\files\\brief.pdf'],
      entities: [{ type: 'bold', offset: 0, length: 7 }],
    };
    const { rerender, unmount } = await renderWorkspacePage({
      onRegisterHistoryRescheduleHandler: registerRescheduler,
      handleCancelMessage,
      setSelectedChat,
      setDate,
      setTime,
    });
    const menuToggle = document.querySelector<HTMLButtonElement>('.workspace-page-publish-menu-toggle')!;
    await act(async () => {
      menuToggle.click();
    });
    const scheduleOption = Array.from(document.querySelectorAll('.workspace-page-publish-option'))
      .find((button) => button.textContent?.trim() === 'Schedule') as HTMLButtonElement;
    await act(async () => {
      scheduleOption.click();
    });
    const timeButton = Array.from(document.querySelectorAll('.workspace-page-schedule-compact-button'))
      .find((button) => button.textContent?.trim() === 'Time') as HTMLButtonElement;
    await act(async () => {
      timeButton.click();
    });
    const dayInput = document.querySelector<HTMLInputElement>('[aria-label="Day"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(dayInput, '99');
      dayInput.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(registerRescheduler).toHaveBeenCalledWith(expect.any(Function));
    await act(async () => {
      registerRescheduler.mock.calls[0][0](message);
    });

    const expectedDate = `${scheduledAt.getFullYear()}-${String(scheduledAt.getMonth() + 1).padStart(2, '0')}-${String(scheduledAt.getDate()).padStart(2, '0')}`;
    const expectedTime = `${String(scheduledAt.getHours()).padStart(2, '0')}:${String(scheduledAt.getMinutes()).padStart(2, '0')}`;
    rerender({
      date: expectedDate,
      time: expectedTime,
    });
    const editor = document.querySelector<HTMLDivElement>('.workspace-page-rich-text-input.is-active')!;
    Object.defineProperties(editor, {
      scrollHeight: { configurable: true, value: 900 },
      clientHeight: { configurable: true, value: 200 },
    });
    await act(async () => {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    });

    expect(setSelectedChat).toHaveBeenCalledWith(chatA);
    expect(setDate).toHaveBeenCalledWith(expectedDate);
    expect(setTime).toHaveBeenCalledWith(expectedTime);
    expect(handleCancelMessage).not.toHaveBeenCalled();
    expect(editor.textContent).toContain(message.text);
    expect(document.activeElement).toBe(editor);
    expect(editor.scrollTop).toBe(700);
    expect(editor.dataset.selectionStart).toBe(String(message.text.length));
    expect(editor.dataset.selectionEnd).toBe(String(message.text.length));
    expect(document.querySelector<HTMLInputElement>('[aria-label="Day"]')?.value).toBe(String(scheduledAt.getDate()));
    expect(document.querySelector<HTMLInputElement>('[aria-label="Month"]')?.value).toBe(String(scheduledAt.getMonth() + 1).padStart(2, '0'));
    expect(document.querySelector<HTMLInputElement>('[aria-label="Year"]')?.value).toBe(String(scheduledAt.getFullYear()));
    expect(document.querySelector<HTMLInputElement>('[aria-label="Schedule time"]')?.value).toBe(expectedTime);

    unmount();
  });

  it('preserves all scheduled post data when draft hydration finishes after rescheduling starts', async () => {
    let finishDraftLoad!: (result: Awaited<ReturnType<typeof window.draftStorage.load>>) => void;
    inMemoryDraftStore = {
      schemaVersion: 2,
      migrationVersion: 1,
      savedDrafts: [],
      workspaceDraft: {
        body: 'An older workspace draft',
        entities: [],
        attachments: [{ name: 'old.pdf', path: 'C:\\files\\old.pdf' }],
        savedAt: '10:00',
        selectedChat: chatA,
        date: '2026-01-10',
        time: '09:00',
        repeatMode: 'none',
        repeatDays: [],
        repeatOccurrences: 5,
      },
    };
    vi.mocked(window.draftStorage.load).mockImplementationOnce(() => new Promise((resolve) => {
      finishDraftLoad = resolve;
    }));

    const registerRescheduler = vi.fn();
    const setDate = vi.fn();
    const setTime = vi.fn();
    const scheduledAt = new Date('2035-01-15T18:30:00.000Z');
    const message: ScheduledMessage = {
      id: 'studio-reschedule-before-hydration',
      chatId: chatA.id,
      chatName: chatA.name,
      text: 'Keep this exact scheduled text',
      when: scheduledAt.toISOString(),
      createdAt: '2035-01-15T17:00:00.000Z',
      status: 'confirmed',
      attachments: ['C:\\files\\brief.pdf', 'C:\\files\\photo.png'],
      entities: [{ type: 'bold', offset: 10, length: 5 }],
      replyMarkup: { inline_keyboard: [[{ text: 'Original button', url: 'https://example.com' }]] },
    };
    const { rerender, unmount } = await renderWorkspacePage({
      onRegisterHistoryRescheduleHandler: registerRescheduler,
      upcoming: [message],
      setDate,
      setTime,
    });

    try {
      await act(async () => {
        registerRescheduler.mock.calls[0][0](message);
      });
      const expectedDate = `${scheduledAt.getFullYear()}-${String(scheduledAt.getMonth() + 1).padStart(2, '0')}-${String(scheduledAt.getDate()).padStart(2, '0')}`;
      const expectedTime = `${String(scheduledAt.getHours()).padStart(2, '0')}:${String(scheduledAt.getMinutes()).padStart(2, '0')}`;
      rerender({ date: expectedDate, time: expectedTime });
      await act(async () => {
        finishDraftLoad({
          success: true,
          store: JSON.parse(JSON.stringify(inMemoryDraftStore)),
        });
      });

      const editor = document.querySelector('.workspace-page-rich-text-input.is-active');
      expect(editor?.textContent).toContain(message.text);
      expect(editor?.textContent).not.toContain('An older workspace draft');
      expect(document.body.textContent).toContain('brief.pdf');
      expect(document.body.textContent).toContain('photo.png');
      expect(document.querySelector<HTMLInputElement>('[aria-label="Schedule time"]')?.value)
        .toBe(expectedTime);
      expect(setDate).toHaveBeenCalledWith(expectedDate);
      expect(setDate).not.toHaveBeenCalledWith('2026-01-10');
      expect(setTime).toHaveBeenCalledWith(expectedTime);
      expect(setTime).not.toHaveBeenCalledWith('09:00');
      expect(document.querySelector('.workspace-page-rich-text-input.is-active strong')?.textContent).toBe('exact');
      expect(document.body.textContent).toContain('Original button');
    } finally {
      unmount();
    }
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

  it('closes the schedule stage after a successful schedule result', async () => {
    const handleSchedule = vi.fn();
    const setTime = vi.fn();
    const { rerender, unmount } = await renderWorkspacePage({
      date: '2035-01-15',
      time: '18:30',
      setTime,
      handleSchedule,
    });
    const menuToggle = document.querySelector<HTMLButtonElement>('.workspace-page-publish-menu-toggle')!;
    await act(async () => menuToggle.click());
    const scheduleOption = Array.from(document.querySelectorAll('.workspace-page-publish-option'))
      .find((button) => button.textContent?.trim() === 'Schedule') as HTMLButtonElement;
    await act(async () => scheduleOption.click());
    const timeButton = Array.from(document.querySelectorAll('.workspace-page-schedule-compact-button'))
      .find((button) => button.textContent?.trim() === 'Time') as HTMLButtonElement;
    await act(async () => timeButton.click());

    const scheduleStage = '.workspace-page-rich-text-schedule-stage.is-active';
    expect(document.querySelector(scheduleStage)).not.toBeNull();
    const openTimePicker = document.querySelector<HTMLButtonElement>('[aria-label="Open time picker"]')!;
    await act(async () => openTimePicker.click());
    const availableTimes = document.querySelector('[aria-label="Available times"]')!;
    const selectedTimeOption = Array.from(availableTimes.querySelectorAll<HTMLButtonElement>('[role="option"]'))
      .find((option) => option.textContent?.trim() === '20:15')!;
    await act(async () => selectedTimeOption.click());
    expect(setTime).toHaveBeenCalledWith('20:15');
    rerender({ time: '20:15' });

    const doneButton = document.querySelector<HTMLButtonElement>('.workspace-page-schedule-footer .workspace-page-stage-primary')!;
    await act(async () => doneButton.click());

    expect(handleSchedule).not.toHaveBeenCalled();
    expect(document.querySelector(scheduleStage)).toBeNull();
    const publishButton = document.querySelector<HTMLButtonElement>('.workspace-page-publish-main')!;
    await act(async () => publishButton.click());

    expect(handleSchedule).toHaveBeenCalledOnce();
  expect(handleSchedule.mock.calls[0][0]).toMatchObject({ date: '2035-01-15', time: '20:15' });
    expect(document.querySelector(scheduleStage)).toBeNull();
    rerender({ scheduling: true });
    expect(document.querySelector(scheduleStage)).toBeNull();
    rerender({ scheduling: false, lastAction: 'scheduled' });
    expect(document.querySelector(scheduleStage)).toBeNull();
    unmount();
  });

  it('keeps the schedule stage open when scheduling fails', async () => {
    const handleSchedule = vi.fn();
    const { rerender, unmount } = await renderWorkspacePage({
      date: '2035-01-15',
      time: '18:30',
      handleSchedule,
    });
    const menuToggle = document.querySelector<HTMLButtonElement>('.workspace-page-publish-menu-toggle')!;
    await act(async () => menuToggle.click());
    const scheduleOption = Array.from(document.querySelectorAll('.workspace-page-publish-option'))
      .find((button) => button.textContent?.trim() === 'Schedule') as HTMLButtonElement;
    await act(async () => scheduleOption.click());
    const timeButton = Array.from(document.querySelectorAll('.workspace-page-schedule-compact-button'))
      .find((button) => button.textContent?.trim() === 'Time') as HTMLButtonElement;
    await act(async () => timeButton.click());

    const scheduleStage = '.workspace-page-rich-text-schedule-stage.is-active';
    const publishButton = document.querySelector<HTMLButtonElement>('.workspace-page-publish-main')!;
    await act(async () => publishButton.click());
    expect(handleSchedule).toHaveBeenCalledOnce();
    rerender({ scheduling: true });
    rerender({ scheduling: false, lastAction: null });

    expect(document.querySelector(scheduleStage)).not.toBeNull();
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

    expect(document.querySelector('.workspace-page-publish-transient-feedback')?.textContent).toBe('Enter a message.');
    expect(document.querySelector('.workspace-page-publish-transient-feedback')?.parentElement?.classList.contains('workspace-page-draft-footer')).toBe(true);
    expect(document.querySelector('.workspace-page-publish-footer-content')?.classList.contains('is-feedback-hidden')).toBe(true);
    expect(inMemoryDraftStore.savedDrafts).toHaveLength(0);

    const firstFeedback = document.querySelector('.workspace-page-publish-transient-feedback');
    await act(async () => {
      (document.querySelector('.workspace-page-publish-main') as HTMLButtonElement).click();
    });
    const repeatedFeedback = document.querySelector('.workspace-page-publish-transient-feedback');
    expect(repeatedFeedback?.textContent).toBe('Enter a message.');
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

  it('keeps the editor preview and removes the duplicate queue UI', async () => {
    const { unmount } = await renderWorkspacePage();

    const actionGroup = document.querySelector('.workspace-page-action-left-group');
    expect(actionGroup?.querySelector('.workspace-page-mode-button-history')).toBeNull();
    expect(actionGroup?.textContent).not.toContain('Queue / History');
    expect(document.querySelector('.workspace-page-preview-panel')).not.toBeNull();
    expect(document.querySelector('.messages-panel')).toBeNull();

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
    expect(document.querySelector('.workspace-page-publish-transient-feedback')?.textContent).toBe('Sending…');
    expect((document.querySelector('.workspace-page-publish-main') as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      resolveFirstSend?.(false);
      await Promise.resolve();
    });
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Could not send the message.');
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
    expect(document.querySelector('.workspace-page-publish-transient-feedback')?.textContent).toBe('Message sent.');
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
    expect(document.querySelector('.workspace-page-publish-transient-feedback.is-warning')?.textContent).toBe('Enter a message.');
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
    expect(document.querySelector('.workspace-page-publish-transient-feedback')?.textContent).toBe('Sending…');

    await act(async () => {
      resolveSend?.(true);
      await Promise.resolve();
    });
    expect(document.querySelector('.workspace-page-publish-transient-feedback.is-success')?.textContent).toBe('Message sent.');
    unmount();
  });

  it('keeps the Draft button after Templates and opens its stage', async () => {
    const { unmount } = await renderWorkspacePage();

    const actionGroup = document.querySelector('.workspace-page-action-left-group');
    const leftGroupButtons = Array.from(actionGroup?.querySelectorAll(':scope > button') ?? [])
      .map((button) => button.textContent?.trim());

    expect(leftGroupButtons).toContain('Draft');
    expect(leftGroupButtons).not.toContain('Queue / History');
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
    expect(document.querySelector('.workspace-page-publish-transient-feedback')?.textContent).toBe('Draft saved.');
    expect(document.querySelector('.workspace-page-publish-transient-feedback')?.classList.contains('is-success')).toBe(true);

    const activeActionGroup = document.querySelector('.workspace-page-action-left-group');
    const actionButtons = Array.from(activeActionGroup?.querySelectorAll(':scope > button') ?? []);
    const draftToggle = actionButtons.find((button) => button.textContent?.trim() === 'Draft');
    const templatesButtonIndex = actionButtons.findIndex((button) => button.textContent?.trim() === 'Templates');

    expect(draftToggle).not.toBeNull();
    expect(templatesButtonIndex).toBeGreaterThanOrEqual(0);
    expect(actionButtons.indexOf(draftToggle as HTMLButtonElement)).toBe(templatesButtonIndex + 1);
    expect(draftToggle?.classList.contains('workspace-page-mode-button-template')).toBe(true);
    expect(draftToggle?.classList.contains('is-active')).toBe(false);
    expect(draftToggle?.getAttribute('aria-pressed')).toBe('false');
    expect(draftToggle?.classList.contains('workspace-page-schedule-compact-button')).toBe(false);
    expect((draftToggle as HTMLButtonElement | undefined)?.title).toBe('Open saved drafts');

    await act(async () => {
      (draftToggle as HTMLButtonElement).click();
    });

    expect(document.querySelector('.workspace-page-rich-text-draft-stage.is-active strong')?.textContent).toBe('Saved drafts');
  expect(draftToggle?.classList.contains('is-active')).toBe(true);
  expect(draftToggle?.getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('.workspace-page-rich-text-draft-stage .workspace-page-template-stage-item strong')?.textContent).toMatch(/^Draft /);

    unmount();
  });

  it('keeps legacy data untouched when file-store migration fails', async () => {
    localStorage.setItem('awaitmsg-workspace-draft', JSON.stringify({
      body: 'Draft text remains available',
      entities: [],
      attachments: [],
      savedAt: '18:00',
    }));
    const legacyWorkspace = localStorage.getItem('awaitmsg-workspace-draft');
    vi.mocked(window.draftStorage.migrate).mockResolvedValueOnce({
      success: false,
      code: 'WRITE_FAILED',
      error: 'Disk unavailable',
    });

    const { unmount } = await renderWorkspacePage();

    expect(localStorage.getItem('awaitmsg-workspace-draft')).toBe(legacyWorkspace);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Disk unavailable');

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
    });

    expect(document.querySelector('.workspace-page-publish-transient-feedback.is-warning')?.textContent).toContain('Disk unavailable');
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
    expect(document.querySelector('.workspace-page-publish-transient-feedback')?.textContent).toBe('Backup exported.');

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
    expect(document.querySelector('.workspace-page-publish-transient-feedback')?.textContent).toBe('Drafts imported.');
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
    expect(document.querySelector('.workspace-page-publish-transient-feedback.is-success')?.textContent).toBe('Draft deleted.');
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

    expect(confirmDelete).toHaveBeenCalledWith('Delete template “Welcome”?');
    expect(document.querySelector('.workspace-page-rich-text-template-stage .workspace-page-template-stage-item')).toBeNull();
    expect(document.querySelector('.workspace-page-publish-transient-feedback.is-success')?.textContent).toBe('Template deleted.');
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

    expect(document.querySelector('.workspace-page-publish-transient-feedback.is-success')?.textContent).toBe('Template created.');
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

    expect(document.querySelector('.workspace-page-publish-transient-feedback.is-success')?.textContent).toBe('Template updated.');
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
    expect(document.querySelector('.workspace-page-publish-transient-feedback')?.textContent).toBe('Text imported into the editor.');
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
    expect(document.querySelector('.workspace-page-publish-transient-feedback.is-error')?.textContent)
      .toContain("The chat preview couldn't load history.");
    expect(document.querySelector('.workspace-page-publish-transient-feedback .workspace-page-send-retry')?.textContent).toBe('Retry');
    unmount();
  });

  it('explains forbidden chat history without offering a retry', async () => {
    vi.mocked(window.telegram.getChatHistory).mockResolvedValueOnce({ success: false, error: 'CHAT_FORBIDDEN' });
    const { unmount } = await renderWorkspacePage({ connected: true });

    const feedback = document.querySelector('.workspace-page-publish-transient-feedback.is-error');
    expect(feedback?.textContent).toContain("You don't have access to this chat.");
    expect(feedback?.querySelector('.workspace-page-send-retry')).toBeNull();
    unmount();
  });

  it('does not expose instanceof runtime errors in preview history feedback', async () => {
    vi.mocked(window.telegram.getChatHistory).mockRejectedValueOnce(new TypeError("Right-hand side of 'instanceof' is not callable"));
    const { unmount } = await renderWorkspacePage({ connected: true });

    const feedback = document.querySelector('.workspace-page-publish-transient-feedback.is-error');
    expect(feedback?.textContent).toContain("The chat preview couldn't load history.");
    expect(feedback?.textContent).not.toContain('instanceof');
    expect(feedback?.querySelector('.workspace-page-send-retry')?.textContent).toBe('Retry');
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

  it('reserves the aggregate attachment limit across overlapping selections', async () => {
    const pendingCopies: Array<(result: { success: boolean; attachment?: { name: string; path: string; size: number } }) => void> = [];
    vi.mocked(window.draftStorage.copyAttachment).mockImplementation(() => new Promise((resolve) => {
      pendingCopies.push(resolve);
    }));
    const filesForBatch = (prefix: string) => Array.from({ length: 4 }, (_, index) => {
      const file = new File([''], `${prefix}-${index}.png`, { type: 'image/png' });
      Object.defineProperty(file, 'size', { value: 50 * 1024 * 1024 });
      return file;
    });
    const firstBatch = filesForBatch('first');
    const secondBatch = filesForBatch('second');
    const { unmount } = await renderWorkspacePage();
    const fileInput = document.querySelector('.workspace-page-hidden-file-input') as HTMLInputElement;

    await act(async () => {
      Object.defineProperty(fileInput, 'files', { value: firstBatch, configurable: true });
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      Object.defineProperty(fileInput, 'files', { value: secondBatch, configurable: true });
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });

    expect(window.draftStorage.copyAttachment).toHaveBeenCalledTimes(4);
    expect(document.querySelector('.workspace-page-publish-transient-feedback.is-error')?.textContent)
      .toContain('200 MB');

    await act(async () => {
      pendingCopies.forEach((resolve, index) => resolve({
        success: true,
        attachment: { name: firstBatch[index].name, path: `/stored/${firstBatch[index].name}`, size: firstBatch[index].size },
      }));
      await Promise.resolve();
    });

    expect(document.querySelectorAll('.workspace-page-attachment-card')).toHaveLength(4);
    unmount();
  });

  it('does not attach stale files after a successful publish clears the composer', async () => {
    let resolveCopy!: (result: { success: boolean; attachment?: { name: string; path: string; size: number } }) => void;
    const copyPromise = new Promise<{ success: boolean; attachment?: { name: string; path: string; size: number } }>((resolve) => {
      resolveCopy = resolve;
    });
    vi.mocked(window.draftStorage.copyAttachment).mockReturnValue(copyPromise);
    const { rerender, unmount } = await renderWorkspacePage();
    const file = new File(['image'], 'late-photo.png', { type: 'image/png' });
    const fileInput = document.querySelector('.workspace-page-hidden-file-input') as HTMLInputElement;

    await act(async () => {
      Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });
    expect(window.draftStorage.copyAttachment).toHaveBeenCalledTimes(1);

    rerender({ successPulse: true });
    resolveCopy({
      success: true,
      attachment: { name: file.name, path: `/stored/${file.name}`, size: file.size },
    });

    await act(async () => {
      await copyPromise;
      await Promise.resolve();
    });

    expect(document.querySelectorAll('.workspace-page-attachment-card')).toHaveLength(0);
    unmount();
  });

  it('releases failed file reservations while retaining reservations for copied files', async () => {
    const pendingCopies: Array<(result: { success: boolean; attachment?: { name: string; path: string; size: number }; error?: string }) => void> = [];
    vi.mocked(window.draftStorage.copyAttachment).mockImplementation(() => new Promise((resolve) => {
      pendingCopies.push(resolve);
    }));
    const makeFile = (name: string) => {
      const file = new File([''], name, { type: 'image/png' });
      Object.defineProperty(file, 'size', { value: 50 * 1024 * 1024 });
      return file;
    };
    const firstBatch = Array.from({ length: 4 }, (_, index) => makeFile(`partial-${index}.png`));
    const { unmount } = await renderWorkspacePage();
    const fileInput = document.querySelector('.workspace-page-hidden-file-input') as HTMLInputElement;

    await act(async () => {
      Object.defineProperty(fileInput, 'files', { value: firstBatch, configurable: true });
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });
    expect(window.draftStorage.copyAttachment).toHaveBeenCalledTimes(4);

    await act(async () => {
      pendingCopies.slice(0, 3).forEach((resolve, index) => resolve({
        success: true,
        attachment: { name: firstBatch[index].name, path: `/stored/${firstBatch[index].name}`, size: firstBatch[index].size },
      }));
      pendingCopies[3]({ success: false, error: 'Simulated copy failure.' });
    });
    expect(document.querySelectorAll('.workspace-page-attachment-card')).toHaveLength(3);

    const nextFile = makeFile('after-partial-failure.png');
    await act(async () => {
      Object.defineProperty(fileInput, 'files', { value: [nextFile], configurable: true });
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });
    expect(window.draftStorage.copyAttachment).toHaveBeenCalledTimes(5);

    await act(async () => {
      pendingCopies[4]({
        success: true,
        attachment: { name: nextFile.name, path: `/stored/${nextFile.name}`, size: nextFile.size },
      });
    });
    expect(document.querySelectorAll('.workspace-page-attachment-card')).toHaveLength(4);

    const overLimitFile = new File(['extra'], 'over-limit.png', { type: 'image/png' });
    await act(async () => {
      Object.defineProperty(fileInput, 'files', { value: [overLimitFile], configurable: true });
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });
    expect(window.draftStorage.copyAttachment).toHaveBeenCalledTimes(5);
    expect(document.querySelector('.workspace-page-publish-transient-feedback.is-error')?.textContent)
      .toContain('200 MB');
    unmount();
  });

  it('allows a new-generation upload before old copies settle and ignores their late results', async () => {
    const pendingCopies: Array<(result: { success: boolean; attachment?: { name: string; path: string; size: number } }) => void> = [];
    vi.mocked(window.draftStorage.copyAttachment).mockImplementation(() => new Promise((resolve) => {
      pendingCopies.push(resolve);
    }));
    const makeFile = (name: string, size: number) => {
      const file = new File([''], name, { type: 'image/png' });
      Object.defineProperty(file, 'size', { value: size });
      return file;
    };
    const staleBatch = Array.from({ length: 4 }, (_, index) => makeFile(`old-${index}.png`, 50 * 1024 * 1024));
    const nextFile = makeFile('new-draft.png', 1024);
    const { rerender, unmount } = await renderWorkspacePage();
    const fileInput = document.querySelector('.workspace-page-hidden-file-input') as HTMLInputElement;

    await act(async () => {
      Object.defineProperty(fileInput, 'files', { value: staleBatch, configurable: true });
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });
    expect(window.draftStorage.copyAttachment).toHaveBeenCalledTimes(4);

    rerender({ successPulse: true });
    await act(async () => {
      Object.defineProperty(fileInput, 'files', { value: [nextFile], configurable: true });
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });
    expect(window.draftStorage.copyAttachment).toHaveBeenCalledTimes(5);

    await act(async () => {
      pendingCopies[4]({
        success: true,
        attachment: { name: nextFile.name, path: `/stored/${nextFile.name}`, size: nextFile.size },
      });
    });
    expect(document.querySelectorAll('.workspace-page-attachment-card')).toHaveLength(1);

    await act(async () => {
      pendingCopies.slice(0, 4).forEach((resolve, index) => resolve({
        success: true,
        attachment: { name: staleBatch[index].name, path: `/stored/${staleBatch[index].name}`, size: staleBatch[index].size },
      }));
    });
    expect(document.querySelectorAll('.workspace-page-attachment-card')).toHaveLength(1);
    expect(document.querySelector('.workspace-page-attachment-name')?.textContent).toBe(nextFile.name);
    unmount();
  });

  it('does not let an old upload overwrite a selected saved draft', async () => {
    const pendingCopies: Array<(result: { success: boolean; attachment?: { name: string; path: string; size: number } }) => void> = [];
    vi.mocked(window.draftStorage.copyAttachment).mockImplementation(() => new Promise((resolve) => {
      pendingCopies.push(resolve);
    }));
    inMemoryDraftStore.savedDrafts = [{
      id: 'generation-draft',
      name: 'Transition draft',
      body: 'New draft body',
      createdAt: '2026-09-28T10:00:00.000Z',
      updatedAt: '2026-09-29T18:35:00.000Z',
      attachments: [],
    }];
    inMemoryDraftStore.migrationVersion = 1;
    const oldFiles = Array.from({ length: 4 }, (_, index) => {
      const file = new File([''], `old-draft-${index}.png`, { type: 'image/png' });
      Object.defineProperty(file, 'size', { value: 50 * 1024 * 1024 });
      return file;
    });
    const nextFile = new File(['new'], 'saved-draft-upload.png', { type: 'image/png' });
    const { unmount } = await renderWorkspacePage();
    const fileInput = document.querySelector('.workspace-page-hidden-file-input') as HTMLInputElement;

    await act(async () => {
      Object.defineProperty(fileInput, 'files', { value: oldFiles, configurable: true });
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });
    expect(window.draftStorage.copyAttachment).toHaveBeenCalledTimes(4);

    await openDraftsStage();
    const draftButton = Array.from(document.querySelectorAll('.workspace-page-rich-text-draft-stage button'))
      .find((button) => button.textContent?.includes('Transition draft')) as HTMLButtonElement;
    expect(draftButton).toBeTruthy();
    await act(async () => { draftButton.click(); });

    await act(async () => {
      Object.defineProperty(fileInput, 'files', { value: [nextFile], configurable: true });
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });
    expect(window.draftStorage.copyAttachment).toHaveBeenCalledTimes(5);

    await act(async () => {
      pendingCopies[4]({
        success: true,
        attachment: { name: nextFile.name, path: `/stored/${nextFile.name}`, size: nextFile.size },
      });
    });
    await act(async () => {
      pendingCopies.slice(0, 4).forEach((resolve, index) => resolve({
        success: true,
        attachment: { name: oldFiles[index].name, path: `/stored/${oldFiles[index].name}`, size: oldFiles[index].size },
      }));
    });

    expect(document.querySelectorAll('.workspace-page-attachment-card')).toHaveLength(1);
    expect(document.querySelector('.workspace-page-attachment-name')?.textContent).toBe(nextFile.name);
    expect(document.querySelector('.workspace-page-rich-text-input')?.textContent).toContain('New draft body');
    unmount();
  });

  it('ignores old uploads when persisted draft restoration replaces the composer', async () => {
    const pendingCopies: Array<(result: { success: boolean; attachment?: { name: string; path: string; size: number } }) => void> = [];
    vi.mocked(window.draftStorage.copyAttachment).mockImplementation(() => new Promise((resolve) => {
      pendingCopies.push(resolve);
    }));
    let resolveLoad!: (result: Awaited<ReturnType<typeof window.draftStorage.load>>) => void;
    vi.mocked(window.draftStorage.load).mockImplementation(() => new Promise((resolve) => {
      resolveLoad = resolve;
    }));
    const staleFiles = Array.from({ length: 4 }, (_, index) => {
      const file = new File([''], `before-restore-${index}.png`, { type: 'image/png' });
      Object.defineProperty(file, 'size', { value: 50 * 1024 * 1024 });
      return file;
    });
    const newFile = new File(['new'], 'after-restore.png', { type: 'image/png' });
    const { unmount } = await renderWorkspacePage();
    const fileInput = document.querySelector('.workspace-page-hidden-file-input') as HTMLInputElement;

    await act(async () => {
      Object.defineProperty(fileInput, 'files', { value: staleFiles, configurable: true });
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });
    expect(window.draftStorage.copyAttachment).toHaveBeenCalledTimes(4);

    resolveLoad({
      success: true,
      needsMigration: false,
      store: {
        schemaVersion: 2,
        migrationVersion: 1,
        savedDrafts: [],
        workspaceDraft: { body: 'Restored workspace draft', attachments: [] },
      },
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      Object.defineProperty(fileInput, 'files', { value: [newFile], configurable: true });
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });
    expect(window.draftStorage.copyAttachment).toHaveBeenCalledTimes(5);

    await act(async () => {
      pendingCopies[4]({
        success: true,
        attachment: { name: newFile.name, path: `/stored/${newFile.name}`, size: newFile.size },
      });
      pendingCopies.slice(0, 4).forEach((resolve, index) => resolve({
        success: true,
        attachment: { name: staleFiles[index].name, path: `/stored/${staleFiles[index].name}`, size: staleFiles[index].size },
      }));
    });

    expect(document.querySelector('.workspace-page-rich-text-input')?.textContent).toContain('Restored workspace draft');
    expect(Array.from(document.querySelectorAll('.workspace-page-attachment-name')).map((node) => node.textContent))
      .toEqual([newFile.name]);
    unmount();
  });

  it('keeps only the scheduled and new files when rescheduling during an old upload', async () => {
    const pendingCopies: Array<(result: { success: boolean; attachment?: { name: string; path: string; size: number } }) => void> = [];
    vi.mocked(window.draftStorage.copyAttachment).mockImplementation(() => new Promise((resolve) => {
      pendingCopies.push(resolve);
    }));
    const registerRescheduler = vi.fn();
    const staleFiles = Array.from({ length: 4 }, (_, index) => {
      const file = new File([''], `stale-${index}.png`, { type: 'image/png' });
      Object.defineProperty(file, 'size', { value: 50 * 1024 * 1024 });
      return file;
    });
    const newFile = new File(['new'], 'after-reschedule.png', { type: 'image/png' });
    const scheduledPost: ScheduledMessage = {
      id: 'reschedule-with-pending-upload',
      chatId: chatA.id,
      chatName: chatA.name,
      text: 'Existing scheduled post',
      when: '2035-01-15T18:30:00.000Z',
      createdAt: '2035-01-15T17:00:00.000Z',
      status: 'scheduled',
      attachments: ['C:\\scheduled\\brief.pdf'],
    };
    const { unmount } = await renderWorkspacePage({ onRegisterHistoryRescheduleHandler: registerRescheduler });
    const fileInput = document.querySelector('.workspace-page-hidden-file-input') as HTMLInputElement;

    await act(async () => {
      Object.defineProperty(fileInput, 'files', { value: staleFiles, configurable: true });
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });
    expect(window.draftStorage.copyAttachment).toHaveBeenCalledTimes(4);

    await act(async () => {
      registerRescheduler.mock.calls[0][0](scheduledPost);
    });
    await act(async () => {
      Object.defineProperty(fileInput, 'files', { value: [newFile], configurable: true });
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });
    expect(window.draftStorage.copyAttachment).toHaveBeenCalledTimes(5);

    await act(async () => {
      pendingCopies[4]({
        success: true,
        attachment: { name: newFile.name, path: `/stored/${newFile.name}`, size: newFile.size },
      });
      pendingCopies.slice(0, 4).forEach((resolve, index) => resolve({
        success: true,
        attachment: { name: staleFiles[index].name, path: `/stored/${staleFiles[index].name}`, size: staleFiles[index].size },
      }));
    });

    expect(Array.from(document.querySelectorAll('.workspace-page-attachment-name')).map((node) => node.textContent))
      .toEqual(['brief.pdf', newFile.name]);
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
    Object.defineProperty(closeEvent, 'returnValue', { configurable: true, value: '', writable: true });

    await act(async () => {
      window.dispatchEvent(closeEvent);
      await Promise.resolve();
    });

    expect(closeEvent.defaultPrevented).toBe(true);
    expect(String(closeEvent.returnValue)).toContain('Draft data could not be saved');
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
    localStorage.setItem('awaitmsg_locale', 'en');
    localStorage.setItem('xmsgi-default-draft-seeded-v1', '1');
    localStorage.setItem('xmsgi-default-template-seeded-v1', '1');
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
      expect(savedDraft.attachments).toMatchObject([{ name: 'photo.png', path: '/tmp/photo.png', size: 1234 }]);
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
