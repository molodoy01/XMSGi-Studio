import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { LocaleProvider } from '@studio/lib/i18n';
import type { Chat, SavedDraft, Template } from '@studio/types';
import { RichTextEditor as BaseRichTextEditor, shouldPreventEditorInsertion } from './RichTextEditor';
import { WorkspaceTextStage } from './WorkspaceTextStage';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function RichTextEditor(props: React.ComponentProps<typeof BaseRichTextEditor>) {
  return <LocaleProvider><BaseRichTextEditor {...props} /></LocaleProvider>;
}

const chatA: Chat = {
  id: 'chat-1',
  name: 'Alpha Team',
  username: 'alpha',
  type: 'group',
  avatarDataUrl: '',
};

const chatB: Chat = {
  id: 'chat-2',
  name: 'Beta Channel',
  username: 'beta',
  type: 'channel',
  avatarDataUrl: '',
};

const templateA: Template = {
  id: 'tpl-1',
  name: 'Welcome',
  body: 'Hello from template',
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
};

const savedDraftA: SavedDraft = {
  id: 'draft-1',
  name: 'Follow-up',
  body: 'Saved draft message',
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
};

function renderStage(overrides: Partial<React.ComponentProps<typeof WorkspaceTextStage>> = {}) {
  const rootElement = document.createElement('div');
  document.body.appendChild(rootElement);

  const root: Root = createRoot(rootElement);
  const defaults: React.ComponentProps<typeof WorkspaceTextStage> = {
    mode: 'editor',
    onModeChange: vi.fn(),
    selectedChat: chatA,
    chats: [chatA, chatB],
    selectedChats: [chatA],
    onChatSelectionChange: vi.fn(),
    onChatSelectionDone: vi.fn(),
    onChatSelectionBack: vi.fn(),
    onChatError: vi.fn(),
    onAddChat: vi.fn(),
    onRemoveChat: vi.fn(),
    draftBody: 'Hello',
    draftEntities: [],
    date: '2026-01-10',
    time: '09:00',
    setDate: vi.fn(),
    setTime: vi.fn(),
    followCurrentTime: false,
    setFollowCurrentTime: vi.fn(),
    scheduling: false,
    canSchedule: true,
    onSchedule: vi.fn(),
    repeatMode: 'none',
    setRepeatMode: vi.fn(),
    repeatDays: [],
    setRepeatDays: vi.fn(),
    repeatOccurrences: 3,
    setRepeatOccurrences: vi.fn(),
    templates: [templateA],
    onInsertTemplate: vi.fn(),
    templateEditingId: null,
    templateDraftName: '',
    setTemplateDraftName: vi.fn(),
    templateDraftBody: '',
    setTemplateDraftBody: vi.fn(),
    openTemplateEditor: vi.fn(),
    onDeleteTemplate: vi.fn(),
    closeTemplateEditor: vi.fn(),
    saveTemplateStage: vi.fn(),
    savedDrafts: [savedDraftA],
    onInsertDraft: vi.fn(),
    draftEditingId: null,
    draftColor: 'gray',
    setDraftColor: vi.fn(),
    draftName: '',
    setDraftName: vi.fn(),
    draftBodyText: '',
    setDraftBodyText: vi.fn(),
    openDraftEditor: vi.fn(),
    onDeleteDraft: vi.fn(),
    closeDraftEditor: vi.fn(),
    saveDraftStage: vi.fn(),
    draftStoreReady: true,
    draftStoreSaving: false,
    onImportDrafts: vi.fn(),
    onImportEditorText: vi.fn(),
  };

  act(() => {
    root.render(<LocaleProvider><WorkspaceTextStage {...defaults} {...overrides} /></LocaleProvider>);
  });

  return {
    root,
    rootElement,
    rerender: (nextOverrides: Partial<React.ComponentProps<typeof WorkspaceTextStage>>) => {
      act(() => {
        root.render(<LocaleProvider><WorkspaceTextStage {...defaults} {...nextOverrides} /></LocaleProvider>);
      });
    },
    unmount: () => {
      act(() => {
        root.unmount();
      });
      rootElement.remove();
    },
  };
}

function renderRichTextEditor(overrides: Partial<React.ComponentProps<typeof RichTextEditor>> = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const onChange = vi.fn();
  const defaults: React.ComponentProps<typeof RichTextEditor> = {
    text: '',
    entities: [],
    onChange,
    maxLength: 4096,
  };

  act(() => root.render(<LocaleProvider><RichTextEditor {...defaults} {...overrides} /></LocaleProvider>));

  return {
    container,
    editor: container.querySelector('[contenteditable="true"]') as HTMLDivElement,
    onChange,
    root,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function createLogoHarness() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const animation = { cancel: vi.fn(), onfinish: null } as unknown as Animation;
  const animate = vi.fn((frames: Keyframe[], options?: KeyframeAnimationOptions) => {
    void frames;
    void options;
    return animation;
  });
  const previousAnimate = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'animate');
  const previousImageBounds = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'getBoundingClientRect');
  Object.defineProperty(HTMLImageElement.prototype, 'animate', { configurable: true, value: animate });
  Object.defineProperty(HTMLImageElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ width: 240, height: 240, top: 0, right: 240, bottom: 240, left: 0, x: 0, y: 0, toJSON: () => ({}) }),
  });
  act(() => root.render(
    <LocaleProvider><RichTextEditor text="" entities={[]} onChange={vi.fn()} maxLength={4096} /></LocaleProvider>,
  ));
  const editor = container.querySelector('[contenteditable="true"]') as HTMLDivElement;
  let cleanedUp = false;
  Object.defineProperty(editor, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ width: 600, height: 300, top: 0, right: 600, bottom: 300, left: 0, x: 0, y: 0, toJSON: () => ({}) }),
  });

  return {
    animation,
    animate,
    container,
    editor,
    cleanup() {
      if (cleanedUp) return;
      cleanedUp = true;
      act(() => root.unmount());
      container.remove();
      if (previousAnimate) Object.defineProperty(HTMLImageElement.prototype, 'animate', previousAnimate);
      else Reflect.deleteProperty(HTMLImageElement.prototype, 'animate');
      if (previousImageBounds) Object.defineProperty(HTMLImageElement.prototype, 'getBoundingClientRect', previousImageBounds);
      else Reflect.deleteProperty(HTMLImageElement.prototype, 'getBoundingClientRect');
    },
  };
}

