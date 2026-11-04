import { createElement, type ReactNode } from 'react';
import { act, fireEvent, render as renderTestingLibrary, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Chat, ScheduledMessage } from '@/types';
import { LocaleProvider } from '@/lib/i18n';
import { DEFAULT_EDITOR_APPEARANCE, writeEditorAppearancePreferences } from '@shared/editorAppearance';
import {
  flushPlannerDraftWrite,
  MAX_PLANNER_ATTACHMENTS,
  readPlannerDraft,
  readPlannerDraftAttachments,
  readPlannerDraftEntities,
  writePlannerDraft,
} from '../lib/plannerDraft';
import { QuickPlanner } from './QuickPlanner';
import { QuickPlannerNavigationContext } from '../workspace/QuickPlannerNavigationContext';

const quickPlannerStyles = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'QuickPlanner.css'), 'utf8');
const activityStyles = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'QuickPlannerActivity.css'), 'utf8');
const globalStyles = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../index.css'), 'utf8');
const colorThemeStyles = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../styles/colorThemes.css'), 'utf8');

function render(ui: ReactNode, initialMode: 'Send now' | 'Schedule' = 'Schedule') {
  const view = renderTestingLibrary(createElement(LocaleProvider, null, ui));
  if (initialMode === 'Schedule') {
    const scheduleMode = view.container.querySelectorAll<HTMLButtonElement>('.quick-planner-mode-switch button')[1];
    fireEvent.click(scheduleMode);
  }
  return view;
}

function createScheduledMessage(overrides: Partial<ScheduledMessage> = {}): ScheduledMessage {
  return {
    id: 'message-1',
    chatId: 'chat-1',
    chatName: 'Test chat',
    text: 'A scheduled message',
    when: '2035-05-12T15:00:00.000Z',
    createdAt: '2035-05-10T10:00:00.000Z',
    status: 'scheduled',
    ...overrides,
  };
}