describe('WorkspaceTextStage editor flows', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.localStorage.clear();
  });

  it('inserts the selected template and returns to editor mode', () => {
    const onModeChange = vi.fn();
    const onInsertTemplate = vi.fn();
    const { unmount } = renderStage({
      mode: 'template',
      onModeChange,
      onInsertTemplate,
      templates: [templateA],
    });

    const templateButton = Array.from(document.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Welcome')
    );

    expect(templateButton).toBeTruthy();

    act(() => {
      templateButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onInsertTemplate).toHaveBeenCalledWith(templateA.body);
    expect(onModeChange).toHaveBeenCalledWith('editor');
    unmount();
  });

  it('searches templates by name and body and shows an empty search state', () => {
    const secondTemplate = { ...templateA, id: 'tpl-2', name: 'Announcement', body: 'Team update for Monday' };
    const { unmount } = renderStage({
      mode: 'template',
      templates: [templateA, secondTemplate],
    });

    const searchInput = screen.getByRole('searchbox', { name: 'Search templates' });
    expect(searchInput.closest('.workspace-page-template-stage-header')).not.toBeNull();
    fireEvent.change(searchInput, { target: { value: '  TEAM UPDATE  ' } });
    const templateStage = document.querySelector('.workspace-page-rich-text-template-stage:not(.workspace-page-rich-text-draft-stage)');
    expect(templateStage?.querySelectorAll('.workspace-page-template-stage-item')).toHaveLength(1);
    expect(templateStage?.querySelector('.workspace-page-template-stage-item strong')?.textContent).toBe('Announcement');

    fireEvent.change(searchInput, { target: { value: 'missing phrase' } });
    expect(templateStage?.querySelector('.workspace-page-template-stage-empty')?.textContent).toBe('No matching templates.');

    unmount();
  });

  it('opens the template editor and saves a new template from the stage form', () => {
    const setTemplateDraftName = vi.fn();
    const setTemplateDraftBody = vi.fn();
    const saveTemplateStage = vi.fn();
    const openTemplateEditor = vi.fn();

    const { unmount } = renderStage({
      mode: 'template',
      templateEditingId: 'new',
      templateDraftName: 'Meeting note',
      templateDraftBody: 'Body text',
      setTemplateDraftName,
      setTemplateDraftBody,
      saveTemplateStage,
      openTemplateEditor,
    });

    const templateEditor = document.querySelector('.workspace-page-template-stage-editor') as HTMLFormElement;
    const nameInput = templateEditor.querySelector('input') as HTMLInputElement;
    const bodyInput = templateEditor.querySelector('textarea') as HTMLTextAreaElement;
    const saveButton = document.querySelector('[form="workspace-template-editor-form"]') as HTMLButtonElement;

    expect(nameInput).toBeTruthy();
    expect(bodyInput).toBeTruthy();
    expect(nameInput.value).toBe('Meeting note');
    expect(bodyInput.value).toBe('Body text');

    act(() => {
      saveButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(saveTemplateStage).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('keeps template Save enabled and focuses the name field when the name is missing', () => {
    const saveTemplateStage = vi.fn();
    const { unmount } = renderStage({
      mode: 'template',
      templateEditingId: 'new',
      templateDraftName: '',
      templateDraftBody: 'Body text',
      saveTemplateStage,
    });

    const nameInput = screen.getByRole('textbox', { name: 'Template name' }) as HTMLInputElement;
    const scrollIntoView = vi.fn();
    nameInput.scrollIntoView = scrollIntoView;
    const saveButton = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;

    expect(saveButton).toBeEnabled();
    act(() => saveButton.click());

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
    expect(nameInput).toHaveFocus();
    expect(saveTemplateStage).not.toHaveBeenCalled();
    unmount();
  });

  it('shows saved drafts in the template-style list and loads the selected draft', () => {
    const onInsertDraft = vi.fn();
    const { unmount } = renderStage({ mode: 'draft', onInsertDraft, savedDrafts: [savedDraftA] });

    const draftView = document.querySelector('.workspace-page-rich-text-draft-stage.is-active');
    const savedDraftButton = Array.from(draftView?.querySelectorAll('button') ?? []).find((button) => button.textContent?.includes('Follow-up'));

    expect(draftView?.classList.contains('workspace-page-rich-text-template-stage')).toBe(true);
    expect(draftView?.querySelector('header strong')?.textContent).toBe('Saved drafts');
    expect(savedDraftButton).toBeTruthy();
    expect(savedDraftButton?.querySelector('.workspace-page-draft-color-dot')?.getAttribute('data-color')).toBe('gray');
    expect(savedDraftButton?.querySelector('.workspace-page-draft-color-indicator')?.getAttribute('data-color-label')).toBe('Gray');

    act(() => {
      savedDraftButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onInsertDraft).toHaveBeenCalledWith(savedDraftA);
    unmount();
  });

  it('hides the saved-on-device label in Russian draft headers', () => {
    window.localStorage.setItem('awaitmsg_locale', 'ru');
    const { unmount } = renderStage({ mode: 'draft', savedDrafts: [savedDraftA], draftStoreReady: true, draftStoreSaving: false });
    const status = document.querySelector('.workspace-page-draft-header-info span');

    expect(status?.textContent).toContain('Сохранено: 1');
    expect(status?.textContent).not.toContain('Сохранено на устройстве');
    unmount();
  });

  it('filters saved drafts by color and restores all drafts when the selected color is pressed again', () => {
    const savedDrafts = [
      { ...savedDraftA, id: 'gray-draft', name: 'Gray draft', color: 'gray' as const },
      { ...savedDraftA, id: 'coral-draft', name: 'Coral draft', color: 'coral' as const },
      { ...savedDraftA, id: 'blue-draft', name: 'Blue draft', color: 'blue' as const },
    ];
    const { unmount } = renderStage({ mode: 'draft', savedDrafts });
    const draftView = document.querySelector('.workspace-page-rich-text-draft-stage.is-active')!;
    const getRows = () => draftView.querySelectorAll('.workspace-page-template-stage-item');
    const filterGroup = draftView.querySelector('.workspace-page-draft-color-filters')!;
    const coralFilter = screen.getByRole('button', { name: 'Coral draft color' });

    expect(filterGroup.parentElement).toBe(draftView.querySelector('.workspace-page-stage-header'));
    expect(draftView.querySelector('.workspace-page-draft-list-area .workspace-page-draft-color-filters')).toBeNull();
    expect(draftView.querySelector('.workspace-page-draft-selected-color')).toBeNull();
    expect(getRows()).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Gray draft color' })).toHaveTextContent('1');
    expect(coralFilter).toHaveTextContent('1');
    expect(screen.getByRole('button', { name: 'Blue draft color' })).toHaveTextContent('1');

    const emptyColorFilter = screen.getByRole('button', { name: 'Green draft color' });
    expect(emptyColorFilter).toBeEnabled();
    act(() => emptyColorFilter.click());
    expect(emptyColorFilter).toHaveAttribute('aria-pressed', 'false');
    expect(getRows()).toHaveLength(3);

    act(() => fireEvent.mouseEnter(coralFilter));
    expect(draftView.querySelector('.workspace-page-draft-selected-color')).toHaveTextContent('Coral');
    expect(draftView.querySelector('.workspace-page-draft-selected-color')).toHaveAttribute('data-color', 'coral');
    act(() => fireEvent.mouseLeave(coralFilter));
    expect(draftView.querySelector('.workspace-page-draft-selected-color')).toBeNull();

    act(() => coralFilter.click());
    expect(getRows()).toHaveLength(1);
    expect(getRows()[0]?.querySelector('.workspace-page-draft-name')?.textContent).toBe('Coral draft');
    expect(coralFilter).toHaveAttribute('aria-pressed', 'true');
    expect(draftView.querySelector('.workspace-page-draft-selected-color')).toHaveTextContent('Coral');
    expect(window.localStorage.getItem('xmsgi_saved_draft_color_filter')).toBe('coral');

    unmount();
    const reopened = renderStage({ mode: 'draft', savedDrafts });
    const reopenedView = document.querySelector('.workspace-page-rich-text-draft-stage.is-active')!;
    const reopenedCoralFilter = screen.getByRole('button', { name: 'Coral draft color' });

    expect(reopenedCoralFilter).toHaveAttribute('aria-pressed', 'true');
    expect(reopenedView.querySelectorAll('.workspace-page-template-stage-item')).toHaveLength(1);
    expect(reopenedView.querySelector('.workspace-page-draft-name')?.textContent).toBe('Coral draft');

    act(() => reopenedCoralFilter.click());
    expect(reopenedView.querySelectorAll('.workspace-page-template-stage-item')).toHaveLength(3);
    expect(reopenedCoralFilter).toHaveAttribute('aria-pressed', 'false');
    expect(reopenedView.querySelector('.workspace-page-draft-selected-color')).toBeNull();
    expect(window.localStorage.getItem('xmsgi_saved_draft_color_filter')).toBeNull();

    reopened.unmount();
  });

  it('keeps the attachment count beside the draft name and the character count on the right', () => {
    const draftWithOneAttachment = {
      ...savedDraftA,
      id: 'draft-one-attachment',
      name: 'One attachment',
      attachments: [{ id: 'photo', type: 'image' as const, name: 'photo.png', mimeType: 'image/png', path: '/tmp/photo.png', size: 1234, position: 0 }],
    };
    const draftWithTwoAttachments = {
      ...savedDraftA,
      id: 'draft-2',
      name: 'Two attachments',
      attachments: [
        { id: 'photo', type: 'image' as const, name: 'photo.png', mimeType: 'image/png', path: '/tmp/photo.png', size: 1234, position: 0 },
        { id: 'brief', type: 'file' as const, name: 'brief.pdf', mimeType: 'application/pdf', path: '/tmp/brief.pdf', size: 4567, position: 0 },
      ],
    };

    const { unmount } = renderStage({ mode: 'draft', savedDrafts: [savedDraftA, draftWithOneAttachment, draftWithTwoAttachments] });

    const draftView = document.querySelector('.workspace-page-rich-text-draft-stage.is-active');
    const getDraftButton = (name: string) => Array.from(draftView?.querySelectorAll('button') ?? []).find((button) => button.textContent?.includes(name));

    expect(getDraftButton('Follow-up')?.textContent).toContain('19 characters');
    expect(getDraftButton('Follow-up')?.textContent).not.toContain('attachment');
    const oneAttachmentButton = getDraftButton('One attachment');
    const twoAttachmentsButton = getDraftButton('Two attachments');
    expect(oneAttachmentButton?.textContent).toContain('One attachment1 attachment');
    expect(oneAttachmentButton?.textContent).toContain('19 characters');
    expect(twoAttachmentsButton?.textContent).toContain('Two attachments2 attachments');
    expect(twoAttachmentsButton?.textContent).toContain('19 characters');
    expect(oneAttachmentButton?.querySelector('.workspace-page-draft-name')?.nextElementSibling?.classList.contains('workspace-page-draft-attachment-summary')).toBe(true);
    expect(oneAttachmentButton?.querySelector('.workspace-page-draft-row-summary')?.textContent).toBe('19 characters');
    unmount();
  });

  it('does not show inline rename controls for saved drafts', () => {
    const { unmount } = renderStage({ mode: 'draft' });

    expect(screen.queryByRole('button', { name: /Rename draft/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'New draft name' })).not.toBeInTheDocument();
    unmount();
  });

  it('renders a draft editor with the template-style fields and save action', () => {
    const saveDraftStage = vi.fn();
    const { unmount } = renderStage({
      mode: 'draft',
      draftEditingId: 'new',
      draftColor: 'coral',
      draftName: 'New note',
      draftBodyText: 'Draft body',
      saveDraftStage,
    });

    const draftEditor = document.querySelector('#workspace-draft-editor-form') as HTMLFormElement;
    expect((draftEditor.querySelector('[aria-label="Draft name"]') as HTMLInputElement).value).toBe('New note');
    expect((draftEditor.querySelector('[aria-label="Draft text"]') as HTMLTextAreaElement).value).toBe('Draft body');
    expect(draftEditor.querySelector('[aria-label="Coral draft color"]')?.getAttribute('aria-checked')).toBe('true');
    expect(draftEditor.querySelector('.draft-color-selected-label')?.getAttribute('data-color')).toBe('coral');

    act(() => {
      (document.querySelector('[form="workspace-draft-editor-form"]') as HTMLButtonElement).click();
    });

    expect(saveDraftStage).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('previews the hovered draft color name and restores the selected color name', () => {
    const { unmount } = renderStage({
      mode: 'draft',
      draftEditingId: 'new',
      draftColor: 'coral',
    });
    const colorLabel = document.querySelector('.draft-color-selected-label');
    const blueSwatch = screen.getByRole('radio', { name: 'Blue draft color' });

    expect(colorLabel).toHaveTextContent('Coral');
    fireEvent.mouseEnter(blueSwatch);
    expect(colorLabel).toHaveTextContent('Blue');
    expect(colorLabel).toHaveAttribute('data-color', 'blue');

    fireEvent.mouseLeave(blueSwatch);
    expect(colorLabel).toHaveTextContent('Coral');
    expect(colorLabel).toHaveAttribute('data-color', 'coral');
    unmount();
  });

  it('keeps draft Save enabled when fields are missing and flashes the first missing field', () => {
    const saveDraftStage = vi.fn();
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 0;
    });
    const { unmount } = renderStage({
      mode: 'draft',
      draftEditingId: 'new',
      draftName: '',
      draftBodyText: 'Draft body',
      saveDraftStage,
    });

    const nameInput = screen.getByRole('textbox', { name: 'Draft name' }) as HTMLInputElement;
    const scrollIntoView = vi.fn();
    nameInput.scrollIntoView = scrollIntoView;
    const saveButton = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;

    expect(saveButton).toBeEnabled();
    act(() => saveButton.click());

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
    expect(nameInput).toHaveFocus();
    expect(nameInput.closest('label')).toHaveClass('workspace-page-draft-field-attention');
    expect(saveDraftStage).not.toHaveBeenCalled();
    unmount();
    vi.restoreAllMocks();
  });

  it('focuses and flashes the draft text field when its content is missing', () => {
    const saveDraftStage = vi.fn();
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 0;
    });
    const { unmount } = renderStage({
      mode: 'draft',
      draftEditingId: 'new',
      draftName: 'New note',
      draftBodyText: '',
      saveDraftStage,
    });

    const bodyInput = screen.getByRole('textbox', { name: 'Draft text' }) as HTMLTextAreaElement;
    const scrollIntoView = vi.fn();
    bodyInput.scrollIntoView = scrollIntoView;
    const saveButton = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;

    expect(saveButton).toBeEnabled();
    act(() => saveButton.click());

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
    expect(bodyInput).toHaveFocus();
    expect(bodyInput.closest('label')).toHaveClass('workspace-page-draft-field-attention');
    expect(saveDraftStage).not.toHaveBeenCalled();
    unmount();
    vi.restoreAllMocks();
  });

  it('renders the time selection panel with the schedule header, navigation and timezone', () => {
    const { unmount } = renderStage({ mode: 'schedule', time: '09:30' });

    const title = document.querySelector('.workspace-page-schedule-header strong') as HTMLElement;
    const timezone = document.querySelector('.workspace-page-schedule-timezone') as HTMLElement;
    const hoursInput = document.querySelector<HTMLInputElement>('[aria-label="Hours"]');
    const minutesInput = document.querySelector<HTMLInputElement>('[aria-label="Minutes"]');
    const headerTime = document.querySelector('.workspace-page-schedule-header-time') as HTMLElement;
    const quickTime = document.querySelector('.workspace-page-schedule-quick-panel') as HTMLElement;
    const backButton = Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.includes('Back')) as HTMLButtonElement;
    const doneButton = Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.includes('Done')) as HTMLButtonElement;

    expect(title).toBeTruthy();
    expect(title.textContent).toBe('Schedule');
    expect(timezone).toBeTruthy();
    expect(hoursInput?.value).toBe('09');
    expect(minutesInput?.value).toBe('30');
    expect(headerTime).toBeTruthy();
    expect(headerTime.textContent).toContain('09:30');
    expect(document.querySelector('.workspace-page-schedule-summary')).toBeNull();
    expect(quickTime).toBeTruthy();
    expect(document.querySelector('.workspace-page-schedule-more')).toBeNull();
    expect(backButton).toBeTruthy();
    expect(doneButton).toBeTruthy();
    unmount();
  });

  it('renders the minimal schedule shell with title and footer actions', () => {
    const { unmount } = renderStage({ mode: 'schedule' });

    const title = document.querySelector('.workspace-page-schedule-header strong') as HTMLElement;
    const backButton = Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.includes('Back')) as HTMLButtonElement;
    const doneButton = Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.includes('Done')) as HTMLButtonElement;

    expect(title).toBeTruthy();
    expect(title.textContent).toBe('Schedule');
    expect(backButton).toBeTruthy();
    expect(doneButton).toBeTruthy();
    expect(document.querySelector('.workspace-page-schedule-flow')).toBeNull();
    expect(document.querySelector('.workspace-page-time-trigger')).toBeNull();
    expect(document.querySelector('.workspace-page-repeat-entry')).toBeNull();
    unmount();
  });

  it('renders a compact Studio date selector with day, month, year and an inline time panel', () => {
    const { unmount } = renderStage({ mode: 'schedule', date: '2026-01-10', time: '09:00' });

    expect(document.querySelector('.workspace-page-schedule-date-value')).toBeTruthy();
    expect(document.querySelector<HTMLInputElement>('[aria-label="Hours"]')?.value).toBe('09');
    expect(document.querySelector<HTMLInputElement>('[aria-label="Minutes"]')?.value).toBe('00');
    expect(document.querySelector('.workspace-page-schedule-header-time')).toBeTruthy();
    expect(document.querySelector('.workspace-page-schedule-summary')).toBeNull();
    expect(document.querySelector('.workspace-page-schedule-quick-panel')).toBeTruthy();
    expect(document.querySelector('.workspace-page-schedule-more')).toBeNull();
    expect(document.querySelector('.workspace-page-schedule-empty-panel')).toBeTruthy();
    expect(document.querySelectorAll('.workspace-page-schedule-segment')).toHaveLength(5);
    expect(document.querySelector('[aria-label="Day"]')).toBeTruthy();
    expect(document.querySelector('[aria-label="Month"]')).toBeTruthy();
    expect(document.querySelector('[aria-label="Year"]')).toBeTruthy();
    expect(document.querySelector('.workspace-page-schedule-timezone')).toBeTruthy();
    unmount();
  });

  it('allows entering both digits of the month before committing the date', () => {
    const setDate = vi.fn();
    const { unmount } = renderStage({ mode: 'schedule', date: '2027-01-05', setDate });
    const monthInput = document.querySelector('[aria-label="Month"]') as HTMLInputElement;
    const setNativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;

    act(() => {
      setNativeValue?.call(monthInput, '1');
      monthInput.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(setDate).not.toHaveBeenCalled();
    expect(monthInput.value).toBe('1');

    act(() => {
      setNativeValue?.call(monthInput, '10');
      monthInput.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(setDate).toHaveBeenCalledWith('2027-10-05');
    unmount();
  });

  it('opens the Studio calendar from the calendar icon in the schedule row', () => {
    const { unmount } = renderStage({ mode: 'schedule', date: '2026-01-10', time: '09:00' });

    const calendarButton = document.querySelector('button[aria-haspopup="dialog"]') as HTMLButtonElement;

    expect(calendarButton).toBeTruthy();
    expect(document.querySelector('.quick-planner-date-picker')).toBeNull();

    act(() => {
      calendarButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(document.querySelector('.quick-planner-date-picker')).toHaveClass('quick-planner-schedule-popover');
    unmount();
  });

  it('does not write a zero year while the year segment is being edited', () => {
    const setDate = vi.fn();
    const { unmount } = renderStage({ mode: 'schedule', setDate, date: '2026-01-10' });
    const yearInput = document.querySelector('[aria-label="Year"]') as HTMLInputElement;

    act(() => {
      const setNativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setNativeValue?.call(yearInput, '2');
      yearInput.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(setDate).not.toHaveBeenCalledWith(expect.stringContaining('0000'));
    unmount();
  });

  it('moves through date and time inputs when Space or Enter is pressed', () => {
    const { unmount } = renderStage({ mode: 'schedule', date: '2026-01-10', time: '09:00' });
    const dayInput = document.querySelector('[aria-label="Day"]') as HTMLInputElement;
    const monthInput = document.querySelector('[aria-label="Month"]') as HTMLInputElement;
    const yearInput = document.querySelector('[aria-label="Year"]') as HTMLInputElement;
    const hoursInput = document.querySelector('[aria-label="Hours"]') as HTMLInputElement;
    const minutesInput = document.querySelector('[aria-label="Minutes"]') as HTMLInputElement;

    const fields = [dayInput, monthInput, yearInput, hoursInput, minutesInput];
    for (const key of [' ', 'Enter']) {
      for (let index = 0; index < fields.length - 1; index += 1) {
        const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
        act(() => {
          fields[index].focus();
          fields[index].dispatchEvent(event);
        });
        expect(document.activeElement).toBe(fields[index + 1]);
        expect(event.defaultPrevented).toBe(true);
      }
    }

    expect(dayInput.value).toBe('10');
    expect(monthInput.value).toBe('01');
    expect(yearInput.value).toBe('2026');
    unmount();
  });

  it('shows the local timezone offset once', () => {
    const { unmount } = renderStage({ mode: 'schedule' });
    const timezone = document.querySelector('.workspace-page-schedule-timezone')?.textContent ?? '';

    expect(timezone).toMatch(/UTC[+-]\d{2}:\d{2}$/);
    expect(timezone).not.toMatch(/GMT[+-]\d.*GMT[+-]\d/);
    unmount();
  });

  it('keeps the standard Back and Done footer for schedule', () => {
    const { unmount } = renderStage({ mode: 'schedule', date: '2026-01-10', time: '09:00' });

    expect(document.querySelector('.workspace-page-schedule-header .workspace-page-schedule-nav')).toBeNull();
    expect(document.querySelector('.workspace-page-schedule-footer .workspace-page-stage-secondary')).toBeTruthy();
    expect(document.querySelector('.workspace-page-schedule-footer .workspace-page-stage-primary')).toBeTruthy();
    expect(document.querySelector('.workspace-page-schedule-footer')).toBeTruthy();
    unmount();
  });

  it('keeps template navigation visible below the template list', () => {
    const { unmount } = renderStage({ mode: 'template' });

    expect(document.querySelector('.workspace-page-template-stage-footer .workspace-page-stage-secondary')).toBeTruthy();
    expect(document.querySelector('.workspace-page-template-stage-footer .workspace-page-stage-primary')).toBeTruthy();
    unmount();
  });

  it('removes the legacy date and time trigger controls completely from the schedule shell', () => {
    const { unmount } = renderStage({ mode: 'schedule', date: '2026-01-10', time: '09:00' });

    const dateButton = document.querySelector('[data-date-trigger="true"]') as HTMLButtonElement | null;
    const timeButton = document.querySelector('[data-time-trigger="true"]') as HTMLButtonElement | null;
    const dayInput = document.querySelector('[aria-label="Day"]') as HTMLInputElement | null;
    const hourInput = document.querySelector('[aria-label="Hours"]') as HTMLInputElement | null;
    const minuteInput = document.querySelector('[aria-label="Minutes"]') as HTMLInputElement | null;

    expect(dateButton).toBeNull();
    expect(timeButton).toBeNull();
    expect(dayInput).toBeTruthy();
    expect(hourInput?.value).toBe('09');
    expect(minuteInput?.value).toBe('00');
    expect(document.querySelector('.workspace-page-schedule-empty-panel')).toBeTruthy();

    unmount();
  });

  it('renders the repeat menu as a separate non-collapsible schedule mode', () => {
    const setRepeatMode = vi.fn();
    const setRepeatOccurrences = vi.fn();
    const { unmount } = renderStage({
      mode: 'schedule',
      scheduleFocus: 'repeat',
      repeatMode: 'weekly',
      repeatDays: ['Thu'],
      repeatOccurrences: 5,
      setRepeatMode,
      setRepeatOccurrences,
    });

    expect(document.querySelector('.workspace-page-schedule-repeat-panel')).toBeTruthy();
    expect(document.querySelector('.workspace-page-schedule-main .workspace-page-schedule-repeat-panel')).toBeTruthy();
    expect(document.querySelector('.workspace-page-schedule-footer .workspace-page-stage-primary')).toBeTruthy();
    expect(document.querySelector('.workspace-page-schedule-header-time')?.textContent).toContain('Weekly');
    expect(document.querySelector('.workspace-page-schedule-header-time')?.textContent).toContain('5 times');
    expect(document.querySelector('.workspace-page-schedule-more')).toBeNull();
    expect(document.querySelectorAll('.workspace-page-schedule-repeat-menu button')).toHaveLength(5);
    expect(document.querySelectorAll('.workspace-page-weekday-list button')).toHaveLength(7);
    expect(document.querySelector('[aria-label="Repeat occurrences"]')).toBeTruthy();

    const dailyButton = Array.from(document.querySelectorAll('.workspace-page-schedule-repeat-menu button'))
      .find((button) => button.textContent === 'Daily') as HTMLButtonElement;
    act(() => {
      dailyButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(setRepeatMode).toHaveBeenCalledWith('daily');

    const occurrences = document.querySelector('[aria-label="Repeat occurrences"]') as HTMLSelectElement;
    act(() => {
      occurrences.value = '10';
      occurrences.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(setRepeatOccurrences).toHaveBeenCalledWith(10);
    unmount();
  });

  it('places quick time controls after the time block and accumulates increments from the selected time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 3, 23, 59, 30));
    const setDate = vi.fn();
    const setTime = vi.fn();
    const { rerender, unmount } = renderStage({
      mode: 'schedule',
      scheduleFocus: 'time',
      date: '2026-10-03',
      time: '09:00',
      setDate,
      setTime,
    });

    try {
      const quickDatePanel = document.querySelector('.workspace-page-schedule-quick-date-panel') as HTMLElement;
      const quickTimePanel = document.querySelector('.workspace-page-schedule-quick-time-panel') as HTMLElement;
      const timeRow = document.querySelector('.workspace-page-schedule-inline-row') as HTMLElement;
      expect(timeRow.nextElementSibling).toBe(quickTimePanel);
      expect(quickTimePanel.nextElementSibling).toBe(quickDatePanel);
      expect(document.querySelector('.workspace-page-schedule-summary')).toBeNull();

      act(() => (document.querySelector('[aria-label="Set time: Now"]') as HTMLButtonElement).click());
      expect(setDate).toHaveBeenCalledWith('2026-10-04');
      expect(setTime).toHaveBeenCalledWith('00:00');

      rerender({ mode: 'schedule', scheduleFocus: 'time', date: '2026-10-03', time: '23:50', setDate, setTime });
      act(() => (document.querySelector('[aria-label="Set time: In 15 min"]') as HTMLButtonElement).click());
      expect(setDate).toHaveBeenLastCalledWith('2026-10-04');
      expect(setTime).toHaveBeenLastCalledWith('00:05');

      rerender({ mode: 'schedule', scheduleFocus: 'time', date: '2026-10-04', time: '00:05', setDate, setTime });
      act(() => (document.querySelector('[aria-label="Set time: In 15 min"]') as HTMLButtonElement).click());
      expect(setDate).toHaveBeenLastCalledWith('2026-10-04');
      expect(setTime).toHaveBeenLastCalledWith('00:20');
    } finally {
      unmount();
      vi.useRealTimers();
    }
  });

  it('restores automatic time updates when the Now preset is selected', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 3, 23, 59, 30));
    const setDate = vi.fn();
    const setTime = vi.fn();
    const setFollowCurrentTime = vi.fn();
    const { unmount } = renderStage({
      mode: 'schedule',
      scheduleFocus: 'time',
      date: '2026-10-03',
      time: '09:00',
      followCurrentTime: false,
      setDate,
      setTime,
      setFollowCurrentTime,
    });

    try {
      act(() => (document.querySelector('[aria-label="Set time: Now"]') as HTMLButtonElement).click());
      expect(setFollowCurrentTime).toHaveBeenCalledWith(true);
      expect(setDate).toHaveBeenCalledWith('2026-10-04');
      expect(setTime).toHaveBeenCalledWith('00:00');
    } finally {
      unmount();
      vi.useRealTimers();
    }
  });

  it('stops automatic time updates when the user selects a quick date', () => {
    const setFollowCurrentTime = vi.fn();
    const { unmount } = renderStage({
      mode: 'schedule',
      scheduleFocus: 'time',
      followCurrentTime: true,
      setFollowCurrentTime,
    });

    try {
      act(() => (document.querySelector('[aria-label="Set date: Today"]') as HTMLButtonElement).click());
      expect(setFollowCurrentTime).toHaveBeenCalledWith(false);
    } finally {
      unmount();
    }
  });

  it('disables time picker options that are already in the past', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 3, 15, 30, 30));
    const { unmount } = renderStage({
      mode: 'schedule',
      scheduleFocus: 'time',
      date: '2026-10-03',
      time: '16:00',
    });

    try {
      act(() => (document.querySelector('[aria-label="Open time picker"]') as HTMLButtonElement).click());
      const options = [...document.querySelectorAll('[role="option"]')] as HTMLButtonElement[];
      const pastOption = options.find((option) => option.textContent === '15:15');
      const futureOption = options.find((option) => option.textContent === '15:45');
      expect(pastOption?.disabled).toBe(true);
      expect(futureOption?.disabled).toBe(false);
    } finally {
      unmount();
      vi.useRealTimers();
    }
  });

  it('sets quick dates relative to the selected date and clamps month-end dates', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 3, 12, 0));
    const setDate = vi.fn();
    const setTime = vi.fn();
    const { rerender, unmount } = renderStage({
      mode: 'schedule',
      scheduleFocus: 'time',
      date: '2026-01-31',
      time: '09:00',
      setDate,
      setTime,
    });

    try {
      const dateRow = document.querySelector('.workspace-page-schedule-quick-date-panel .workspace-page-schedule-quick-row') as HTMLElement;
      expect(dateRow.querySelectorAll('button')).toHaveLength(4);

      act(() => (document.querySelector('[aria-label="Set date: In 1 month"]') as HTMLButtonElement).click());
      expect(setDate).toHaveBeenLastCalledWith('2026-02-28');
      expect(setTime).not.toHaveBeenCalled();

      rerender({ mode: 'schedule', scheduleFocus: 'time', date: '2026-02-28', time: '09:00', setDate, setTime });
      act(() => (document.querySelector('[aria-label="Set date: In 1 week"]') as HTMLButtonElement).click());
      expect(setDate).toHaveBeenLastCalledWith('2026-03-07');

      rerender({ mode: 'schedule', scheduleFocus: 'time', date: '2026-03-07', time: '09:00', setDate, setTime });
      act(() => (document.querySelector('[aria-label="Set date: Today"]') as HTMLButtonElement).click());
      expect(setDate).toHaveBeenLastCalledWith('2026-10-03');
    } finally {
      unmount();
      vi.useRealTimers();
    }
  });

  it('renders the time picker outside the schedule field and aligns it to the clock button', () => {
    const setTime = vi.fn();
    const { unmount } = renderStage({ mode: 'schedule', scheduleFocus: 'time', date: '2099-01-10', time: '09:00', setTime });
    const timeField = document.querySelector('.workspace-page-schedule-inline-time') as HTMLElement;
    const clockButton = document.querySelector('[aria-label="Open time picker"]') as HTMLButtonElement;
    vi.spyOn(timeField, 'getBoundingClientRect').mockReturnValue({
      top: 100,
      bottom: 138,
      left: 120,
      right: 340,
      width: 220,
      height: 38,
      x: 120,
      y: 100,
      toJSON: () => ({}),
    });

    expect(timeField).toBeTruthy();
    expect(timeField.querySelector('[aria-label="Hours"]')).toBeTruthy();
    expect(document.querySelector('[role="listbox"][aria-label="Available times"]')).toBeNull();

    act(() => {
      clockButton.click();
    });

    const timePicker = document.querySelector('[role="listbox"][aria-label="Available times"]') as HTMLElement;
    expect(timePicker).toBeTruthy();
    expect(timePicker.parentElement).toBe(document.body);
    expect(timePicker.style.top).toBe('144px');
    expect(timePicker.style.left).toBe('120px');
    expect(timePicker.style.height).toBe('220px');
    expect(clockButton.getAttribute('aria-expanded')).toBe('true');
    expect(timePicker.querySelectorAll('[role="option"]')).toHaveLength(96);
    expect(timePicker.querySelector('[aria-selected="true"]')?.textContent).toBe('09:00');

    const option = timePicker.querySelector('[role="option"][aria-selected="false"]') as HTMLButtonElement;
    act(() => option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    expect(document.querySelector('[role="listbox"][aria-label="Available times"]')).not.toBeNull();
    act(() => option.click());
    expect(setTime).toHaveBeenCalled();
    expect(timeField.querySelector('[role="listbox"]')).toBeNull();

    act(() => {
      clockButton.click();
      clockButton.click();
    });
    expect(timeField.querySelector('[role="listbox"]')).toBeNull();
    expect(clockButton.getAttribute('aria-expanded')).toBe('false');
    unmount();
  });

  it('keeps the time picker below its field in a short viewport and closes it on Escape', () => {
    const previousHeight = Object.getOwnPropertyDescriptor(window, 'innerHeight');
    const previousWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth');
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 220 });
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 });
    const { unmount } = renderStage({ mode: 'schedule', scheduleFocus: 'time' });
    const clockButton = document.querySelector('[aria-label="Open time picker"]') as HTMLButtonElement;
    const timeField = document.querySelector('.workspace-page-schedule-inline-time') as HTMLElement;
    vi.spyOn(timeField, 'getBoundingClientRect').mockReturnValue({
      top: 62,
      bottom: 100,
      left: 280,
      right: 318,
      width: 38,
      height: 38,
      x: 280,
      y: 62,
      toJSON: () => ({}),
    });

    try {
      act(() => clockButton.click());
      const timePicker = document.querySelector('[role="listbox"][aria-label="Available times"]') as HTMLElement;
      expect(timePicker.style.top).toBe('106px');
      expect(timePicker.style.left).toBe('132px');
      expect(timePicker.style.height).toBe('106px');

      act(() => timePicker.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
      expect(document.querySelector('[role="listbox"][aria-label="Available times"]')).toBeNull();
      expect(clockButton.getAttribute('aria-expanded')).toBe('false');

      act(() => clockButton.click());
      act(() => document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
      expect(document.querySelector('[role="listbox"][aria-label="Available times"]')).toBeNull();
    } finally {
      unmount();
      if (previousHeight) Object.defineProperty(window, 'innerHeight', previousHeight);
      else Reflect.deleteProperty(window, 'innerHeight');
      if (previousWidth) Object.defineProperty(window, 'innerWidth', previousWidth);
      else Reflect.deleteProperty(window, 'innerWidth');
    }
  });

  it('keeps template and chat stages navigable with stable list and footer regions', () => {
    const onModeChange = vi.fn();
    const { unmount: unmountTemplate } = renderStage({ mode: 'template', onModeChange });

    const templateStage = document.querySelector('.workspace-page-rich-text-template-stage.is-active') as HTMLElement;
    expect(templateStage).toBeTruthy();
    expect(templateStage.querySelector('.workspace-page-template-stage-list')).toBeTruthy();
    expect(templateStage.querySelectorAll('.workspace-page-template-stage-footer button')).toHaveLength(2);
    expect(templateStage.querySelector('.workspace-page-template-stage-item button')).toBeTruthy();

    act(() => {
      (templateStage.querySelector('.workspace-page-stage-secondary') as HTMLButtonElement).click();
    });
    expect(onModeChange).toHaveBeenCalledWith('editor');
    unmountTemplate();

    const onChatSelectionBack = vi.fn();
    const { unmount: unmountChat } = renderStage({ mode: 'chat', onChatSelectionBack, selectedChats: [] });
    const chatStage = document.querySelector('.workspace-page-rich-text-chat-stage.is-active') as HTMLElement;

    expect(chatStage).toBeTruthy();
    expect(chatStage.querySelector('[role="listbox"]')).toBeTruthy();
    expect(chatStage.querySelectorAll('[role="option"]')).toHaveLength(2);
    expect(chatStage.querySelector('.workspace-page-chat-stage-footer')).toBeTruthy();
    expect(chatStage.querySelectorAll('.workspace-page-chat-stage-footer button').length).toBeGreaterThanOrEqual(4);

    act(() => {
      (chatStage.querySelector('.workspace-page-stage-secondary') as HTMLButtonElement).click();
    });
    expect(onChatSelectionBack).toHaveBeenCalledTimes(1);
    unmountChat();
  });

  it('does not render static demo chats in the real chat picker', () => {
    const onChatSelectionChange = vi.fn();
    const onChatSelectionDone = vi.fn();
    const { rootElement, unmount } = renderStage({
      mode: 'chat',
      selectedChats: [],
      onChatSelectionChange,
      onChatSelectionDone,
    });

    expect(rootElement.querySelector('.workspace-page-chat-stage-demo')).toBeNull();
    expect(rootElement.querySelectorAll('.workspace-page-chat-stage-list [role="option"]')).toHaveLength(2);

    act(() => {
      const firstOption = rootElement.querySelector('.workspace-page-chat-stage-list [role="option"]');
      firstOption?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onChatSelectionChange).toHaveBeenCalledWith([chatA]);
    expect(onChatSelectionDone).toHaveBeenCalledWith(chatA);
    unmount();
  });

  it('selects and confirms a chat from the chat picker with one click', () => {
    const onChatSelectionChange = vi.fn();
    const onChatSelectionDone = vi.fn();

    const { unmount } = renderStage({
      mode: 'chat',
      selectedChats: [],
      onChatSelectionChange,
      onChatSelectionDone,
    });

    const chatOption = Array.from(document.querySelectorAll('[role="option"]')).find((node) =>
      node.textContent?.includes('Alpha Team')
    );

    expect(chatOption).toBeTruthy();

    act(() => {
      chatOption!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onChatSelectionChange).toHaveBeenCalledWith([chatA]);
    expect(onChatSelectionDone).toHaveBeenCalledWith(chatA);
    unmount();
  });

  it('confirms an already selected chat when its option is activated', () => {
    const onChatSelectionChange = vi.fn();
    const onChatSelectionDone = vi.fn();
    const { unmount } = renderStage({
      mode: 'chat',
      selectedChats: [chatA],
      onChatSelectionChange,
      onChatSelectionDone,
    });
    const chatOption = Array.from(document.querySelectorAll('[role="option"]')).find((node) =>
      node.textContent?.includes('Alpha Team')
    );

    act(() => {
      chatOption!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onChatSelectionChange).not.toHaveBeenCalled();
    expect(onChatSelectionDone).toHaveBeenCalledWith(chatA);
    unmount();
  });

  it('keeps the Done button as a fallback for the selected chat', () => {
    const onChatSelectionDone = vi.fn();
    const { unmount } = renderStage({ mode: 'chat', selectedChats: [chatA], onChatSelectionDone });
    const doneButton = document.querySelector('.workspace-page-chat-stage-footer .workspace-page-stage-primary') as HTMLButtonElement;

    act(() => doneButton.click());

    expect(onChatSelectionDone).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('shows a Telegram-blue initial when a contact photo fails to load', () => {
    const chatWithBrokenPhoto = { ...chatA, avatarDataUrl: 'broken-avatar-url' };
    const { unmount } = renderStage({ mode: 'chat', chats: [chatWithBrokenPhoto], selectedChats: [] });
    const avatar = document.querySelector('.workspace-page-chat-stage-avatar') as HTMLElement;
    const image = avatar.querySelector('img') as HTMLImageElement;

    expect(image).toBeTruthy();
    act(() => image.dispatchEvent(new Event('error')));

    expect(avatar.querySelector('img')).toBeNull();
    expect(avatar.textContent).toBe('A');
    expect(avatar.classList.contains('is-broken')).toBe(true);
    unmount();
  });

  it('marks chats as favorites and filters the chat list', () => {
    const { unmount } = renderStage({ mode: 'chat', chats: [chatB, chatA], selectedChats: [] });
    const favoriteButton = document.querySelector('[aria-label="Add Alpha Team to favorites"]') as HTMLButtonElement;
    const favoritesFilter = Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.includes('Favorites')) as HTMLButtonElement;

    expect(favoriteButton).toBeTruthy();
    expect(favoritesFilter).toBeTruthy();

    act(() => {
      favoriteButton.click();
    });

    expect(favoriteButton.getAttribute('aria-pressed')).toBe('true');
    expect(window.localStorage.getItem('awaitmsg_favorite_chats')).toBe('["chat-1"]');
    expect(Array.from(document.querySelectorAll('.workspace-page-chat-stage-copy strong')).map((chat) => chat.textContent)).toEqual(['Alpha Team', 'Beta Channel']);

    act(() => {
      favoritesFilter.click();
    });

    expect(document.querySelector('[aria-label="Remove Alpha Team from favorites"]')).toBeTruthy();
    expect(document.body.textContent).not.toContain('Beta Channel');
    unmount();
  });

  it('opens link entry inside the toolbar and confirms the selected text as a link', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const onChange = vi.fn();

    act(() => {
      root.render(<RichTextEditor text="Read more" entities={[]} onChange={onChange} maxLength={4096} />);
    });

    const editor = container.querySelector('[contenteditable="true"]') as HTMLDivElement;
    act(() => editor.focus());
    const range = document.createRange();
    range.selectNodeContents(editor);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    act(() => editor.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })));

    const linkButton = container.querySelector('[aria-label="Insert link"]') as HTMLButtonElement;
    expect(linkButton.querySelector('.workspace-page-rich-text-link-trigger__icon svg')).not.toBeNull();
    act(() => linkButton.click());

    const popover = container.querySelector('[role="dialog"][aria-label="Insert link"]') as HTMLFormElement;
    expect(popover.parentElement?.classList.contains('workspace-page-rich-text-link-controls')).toBe(true);
    expect(popover.parentElement?.classList.contains('is-open')).toBe(true);
    expect(popover.closest('[role="toolbar"]')).not.toBeNull();
    expect(popover.parentElement?.nextElementSibling).toHaveClass('workspace-page-rich-text-toolbar-divider');
    expect(popover.querySelectorAll('button')).toHaveLength(2);
    expect(popover.querySelector('.workspace-page-rich-text-link-popover__cancel')?.textContent).toBe('Cancel');
    expect((popover.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(true);
    expect(linkButton).toHaveAttribute('aria-expanded', 'true');
    act(() => linkButton.click());
    expect(container.querySelector('[role="dialog"][aria-label="Insert link"]')).toBeNull();
    expect(linkButton).toHaveAttribute('aria-expanded', 'false');
    act(() => linkButton.click());

    const reopenedPopover = container.querySelector('[role="dialog"][aria-label="Insert link"]') as HTMLFormElement;
    const input = reopenedPopover.querySelector('input') as HTMLInputElement;
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    act(() => {
      valueSetter?.call(input, 'https://example.com');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const confirmButton = reopenedPopover.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(confirmButton.disabled).toBe(false);
    act(() => confirmButton.click());

    expect(onChange).toHaveBeenLastCalledWith('Read more', [
      { type: 'text_url', offset: 0, length: 9, url: 'https://example.com' },
    ]);
    expect(container.querySelector('[role="dialog"][aria-label="Insert link"]')).toBeNull();

    act(() => editor.focus());
    act(() => root.unmount());
    container.remove();
  });

  it('closes link entry with Escape without changing the message', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const onChange = vi.fn();

    act(() => {
      root.render(<RichTextEditor text="Keep this text" entities={[]} onChange={onChange} maxLength={4096} />);
    });

    act(() => (container.querySelector('[aria-label="Insert link"]') as HTMLButtonElement).click());
    const input = container.querySelector('[role="dialog"] input[type="url"]') as HTMLInputElement;
    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));

    expect(container.querySelector('[role="dialog"][aria-label="Insert link"]')).toBeNull();
    expect((container.querySelector('[contenteditable="true"]') as HTMLDivElement).textContent).toBe('Keep this text');
    expect(onChange).not.toHaveBeenCalled();

    act(() => root.unmount());
    container.remove();
  });

  it('closes link entry when another button is pressed and lets that button work', () => {
    const container = document.createElement('div');
    const otherButton = document.createElement('button');
    const otherButtonAction = vi.fn();
    otherButton.addEventListener('click', otherButtonAction);
    document.body.append(container, otherButton);
    const root = createRoot(container);

    act(() => {
      root.render(<RichTextEditor text="Keep this text" entities={[]} onChange={vi.fn()} maxLength={4096} />);
    });
    act(() => (container.querySelector('[aria-label="Insert link"]') as HTMLButtonElement).click());
    expect(container.querySelector('[role="dialog"][aria-label="Insert link"]')).toBeTruthy();

    act(() => {
      otherButton.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      otherButton.click();
    });

    expect(container.querySelector('[role="dialog"][aria-label="Insert link"]')).toBeNull();
    expect(otherButtonAction).toHaveBeenCalledOnce();

    act(() => root.unmount());
    container.remove();
    otherButton.remove();
  });

  it('closes link entry with Cancel without changing the message', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const onChange = vi.fn();

    act(() => {
      root.render(<RichTextEditor text="Keep this text" entities={[]} onChange={onChange} maxLength={4096} />);
    });
    act(() => (container.querySelector('[aria-label="Insert link"]') as HTMLButtonElement).click());
    act(() => (container.querySelector('.workspace-page-rich-text-link-popover__cancel') as HTMLButtonElement).click());

    expect(container.querySelector('[role="dialog"][aria-label="Insert link"]')).toBeNull();
    expect((container.querySelector('[contenteditable="true"]') as HTMLDivElement).textContent).toBe('Keep this text');
    expect(onChange).not.toHaveBeenCalled();

    act(() => root.unmount());
    container.remove();
  });

  it('opens the format toolbar with the selected format state remembered', () => {
    const { container, editor, unmount } = renderRichTextEditor({
      text: 'Bold text',
      entities: [{ type: 'bold', offset: 0, length: 4 }],
    });
    const boldText = editor.querySelector('strong')!;
    const range = document.createRange();
    range.selectNodeContents(boldText);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    act(() => editor.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })));
    const toolbar = container.querySelector('[role="toolbar"]')!;
    expect(toolbar.classList.contains('is-airy')).toBe(true);
    expect(toolbar.querySelector('[aria-label="Bold"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(toolbar.querySelector('[aria-label="Italic"]')?.getAttribute('aria-pressed')).toBe('false');

    const previousExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    act(() => (toolbar.querySelector('[aria-label="Bold"]') as HTMLButtonElement).click());
    expect(execCommand).toHaveBeenCalledWith('bold', false);
    if (previousExecCommand) Object.defineProperty(document, 'execCommand', previousExecCommand);
    else Reflect.deleteProperty(document, 'execCommand');

    unmount();
  });

  it('inserts an emoji at the saved editor selection', () => {
    window.localStorage.setItem('awaitmsg_locale', 'ru');
    const { container, editor, onChange, unmount } = renderRichTextEditor({ text: 'Write here' });
    const textNode = editor.firstChild as Text;
    const range = document.createRange();
    range.setStart(textNode, 5);
    range.collapse(true);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    act(() => editor.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })));

    expect(Array.from(container.querySelectorAll('.workspace-page-rich-text-toolbar button'), (button) => button.getAttribute('aria-label')))
      .toContain('Выбрать смайлик');
    const emojiButton = container.querySelector<HTMLButtonElement>('[aria-label="Выбрать смайлик"]')!;
    fireEvent.click(emojiButton);
    expect(document.querySelector('[role="dialog"][aria-label="Выбрать эмодзи"]')).not.toBeNull();
    const emojiPicker = document.querySelector('.workspace-page-rich-text-emoji-picker--floating');
    expect(emojiPicker).not.toBeNull();
    expect(emojiPicker?.parentElement).toBe(document.body);
    expect(document.querySelector('[role="tablist"][aria-label="Категории эмодзи"]')).not.toBeNull();
    const emojiSearch = document.querySelector<HTMLInputElement>('.quick-planner-emoji-search')!;
    fireEvent.change(emojiSearch, { target: { value: 'сердце' } });
    expect(document.querySelector('[role="tablist"][aria-label="Категории эмодзи"]')).not.toBeNull();
    fireEvent.click(document.querySelector('[aria-label="Вставить ❤️"]') as HTMLButtonElement);

    expect(editor.textContent).toBe('Write❤️ here');
    expect(onChange).toHaveBeenLastCalledWith('Write❤️ here', []);
    unmount();
  });

  it('uses Telegram-provided effect IDs from the Studio toolbar', async () => {
    const previousTelegram = Object.getOwnPropertyDescriptor(window, 'telegram');
    const getAvailableEffects = vi.fn().mockResolvedValue({
      success: true,
      effects: [
        { id: '123456789', emoticon: '🎉', premiumRequired: false },
        { id: '987654321', emoticon: '✨', premiumRequired: true },
      ],
    });
    Object.defineProperty(window, 'telegram', { configurable: true, value: { getAvailableEffects } });
    const onEffectChange = vi.fn();
    const { container, unmount } = renderRichTextEditor({ onEffectChange });

    await act(async () => { await Promise.resolve(); });
    expect(getAvailableEffects).toHaveBeenCalledOnce();
    expect(container.querySelectorAll('.workspace-page-rich-text-effect-option')).toHaveLength(0);

    fireEvent.click(container.querySelector('[aria-label="Message effects"]') as HTMLButtonElement);
    expect(container.querySelector('.workspace-page-rich-text-effects-picker')).not.toBeNull();
    expect(container.querySelectorAll('.workspace-page-rich-text-effect-option')).toHaveLength(2);
    expect(container.querySelector('[aria-label="Premium effect ✨"]')).toBeNull();
    fireEvent.click(container.querySelector('.workspace-page-rich-text-effect-option[aria-pressed="false"]') as HTMLButtonElement);

    expect(onEffectChange).toHaveBeenCalledWith('123456789');
    unmount();
    if (previousTelegram) Object.defineProperty(window, 'telegram', previousTelegram);
    else Reflect.deleteProperty(window, 'telegram');
  });

  it('does not mark partial formats active when a selection spans more than two styles', () => {
    const { container, editor, unmount } = renderRichTextEditor({
      text: 'styled plain',
    });
    act(() => {
      editor.innerHTML = '<strong><em><u>styled</u></em></strong> plain';
    });
    const range = document.createRange();
    range.selectNodeContents(editor);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    act(() => editor.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })));

    const toolbar = container.querySelector('[role="toolbar"]')!;
    expect(toolbar.querySelector('[aria-label="Bold"]')).toHaveAttribute('aria-pressed', 'false');
    expect(toolbar.querySelector('[aria-label="Italic"]')).toHaveAttribute('aria-pressed', 'false');
    expect(toolbar.querySelector('[aria-label="Underline"]')).toHaveAttribute('aria-pressed', 'false');
    unmount();
  });

  it('keeps more than two active formats independent when switching them off sequentially', () => {
    const { container, editor, unmount } = renderRichTextEditor({
      text: 'styled plain',
      entities: [
        { type: 'bold', offset: 0, length: 6 },
        { type: 'italic', offset: 0, length: 6 },
        { type: 'underline', offset: 0, length: 6 },
      ],
    });
    const textWalker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    const styledText = textWalker.nextNode() as Text;
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.setStart(styledText, 0);
    range.setEnd(styledText, styledText.textContent?.length ?? 0);
    expect(editor.querySelector('strong, b')).not.toBeNull();
    expect(editor.querySelector('em, i')).not.toBeNull();
    expect(editor.querySelector('u')).not.toBeNull();
    selection.removeAllRanges();
    selection.addRange(range);
    act(() => editor.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })));

    const previousExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    const selectorByCommand: Record<string, string> = {
      bold: 'b,strong',
      italic: 'i,em',
      underline: 'u',
    };
    const execCommand = vi.fn((command: string) => {
      const wrapper = editor.querySelector(selectorByCommand[command]);
      if (!wrapper?.parentNode) return true;
      const parent = wrapper.parentNode;
      while (wrapper.firstChild) parent.insertBefore(wrapper.firstChild, wrapper);
      wrapper.remove();
      return true;
    });
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });

    try {
      const toolbar = container.querySelector('[role="toolbar"]')!;
      const bold = toolbar.querySelector<HTMLButtonElement>('[aria-label="Bold"]')!;
      const italic = toolbar.querySelector<HTMLButtonElement>('[aria-label="Italic"]')!;
      const underline = toolbar.querySelector<HTMLButtonElement>('[aria-label="Underline"]')!;
      expect(bold).toHaveAttribute('aria-pressed', 'true');
      expect(italic).toHaveAttribute('aria-pressed', 'true');
      expect(underline).toHaveAttribute('aria-pressed', 'true');

      act(() => bold.click());
      expect(bold).toHaveAttribute('aria-pressed', 'false');
      expect(italic).toHaveAttribute('aria-pressed', 'true');
      expect(underline).toHaveAttribute('aria-pressed', 'true');

      act(() => italic.click());
      expect(bold).toHaveAttribute('aria-pressed', 'false');
      expect(italic).toHaveAttribute('aria-pressed', 'false');
      expect(underline).toHaveAttribute('aria-pressed', 'true');
      expect(execCommand).toHaveBeenNthCalledWith(1, 'bold', false);
      expect(execCommand).toHaveBeenNthCalledWith(2, 'italic', false);
    } finally {
      if (previousExecCommand) Object.defineProperty(document, 'execCommand', previousExecCommand);
      else Reflect.deleteProperty(document, 'execCommand');
      unmount();
    }
  });

  it('toggles italic off and on when clicked repeatedly at a caret', () => {
    const { container, editor, unmount } = renderRichTextEditor({
      text: 'Italic text',
      entities: [{ type: 'italic', offset: 0, length: 6 }],
    });
    let italicEnabled = true;
    const previousQueryCommandState = Object.getOwnPropertyDescriptor(document, 'queryCommandState');
    const previousExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    const execCommand = vi.fn((command: string) => {
      if (command === 'italic') italicEnabled = !italicEnabled;
      return true;
    });
    Object.defineProperty(document, 'queryCommandState', {
      configurable: true,
      value: (command: string) => command === 'italic' ? italicEnabled : false,
    });
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });

    try {
      const italicText = editor.querySelector('em, i')?.firstChild;
      expect(italicText).not.toBeNull();
      const range = document.createRange();
      range.setStart(italicText!, 2);
      range.collapse(true);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      act(() => editor.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })));

      const italicButton = container.querySelector<HTMLButtonElement>('[aria-label="Italic"]')!;
      expect(italicButton.getAttribute('aria-pressed')).toBe('true');

      act(() => italicButton.click());
      expect(execCommand).toHaveBeenCalledWith('italic', false);
      expect(italicButton.getAttribute('aria-pressed')).toBe('false');

      act(() => italicButton.click());
      expect(execCommand).toHaveBeenCalledTimes(2);
      expect(italicButton.getAttribute('aria-pressed')).toBe('true');
    } finally {
      if (previousQueryCommandState) Object.defineProperty(document, 'queryCommandState', previousQueryCommandState);
      else Reflect.deleteProperty(document, 'queryCommandState');
      if (previousExecCommand) Object.defineProperty(document, 'execCommand', previousExecCommand);
      else Reflect.deleteProperty(document, 'execCommand');
      unmount();
    }
  });

  it('toggles italic off and on across multiple italic text runs', () => {
    const { container, editor, unmount } = renderRichTextEditor({
      text: 'one two three four',
      entities: [
        { type: 'italic', offset: 0, length: 3 },
        { type: 'italic', offset: 4, length: 3 },
        { type: 'italic', offset: 8, length: 5 },
        { type: 'italic', offset: 14, length: 4 },
      ],
    });
    let italicEnabled = true;
    const previousQueryCommandState = Object.getOwnPropertyDescriptor(document, 'queryCommandState');
    const previousExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    const execCommand = vi.fn((command: string) => {
      if (command === 'italic') italicEnabled = !italicEnabled;
      return true;
    });
    Object.defineProperty(document, 'queryCommandState', {
      configurable: true,
      value: (command: string) => command === 'italic' ? italicEnabled : false,
    });
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });

    try {
      const range = document.createRange();
      range.selectNodeContents(editor);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      act(() => editor.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })));

      const italicButton = container.querySelector<HTMLButtonElement>('[aria-label="Italic"]')!;
      expect(italicButton.getAttribute('aria-pressed')).toBe('true');

      act(() => italicButton.click());
      expect(execCommand).toHaveBeenCalledWith('italic', false);
      expect(italicButton.getAttribute('aria-pressed')).toBe('false');

      act(() => italicButton.click());
      expect(execCommand).toHaveBeenCalledTimes(2);
      expect(italicButton.getAttribute('aria-pressed')).toBe('true');
    } finally {
      if (previousQueryCommandState) Object.defineProperty(document, 'queryCommandState', previousQueryCommandState);
      else Reflect.deleteProperty(document, 'queryCommandState');
      if (previousExecCommand) Object.defineProperty(document, 'execCommand', previousExecCommand);
      else Reflect.deleteProperty(document, 'execCommand');
      unmount();
    }
  });

  it('applies every format option in turn while the toolbar stays visible', () => {
    const { container, editor, unmount } = renderRichTextEditor({
      text: 'Chain formats',
      entities: [],
    });
    act(() => editor.focus());
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(editor);
    selection.removeAllRanges();
    selection.addRange(range);

    act(() => editor.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })));

    const toolbar = container.querySelector<HTMLElement>('[role="toolbar"]')!;

    const previousExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });

    const pressOption = (label: string) => {
      const option = toolbar.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
      act(() => option.click());
      // Тулбар — воздушный ряд без попапа: каждая иконка переключается
      // следом за предыдущей без повторного открытия.
      expect(toolbar.isConnected).toBe(true);
    };

    pressOption('Bold');
    pressOption('Italic');
    pressOption('Underline');
    pressOption('Strikethrough');

    expect(execCommand).toHaveBeenNthCalledWith(1, 'bold', false);
    expect(execCommand).toHaveBeenNthCalledWith(2, 'italic', false);
    expect(execCommand).toHaveBeenNthCalledWith(3, 'underline', false);
    expect(execCommand).toHaveBeenNthCalledWith(4, 'strikeThrough', false);

    if (previousExecCommand) Object.defineProperty(document, 'execCommand', previousExecCommand);
    else Reflect.deleteProperty(document, 'execCommand');

    unmount();
  });

  it('keeps typing order and bold formatting after toggling the toolbar at an empty caret', () => {
    const { container, editor, onChange, unmount } = renderRichTextEditor();
    act(() => editor.focus());

    const selection = window.getSelection()!;
    const initialRange = document.createRange();
    initialRange.selectNodeContents(editor);
    initialRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(initialRange);
    act(() => editor.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })));

    const boldButton = container.querySelector<HTMLButtonElement>('[aria-label="Bold"]')!;
    act(() => boldButton.click());
    expect(boldButton.getAttribute('aria-pressed')).toBe('true');

    const marker = editor.querySelector('b')?.firstChild as Text;
    expect(marker.textContent).toBe('\u200B');
    act(() => {
      marker.insertData(marker.length, 'AB');
      const caretRange = document.createRange();
      caretRange.setStart(marker, marker.length);
      caretRange.collapse(true);
      selection.removeAllRanges();
      selection.addRange(caretRange);
      editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'B' }));
    });

    expect(editor.querySelector('b')?.textContent).toBe('AB');
    expect(onChange).toHaveBeenLastCalledWith('AB', [{ type: 'bold', offset: 0, length: 2 }]);
    expect(selection.getRangeAt(0).startOffset).toBe(2);

    unmount();
  });

  it('keeps the format icon states when the native selection is cleared', () => {
    const { container, editor, unmount } = renderRichTextEditor({
      text: 'Bold text',
      entities: [{ type: 'bold', offset: 0, length: 4 }],
    });
    act(() => editor.focus());
    const strongElement = editor.querySelector('strong')!;
    const range = document.createRange();
    range.selectNodeContents(strongElement);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    act(() => editor.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })));

    const toolbar = container.querySelector<HTMLElement>('[role="toolbar"]')!;
    expect(toolbar.querySelector('[aria-label="Bold"]')?.getAttribute('aria-pressed')).toBe('true');

    act(() => {
      selection.removeAllRanges();
      document.dispatchEvent(new Event('selectionchange'));
    });

    expect(toolbar.querySelector('[aria-label="Bold"]')?.getAttribute('aria-pressed')).toBe('true');

    unmount();
  });

  it('preserves logical text and caret position for a long unbroken string', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const onChange = vi.fn();

    act(() => {
      root.render(<RichTextEditor text="" entities={[]} onChange={onChange} maxLength={4096} />);
    });

    const editor = container.querySelector('[contenteditable="true"]') as HTMLDivElement;
    const longText = 'B'.repeat(1000);

    act(() => {
      editor.textContent = longText;
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(editor.textContent).toBe(longText);
    expect(editor.textContent?.length).toBe(1000);
    expect(editor.textContent?.includes('\n')).toBe(false);
    expect(editor.textContent?.includes('\u00AD')).toBe(false);
    expect(editor.textContent?.includes('\u200B')).toBe(false);
    expect(editor.textContent?.includes('\u2060')).toBe(false);

    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(editor.firstChild!, 250);
    range.setEnd(editor.firstChild!, 250);
    selection?.removeAllRanges();
    selection?.addRange(range);

    act(() => {
      editor.dispatchEvent(new Event('select', { bubbles: true }));
    });

    expect(selection?.anchorOffset).toBe(250);
    expect(selection?.focusOffset).toBe(250);
    expect(editor.contains(selection?.anchorNode ?? null)).toBe(true);

    act(() => root.unmount());
    container.remove();
  });

  it('normalizes non-breaking and zero-width characters from pasted content', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const onChange = vi.fn();

    act(() => {
      root.render(<RichTextEditor text="" entities={[]} onChange={onChange} maxLength={4096} />);
    });

    const editor = container.querySelector('[contenteditable="true"]') as HTMLDivElement;
    act(() => {
      editor.innerHTML = 'Hello&nbsp;&nbsp;world\u200B';
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(onChange).toHaveBeenLastCalledWith('Hello  world', []);

    act(() => {
      editor.textContent = 'Hello\u00A0\u200BWorld';
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(onChange).toHaveBeenLastCalledWith('Hello World', []);

    act(() => root.unmount());
    container.remove();
  });

  it('converts completed Markdown while typing and keeps the caret in place', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const onChange = vi.fn();

    act(() => {
      root.render(<RichTextEditor text="" entities={[]} onChange={onChange} maxLength={4096} />);
    });

    const editor = container.querySelector('[contenteditable="true"]') as HTMLDivElement;
    const source = 'Start **Жирный**';
    editor.textContent = source;
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(editor.firstChild!, source.length);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);

    act(() => editor.dispatchEvent(new Event('input', { bubbles: true })));

    expect(onChange).toHaveBeenLastCalledWith('Start Жирный', [{ type: 'bold', offset: 6, length: 6 }]);
    expect(editor.textContent).toBe('Start Жирный');
    expect(editor.querySelector('strong')?.textContent).toBe('Жирный');
    expect(selection?.isCollapsed).toBe(true);
    expect(editor.contains(selection?.anchorNode ?? null)).toBe(true);

    const caretRange = document.createRange();
    caretRange.selectNodeContents(editor);
    caretRange.setEnd(selection!.anchorNode!, selection!.anchorOffset);
    expect(caretRange.toString()).toBe('Start Жирный');

    act(() => root.unmount());
    container.remove();
  });

  it('converts pasted Markdown but preserves ordinary asterisks', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const onChange = vi.fn();

    act(() => {
      root.render(<RichTextEditor text="" entities={[]} onChange={onChange} maxLength={4096} />);
    });

    const editor = container.querySelector('[contenteditable="true"]') as HTMLDivElement;
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);

    const clipboardData = {
      items: [],
      getData: vi.fn((type: string) => type === 'text/plain' ? '**Жирный** и 2 * 2 = 4' : '<strong>ignored</strong>'),
    };
    const pasteEvent = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(pasteEvent, 'clipboardData', { value: clipboardData });

    act(() => editor.dispatchEvent(pasteEvent));

    expect(clipboardData.getData).toHaveBeenCalledWith('text/plain');
    expect(pasteEvent.defaultPrevented).toBe(true);
    expect(onChange).toHaveBeenLastCalledWith('Жирный и 2 * 2 = 4', [{ type: 'bold', offset: 0, length: 6 }]);
    expect(editor.textContent).toBe('Жирный и 2 * 2 = 4');
    expect(editor.querySelector('strong')?.textContent).toBe('Жирный');

    act(() => root.unmount());
    container.remove();
  });

  it('drops one image into the draft and prevents the browser from opening it', () => {
    const onAddFiles = vi.fn();
    const { container, editor, unmount } = renderRichTextEditor({ onAddFiles });
    editor.textContent = 'Draft text';
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(editor.firstChild!, 5);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);

    const image = new File(['image-bytes'], 'photo.png', { type: 'image/png' });
    const dataTransfer = { types: ['Files'], files: [image], dropEffect: 'none' };
    const dragOver = new Event('dragover', { bubbles: true, cancelable: true });
    Object.defineProperty(dragOver, 'dataTransfer', { value: dataTransfer });
    act(() => container.querySelector('.workspace-page-rich-text-editor')?.dispatchEvent(dragOver));
    expect(container.querySelector('.workspace-page-rich-text-editor')?.classList.contains('is-drag-over')).toBe(true);

    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: dataTransfer });
    act(() => container.querySelector('.workspace-page-rich-text-editor')?.dispatchEvent(drop));

    expect(drop.defaultPrevented).toBe(true);
    expect(onAddFiles).toHaveBeenCalledWith([image], 5);
    expect(container.querySelector('.workspace-page-rich-text-editor')?.classList.contains('is-drag-over')).toBe(false);
    unmount();
  });

  it('drops multiple files as one attachment batch', () => {
    const onAddFiles = vi.fn();
    const { container, unmount } = renderRichTextEditor({ onAddFiles });
    const image = new File(['image-bytes'], 'photo.png', { type: 'image/png' });
    const documentFile = new File(['report-bytes'], 'report.pdf', { type: 'application/pdf' });
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', {
      value: { types: ['Files'], files: [image, documentFile], dropEffect: 'none' },
    });

    act(() => container.querySelector('.workspace-page-rich-text-editor')?.dispatchEvent(drop));

    expect(drop.defaultPrevented).toBe(true);
    expect(onAddFiles).toHaveBeenCalledWith([image, documentFile], 0);
    unmount();
  });

  it('pastes clipboard images as attachments without inserting binary data into text', () => {
    const onAddFiles = vi.fn();
    const onChange = vi.fn();
    const { editor, unmount } = renderRichTextEditor({ onAddFiles, onChange });
    const image = new File(['clipboard-image'], 'clipboard.png', { type: 'image/png' });
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', {
      value: {
        items: [{ kind: 'file', type: 'image/png', getAsFile: () => image }],
        files: [image],
        getData: () => '',
      },
    });

    act(() => editor.dispatchEvent(paste));

    expect(paste.defaultPrevented).toBe(true);
    expect(onAddFiles).toHaveBeenCalledWith([image], 0);
    expect(editor.textContent).toBe('');
    expect(onChange).not.toHaveBeenCalled();
    unmount();
  });

  it('selects a rich-editor line on a triple click and all text on a fourth click', () => {
    const { editor, unmount } = renderRichTextEditor({ text: 'First line\nSecond line\nThird line' });
    editor.textContent = 'First line\nSecond line\nThird line';
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(editor.firstChild!, 14);
    range.setEnd(editor.firstChild!, 20);
    selection?.removeAllRanges();
    selection?.addRange(range);

    fireEvent.click(editor, { detail: 3 });

    expect(selection?.toString()).toBe('Second line');
    expect(selection?.rangeCount).toBe(1);

    fireEvent.click(editor, { detail: 4 });
    expect(selection?.toString()).toBe(editor.textContent);
    expect(editor).toHaveAttribute('data-selection-start', '0');
    expect(editor).toHaveAttribute('data-selection-end', String(editor.textContent?.length));
    unmount();
  });

  it('keeps ordinary plain-text paste working', () => {
    const onChange = vi.fn();
    const { editor, unmount } = renderRichTextEditor({ onChange });
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', {
      value: { items: [], files: [], getData: (type: string) => type === 'text/plain' ? 'ordinary pasted text' : '' },
    });

    act(() => editor.dispatchEvent(paste));

    expect(paste.defaultPrevented).toBe(true);
    expect(editor.textContent).toBe('ordinary pasted text');
    expect(onChange).toHaveBeenLastCalledWith('ordinary pasted text', []);
    unmount();
  });

  it('adds pasted clipboard images as attachments instead of dropping them', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const onPasteImages = vi.fn();
    const image = new File(['image-bytes'], 'clipboard-photo.png', { type: 'image/png' });

    act(() => {
      root.render(
        <RichTextEditor
          text=""
          entities={[]}
          onChange={vi.fn()}
          onPasteImages={onPasteImages}
          maxLength={4096}
        />,
      );
    });

    const editor = container.querySelector('[contenteditable="true"]') as HTMLDivElement;
    const pasteEvent = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(pasteEvent, 'clipboardData', {
      value: {
        items: [{ kind: 'file', type: 'image/png', getAsFile: () => image }],
        getData: () => '',
      },
    });

    act(() => editor.dispatchEvent(pasteEvent));

    expect(pasteEvent.defaultPrevented).toBe(true);
    expect(onPasteImages).toHaveBeenCalledWith([image]);

    act(() => root.unmount());
    container.remove();
  });

  it('keeps the caret inside the editor after auto-trimming to max length', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const onChange = vi.fn();

    act(() => {
      root.render(<RichTextEditor text="" entities={[]} onChange={onChange} maxLength={10} />);
    });

    const editor = container.querySelector('[contenteditable="true"]') as HTMLDivElement;
    act(() => editor.focus());
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);

    act(() => {
      editor.textContent = 'abcdefghijk';
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(editor.textContent).toBe('abcdefghij');
    expect(window.getSelection()?.rangeCount).toBeGreaterThan(0);
    expect(editor.contains(window.getSelection()?.anchorNode ?? null)).toBe(true);

    act(() => root.unmount());
    container.remove();
  });

  it('blocks only insertions that would exceed the editor limit', () => {
    expect(shouldPreventEditorInsertion(4, 0, 4)).toBe(true);
    expect(shouldPreventEditorInsertion(4, 1, 4)).toBe(false);
    expect(shouldPreventEditorInsertion(3, 0, 4)).toBe(false);
  });

  it('removes hidden word-joiner and soft-hyphen characters from repeated input', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const onChange = vi.fn();

    act(() => {
      root.render(<RichTextEditor text="" entities={[]} onChange={onChange} maxLength={4096} />);
    });

    const editor = container.querySelector('[contenteditable="true"]') as HTMLDivElement;
    act(() => {
      editor.textContent = 'B'.repeat(300) + '\u2060\u00AD\u200E\u200F';
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(editor.textContent).toBe('B'.repeat(300));
    expect(onChange).toHaveBeenLastCalledWith('B'.repeat(300), []);

    act(() => root.unmount());
    container.remove();
  });

  it('keeps long unbroken strings as plain text without injecting artificial wrap hints', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const onChange = vi.fn();

    act(() => {
      root.render(<RichTextEditor text="" entities={[]} onChange={onChange} maxLength={4096} />);
    });

    const editor = container.querySelector('[contenteditable="true"]') as HTMLDivElement;
    act(() => {
      editor.textContent = 'a'.repeat(500);
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(editor.querySelector('wbr')).toBeNull();
    expect(editor.textContent).toBe('a'.repeat(500));
    expect(editor.textContent?.length).toBe(500);

    act(() => root.unmount());
    container.remove();
  });

  it('animates the editor logo on the first focus only', () => {
    vi.useFakeTimers();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const onChange = vi.fn();
    const renderEditor = (text: string) => root.render(
      <LocaleProvider><RichTextEditor text={text} entities={[]} onChange={onChange} maxLength={4096} /></LocaleProvider>,
    );

    act(() => renderEditor(''));
    const editor = container.querySelector('[contenteditable="true"]') as HTMLDivElement;
    expect(container.querySelector('.workspace-page-rich-text-empty-logo')).toBeNull();

    const animation = { cancel: vi.fn(), onfinish: null } as unknown as Animation;
    const animate = vi.fn((keyframes: Keyframe[], options?: KeyframeAnimationOptions) => {
      void keyframes;
      void options;
      return animation;
    });
    Object.defineProperty(HTMLImageElement.prototype, 'animate', { configurable: true, value: animate });
    Object.defineProperty(HTMLImageElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ width: 240, height: 240, top: 0, right: 240, bottom: 240, left: 0, x: 0, y: 0, toJSON: () => ({}) }),
    });
    vi.spyOn(editor, 'getBoundingClientRect').mockReturnValue({
      width: 600,
      height: 300,
      top: 0,
      right: 600,
      bottom: 300,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    act(() => editor.focus());
    const logo = container.querySelector('.workspace-page-rich-text-empty-logo');
    expect(logo).toBeTruthy();
    expect(window.getSelection()?.anchorNode).toBe(editor);
    expect(window.getSelection()?.anchorOffset).toBe(0);
    expect(editor.classList.contains('is-empty')).toBe(true);
    expect(editor.getAttribute('data-placeholder')).toBe('Start writing your post…');
    expect(logo?.querySelector('img')?.getAttribute('src')).toContain('logo.png');
    expect(editor.contains(logo)).toBe(false);
    expect(animate).toHaveBeenCalledTimes(1);
    expect(editor.classList.contains('is-logo-intro')).toBe(true);
    expect(animate.mock.calls[0][1]?.duration).toBe(4950);
    const keyframes = animate.mock.calls[0][0];
    expect(keyframes).toHaveLength(7);
    expect(keyframes[2]?.opacity).toBe(1);
    expect(keyframes[2]?.offset).toBe(0.4457218);
    expect(keyframes[2]?.transform).toContain('scale(1)');
    expect(keyframes[1]?.easing).toBe('cubic-bezier(0.32, 0.35, 0.4, 1)');
    expect(keyframes[3]?.offset).toBe(0.8699642);
    expect(keyframes[3]?.opacity).toBe(1);
    expect(keyframes[3]?.transform).toBe(keyframes[2]?.transform);
    expect(keyframes[3]?.easing).toBe('cubic-bezier(0.6, 0, 0.68, 0.65)');
    expect((keyframes[3]!.offset! - keyframes[2]!.offset!) * 4950).toBeCloseTo(2100, 0);
    expect(keyframes[4]?.offset).toBe(0.9208352);
    expect(keyframes[4]?.opacity).toBe(0.78);
    expect(keyframes[4]?.transform).toContain('scale(2.7)');
    expect(keyframes[4]?.easing).toBe('linear');
    expect(keyframes[5]?.offset).toBe(0.9591442);
    expect(keyframes[5]?.opacity).toBe(0.32);
    expect(keyframes[5]?.transform).toContain('scale(3.645');
    expect(keyframes[5]?.easing).toBe('linear');
    expect(keyframes[6]?.opacity).toBe(0);
    expect(keyframes[6]?.transform).toContain('scale(4.725');
    expect(keyframes.every((frame) => String(frame.transform).includes('rotateY(27deg)'))).toBe(true);
    expect(logo?.classList.contains('is-flying')).toBe(true);

    act(() => {
      editor.textContent = 'Hello';
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith('Hello', []);

    act(() => renderEditor('Hello'));
    const flyingLogo = container.querySelector('.workspace-page-rich-text-empty-logo.is-flying');
    expect(flyingLogo).toBeTruthy();
    expect(editor.classList.contains('has-content')).toBe(true);
    expect(editor.classList.contains('is-empty')).toBe(false);
    expect(animate).toHaveBeenCalledTimes(1);
    expect(editor.classList.contains('has-content')).toBe(true);
    const clearTextButton = container.querySelector('[aria-label="Clear editor text"]') as HTMLButtonElement;
    expect(clearTextButton).not.toBeNull();

    act(() => clearTextButton.click());
    expect(onChange).toHaveBeenLastCalledWith('', []);
    act(() => renderEditor(''));
    const hiddenClearTextButton = container.querySelector('[aria-label="Clear editor text"]') as HTMLButtonElement;
    expect(hiddenClearTextButton).toBeDisabled();
    expect(hiddenClearTextButton).toHaveAttribute('aria-hidden', 'true');
    expect(hiddenClearTextButton).toHaveClass('is-hidden');

    act(() => {
      animation.onfinish?.call(animation, {} as AnimationPlaybackEvent);
    });
    expect(container.querySelector('.workspace-page-rich-text-empty-logo')).toBeNull();
    expect(editor.classList.contains('is-logo-intro')).toBe(true);
    expect(editor.classList.contains('is-logo-intro-finishing')).toBe(true);

    act(() => vi.advanceTimersByTime(180));
    expect(editor.classList.contains('is-logo-intro')).toBe(false);
    expect(editor.classList.contains('is-logo-intro-finishing')).toBe(false);

    act(() => editor.blur());
    expect(editor.classList.contains('is-logo-intro')).toBe(false);

    act(() => vi.advanceTimersByTime(5030));
    expect(container.querySelector('.workspace-page-rich-text-empty-logo')).toBeNull();
    expect(animation.cancel).not.toHaveBeenCalled();

    act(() => {
      editor.textContent = '';
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => renderEditor(''));
    expect(container.querySelector('.workspace-page-rich-text-empty-logo')).toBeNull();

    act(() => {
      editor.textContent = 'Again';
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(container.querySelector('.workspace-page-rich-text-empty-logo')).toBeNull();
    expect(animate).toHaveBeenCalledTimes(1);

    act(() => editor.blur());
    act(() => editor.focus());
    expect(animate).toHaveBeenCalledTimes(1);

    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it('uses a minimal animation duration when reduced motion is preferred', () => {
    vi.useFakeTimers();
    const previousMatchMedia = Object.getOwnPropertyDescriptor(window, 'matchMedia');
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: true }),
    });
    const harness = createLogoHarness();

    try {
      act(() => harness.editor.focus());
      expect(harness.animate.mock.calls[0]?.[1]?.duration).toBe(1);

      act(() => vi.advanceTimersByTime(81));
      expect(harness.container.querySelector('.workspace-page-rich-text-empty-logo')).toBeNull();
    } finally {
      harness.cleanup();
      if (previousMatchMedia) Object.defineProperty(window, 'matchMedia', previousMatchMedia);
      else Reflect.deleteProperty(window, 'matchMedia');
      vi.useRealTimers();
    }
  });

  it('clears the pending logo timeout when the editor unmounts', () => {
    vi.useFakeTimers();
    const harness = createLogoHarness();
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout');
    const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout');

    try {
      act(() => harness.editor.focus());
      const duration = Number(harness.animate.mock.calls[0]?.[1]?.duration ?? 0);
      const timerIndex = setTimeoutSpy.mock.calls.findIndex(([, delay]) => delay === duration + 80);
      expect(timerIndex).toBeGreaterThanOrEqual(0);
      const logoTimeoutId = setTimeoutSpy.mock.results[timerIndex]?.value;

      harness.cleanup();
      expect(clearTimeoutSpy).toHaveBeenCalledWith(logoTimeoutId);
    } finally {
      harness.cleanup();
      setTimeoutSpy.mockRestore();
      clearTimeoutSpy.mockRestore();
      vi.useRealTimers();
    }
  });
});