describe('QuickPlanner feedback', () => {
  beforeEach(() => {
    flushPlannerDraftWrite();
    for (const key of [
      'xmsgi-planner-draft-text',
      'xmsgi-planner-draft-updated-at',
      'xmsgi-planner-draft-entities',
      'xmsgi-planner-draft-attachments',
      'xmsgi-planner-draft-snapshot-v1',
      'xmsgi:active-draft:v1',
    ]) localStorage.removeItem(key);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    flushPlannerDraftWrite();
    vi.restoreAllMocks();
    Reflect.deleteProperty(window, 'telegram');
    Reflect.deleteProperty(window, 'draftStorage');
    localStorage.removeItem('xmsgi-quick-planner-recent-emojis');
    localStorage.removeItem('awaitmsg_locale');
    for (const key of [
      'xmsgi-planner-draft-text',
      'xmsgi-planner-draft-updated-at',
      'xmsgi-planner-draft-entities',
      'xmsgi-planner-draft-attachments',
      'xmsgi-planner-draft-snapshot-v1',
      'xmsgi:active-draft:v1',
    ]) localStorage.removeItem(key);
  });

  it('hides the Activity panel at the narrow Planner breakpoint', () => {
    expect(quickPlannerStyles).toMatch(
      /@media \(max-width: 900px\)[\s\S]*?\.quick-planner-activity\s*\{\s*display:\s*none;\s*\}/,
    );
  });

  it('wraps action-mode labels inside narrow workbench buttons', () => {
    expect(quickPlannerStyles).toMatch(
      /@container quick-planner-workbench \(max-width: 620px\)\s*\{\s*\.quick-planner-mode-switch button\s*\{\s*flex-direction:\s*column;[^}]*font-size:\s*9px;[^}]*white-space:\s*normal;/,
    );
    expect(quickPlannerStyles).toMatch(
      /@container quick-planner-workbench \(max-width: 620px\)[\s\S]*?\.quick-planner-mode-switch button > span\s*\{[^}]*overflow-wrap:\s*anywhere;[^}]*text-align:\s*center;/,
    );
  });

  it('uses a gray text selection in the light Planner theme', () => {
    expect(colorThemeStyles).toMatch(
      /html\[data-theme='light'\] \.quick-planner::selection,\s*html\[data-theme='light'\] \.quick-planner ::selection\s*\{\s*background:\s*#d9dde0;\s*color:\s*#26343d;/,
    );
  });

  it('uses a light gray text selection in the dark Planner theme', () => {
    expect(quickPlannerStyles).toMatch(
      /html\[data-theme='dark'\] \.quick-planner \.quick-planner-message::selection\s*\{\s*background:\s*#c4c9cc;\s*color:\s*#20272c;/,
    );
  });

  it('shows reconnection progress in the Planner status area', () => {
    render(<QuickPlanner connectionRecoveryStatus="reconnecting" />, 'Send now');

    const status = document.querySelector('.quick-planner-action-feedback.is-connection-status');
    const spinner = status?.querySelector('.quick-planner-connection-spinner');
    expect(status).toHaveAttribute('role', 'status');
    expect(spinner).toBeInTheDocument();
    expect(globalStyles).toMatch(
      /\.quick-planner-connection-spinner,[\s\S]*?\.workspace-page-connection-spinner\s*\{[^}]*width:\s*13px;[^}]*height:\s*13px;[^}]*flex:\s*0 0 13px;[^}]*border-radius:\s*50%;[^}]*animation:\s*connection-status-spin 800ms linear infinite;/,
    );
    expect(quickPlannerStyles).toMatch(
      /\.quick-planner-compose-footer \.quick-planner-action-feedback > \.quick-planner-action-feedback-message\s*\{[^}]*width:\s*auto;/,
    );
    expect(quickPlannerStyles).not.toMatch(
      /\.quick-planner-compose-footer \.quick-planner-action-feedback > span\s*\{/,
    );
  });

  it('loads a selected history draft into the active Planner editor', () => {
    const request = {
      revision: 1,
      text: 'Continue editing this saved draft',
      attachments: ['C:/drafts/photo.png'],
      entities: [{ type: 'bold' as const, offset: 0, length: 8 }],
      restoreDraft: { text: '', attachments: [], entities: [] },
    };
    const onOpenInStudio = vi.fn();
    const view = render(<QuickPlanner />, 'Send now');
    view.rerender(createElement(LocaleProvider, null, <QuickPlanner draftLoadRequest={request} onOpenInStudio={onOpenInStudio} />));

    expect(view.container.querySelector<HTMLTextAreaElement>('.quick-planner-message')?.value)
      .toBe('Continue editing this saved draft');
    expect(view.container.querySelector('.quick-planner-attachment-name')).toHaveTextContent('photo.png');
    expect(readPlannerDraftAttachments()).toEqual(['C:/drafts/photo.png']);
    expect(readPlannerDraftEntities()).toEqual(request.entities);
    fireEvent.click(screen.getByRole('button', { name: 'Draft' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open in Studio' }));
    expect(onOpenInStudio).toHaveBeenCalledWith({
      text: request.text,
      attachments: request.attachments,
      entities: request.entities,
    });
  });

  it('limits imported Planner drafts to ten attachments before sending', async () => {
    const chat: Chat = { id: 'chat-imported-draft', name: 'Imported draft chat' };
    const attachments = Array.from({ length: MAX_PLANNER_ATTACHMENTS + 2 }, (_, index) => (
      `C:/drafts/photo-${index}.png`
    ));
    const request = {
      revision: 1,
      text: 'Imported draft',
      attachments,
      entities: [],
      restoreDraft: { text: '', attachments: [], entities: [] },
    };
    const onSendNow = vi.fn().mockResolvedValue(true);
    const view = render(
      <QuickPlanner chats={[chat]} selectedChat={chat} onSendNow={onSendNow} />,
      'Send now',
    );
    view.rerender(createElement(LocaleProvider, null, <QuickPlanner
      chats={[chat]}
      selectedChat={chat}
      draftLoadRequest={request}
      onSendNow={onSendNow}
    />));

    expect(view.container.querySelectorAll('.quick-planner-attachment')).toHaveLength(MAX_PLANNER_ATTACHMENTS);
    expect(screen.getByRole('status')).toHaveTextContent('Max 10 files per message.');
    expect(readPlannerDraftAttachments()).toEqual(attachments.slice(0, MAX_PLANNER_ATTACHMENTS));

    await act(async () => {
      fireEvent.click(view.container.querySelector<HTMLButtonElement>('.quick-planner-schedule-row .quick-planner-submit')!);
      await Promise.resolve();
    });

    expect(onSendNow).toHaveBeenCalledWith(
      chat,
      'Imported draft',
      attachments.slice(0, MAX_PLANNER_ATTACHMENTS),
      undefined,
      [],
    );
  });

  it('limits an oversized persisted Planner draft and reports the limit', () => {
    const attachments = Array.from({ length: MAX_PLANNER_ATTACHMENTS + 1 }, (_, index) => (
      `C:/drafts/photo-${index}.png`
    ));
    writePlannerDraft('Saved Planner draft', [], attachments);
    flushPlannerDraftWrite();

    const { container } = render(<QuickPlanner />);

    expect(container.querySelectorAll('.quick-planner-attachment')).toHaveLength(MAX_PLANNER_ATTACHMENTS);
    expect(screen.getByRole('status')).toHaveTextContent('Max 10 files per message.');
    expect(readPlannerDraftAttachments()).toEqual(attachments.slice(0, MAX_PLANNER_ATTACHMENTS));
  });

  it('restores the previous Planner draft after successfully sending a selected Posts draft', async () => {
    const chat: Chat = { id: 'chat-restore', name: 'Restore chat' };
    const restoreDraft = {
      text: 'Previous Planner text',
      attachments: ['C:/planner/previous.pdf'],
      entities: [{ type: 'italic' as const, offset: 0, length: 8 }],
    };
    const onRestoreDraft = vi.fn();
    const onSendNow = vi.fn().mockResolvedValue(true);
    const { container } = render(
      <QuickPlanner
        chats={[chat]}
        selectedChat={chat}
        draftLoadRequest={{
          revision: 1,
          text: 'Selected Posts draft',
          attachments: ['C:/posts/selected.png'],
          entities: [{ type: 'bold' as const, offset: 0, length: 8 }],
          restoreDraft,
        }}
        onRestoreDraft={onRestoreDraft}
        onSendNow={onSendNow}
      />,
    );
    const editor = screen.getByRole('textbox', { name: 'Reminder text' });
    const submit = container.querySelector<HTMLButtonElement>('.quick-planner-schedule-row .quick-planner-submit')!;
    fireEvent.click(screen.getByRole('button', { name: 'Send now' }));
    await act(async () => {
      fireEvent.click(submit);
      await Promise.resolve();
    });

    expect(onSendNow).toHaveBeenCalledWith(
      chat,
      'Selected Posts draft',
      ['C:/posts/selected.png'],
      undefined,
      [{ type: 'bold', offset: 0, length: 8 }],
    );
    expect(editor).toHaveValue('');
    expect(container.querySelector('.quick-planner-attachment-name')).not.toBeInTheDocument();
    expect(readPlannerDraft()).toBe('');
    expect(readPlannerDraftAttachments()).toEqual([]);
    expect(onRestoreDraft).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Message sent.');
    expect(screen.getByRole('status')).not.toHaveTextContent('You had text here before');
    await act(async () => vi.advanceTimersByTimeAsync(3359));
    expect(editor).toHaveValue('');
    expect(onRestoreDraft).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(editor).toHaveValue(restoreDraft.text);
    expect(container.querySelector('.quick-planner-attachment-name')).toHaveTextContent('previous.pdf');
    expect(readPlannerDraft()).toBe(restoreDraft.text);
    expect(readPlannerDraftAttachments()).toEqual(restoreDraft.attachments);
    expect(readPlannerDraftEntities()).toEqual(restoreDraft.entities);
    expect(onRestoreDraft).toHaveBeenCalledWith(restoreDraft);
    expect(screen.getByRole('status')).toHaveTextContent('You had text here before — we put it back in the editor.');
    expect(screen.getByRole('status')).toHaveClass('is-success');
    await act(async () => vi.advanceTimersByTimeAsync(4359));
    expect(screen.getByRole('status')).toBeInTheDocument();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('does not show a previous-text notice when the Planner was empty before loading a Posts draft', async () => {
    const chat: Chat = { id: 'chat-empty-restore', name: 'Empty restore chat' };
    const onRestoreDraft = vi.fn();
    const onSendNow = vi.fn().mockResolvedValue(true);
    const { container } = render(
      <QuickPlanner
        chats={[chat]}
        selectedChat={chat}
        draftLoadRequest={{
          revision: 1,
          text: 'Selected Posts draft',
          attachments: [],
          entities: [],
          restoreDraft: null,
        }}
        onRestoreDraft={onRestoreDraft}
        onSendNow={onSendNow}
      />,
    );
    const editor = screen.getByRole('textbox', { name: 'Reminder text' });
    const submit = container.querySelector<HTMLButtonElement>('.quick-planner-schedule-row .quick-planner-submit')!;
    fireEvent.click(screen.getByRole('button', { name: 'Send now' }));

    await act(async () => {
      fireEvent.click(submit);
      await Promise.resolve();
    });

    expect(onSendNow).toHaveBeenCalledWith(chat, 'Selected Posts draft', undefined, undefined, []);
    expect(editor).toHaveValue('');
    expect(onRestoreDraft).toHaveBeenCalledWith(null);
    expect(screen.getByRole('status')).toHaveTextContent('Message sent.');
    expect(screen.getByRole('status')).not.toHaveTextContent('You had text here before');
  });

  it('keeps the selected Posts draft after a failed send and restores the previous draft on retry success', async () => {
    const chat: Chat = { id: 'chat-retry-restore', name: 'Retry restore chat' };
    const restoreDraft = { text: 'Previous Planner text', attachments: [], entities: [] };
    const onRestoreDraft = vi.fn();
    const onSendNow = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const { container } = render(
      <QuickPlanner
        chats={[chat]}
        selectedChat={chat}
        draftLoadRequest={{
          revision: 1,
          text: 'Selected Posts draft',
          attachments: [],
          entities: [],
          restoreDraft,
        }}
        onRestoreDraft={onRestoreDraft}
        onSendNow={onSendNow}
      />,
    );
    const editor = screen.getByRole('textbox', { name: 'Reminder text' });
    const submit = container.querySelector<HTMLButtonElement>('.quick-planner-schedule-row .quick-planner-submit')!;
    fireEvent.click(screen.getByRole('button', { name: 'Send now' }));

    await act(async () => {
      fireEvent.click(submit);
      await Promise.resolve();
    });
    expect(editor).toHaveValue('Selected Posts draft');
    expect(onRestoreDraft).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(submit);
      await Promise.resolve();
    });
    expect(editor).toHaveValue('');
    expect(onRestoreDraft).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(3360));
    expect(editor).toHaveValue(restoreDraft.text);
    expect(onRestoreDraft).toHaveBeenCalledWith(restoreDraft);
  });

  it('repeats the offline status instead of showing the empty-message warning when sending', () => {
    const { container } = render(<QuickPlanner connectionRecoveryStatus="offline" />, 'Send now');
    const submitButton = container.querySelector<HTMLButtonElement>('.quick-planner-schedule-row .quick-planner-submit');

    if (!submitButton) throw new Error('Expected the Planner send button');
    fireEvent.click(submitButton);

    let status = screen.getByRole('alert');
    expect(status).toHaveTextContent('Telegram is unavailable. The app will keep trying to reconnect.');
    expect(status).toHaveClass('is-error');

    fireEvent.click(submitButton);
    status = screen.getByRole('alert');
    expect(status).toHaveTextContent('Telegram is unavailable. The app will keep trying to reconnect.');
    expect(status).toHaveClass('is-retriggered');
    expect(status).not.toHaveTextContent('Write a message');
  });

  it('makes the selected action mode easy to distinguish in dark theme', () => {
    expect(quickPlannerStyles).toMatch(
      /html\[data-theme\] \.quick-planner \.quick-planner-mode-switch button\.is-active\s*\{\s*color:\s*var\(--planner-accent\);\s*border:\s*1px solid rgba\(var\(--planner-accent-rgb\), 0\.24\);\s*background:\s*rgba\(var\(--planner-accent-rgb\), 0\.06\);\s*box-shadow:\s*0 1px 2px rgba\(35, 52, 66, 0\.06\);/,
    );
    expect(quickPlannerStyles).toMatch(
      /html\[data-theme\] \.quick-planner \.quick-planner-mode-switch button\.is-active:hover\s*\{\s*background:\s*rgba\(var\(--planner-accent-rgb\), 0\.06\);/,
    );
    expect(quickPlannerStyles).toMatch(
      /html\[data-theme\] \.quick-planner \.quick-planner-mode-switch button\.is-active:active\s*\{\s*background:\s*rgba\(var\(--planner-accent-rgb\), 0\.06\);/,
    );
    expect(quickPlannerStyles).toMatch(
      /html\[data-theme='dark'\] \.quick-planner \.quick-planner-mode-switch button\.is-active,[\s\S]*?button\.is-active:active\s*\{\s*color:\s*#f0f4f6;\s*border-color:\s*#74828b;\s*background:\s*#354047;/,
    );
  });

  it('uses the editor hover tint on Planner controls and Activity buttons in light theme', () => {
    expect(colorThemeStyles).toMatch(
      /html\[data-theme='light'\] \.quick-planner-workbench \.quick-planner-mode-switch button:is\(:hover, :focus-visible\),[\s\S]*?\.quick-planner-workbench \.quick-planner-tools button:is\(:hover, :focus-visible, \.is-active\),[\s\S]*?\.quick-planner-workbench \.quick-planner-clear-message:is\(:hover, :focus-visible\):not\(:disabled\),[\s\S]*?\.quick-planner-workbench \.quick-planner-schedule-row button:not\(\.quick-planner-submit\):not\(\.is-readonly\):is\(:hover, :focus-visible\):not\(:disabled\)\s*\{\s*border-color:\s*#91afbf !important;\s*background:\s*#d7e6ed !important;/,
    );
    expect(colorThemeStyles).toMatch(
      /html\[data-theme='light'\] \.quick-planner-activity \.quick-planner-activity-period-option:hover:not\(\.is-active\),\s*html\[data-theme='light'\] \.quick-planner-activity \.quick-planner-activity-view:hover:not\(\.is-active\)\s*\{\s*border-color:\s*#91afbf !important;\s*background:\s*#d7e6ed !important;[^}]*box-shadow:\s*0 2px 6px rgba\(34, 47, 58, 0\.18\), inset 0 0 0 1px rgba\(71, 124, 158, 0\.12\) !important;/,
    );
  });

  it('keeps the dark action switch background subtle when inactive', () => {
    expect(colorThemeStyles).toMatch(
      /html\[data-theme='dark'\] \.quick-planner-mode-switch\s*\{[^}]*border-color:\s*rgba\(110, 166, 202, 0\.1\);[^}]*background:\s*linear-gradient\(180deg, rgba\(32, 40, 46, 0\.32\), rgba\(28, 36, 42, 0\.38\)\);/,
    );
    expect(colorThemeStyles).toMatch(
      /html\[data-theme='dark'\] \.quick-planner-mode-switch button:hover:not\(\.is-active\),[\s\S]*?focus-visible:not\(\.is-active\)\s*\{[^}]*background:\s*rgba\(180, 193, 201, 0\.08\);[^}]*color:\s*#e0e6ea;/,
    );
  });

  it('uses a neutral selected background for dark Planner action modes', () => {
    expect(colorThemeStyles).toMatch(
      /html\[data-theme='dark'\] \.quick-planner-mode-switch button\.is-active\s*\{[^}]*border-color:\s*#74828b;[^}]*background:\s*#354047;[^}]*color:\s*#f0f4f6;/,
    );
    expect(colorThemeStyles).toMatch(
      /html\[data-theme='dark'\] \.quick-planner-date-picker-grid button\.is-selected,\s*html\[data-theme='dark'\] \.quick-planner-time-list button\[aria-selected='true'\]\s*\{[^}]*background:\s*#1a4d73;[^}]*color:\s*#eaf7ff;/,
    );
  });

  it('matches the light-theme publish button to the activity graph line', () => {
    expect(quickPlannerStyles).toMatch(
      /html\[data-theme='light'\] \.quick-planner \.quick-planner-submit:not\(:disabled\)\s*\{\s*border-color:\s*var\(--planner-accent\);\s*background:\s*var\(--planner-accent\);\s*color:\s*#ffffff;/,
    );
    expect(quickPlannerStyles).toMatch(
      /html\[data-theme='light'\] \.quick-planner \.quick-planner-submit:hover:not\(:disabled\),\s*html\[data-theme='light'\] \.quick-planner \.quick-planner-submit:focus-visible:not\(:disabled\)\s*\{\s*border-color:\s*#168de8;\s*background:\s*#168de8;\s*color:\s*#ffffff;/,
    );
    expect(activityStyles).toMatch(
      /\.quick-planner-activity-chart\s*\{\s*--activity-chart-color:\s*var\(--planner-accent,\s*#477c9e\);/,
    );
    expect(activityStyles).not.toMatch(
      /html:not\(\[data-theme='dark'\]\) \.quick-planner-activity-chart\s*\{\s*--activity-chart-color:\s*#78aec4;/,
    );
    expect(quickPlannerStyles).toMatch(
      /html\[data-theme='dark'\] \.quick-planner \.quick-planner-mode-switch button\.is-active,[\s\S]*?background:\s*#354047;/,
    );
  });

  it('uses the blue Planner accent for selected dates and times in light theme', () => {
    expect(colorThemeStyles).toMatch(
      /html\[data-theme='light'\] \.quick-planner-date-picker-grid button\.is-selected,[\s\S]*?background:\s*var\(--planner-accent\) !important;[\s\S]*?color:\s*#ffffff !important;/,
    );
    expect(colorThemeStyles).toMatch(
      /html\[data-theme='light'\] \.quick-planner-time-list button\[aria-selected='true'\],[\s\S]*?background:\s*var\(--planner-accent\);[\s\S]*?color:\s*#ffffff;/,
    );
  });

  it('removes glossy highlights and shadows from the send button in every state', () => {
    expect(quickPlannerStyles).toMatch(
      /html\[data-theme\] \.quick-planner \.quick-planner-schedule-row \.quick-planner-submit,[\s\S]*?background:\s*var\(--planner-accent\);[\s\S]*?box-shadow:\s*none;/,
    );
    expect(quickPlannerStyles).toMatch(
      /html\[data-theme\] \.quick-planner \.quick-planner-submit:hover:not\(:disabled\),[\s\S]*?box-shadow:\s*none;[\s\S]*?filter:\s*none;[\s\S]*?transform:\s*none;/,
    );
    expect(quickPlannerStyles).toMatch(
      /html\[data-theme='light'\] \.quick-planner \.quick-planner-submit:hover:not\(:disabled\),[\s\S]*?box-shadow:\s*none;/,
    );
  });

  it('uses the Planner accent for time-option hover and focus highlights', () => {
    expect(quickPlannerStyles).toMatch(
      /\.quick-planner-time-list button:hover:not\(:disabled\),\s*\.quick-planner-time-list button:focus-visible:not\(:disabled\)\s*\{\s*color:\s*#ffffff;\s*background:\s*var\(--planner-accent\);/,
    );
    expect(colorThemeStyles).toMatch(
      /html\[data-theme='dark'\] \.quick-planner-time-list button:hover:not\(:disabled\),\s*html\[data-theme='dark'\] \.quick-planner-time-list button:focus-visible:not\(:disabled\),[\s\S]*?\{\s*background:\s*#239dfb !important;\s*color:\s*#ffffff !important;/,
    );
  });

  it('makes the Planner time list scrollbar more visible in light theme', () => {
    expect(colorThemeStyles).toMatch(
      /html\[data-theme='light'\] \.quick-planner-time-list\s*\{\s*scrollbar-color:\s*#7b8993 #edf1f3;/,
    );
    expect(colorThemeStyles).toMatch(
      /html\[data-theme='light'\] \.quick-planner-time-list::-webkit-scrollbar-thumb\s*\{\s*background:\s*#7b8993;\s*border:\s*2px solid #edf1f3;/,
    );
  });

  it('matches the date and time controls to the send button height in both themes', () => {
    expect(quickPlannerStyles).toMatch(
      /\.quick-planner-schedule-row > \.quick-planner-schedule-field > button,\s*\.quick-planner-time-value > \.quick-planner-schedule-field > button\s*\{[^}]*height:\s*44px;/,
    );
    expect(quickPlannerStyles).toMatch(
      /\.quick-planner \.quick-planner-schedule-field > button\s*\{[^}]*border-color:\s*transparent;[^}]*background:\s*transparent;[^}]*font-size:\s*16px;[^}]*font-weight:\s*700;/,
    );
    expect(colorThemeStyles).toMatch(
      /html\[data-theme='dark'\] \.quick-planner \.quick-planner-schedule-row > \.quick-planner-schedule-field > button,\s*html\[data-theme='dark'\] \.quick-planner \.quick-planner-time-value > \.quick-planner-schedule-field > button\s*\{[^}]*border-color:\s*transparent;[^}]*background:\s*transparent;/,
    );
  });

  it('styles quick time presets like separate Studio actions without a dark container backdrop', () => {
    expect(quickPlannerStyles).toMatch(/\.quick-planner-presets\s*\{[^}]*border:\s*0;[^}]*background:\s*transparent;/);
    expect(quickPlannerStyles).toMatch(
      /\.quick-planner-presets button,\s*\.quick-planner-presets button \+ button\s*\{[^}]*height:\s*44px;[^}]*border:\s*1px solid var\(--planner-line\);[^}]*border-radius:\s*6px;[^}]*background:\s*#ffffff;/,
    );
    expect(quickPlannerStyles).toMatch(
      /\.quick-planner-schedule-row \.quick-planner-presets button:hover,\s*\.quick-planner-schedule-row \.quick-planner-presets button:focus-visible\s*\{[^}]*border-color:\s*rgba\(var\(--planner-accent-rgb\),\s*0\.42\);[^}]*background:\s*rgba\(var\(--planner-accent-rgb\),\s*0\.05\);[^}]*outline:\s*none;/,
    );
    expect(colorThemeStyles).toMatch(
      /html\[data-theme='dark'\] \.quick-planner-mode-switch,\s*html\[data-theme='dark'\] \.quick-planner-presets,\s*html\[data-theme='dark'\] \.quick-planner-schedule-row button,[\s\S]*?\{\s*border-color:\s*#35414a;\s*background:\s*#10161a;\s*color:\s*#c5cfd6;/,
    );
    expect(quickPlannerStyles).not.toMatch(
      /html\[data-theme='dark'\] \.quick-planner \.quick-planner-schedule-row \.quick-planner-presets > button/,
    );
    expect(quickPlannerStyles).toMatch(
      /html\[data-theme='dark'\] \.quick-planner \.quick-planner-schedule-row \.quick-planner-presets\s*\{[^}]*border:\s*0;[^}]*background:\s*transparent;/,
    );
  });

  it('uses filled neutral date and time buttons without a dark schedule strip in dark theme', () => {
    expect(colorThemeStyles).toMatch(
      /html\[data-theme='dark'\] \.quick-planner \.quick-planner-schedule-row::before\s*\{[^}]*border-color:\s*transparent;[^}]*background:\s*transparent;[^}]*backdrop-filter:\s*none;/,
    );
    expect(colorThemeStyles).toMatch(
      /html\[data-theme='dark'\] \.quick-planner \.quick-planner-schedule-row button:not\(\.quick-planner-submit\)\s*\{[^}]*border-color:\s*#36414a;[^}]*background:\s*#1a2228;[^}]*color:\s*#d8e4eb;/,
    );
    expect(colorThemeStyles).toMatch(
      /html\[data-theme='dark'\] \.quick-planner \.quick-planner-schedule-row button:not\(\.quick-planner-submit\):hover,[\s\S]*?button:not\(\.quick-planner-submit\):focus-visible\s*\{[^}]*border-color:\s*#59636b;[^}]*background:\s*#252d32;[^}]*color:\s*#f2f5f7;/,
    );
  });

  it('uses a restrained dark Planner message field outline and removes it on focus', () => {
    expect(quickPlannerStyles).toMatch(
      /\.quick-planner-message\s*\{[^}]*transition:\s*background-color 180ms ease,\s*transform 180ms ease;/,
    );
    expect(quickPlannerStyles).toMatch(
      /html\[data-theme='light'\] \.quick-planner \.quick-planner-message:not\(:focus\),\s*html\[data-theme='light'\] \.quick-planner \.quick-planner-message:not\(:focus\):hover\s*\{[^}]*border-color:\s*rgba\(var\(--planner-accent-rgb\), 0\.52\);[^}]*box-shadow:\s*0 0 0 1px rgba\(var\(--planner-accent-rgb\), 0\.13\),\s*0 0 6px rgba\(var\(--planner-accent-rgb\), 0\.1\);/,
    );
    expect(quickPlannerStyles).toMatch(
      /html\[data-theme='light'\] \.quick-planner \.quick-planner-message:focus\s*\{[^}]*border-color:\s*var\(--planner-accent\);[^}]*box-shadow:\s*0 0 0 2px rgba\(var\(--planner-accent-rgb\), 0\.18\);/,
    );
    expect(quickPlannerStyles).toMatch(
      /html\[data-theme='dark'\] \.quick-planner \.quick-planner-message:not\(:focus\):not\(:hover\)\s*\{\s*border-color:\s*#59636b;\s*box-shadow:\s*none;/,
    );
    expect(quickPlannerStyles).toMatch(
      /html\[data-theme='dark'\] \.quick-planner \.quick-planner-message:not\(:focus\):hover\s*\{\s*border-color:\s*#46545e;\s*box-shadow:\s*none;/,
    );
    expect(quickPlannerStyles).toMatch(
      /html\[data-theme='dark'\] \.quick-planner \.quick-planner-message:focus,\s*html\[data-theme='dark'\] \.quick-planner \.quick-planner-message:focus-visible\s*\{\s*border-color:\s*#46545e;\s*box-shadow:\s*none;\s*outline:\s*none;/,
    );
  });

  it('removes the shadow from the New Message heading', () => {
    expect(quickPlannerStyles).toMatch(
      /html\[data-theme='light'\] \.quick-planner-heading h1\s*\{\s*filter:\s*none !important;\s*text-shadow:\s*none !important;/,
    );
    expect(quickPlannerStyles).toMatch(
      /\.quick-planner-heading h1\s*\{[^}]*transform:\s*translateY\(80px\);/,
    );
  });

  it('keeps the Planner heading clear of the card on narrow screens', () => {
    expect(quickPlannerStyles).toMatch(
      /@media \(max-width:\s*900px\)\s*\{[\s\S]*?\.quick-planner-heading\s*\{[^}]*min-height:\s*32px;[^}]*margin-bottom:\s*16px;[\s\S]*?\.quick-planner-heading h1\s*\{\s*transform:\s*none;/,
    );
  });

  it('hides the workbench top highlight stripe in the light theme', () => {
    expect(quickPlannerStyles).toMatch(
      /html\[data-theme='light'\] \.quick-planner-workbench::before\s*\{\s*display:\s*none;/,
    );
  });

  it('reserves enough width for the enlarged date and time labels with their icons', () => {
    expect(quickPlannerStyles).toMatch(
      /\.quick-planner-schedule-row > \.quick-planner-schedule-field\s*\{\s*width:\s*144px;\s*flex:\s*0 0 144px;/,
    );
    expect(quickPlannerStyles).toMatch(
      /\.quick-planner-time-value > \.quick-planner-schedule-field\s*\{\s*width:\s*124px;\s*flex:\s*0 0 124px;/,
    );
    expect(quickPlannerStyles).toMatch(
      /@media \(max-width:\s*560px\)\s*\{[\s\S]*?\.quick-planner-schedule-row \.quick-planner-time-value > \.quick-planner-schedule-field\s*\{\s*width:\s*124px;\s*flex-basis:\s*124px;/,
    );
    expect(quickPlannerStyles).toMatch(/\.quick-planner-schedule-row \.quick-planner-presets\s*\{[^}]*margin-left:\s*12px;/);
  });

  it('reflows schedule controls inside a narrow Planner card instead of clipping them', () => {
    expect(quickPlannerStyles).toMatch(
      /@container quick-planner-workbench \(max-width:\s*680px\)\s*\{[\s\S]*?\.quick-planner-schedule-row\s*\{[^}]*display:\s*grid;[^}]*overflow:\s*visible;/,
    );
    expect(quickPlannerStyles).toMatch(
      /\.quick-planner-schedule-row > \.quick-planner-submit-group,\s*\.quick-planner-schedule-row > \.quick-planner-draft-actions\s*\{[^}]*flex:\s*0 0 auto;[^}]*margin:\s*0 0 0 auto;/,
    );
    expect(quickPlannerStyles).toMatch(
      /\.quick-planner-schedule-row > \.quick-planner-submit-group\s*\{[^}]*grid-column:\s*2;[^}]*width:\s*100%;[^}]*min-width:\s*0;/,
    );
    expect(quickPlannerStyles).toMatch(/\.quick-planner-workbench\s*\{[^}]*container-name:\s*quick-planner-workbench;[^}]*container-type:\s*inline-size;/);
  });

  it('places the timezone immediately to the left of the send button', () => {
    const { container } = render(<QuickPlanner />);
    const submitGroup = container.querySelector('.quick-planner-submit-group')!;
    const timezone = submitGroup.querySelector('.quick-planner-timezone');
    const submit = submitGroup.querySelector('.quick-planner-submit');

    expect(timezone).toHaveTextContent(/^GMT/);
    expect(submitGroup.firstElementChild).toBe(timezone);
    expect(submitGroup.lastElementChild).toBe(submit);
    expect(container.querySelector('.quick-planner-time-value .quick-planner-timezone')).not.toBeInTheDocument();
    expect(quickPlannerStyles).toMatch(/\.quick-planner-timezone\.is-no-presets\s*\{[^}]*border-right:\s*1px solid var\(--planner-line\);/);
  });

  it('places the available time list above the editable time field', () => {
    expect(quickPlannerStyles).toMatch(
      /\.quick-planner-time-picker\s*\{[^}]*grid-template-rows:\s*minmax\(0,\s*1fr\)\s+auto;[^}]*grid-template-areas:\s*"times"\s*"entry";/,
    );
    expect(quickPlannerStyles).toMatch(/\.quick-planner-time-field\s*\{[^}]*grid-area:\s*entry;/);
    expect(quickPlannerStyles).toMatch(/\.quick-planner-time-list\s*\{[^}]*grid-area:\s*times;/);
  });

  it('does not populate the chat picker with sample chats', () => {
    render(<QuickPlanner />);

    expect(screen.getByRole('button', { name: 'Choose a chat' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Choose a chat' }));
    expect(document.querySelector('.quick-planner-chat-options [role="option"]')).not.toBeInTheDocument();
    expect(screen.getByText('No chats found')).toBeInTheDocument();
  });

  it('keeps the open chat picker above the message editor and outside the workbench clipping area', () => {
    expect(quickPlannerStyles).toMatch(
      /\.quick-planner-workbench:has\(\.quick-planner-chat-menu\)\s*\{[^}]*z-index:\s*10;[^}]*overflow:\s*visible;/,
    );
    expect(quickPlannerStyles).toMatch(
      /\.quick-planner-workbench:has\(\.quick-planner-chat-menu\) \.quick-planner-toolbar\s*\{[^}]*position:\s*relative;[^}]*z-index:\s*1;/,
    );
  });

  it('renders a feedback preview in the same accessible Planner status slot', () => {
    render(<QuickPlanner feedbackPreview={{ tone: 'error', message: 'Could not send the message.' }} />);

    const feedback = screen.getByRole('alert');
    expect(feedback).toHaveTextContent('Could not send the message.');
    expect(feedback).toHaveAttribute('title', 'Could not send the message.');
    expect(feedback).toHaveClass('quick-planner-action-feedback', 'is-error');
  });

  it('renders retry and dismiss actions in notification previews', () => {
    const onRetry = vi.fn();
    const onDismiss = vi.fn();
    render(<QuickPlanner feedbackPreview={{
      tone: 'error',
      message: 'Could not send the message.',
      actions: [
        { id: 'retry', label: 'Retry', onClick: onRetry },
        { id: 'dismiss', label: 'Dismiss', onClick: onDismiss },
      ],
    }} />);

    const feedback = screen.getByRole('alert');
    expect(feedback).toHaveTextContent('Could not send the message.');
    expect(feedback).toHaveClass('has-actions');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('restores the Planner text and attachment chips after remounting', () => {
    writePlannerDraft('Survives reload', [], ['C:\\files\\report.pdf']);
    expect(flushPlannerDraftWrite()).toBe(true);

    const firstRender = render(<QuickPlanner />);
    const editor = screen.getByRole('textbox', { name: 'Reminder text' });
    expect(editor).toHaveValue('Survives reload');
    expect(firstRender.container.querySelector('.quick-planner-attachment-name')).toHaveTextContent('report.pdf');

    fireEvent.change(editor, { target: { value: 'Updated before reload' } });
    expect(flushPlannerDraftWrite()).toBe(true);
    firstRender.unmount();

    const secondRender = render(<QuickPlanner />);
    expect(screen.getByRole('textbox', { name: 'Reminder text' })).toHaveValue('Updated before reload');
    expect(secondRender.container.querySelector('.quick-planner-attachment-name')).toHaveTextContent('report.pdf');
  });

  it('translates the Planner page and its accessible controls into Russian', () => {
    localStorage.setItem('awaitmsg_locale', 'ru');

    render(<QuickPlanner />, 'Send now');

    expect(screen.getByRole('heading', { name: 'Новое сообщение' })).toBeInTheDocument();
    expect(screen.getByRole('main', { name: 'Новое сообщение' })).toHaveAttribute('lang', 'ru');
    const modeGroup = screen.getByRole('group', { name: 'Режимы действия' });
    expect(within(modeGroup).getByRole('button', { name: 'Отправить сейчас' })).toHaveAttribute('aria-pressed', 'true');
    expect(document.querySelector('.quick-planner-schedule-label')).toHaveTextContent('ОТПРАВИТЬ СЕЙЧАС');
    expect(screen.getByRole('textbox', { name: 'Текст напоминания' })).toHaveAttribute('placeholder', 'Запишите то, что важно…');
    expect(screen.getAllByRole('button', { name: 'Отправить сейчас' })).not.toHaveLength(0);
    expect(screen.getByRole('heading', { name: 'Активность' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Предстоящие' })).not.toBeInTheDocument();

    fireEvent.click(within(modeGroup).getByRole('button', { name: 'Запланировать' }));
    expect(document.querySelector('.quick-planner-schedule-label')).toHaveTextContent('ЗАПЛАНИРОВАТЬ');
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать дату' }));
    const datePicker = screen.getByRole('dialog', { name: 'Выбор даты отправки' });
    expect(datePicker).toHaveTextContent(new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' }).format(new Date()));
    expect(datePicker.querySelector('.quick-planner-date-picker-weekdays')).toHaveTextContent('пн');

    fireEvent.click(screen.getByRole('button', { name: 'Открыть окно эмодзи' }));
    expect(screen.getByRole('dialog', { name: 'Выбрать эмодзи' })).toHaveTextContent('Лица');

    fireEvent.click(screen.getByRole('button', { name: 'Черновик' }));
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeInTheDocument();
  });

  it('shows Activity while hiding the Upcoming section', () => {
    const { container } = render(<QuickPlanner />, 'Send now');

    expect(screen.getByRole('heading', { name: 'Activity' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Upcoming' })).not.toBeInTheDocument();
    expect(container.querySelector('.quick-planner-upcoming-section')).toHaveAttribute('hidden');
    expect(screen.getByText('Nothing here yet.')).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Planner actions' })).getByRole('button', { name: 'Send now' }))
      .toHaveAttribute('aria-pressed', 'true');
    expect(document.querySelector('.quick-planner-schedule-label')).toHaveTextContent('SEND NOW');
  });

  it('charts only distinct confirmed sends with valid sentAt timestamps over local days', () => {
    const now = new Date(2035, 4, 12, 12, 0, 0);
    vi.setSystemTime(now);
    const sentAt = new Date(2035, 4, 12, 9, 30, 0).toISOString();
    const sent = [
      createScheduledMessage({ id: 'send-a', status: 'sent', sentAt, sendAttemptId: 'attempt-a' }),
      createScheduledMessage({ id: 'duplicate', status: 'sent', sentAt, sendAttemptId: 'attempt-a' }),
      createScheduledMessage({ id: 'send-b', status: 'sent', sentAt }),
      createScheduledMessage({ id: 'unknown', status: 'unknown', sentAt }),
      createScheduledMessage({ id: 'failed', status: 'failed', sentAt }),
      createScheduledMessage({ id: 'missing-time', status: 'sent', sentAt: undefined }),
      createScheduledMessage({ id: 'invalid-time', status: 'sent', sentAt: 'not-a-date' }),
      createScheduledMessage({ id: 'planned', status: 'scheduled', sentAt }),
    ];

    render(<QuickPlanner sent={sent} />);

    const dateLabel = new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    }).format(now);
    expect(screen.getByRole('img', { name: 'Confirmed messages sent in the last 7 days: 2' })).toBeInTheDocument();
    expect(screen.getByTitle(`${dateLabel}: 2 messages sent`)).toBeInTheDocument();
    expect(screen.getByText('2', { selector: '.quick-planner-activity-total-count' })).toBeInTheDocument();
    expect(screen.getByText('confirmed sends', { selector: '.quick-planner-activity-total-label' })).toBeInTheDocument();
  });

  it('includes a newly received confirmed send even when the scheduling clock state is stale', () => {
    const initialTime = new Date('2035-05-12T12:00:00.000Z');
    vi.setSystemTime(initialTime);
    const view = render(<QuickPlanner sent={[]} />);

    const sentAt = new Date(initialTime.getTime() + 500).toISOString();
    vi.setSystemTime(new Date(initialTime.getTime() + 1000));
    view.rerender(createElement(LocaleProvider, null, createElement(QuickPlanner, {
      sent: [createScheduledMessage({ status: 'sent', sentAt })],
    })));

    expect(screen.getByRole('img', { name: 'Confirmed messages sent in the last 7 days: 1' })).toBeInTheDocument();
    expect(screen.queryByText('Nothing here yet.')).not.toBeInTheDocument();
  });

  it('does not present history load errors as an empty activity state', () => {
    render(<QuickPlanner historyReady={false} historyError />);

    expect(screen.getAllByText('Message history could not be loaded.')).toHaveLength(2);
    expect(screen.queryByText('Nothing here yet.')).not.toBeInTheDocument();
    expect(screen.queryByText('No upcoming messages.')).not.toBeInTheDocument();
  });

  it('shows a zero-count chart when saved sent records have no valid sentAt value', () => {
    render(<QuickPlanner sent={[
      createScheduledMessage({ id: 'missing-time', status: 'sent' }),
      createScheduledMessage({ id: 'invalid-time', status: 'sent', sentAt: 'invalid' }),
    ]} />);

    expect(screen.getByText('Nothing here yet.')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Confirmed messages sent in the last 7 days: 0' })).toBeInTheDocument();
    expect(screen.getByText('0', { selector: '.quick-planner-activity-total-count' })).toBeInTheDocument();
  });

  it('shows loading rather than empty states until history is restored', () => {
    render(<QuickPlanner historyReady={false} />);

    expect(screen.getByText('Loading activity…')).toBeInTheDocument();
    expect(screen.getByText('Loading upcoming messages…')).toBeInTheDocument();
  });

  it('shows only future scheduled messages in chronological order and updates with props', () => {
    vi.setSystemTime(new Date('2035-05-12T12:00:00.000Z'));
    const first = createScheduledMessage({
      id: 'first',
      chatName: 'First chat',
      text: 'First upcoming',
      when: '2035-05-12T13:00:00.000Z',
    });
    const second = createScheduledMessage({
      id: 'second',
      chatName: 'Second chat',
      text: 'Second upcoming',
      when: '2035-05-12T14:00:00.000Z',
    });
    const cancelled = createScheduledMessage({ id: 'cancelled', text: 'Cancelled record' });
    Object.assign(cancelled, { status: 'cancelled' });
    const view = render(<QuickPlanner upcoming={[
      second,
      first,
      createScheduledMessage({ id: 'past', text: 'Expired record', when: '2035-05-12T11:00:00.000Z' }),
      createScheduledMessage({ id: 'sent', status: 'sent', text: 'Sent record' }),
      createScheduledMessage({ id: 'failed', status: 'failed', text: 'Failed record' }),
      createScheduledMessage({ id: 'sending', status: 'sending', text: 'Sending record' }),
      createScheduledMessage({ id: 'unknown', status: 'unknown', text: 'Unknown record' }),
      createScheduledMessage({ id: 'pending', status: 'pending', text: 'Pending record' }),
      createScheduledMessage({ id: 'invalid', when: 'invalid-date', text: 'Invalid record' }),
      cancelled,
    ]} />);

    const items = view.container.querySelectorAll('.quick-planner-upcoming-item');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('First upcoming');
    expect(items[1]).toHaveTextContent('Second upcoming');
    for (const excluded of ['Expired record', 'Sent record', 'Failed record', 'Sending record', 'Unknown record', 'Pending record', 'Invalid record', 'Cancelled record']) {
      expect(screen.queryByText(excluded)).not.toBeInTheDocument();
    }

    view.rerender(createElement(LocaleProvider, null, createElement(QuickPlanner, {
      upcoming: [createScheduledMessage({ id: 'updated', text: 'Updated schedule', when: '2035-05-12T16:00:00.000Z' })],
    })));
    expect(screen.getByText('Updated schedule')).toBeInTheDocument();
    expect(screen.queryByText('First upcoming')).not.toBeInTheDocument();
  });

  it('formats upcoming ISO timestamps as the local scheduled instant', () => {
    const when = '2035-05-12T15:00:00.000Z';
    render(<QuickPlanner upcoming={[createScheduledMessage({ when })]} />);

    const displayedTime = new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(when));
    expect(screen.getByText(displayedTime)).toBeInTheDocument();
    expect(screen.getByText(displayedTime)).toHaveAttribute('title', new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(when)));
  });

  it('keeps full long Upcoming labels available while displaying compact previews', () => {
    const chatName = 'A very long channel name that needs more than one line';
    const messageText = 'A detailed message preview that should remain available in full';
    render(<QuickPlanner upcoming={[createScheduledMessage({
      chatName,
      text: messageText,
    })]} />);

    expect(screen.getByText(chatName)).toHaveAttribute('title', chatName);
    expect(screen.getByText(messageText)).toHaveAttribute('title', messageText);
  });

  it('uses a translated content label for a scheduled attachment with no text', () => {
    render(<QuickPlanner upcoming={[createScheduledMessage({
      text: '',
      attachments: ['C:\\files\\image.png'],
    })]} />);

    expect(screen.getByText('Media message')).toBeInTheDocument();
    expect(screen.queryByText('undefined')).not.toBeInTheDocument();
  });

  it('restarts repeated validation warnings and dismisses them after the Studio timeout', () => {
    render(<QuickPlanner />);
    const submitButton = document.querySelector<HTMLButtonElement>('.quick-planner-schedule-row .quick-planner-submit')!;

    fireEvent.click(submitButton!);
    const firstStatus = screen.getByRole('status');
    expect(firstStatus).not.toHaveClass('is-retriggered');
    fireEvent.click(submitButton!);
    const repeatedStatus = screen.getByRole('status');

    expect(repeatedStatus).not.toBe(firstStatus);
    expect(repeatedStatus).toHaveClass('is-retriggered');
    expect(repeatedStatus).toHaveClass('is-warning');
    expect(repeatedStatus).toHaveClass('planner-inline-notification');
    expect(repeatedStatus.querySelector('svg')).toBeNull();

    act(() => vi.advanceTimersByTime(4999));
    expect(screen.getByRole('status')).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    fireEvent.click(submitButton);
    const nextStatus = screen.getByRole('status');
    expect(nextStatus).not.toHaveClass('is-retriggered');
    fireEvent.click(submitButton);
    expect(screen.getByRole('status')).toHaveClass('is-retriggered');
  });

  it('uses the Studio warning and success notification durations', () => {
    const chat: Chat = { id: 'chat-1', name: 'Test channel', type: 'channel' };
    const { container } = render(<QuickPlanner
      chats={[chat]}
      selectedChat={chat}
      onSaveDraft={() => true}
      onSchedule={async () => true}
    />);
    const editor = screen.getByRole('textbox', { name: 'Reminder text' });
    const submitButton = () => container.querySelector<HTMLButtonElement>(
      '.quick-planner-schedule-row .quick-planner-submit',
    )!;

    fireEvent.click(screen.getByRole('button', { name: 'Send now' }));
    fireEvent.click(submitButton());

    let status = screen.getByRole('status');
    expect(status).toHaveClass('is-warning');
    expect(status).toHaveClass('planner-inline-notification');
    act(() => vi.advanceTimersByTime(4999));
    expect(screen.getByRole('status')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    fireEvent.change(editor, {
      target: { value: 'Test status message' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Draft' }));
    fireEvent.click(submitButton());
    status = screen.getByRole('status');
    expect(status).toHaveClass('is-success');
    act(() => vi.advanceTimersByTime(3359));
    expect(screen.getByRole('status')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

  });

  it('shows fractional local timezone offsets without changing the timezone control width', () => {
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(-345);

    const { container } = render(<QuickPlanner />);
    const timeZone = screen.getByText('GMT+5:45');

    expect(timeZone).toHaveClass('quick-planner-timezone');
    expect(container.querySelector('.quick-planner-timezone')?.textContent).toBe('GMT+5:45');
  });

  it('uses the default appearance accent in each theme when colors or action modes change', () => {
    const { container } = render(<QuickPlanner />);
    const planner = container.querySelector<HTMLElement>('.quick-planner')!;
    const modeGroup = screen.getByRole('group', { name: 'Planner actions' });

    expect(planner.style.getPropertyValue('--planner-accent')).toBe('#239dfb');
    expect(colorThemeStyles).toMatch(
      /html\[data-theme='light'\] \.quick-planner\s*\{\s*--planner-accent:\s*#239dfb !important;\s*--planner-accent-rgb:\s*35,\s*157,\s*251 !important;/,
    );

    act(() => {
      writeEditorAppearancePreferences({
        style: 'outline',
        palette: 'custom',
        modeColors: { send: '#287fa6', schedule: '#b482f5', draft: '#f58b37' },
      });
    });
    expect(planner.style.getPropertyValue('--planner-accent')).toBe('#239dfb');

    fireEvent.click(within(modeGroup).getByRole('button', { name: 'Draft' }));
    expect(planner.style.getPropertyValue('--planner-accent')).toBe('#239dfb');

    fireEvent.click(within(modeGroup).getByRole('button', { name: 'Send now' }));
    expect(planner.style.getPropertyValue('--planner-accent')).toBe('#239dfb');

    act(() => writeEditorAppearancePreferences(DEFAULT_EDITOR_APPEARANCE));
    expect(planner.style.getPropertyValue('--planner-accent')).toBe('#239dfb');
  });

  it('removes group and channel chats from Planner through the existing remove callback', () => {
    const group: Chat = { id: 'group-1', name: 'Design group', type: 'group' };
    const channel: Chat = { id: 'channel-1', name: 'News channel', type: 'channel' };
    const onRemoveChat = vi.fn();
    const { container } = render(<QuickPlanner chats={[group, channel]} onRemoveChat={onRemoveChat} />);

    fireEvent.click(container.querySelector('.quick-planner-chat')!);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Design group from Planner' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove News channel from Planner' }));

    expect(onRemoveChat).toHaveBeenNthCalledWith(1, group);
    expect(onRemoveChat).toHaveBeenNthCalledWith(2, channel);
  });

  it('clears reminder text with one click and returns focus to the editor', () => {
    render(<QuickPlanner />);
    const editor = screen.getByRole('textbox', { name: 'Reminder text' });
    fireEvent.change(editor, { target: { value: 'A long reminder to erase' } });

    const clearButton = screen.getByRole('button', { name: 'Clear reminder text' });
    expect(clearButton.parentElement).toHaveClass('quick-planner-counter-controls');
    expect(clearButton.previousElementSibling).toHaveClass('quick-planner-character-count');
    editor.focus();
    fireEvent.mouseDown(clearButton);
    expect(editor).toHaveFocus();
    fireEvent.click(clearButton);

    expect(editor).toHaveValue('');
    expect(editor).toHaveFocus();
    expect(clearButton).toBeDisabled();
    expect(clearButton).toHaveAttribute('aria-hidden', 'true');
    expect(clearButton).toHaveClass('is-hidden');
  });

  it('opens the emoji picker 5px beside the smile button', () => {
    const { container } = render(<QuickPlanner />);
    const toolAnchors = container.querySelectorAll<HTMLElement>(
      '.quick-planner-tools > .quick-planner-tool-anchor',
    );
    vi.spyOn(toolAnchors[0], 'getBoundingClientRect').mockReturnValue(new DOMRect(80, 160, 48, 48));
    vi.spyOn(toolAnchors[2], 'getBoundingClientRect').mockReturnValue(new DOMRect(200, 160, 48, 48));

    fireEvent.click(screen.getByRole('button', { name: 'Open emoji window' }));

    expect(screen.getByRole('dialog', { name: 'Choose emoji' })).toHaveStyle({ left: '253px' });
  });

  it('loads Telegram effect IDs and selects a real message effect', async () => {
    const getAvailableEffects = vi.fn().mockResolvedValue({
      success: true,
      effects: [
        { id: '123456789', emoticon: '🎉', premiumRequired: false },
        { id: '223456789', emoticon: '👍', premiumRequired: false },
        { id: '323456789', emoticon: '👎', premiumRequired: false },
        { id: '423456789', emoticon: '🔥', premiumRequired: false },
        { id: '987654321', emoticon: '✨', premiumRequired: true },
      ],
    });
    Object.defineProperty(window, 'telegram', { configurable: true, value: { getAvailableEffects } });
    const onOpenInStudio = vi.fn();
    const { container } = render(<QuickPlanner onOpenInStudio={onOpenInStudio} />);
    await act(async () => { await Promise.resolve(); });
    expect(getAvailableEffects).toHaveBeenCalledOnce();

    expect(Array.from(container.querySelectorAll('.quick-planner-tools > .quick-planner-tool-anchor > button'))
      .map((button) => button.getAttribute('aria-label')))
      .toEqual(['Attach files', 'Message effects', 'Open emoji window']);

    const attachmentButton = screen.getByRole('button', { name: 'Attach files' });
    const effectsButton = screen.getByRole('button', { name: 'Message effects' });
    const emojiButton = screen.getByRole('button', { name: 'Open emoji window' });
    for (const button of [attachmentButton, effectsButton, emojiButton]) {
      expect(button.querySelector('svg')).toHaveAttribute('width', '24');
      expect(button.querySelector('svg')).toHaveAttribute('height', '24');
    }
    fireEvent.click(effectsButton);
    const effectsGrid = screen.getByRole('group', { name: 'Choose message effect' });
    expect(effectsGrid).toBeInTheDocument();
    expect(within(effectsGrid).getAllByRole('button').map((button) => button.getAttribute('aria-label')))
      .toEqual(['effect 🎉', 'effect 👍', 'effect 👎', 'No effect', 'effect 🔥']);
    expect(screen.queryByRole('button', { name: 'Premium effect ✨' })).not.toBeInTheDocument();
    const effectOption = screen.getByRole('button', { name: 'effect 🎉' });
    fireEvent.click(effectOption);
    expect(effectsButton).toHaveAttribute('aria-pressed', 'true');
    expect(effectsButton).toHaveAttribute('title', 'Message effects: 🎉');
    const selectedEffect = container.querySelector('.quick-planner-selected-effect');
    expect(selectedEffect).toHaveTextContent('🎉');
    expect(selectedEffect).toHaveAttribute('aria-label', 'Message effects: 🎉');
    expect(selectedEffect?.compareDocumentPosition(container.querySelector('.quick-planner-character-count')!))
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    fireEvent.click(effectsButton);
    const noEffectButton = screen.getByRole('button', { name: 'No effect' });
    expect(noEffectButton).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(noEffectButton);
    expect(effectsButton).toHaveAttribute('aria-pressed', 'false');
    expect(container.querySelector('.quick-planner-selected-effect')).not.toBeInTheDocument();
  });

  it('shows categorized emojis and inserts the chosen emoji at the cursor', () => {
    render(<QuickPlanner />);
    const editor = screen.getByRole('textbox', { name: 'Reminder text' });
    fireEvent.change(editor, { target: { value: 'Good day' } });
    (editor as HTMLTextAreaElement).setSelectionRange(4, 4);

    fireEvent.click(screen.getByRole('button', { name: 'Open emoji window' }));
    const emojiPicker = screen.getByRole('dialog', { name: 'Choose emoji' });
    expect(emojiPicker).toHaveClass('quick-planner-emoji-picker');
    expect(emojiPicker.parentElement).toBe(document.body);
    fireEvent.click(screen.getByRole('tab', { name: 'Hearts' }));
    expect(screen.getByRole('group', { name: 'Hearts emoji' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Insert ❤️' }));

    expect(editor).toHaveValue('Good❤️ day');
    expect(screen.queryByRole('dialog', { name: 'Choose emoji' })).not.toBeInTheDocument();
  });

  it('persists the six latest unique emojis below the categories', () => {
    const selections = [
      { category: 'Faces', emoji: '😀' },
      { category: 'Hands', emoji: '👍' },
      { category: 'Hearts', emoji: '❤️' },
      { category: 'Nature', emoji: '🔥' },
      { category: 'Food', emoji: '🍎' },
      { category: 'Fun', emoji: '🎉' },
    ];

    const firstMount = render(<QuickPlanner />);
    for (const selection of selections) {
      fireEvent.click(screen.getByRole('button', { name: 'Open emoji window' }));
      fireEvent.click(screen.getByRole('tab', { name: selection.category }));
      const categoryGrid = screen.getByRole('group', { name: `${selection.category} emoji` });
      const emojiButton = within(categoryGrid).getByRole('button', { name: `Insert ${selection.emoji}` });
      fireEvent.click(emojiButton);
    }
    firstMount.unmount();

    render(<QuickPlanner />);
    fireEvent.click(screen.getByRole('button', { name: 'Open emoji window' }));
    const picker = screen.getByRole('dialog', { name: 'Choose emoji' });
    const recentGroup = within(picker).getByRole('group', { name: 'Recent emoji' });
    expect(within(recentGroup).getAllByRole('button').map((button) => button.getAttribute('aria-label')))
      .toEqual(['Insert recent 🎉', 'Insert recent 🍎', 'Insert recent 🔥', 'Insert recent ❤️', 'Insert recent 👍', 'Insert recent 😀']);
    expect(picker.querySelector('.quick-planner-emoji-categories')!.compareDocumentPosition(
      picker.querySelector('.quick-planner-emoji-recent')!,
    ) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(picker.querySelector('.quick-planner-emoji-search')!.compareDocumentPosition(
      picker.querySelector('.quick-planner-emoji-recent')!,
    ) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps the Recent order unchanged when selecting an emoji from Recent', async () => {
    localStorage.setItem('xmsgi-quick-planner-recent-emojis', JSON.stringify(['😀', '❤️', '😃']));
    render(<QuickPlanner />);
    fireEvent.click(screen.getByRole('button', { name: 'Open emoji window' }));
    const getRecentOrder = () => within(screen.getByRole('group', { name: 'Recent emoji' }))
      .getAllByRole('button').map((button) => button.getAttribute('aria-label'));
    const recentOrder = getRecentOrder();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Insert recent ❤️' }), { ctrlKey: true });
      await vi.advanceTimersByTimeAsync(20);
    });

    expect(screen.getByRole('dialog', { name: 'Choose emoji' })).toBeInTheDocument();
    expect(getRecentOrder()).toEqual(recentOrder);
    expect(JSON.parse(localStorage.getItem('xmsgi-quick-planner-recent-emojis')!)).toEqual(['😀', '❤️', '😃']);
  });

  it('closes the previous picker when opening the other toolbar picker', () => {
    render(<QuickPlanner />);
    fireEvent.click(screen.getByRole('button', { name: 'Open emoji window' }));
    expect(screen.getByRole('dialog', { name: 'Choose emoji' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Message effects' }));
    expect(screen.queryByRole('dialog', { name: 'Choose emoji' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Message effects' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open emoji window' }));
    expect(screen.queryByRole('dialog', { name: 'Message effects' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Choose emoji' })).toBeInTheDocument();
  });

  it('opens the emoji window with the quick keyboard command', () => {
    render(<QuickPlanner />);

    fireEvent.keyDown(document, { key: '.', ctrlKey: true });

    const emojiButton = screen.getByRole('button', { name: 'Open emoji window' });
    expect(emojiButton).toHaveAttribute('title', 'Open emoji window (Ctrl+. / Cmd+.)');
    expect(emojiButton).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('dialog', { name: 'Choose emoji' })).toBeInTheDocument();
  });

  it('opens emoji search from a colon command and replaces the query with the keyboard-selected result', () => {
    render(<QuickPlanner />);
    const editor = screen.getByRole('textbox', { name: 'Reminder text' });
    fireEvent.change(editor, { target: { value: 'Say :heart', selectionStart: 10, selectionEnd: 10 } });

    expect(editor).toHaveValue('Say :heart');
    expect(screen.getByRole('searchbox', { name: 'Search emoji' })).toHaveValue('heart');
    expect(screen.getByRole('group', { name: 'Emoji search results' })).toBeInTheDocument();

    fireEvent.keyDown(editor, { key: 'ArrowDown' });
    fireEvent.keyDown(editor, { key: 'Enter' });

    expect(editor).toHaveValue('Say ❤️');
    expect(screen.queryByRole('dialog', { name: 'Choose emoji' })).not.toBeInTheDocument();
  });

  it('finds the same heart emoji from English and Russian picker searches', () => {
    render(<QuickPlanner />);
    fireEvent.click(screen.getByRole('button', { name: 'Open emoji window' }));
    const search = screen.getByRole('searchbox', { name: 'Search emoji' });

    fireEvent.change(search, { target: { value: 'heart' } });
    const categories = screen.getByRole('tablist', { name: 'Emoji categories' });
    expect(within(categories).getByRole('tab', { name: 'Faces' })).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Emoji search results' }))
      .getByRole('button', { name: 'Insert ❤️' })).toBeInTheDocument();

    fireEvent.change(search, { target: { value: 'сердце' } });
    expect(within(categories).getByRole('tab', { name: 'Faces' })).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Emoji search results' }))
      .getByRole('button', { name: 'Insert ❤️' })).toBeInTheDocument();
  });

  it('searches emoji names in Russian and keeps the picker open when there are no matches', () => {
    render(<QuickPlanner />);
    const editor = screen.getByRole('textbox', { name: 'Reminder text' });
    fireEvent.change(editor, { target: { value: 'Привет :сердце', selectionStart: 14, selectionEnd: 14 } });

    expect(screen.getByRole('searchbox', { name: 'Search emoji' })).toHaveValue('сердце');
    const results = screen.getByRole('group', { name: 'Emoji search results' });
    expect(within(results).getByRole('button', { name: 'Insert ❤️' })).toBeInTheDocument();

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search emoji' }), { target: { value: 'no-such-emoji' } });

    const picker = screen.getByRole('dialog', { name: 'Choose emoji' });
    expect(within(picker).getByRole('status')).toHaveTextContent('No emojis found.');
    expect(within(picker).getByRole('searchbox', { name: 'Search emoji' })).toBeInTheDocument();
    expect(within(picker).getByRole('region', { name: 'Recent emojis' })).toBeInTheDocument();
  });

  it('keeps the picker open for Ctrl selections and closes on a normal selection', async () => {
    render(<QuickPlanner />);
    const editor = screen.getByRole('textbox', { name: 'Reminder text' });
    fireEvent.change(editor, { target: { value: 'Hi ' } });
    (editor as HTMLTextAreaElement).setSelectionRange(3, 3);
    fireEvent.click(screen.getByRole('button', { name: 'Open emoji window' }));
    const modifierHint = screen.getByText('Hold Ctrl to add more');
    expect(modifierHint).toBeInTheDocument();
    expect(modifierHint.closest('.quick-planner-emoji-recent-heading')).not.toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Insert 😀' }), { ctrlKey: true });
      await vi.advanceTimersByTimeAsync(20);
    });
    expect(editor).toHaveValue('Hi 😀');
    expect(screen.getByRole('dialog', { name: 'Choose emoji' })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Insert 😃' }), { ctrlKey: true });
      await vi.advanceTimersByTimeAsync(20);
    });
    expect(editor).toHaveValue('Hi 😀😃');
    expect(screen.getByRole('dialog', { name: 'Choose emoji' })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Insert 😄' }));
      await vi.advanceTimersByTimeAsync(20);
    });
    expect(editor).toHaveValue('Hi 😀😃😄');
    expect(screen.queryByRole('dialog', { name: 'Choose emoji' })).not.toBeInTheDocument();
  });

  it('closes the picker shortly after Ctrl is released following a multi-select', async () => {
    render(<QuickPlanner />);
    fireEvent.click(screen.getByRole('button', { name: 'Open emoji window' }));
    fireEvent.keyDown(document, { key: 'Control' });
    expect(screen.getByRole('dialog', { name: 'Choose emoji' })).toHaveClass('is-modifier-held');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Insert 😀' }), { ctrlKey: true });
      await vi.advanceTimersByTimeAsync(20);
    });

    fireEvent.keyUp(document, { key: 'Control' });
    expect(screen.getByRole('dialog', { name: 'Choose emoji' })).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Choose emoji' })).not.toHaveClass('is-modifier-held');
    await act(async () => vi.advanceTimersByTimeAsync(699));
    expect(screen.getByRole('dialog', { name: 'Choose emoji' })).toBeInTheDocument();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(screen.queryByRole('dialog', { name: 'Choose emoji' })).not.toBeInTheDocument();
  });

  it('forwards send, schedule, and draft actions to Posts callbacks', async () => {
    const chat: Chat = { id: 'chat-1', name: 'Studio channel', type: 'channel' };
    Object.defineProperty(window, 'telegram', {
      configurable: true,
      value: {
        getAvailableEffects: vi.fn().mockResolvedValue({
          success: true,
          effects: [
            { id: '111', emoticon: '🔥', premiumRequired: false },
            { id: '222', emoticon: '🎉', premiumRequired: false },
          ],
        }),
        getFilePath: vi.fn((file: File) => `C:/photos/${file.name}`),
      },
    });
    const onSendNow = vi.fn().mockResolvedValue(true);
    const onSchedule = vi.fn().mockResolvedValue(true);
    const onSaveDraft = vi.fn().mockReturnValue(true);
    const openPosts = vi.fn();
    const { container } = render(
      <QuickPlannerNavigationContext.Provider value={{
        currentSection: 'quick-plan',
        openQuickPlan: vi.fn(),
        openStudio: vi.fn(),
        openPosts,
        openSettings: vi.fn(),
      }}>
        <QuickPlanner
          chats={[chat]}
          selectedChat={chat}
          onSendNow={onSendNow}
          onSchedule={onSchedule}
          onSaveDraft={onSaveDraft}
        />
      </QuickPlannerNavigationContext.Provider>,
    );
    await act(async () => { await Promise.resolve(); });
    const editor = screen.getByRole('textbox', { name: 'Reminder text' });
    const submit = () => container.querySelector<HTMLButtonElement>('.quick-planner-schedule-row .quick-planner-submit')!;
    const addPhoto = (name: string) => fireEvent.change(container.querySelector<HTMLInputElement>('input[type="file"]')!, {
      target: { files: [new File(['photo'], name, { type: 'image/png' })] },
    });
    const selectEffect = (name: string) => {
      fireEvent.click(screen.getByRole('button', { name: 'Message effects' }));
      fireEvent.click(screen.getByRole('button', { name }));
    };

    selectEffect('effect 🔥');
    fireEvent.change(editor, { target: { value: 'Send from Planner' } });
    addPhoto('send.png');
    fireEvent.click(screen.getByRole('button', { name: 'Send now' }));
    await act(async () => {
      fireEvent.click(submit());
      await Promise.resolve();
    });
    expect(onSendNow).toHaveBeenCalledWith(chat, 'Send from Planner', ['C:/photos/send.png'], '111', []);
    expect(openPosts).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Message effects' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('status')).toHaveClass('is-success');
    expect(screen.getByRole('status')).toHaveTextContent('Message sent.');
    expect(screen.getByRole('status')).not.toHaveTextContent('Posts');

    fireEvent.change(editor, { target: { value: 'Schedule from Planner' } });
    addPhoto('schedule.png');
    fireEvent.click(within(screen.getByRole('group', { name: 'Planner actions' })).getByRole('button', { name: 'Schedule' }));
    selectEffect('effect 🎉');
    await act(async () => {
      fireEvent.click(submit());
      await Promise.resolve();
    });
    expect(onSchedule).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveClass('is-warning');
    await act(async () => {
      fireEvent.click(submit());
      await Promise.resolve();
    });
    expect(onSchedule).toHaveBeenCalledWith(expect.objectContaining({
      chatId: chat.id,
      message: 'Schedule from Planner',
      date: expect.any(String),
      time: expect.any(String),
      attachments: ['C:/photos/schedule.png'],
      effect: '222',
      entities: [],
    }));
    expect(openPosts).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Message effects' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('status')).toHaveClass('is-success');
    expect(screen.getByRole('status')).toHaveTextContent('Schedule request sent.');
    expect(screen.getByRole('status')).not.toHaveTextContent('Posts');

    fireEvent.change(editor, { target: { value: 'Save from Planner' } });
    fireEvent.click(screen.getByRole('button', { name: 'Draft' }));
    await act(async () => {
      fireEvent.click(submit());
      await Promise.resolve();
    });
    expect(onSaveDraft).toHaveBeenCalledWith({
      message: 'Save from Planner',
      attachments: [],
      entities: [],
      selectedChat: chat,
    });
    expect(openPosts).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Draft saved.');
    expect(screen.getByRole('status')).not.toHaveTextContent('Posts');
  });

  it('keeps Planner text and photos when Telegram rejects sending or scheduling', async () => {
    const chat: Chat = { id: 'chat-1', name: 'Studio channel', type: 'channel' };
    const onSendNow = vi.fn().mockResolvedValue(false);
    const onSchedule = vi.fn().mockResolvedValue(false);
    const openPosts = vi.fn();
    Object.defineProperty(window, 'telegram', {
      configurable: true,
      value: { getFilePath: vi.fn((file: File) => `C:/photos/${file.name}`) },
    });
    const { container } = render(
      <QuickPlannerNavigationContext.Provider value={{
        currentSection: 'quick-plan',
        openQuickPlan: vi.fn(),
        openStudio: vi.fn(),
        openPosts,
        openSettings: vi.fn(),
      }}>
        <QuickPlanner chats={[chat]} selectedChat={chat} onSendNow={onSendNow} onSchedule={onSchedule} />
      </QuickPlannerNavigationContext.Provider>,
    );
    const editor = screen.getByRole('textbox', { name: 'Reminder text' });
    const addPhoto = (name: string) => fireEvent.change(container.querySelector<HTMLInputElement>('input[type="file"]')!, {
      target: { files: [new File(['photo'], name, { type: 'image/png' })] },
    });
    const submit = () => container.querySelector<HTMLButtonElement>('.quick-planner-schedule-row .quick-planner-submit')!;

    fireEvent.change(editor, { target: { value: 'Keep this send' } });
    addPhoto('failed-send.png');
    fireEvent.click(screen.getByRole('button', { name: 'Send now' }));
    await act(async () => { fireEvent.click(submit()); await Promise.resolve(); });
    expect(onSendNow).toHaveBeenCalledWith(chat, 'Keep this send', ['C:/photos/failed-send.png'], undefined, []);
    expect(editor).toHaveValue('Keep this send');
    expect(screen.getByText('failed-send.png')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Message was not sent.');
    expect(screen.getByRole('alert')).not.toHaveTextContent('Posts');

    fireEvent.click(within(screen.getByRole('group', { name: 'Planner actions' })).getByRole('button', { name: 'Schedule' }));
    await act(async () => { fireEvent.click(submit()); await Promise.resolve(); });
    expect(onSchedule).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(submit()); await Promise.resolve(); });
    expect(onSchedule).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Keep this send',
      attachments: ['C:/photos/failed-send.png'],
    }));
    expect(editor).toHaveValue('Keep this send');
    expect(screen.getByText('failed-send.png')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Message could not be scheduled.');
    expect(screen.getByRole('alert')).not.toHaveTextContent('Posts');
    expect(openPosts).not.toHaveBeenCalled();
  });

  it('keeps Planner content and warns when Telegram sent but history persistence failed', async () => {
    vi.setSystemTime(new Date(2026, 9, 19, 10, 10, 0));
    const chat: Chat = { id: 'chat-history-failure', name: 'History failure chat' };
    const onSendNow = vi.fn().mockResolvedValue('sent-history-failed');
    const { container } = render(
      <QuickPlanner chats={[chat]} selectedChat={chat} onSendNow={onSendNow} />,
    );
    const editor = screen.getByRole('textbox', { name: 'Reminder text' });
    const submit = () => container.querySelector<HTMLButtonElement>('.quick-planner-schedule-row .quick-planner-submit')!;

    fireEvent.change(editor, { target: { value: 'Keep confirmed message' } });
    fireEvent.click(screen.getByRole('button', { name: 'NOW' }));
    fireEvent.click(screen.getByRole('button', { name: 'Choose time' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Schedule time picker' })).getByRole('option', { name: '10:45' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send now' }));
    await act(async () => { fireEvent.click(submit()); await Promise.resolve(); });

    expect(onSendNow).toHaveBeenCalledWith(chat, 'Keep confirmed message', undefined, undefined, []);
    expect(editor).toHaveValue('Keep confirmed message');
    expect(screen.getByRole('status')).toHaveClass('is-warning');
    expect(screen.getByRole('status')).toHaveTextContent('Message history could not be saved.');
    expect(screen.getByRole('status')).not.toHaveClass('is-success');
    expect(screen.getByRole('button', { name: 'Choose time' })).toHaveTextContent('10:11');
  });

  it('uses the first chat-name letter in placeholder avatars', () => {
    const chat: Chat = { id: 'chat-1', name: 'Design group', type: 'group' };
    const { container } = render(<QuickPlanner chats={[chat]} selectedChat={chat} />);

    expect(container.querySelector('.quick-planner-chat > .quick-planner-chat-avatar')).toHaveTextContent('D');
    fireEvent.click(container.querySelector('.quick-planner-chat')!);
    const chatOptionList = container.querySelector<HTMLElement>('.quick-planner-chat-options')!;
    const chatOption = within(chatOptionList).getByRole('option', { name: /Design group/ });
    expect(chatOption.querySelector('.quick-planner-chat-avatar')).toHaveTextContent('D');
  });

  it('warns instead of opening Studio when draft text is empty', () => {
    const openStudio = vi.fn();
    render(
      <QuickPlannerNavigationContext.Provider value={{
        currentSection: 'quick-plan',
        openQuickPlan: vi.fn(),
        openStudio,
        openPosts: vi.fn(),
        openSettings: vi.fn(),
      }}>
        <QuickPlanner />
      </QuickPlannerNavigationContext.Provider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Draft' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open in Studio' }));

    expect(screen.getByRole('status')).toHaveTextContent('Write a message before opening Studio.');
    expect(openStudio).not.toHaveBeenCalled();
  });

  it('opens Studio when draft text is present', () => {
    const openStudio = vi.fn();
    const onOpenInStudio = vi.fn();
    render(
      <QuickPlannerNavigationContext.Provider value={{
        currentSection: 'quick-plan',
        openQuickPlan: vi.fn(),
        openStudio,
        openPosts: vi.fn(),
        openSettings: vi.fn(),
      }}>
        <QuickPlanner onOpenInStudio={onOpenInStudio} />
      </QuickPlannerNavigationContext.Provider>,
    );

    fireEvent.change(screen.getByRole('textbox', { name: 'Reminder text' }), {
      target: { value: 'Write the next idea' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Draft' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open in Studio' }));

    expect(onOpenInStudio).toHaveBeenCalledWith({
      text: 'Write the next idea',
      attachments: [],
      entities: [],
    });
    expect(openStudio).not.toHaveBeenCalled();
  });

  it('returns to Studio when Escape is pressed in Quick Planner', () => {
    const openStudio = vi.fn();
    render(
      <QuickPlannerNavigationContext.Provider value={{
        currentSection: 'quick-plan',
        openQuickPlan: vi.fn(),
        openStudio,
        openPosts: vi.fn(),
        openSettings: vi.fn(),
      }}>
        <QuickPlanner />
      </QuickPlannerNavigationContext.Provider>,
    );

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(openStudio).toHaveBeenCalledOnce();
  });

  it('closes an open Planner picker before Escape returns to Studio', () => {
    const openStudio = vi.fn();
    render(
      <QuickPlannerNavigationContext.Provider value={{
        currentSection: 'quick-plan',
        openQuickPlan: vi.fn(),
        openStudio,
        openPosts: vi.fn(),
        openSettings: vi.fn(),
      }}>
        <QuickPlanner />
      </QuickPlannerNavigationContext.Provider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Message effects' }));
    expect(screen.getByRole('dialog', { name: 'Message effects' })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Message effects' })).not.toBeInTheDocument();
    expect(openStudio).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(openStudio).toHaveBeenCalledOnce();
  });

  it('passes selected attachment paths when opening Studio from Planner', () => {
    const previousTelegram = Object.getOwnPropertyDescriptor(window, 'telegram');
    Object.defineProperty(window, 'telegram', {
      configurable: true,
      value: { getFilePath: vi.fn((file: File) => `C:/photos/${file.name}`) },
    });
    const onOpenInStudio = vi.fn();
    const { container } = render(<QuickPlanner onOpenInStudio={onOpenInStudio} />);
    const editor = screen.getByRole('textbox', { name: 'Reminder text' });
    fireEvent.change(editor, { target: { value: 'Photo caption' } });
    fireEvent.change(container.querySelector<HTMLInputElement>('input[type="file"]')!, {
      target: { files: [new File(['photo'], 'photo.png', { type: 'image/png' })] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Draft' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open in Studio' }));

    expect(onOpenInStudio).toHaveBeenCalledWith({
      text: 'Photo caption',
      attachments: ['C:/photos/photo.png'],
      entities: [],
    });

    if (previousTelegram) Object.defineProperty(window, 'telegram', previousTelegram);
    else Reflect.deleteProperty(window, 'telegram');
  });

  it('opens Studio with a photo even when the Planner caption is empty', () => {
    Object.defineProperty(window, 'telegram', {
      configurable: true,
      value: { getFilePath: vi.fn((file: File) => `C:/photos/${file.name}`) },
    });
    const onOpenInStudio = vi.fn();
    const { container } = render(<QuickPlanner onOpenInStudio={onOpenInStudio} />);
    fireEvent.change(container.querySelector<HTMLInputElement>('input[type="file"]')!, {
      target: { files: [new File(['photo'], 'photo.png', { type: 'image/png' })] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Draft' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open in Studio' }));

    expect(onOpenInStudio).toHaveBeenCalledWith({
      text: '',
      attachments: ['C:/photos/photo.png'],
      entities: [],
    });
  });

  it('keeps selected photos separate in Planner until the user explicitly opens Studio', () => {
    const getFilePath = vi.fn((file: File) => `C:/photos/${file.name}`);
    Object.defineProperty(window, 'telegram', {
      configurable: true,
      value: { getFilePath },
    });
    const onOpenInStudio = vi.fn();
    const { container } = render(<QuickPlanner onOpenInStudio={onOpenInStudio} />);
    fireEvent.change(container.querySelector<HTMLInputElement>('input[type="file"]')!, {
      target: { files: [new File(['photo'], 'photo.png', { type: 'image/png' })] },
    });

    expect(screen.getByText('photo.png')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('File added.');
    expect(screen.getByRole('status')).not.toHaveTextContent('Studio');
    expect(onOpenInStudio).not.toHaveBeenCalled();
    const emojiTool = screen.getByRole('button', { name: 'Open emoji window' }).closest('.quick-planner-tool-anchor');
    const attachmentPanel = emojiTool?.nextElementSibling;
    expect(attachmentPanel).toHaveClass('quick-planner-attachments');
    expect(attachmentPanel?.querySelector('.quick-planner-attachments-scrollbar')).toBeInTheDocument();
    expect(attachmentPanel?.querySelector('.quick-planner-attachment-list')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove photo.png' })).toBeInTheDocument();
    expect(readPlannerDraftAttachments()).toEqual(['C:/photos/photo.png']);
    fireEvent.click(screen.getByRole('button', { name: 'Remove photo.png' }));
    expect(screen.queryByText('photo.png')).not.toBeInTheDocument();
    expect(readPlannerDraftAttachments()).toEqual([]);
    expect(onOpenInStudio).not.toHaveBeenCalled();
  });

  it('adds a pasted clipboard image as a Planner attachment and leaves text paste enabled', async () => {
    const copyAttachment = vi.fn(async (file: File) => ({
      success: true,
      attachment: { name: 'clipboard-photo.png', path: 'C:/drafts/clipboard-photo.png', size: file.size },
    }));
    Object.defineProperty(window, 'draftStorage', {
      configurable: true,
      value: { load: vi.fn(), copyAttachment },
    });
    const { container } = render(<QuickPlanner />);
    const editor = container.querySelector<HTMLTextAreaElement>('.quick-planner-message')!;
    const image = new File(['image-bytes'], 'clipboard-photo.png', { type: 'image/png' });
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', {
      value: {
        items: [{ kind: 'file', type: 'image/png', getAsFile: () => image }],
        files: [image],
        getData: (type: string) => type === 'text/plain' ? 'copied caption' : '',
      },
    });

    await act(async () => {
      editor.dispatchEvent(paste);
      await Promise.resolve();
    });

    expect(paste.defaultPrevented).toBe(false);
    expect(copyAttachment).toHaveBeenCalledWith(image);
    expect(screen.getByRole('button', { name: 'Remove clipboard-photo.png' })).toBeInTheDocument();
    expect(readPlannerDraftAttachments()).toEqual(['C:/drafts/clipboard-photo.png']);
  });

  it('selects a Planner line on a triple click and all text on a fourth click', () => {
    const { container } = render(<QuickPlanner />);
    const editor = container.querySelector<HTMLTextAreaElement>('.quick-planner-message')!;
    const message = 'First line\nSecond line\nThird line';
    fireEvent.change(editor, { target: { value: message } });

    editor.setSelectionRange(14, 20);
    fireEvent.click(editor, { detail: 3 });
    expect(editor.value.slice(editor.selectionStart, editor.selectionEnd)).toBe('Second line');

    fireEvent.click(editor, { detail: 4 });
    expect(editor.selectionStart).toBe(0);
    expect(editor.selectionEnd).toBe(message.length);
  });

  it('accepts file drops on the text field and highlights it while dragging', () => {
    const getFilePath = vi.fn((file: File) => `C:/photos/${file.name}`);
    Object.defineProperty(window, 'telegram', {
      configurable: true,
      value: { getFilePath },
    });
    render(<QuickPlanner />);
    const editor = screen.getByRole('textbox', { name: 'Reminder text' });
    const file = new File(['photo'], 'dropped.png', { type: 'image/png' });
    const dataTransfer = {
      files: [file],
      types: ['Files'],
      dropEffect: 'none',
    };

    fireEvent.dragEnter(editor, { dataTransfer });
    expect(editor).toHaveClass('is-file-drag-over');
    fireEvent.dragOver(editor, { dataTransfer });
    fireEvent.drop(editor, { dataTransfer });

    expect(editor).not.toHaveClass('is-file-drag-over');
    expect(editor).toHaveValue('');
    expect(screen.getByText('dropped.png')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('File added.');
    expect(getFilePath).toHaveBeenCalledWith(file);
    expect(readPlannerDraftAttachments()).toEqual(['C:/photos/dropped.png']);
  });

  it('limits Planner attachments to ten and reports the limit', () => {
    Object.defineProperty(window, 'telegram', {
      configurable: true,
      value: { getFilePath: vi.fn((file: File) => `C:/photos/${file.name}`) },
    });
    const { container } = render(<QuickPlanner />);
    const files = Array.from({ length: 12 }, (_, index) => (
      new File([`photo-${index}`], `photo-${index}.png`, { type: 'image/png' })
    ));
    fireEvent.change(container.querySelector<HTMLInputElement>('input[type="file"]')!, {
      target: { files },
    });

    expect(container.querySelectorAll('.quick-planner-attachment')).toHaveLength(10);
    expect(screen.getByRole('status')).toHaveTextContent('Max 10 files per message.');
    expect(screen.getByRole('status')).toHaveClass('is-warning');
  });

  it('shows the attachment scrollbar only when the chips overflow', () => {
    Object.defineProperty(window, 'telegram', {
      configurable: true,
      value: { getFilePath: vi.fn((file: File) => `C:/photos/${file.name}`) },
    });
    const { container } = render(<QuickPlanner />);
    fireEvent.change(container.querySelector<HTMLInputElement>('input[type="file"]')!, {
      target: { files: [
        new File(['one'], 'one.png', { type: 'image/png' }),
        new File(['two'], 'two.png', { type: 'image/png' }),
      ] },
    });
    const panel = container.querySelector('.quick-planner-attachments')!;
    const list = panel.querySelector('.quick-planner-attachment-list') as HTMLDivElement;

    const scrollbar = panel.querySelector('.quick-planner-attachments-scrollbar') as HTMLDivElement;
    expect(list).toBeInTheDocument();
    expect(panel).not.toHaveClass('has-overflow');
    expect(quickPlannerStyles).toMatch(/\.quick-planner-attachments:not\(\.has-overflow\)\s+\.quick-planner-attachments-scrollbar\s*\{\s*display:\s*none;/);
    expect(quickPlannerStyles).toMatch(/\.quick-planner-attachment\s*\{[^}]*border:\s*1px solid #c5d0d9;/);

    Object.defineProperty(list, 'scrollWidth', { configurable: true, value: 600 });
    Object.defineProperty(list, 'clientWidth', { configurable: true, value: 250 });
    Object.defineProperty(list, 'scrollLeft', { value: 0, writable: true, configurable: true });
    fireEvent.resize(window);

    expect(panel).toHaveClass('has-overflow');
    expect(scrollbar).toHaveAttribute('role', 'scrollbar');
    fireEvent.keyDown(list, { key: 'ArrowRight', code: 'ArrowRight' });
    expect(list.scrollLeft).toBeGreaterThan(0);
  });

  it('passes the selected Telegram effect when opening Studio from Planner', async () => {
    Object.defineProperty(window, 'telegram', {
      configurable: true,
      value: {
        getAvailableEffects: vi.fn().mockResolvedValue({
          success: true,
          effects: [{ id: '123456789', emoticon: '🎉', premiumRequired: false }],
        }),
      },
    });
    const onOpenInStudio = vi.fn();
    render(<QuickPlanner onOpenInStudio={onOpenInStudio} />);
    await act(async () => { await Promise.resolve(); });
    fireEvent.change(screen.getByRole('textbox', { name: 'Reminder text' }), {
      target: { value: 'Effect caption' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Message effects' }));
    const effects = screen.getByRole('group', { name: 'Choose message effect' });
    fireEvent.click(within(effects).getByRole('button', { name: 'effect 🎉' }));
    fireEvent.click(screen.getByRole('button', { name: 'Draft' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open in Studio' }));

    expect(onOpenInStudio).toHaveBeenCalledWith({
      text: 'Effect caption',
      attachments: [],
      entities: [],
      effect: '123456789',
    });
  });

  it('starts one minute ahead and clamps manually entered past times', () => {
    vi.setSystemTime(new Date(2026, 9, 19, 10, 10, 0));
    render(<QuickPlanner />);
    const timeTrigger = screen.getByRole('button', { name: 'Choose time' });

    expect(timeTrigger).toHaveTextContent('10:11');
    fireEvent.click(timeTrigger);
    fireEvent.change(screen.getByRole('textbox', { name: 'Enter schedule time' }), {
      target: { value: '09:00' },
    });

    expect(timeTrigger).toHaveTextContent('10:11');
  });

  it('keeps the selected schedule time fixed when the clock advances', () => {
    vi.setSystemTime(new Date(2026, 9, 19, 10, 14, 0));
    render(<QuickPlanner />);
    const timeTrigger = screen.getByRole('button', { name: 'Choose time' });

    expect(timeTrigger).toHaveTextContent('10:15');
    act(() => vi.advanceTimersByTime(60_025));

    expect(timeTrigger).toHaveTextContent('10:15');
  });

  it('warns once when schedule time has not been touched, then allows the second submit', async () => {
    vi.setSystemTime(new Date(2026, 9, 19, 10, 10, 0));
    const chat: Chat = { id: 'chat-1', name: 'Studio channel', type: 'channel' };
    const onSchedule = vi.fn().mockResolvedValue(true);
    const { container } = render(<QuickPlanner chats={[chat]} selectedChat={chat} onSchedule={onSchedule} />);
    const editor = screen.getByRole('textbox', { name: 'Reminder text' });
    const submit = container.querySelector<HTMLButtonElement>('.quick-planner-schedule-row .quick-planner-submit')!;

    fireEvent.change(editor, { target: { value: 'Schedule without selecting a time' } });

    await act(async () => {
      fireEvent.click(submit);
      await Promise.resolve();
    });

    expect(onSchedule).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveClass('is-warning');
    expect(screen.getByRole('status')).toHaveTextContent('Schedule now? Press again to confirm.');

    await act(async () => {
      fireEvent.click(submit);
      await Promise.resolve();
    });

    expect(onSchedule).toHaveBeenCalledTimes(1);
  });

  it('keeps the date and time fields aligned in Send now without opening pickers', () => {
    render(<QuickPlanner />);
    fireEvent.click(screen.getByRole('button', { name: 'Send now' }));
    const dateTrigger = screen.getByRole('button', { name: 'Choose date' });
    const timeTrigger = screen.getByRole('button', { name: 'Choose time' });

    expect(dateTrigger).toHaveClass('is-readonly');
    expect(timeTrigger).toHaveClass('is-readonly');
    expect(dateTrigger).toHaveAttribute('aria-disabled', 'true');
    expect(timeTrigger).toHaveAttribute('aria-disabled', 'true');
    expect(dateTrigger.querySelector('svg:last-child')).toHaveStyle({ visibility: 'hidden' });
    expect(timeTrigger.querySelector('svg:last-child')).toHaveStyle({ visibility: 'hidden' });
    expect(quickPlannerStyles).toMatch(
      /html\[data-theme\] \.quick-planner \.quick-planner-schedule-field > button\.is-readonly\s*\{\s*color:\s*var\(--planner-muted\);\s*\}/,
    );
    expect(quickPlannerStyles).toMatch(
      /html\[data-theme\] \.quick-planner \.quick-planner-schedule-field > button\.is-readonly svg\s*\{\s*color:\s*currentColor;\s*\}/,
    );
    expect(quickPlannerStyles).toMatch(
      /html\[data-theme\] \.quick-planner \.quick-planner-schedule-field > button\.is-readonly:hover,\s*html\[data-theme\] \.quick-planner \.quick-planner-schedule-field > button\.is-readonly:focus-visible,\s*html\[data-theme\] \.quick-planner \.quick-planner-schedule-field > button\.is-readonly:active\s*\{[^}]*border-color:\s*transparent;[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;[^}]*outline:\s*none;[^}]*transform:\s*none;/,
    );

    fireEvent.click(dateTrigger);
    fireEvent.click(timeTrigger);
    expect(screen.queryByRole('dialog', { name: 'Choose schedule date' })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Choose schedule time' })).not.toBeInTheDocument();
  });

  it('does not warn when NOW is selected before scheduling', async () => {
    vi.setSystemTime(new Date(2026, 9, 19, 10, 10, 0));
    const chat: Chat = { id: 'chat-1', name: 'Studio channel', type: 'channel' };
    const onSchedule = vi.fn().mockResolvedValue(true);
    const { container } = render(<QuickPlanner chats={[chat]} onSchedule={onSchedule} />);

    fireEvent.click(screen.getByRole('button', { name: 'NOW' }));

    expect(screen.getByRole('button', { name: 'Choose time' })).toHaveTextContent('10:11');
    fireEvent.change(screen.getByRole('textbox', { name: 'Reminder text' }), {
      target: { value: 'Schedule one minute from now' },
    });
    fireEvent.click(container.querySelector<HTMLButtonElement>('.quick-planner-schedule-row .quick-planner-submit')!);

    expect(onSchedule).toHaveBeenCalledWith({
      chatId: 'chat-1',
      message: 'Schedule one minute from now',
      date: '2026-10-19',
      time: '10:11',
      entities: [],
    });
  });

  it('resets the schedule date and time after a successful schedule', async () => {
    vi.setSystemTime(new Date(2026, 9, 19, 10, 10, 0));
    const chat: Chat = { id: 'chat-1', name: 'Studio channel', type: 'channel' };
    const onSchedule = vi.fn().mockResolvedValue(true);
    const { container } = render(<QuickPlanner chats={[chat]} onSchedule={onSchedule} />);

    fireEvent.click(screen.getByRole('button', { name: 'NOW' }));
    fireEvent.click(screen.getByRole('button', { name: 'Choose time' }));
    const timePicker = screen.getByRole('dialog', { name: 'Schedule time picker' });
    fireEvent.click(within(timePicker).getByRole('option', { name: '10:45' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Reminder text' }), {
      target: { value: 'Schedule and reset the fields' },
    });

    await act(async () => {
      fireEvent.click(container.querySelector<HTMLButtonElement>('.quick-planner-schedule-row .quick-planner-submit')!);
      await Promise.resolve();
    });

    expect(onSchedule).toHaveBeenCalledWith(expect.objectContaining({
      date: '2026-10-19',
      time: '10:45',
    }));
    expect(screen.getByRole('button', { name: 'Choose date' })).toHaveTextContent('Oct 19');
    expect(screen.getByRole('button', { name: 'Choose time' })).toHaveTextContent('10:11');
  });

  it('resets the schedule date and time after a successful immediate send', async () => {
    vi.setSystemTime(new Date(2026, 9, 19, 10, 10, 0));
    const chat: Chat = { id: 'chat-1', name: 'Studio channel', type: 'channel' };
    const onSendNow = vi.fn().mockResolvedValue(true);
    const { container } = render(<QuickPlanner chats={[chat]} onSendNow={onSendNow} />);

    fireEvent.click(screen.getByRole('button', { name: 'NOW' }));
    fireEvent.click(screen.getByRole('button', { name: 'Choose time' }));
    const timePicker = screen.getByRole('dialog', { name: 'Schedule time picker' });
    fireEvent.click(within(timePicker).getByRole('option', { name: '10:45' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Reminder text' }), {
      target: { value: 'Send and reset the fields' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send now' }));

    await act(async () => {
      fireEvent.click(container.querySelector<HTMLButtonElement>('.quick-planner-schedule-row .quick-planner-submit')!);
      await Promise.resolve();
    });

    expect(onSendNow).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Choose date' })).toHaveTextContent('Oct 19');
    expect(screen.getByRole('button', { name: 'Choose time' })).toHaveTextContent('10:11');
  });

  it('opens the calendar and 15-minute time list above the schedule controls', () => {
    render(<QuickPlanner />);
    const dateButton = screen.getByRole('button', { name: 'Choose date' });
    const originalDate = dateButton.textContent;

    fireEvent.click(dateButton);
    const calendar = screen.getByRole('dialog', { name: 'Schedule date picker' });
    expect(calendar).toBeInTheDocument();
    fireEvent.click(within(calendar).getByRole('button', { name: 'Next month' }));

    const nextMonthDay = calendar.querySelector<HTMLButtonElement>('[aria-pressed="false"]:not(:disabled)');
    expect(nextMonthDay).not.toBeNull();
    fireEvent.click(nextMonthDay!);
    expect(screen.queryByRole('dialog', { name: 'Schedule date picker' })).not.toBeInTheDocument();
    expect(dateButton.textContent).not.toBe(originalDate);
    expect(dateButton.querySelector('span')).toHaveTextContent(/^[A-Z][a-z]{2} \d{1,2}( '\d{2})?$/);

    fireEvent.click(screen.getByRole('button', { name: 'Choose time' }));
    const timePicker = screen.getByRole('dialog', { name: 'Schedule time picker' });
    const editableTime = within(timePicker).getByRole('textbox', { name: 'Enter schedule time' }) as HTMLInputElement;
    expect(editableTime).toHaveFocus();
    expect(editableTime.selectionStart).toBe(editableTime.selectionEnd);
    const timeList = within(timePicker).getByRole('listbox', { name: 'Available times' });
    expect(within(timeList).getAllByRole('option')).toHaveLength(96);

    fireEvent.click(within(timeList).getByRole('option', { name: '09:15' }));
    expect(screen.queryByRole('dialog', { name: 'Schedule time picker' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose time' })).toHaveTextContent('09:15');
  });
});