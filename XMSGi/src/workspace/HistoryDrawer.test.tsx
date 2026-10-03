import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Chat, ScheduledMessage } from '@/types';
import { HistoryDrawer } from './HistoryDrawer';
import { normalizeSavedDraft, normalizeScheduledMessages, sortHistoryItems } from './historyModel';

const scheduledMessage: ScheduledMessage = {
  id: 'scheduled-studio-1',
  chatId: 'chat-1',
  chatName: 'XMSGi Updates',
  text: 'Релиз нового набора шаблонов для Telegram-канала',
  attachments: ['C:\\files\\brief.pdf'],
  when: '2026-09-29T17:30:00.000Z',
  createdAt: '2026-09-29T16:00:00.000Z',
  status: 'confirmed',
};

const channel: Chat = { id: 'chat-1', name: 'XMSGi Updates', username: 'xmsgi_updates', type: 'channel' };
const upcomingRecord = normalizeScheduledMessages([scheduledMessage], 'workspace', 'upcoming', [channel])[0];

const completedRecord = normalizeScheduledMessages([{
    ...scheduledMessage,
    id: 'completed-personal-1',
    chatName: 'Личные заметки',
    text: 'Подтвердить встречу',
    attachments: [],
    status: 'sent',
  }], 'personal', 'sent', [channel])[0];

const workspaceSentRecord = normalizeScheduledMessages([{
  ...scheduledMessage,
  id: 'completed-studio-1',
  status: 'sent',
}], 'workspace', 'sent', [channel])[0];

const personalUpcomingRecord = normalizeScheduledMessages([{
    ...scheduledMessage,
    id: 'scheduled-personal-1',
    chatName: 'Личное',
    text: 'Подтвердить встречу',
    attachments: [],
  }], 'personal', 'upcoming', [])[0];

function renderHistory(
  records = [upcomingRecord],
  onCancel = vi.fn(),
  onDelete = vi.fn(),
  onSendNow = vi.fn(),
  onOpenDraft = vi.fn(),
  onReschedule = vi.fn(),
  onClearSent = vi.fn(),
) {
  const onClose = vi.fn();
  const view = render(
    <HistoryDrawer
      isOpen
      onClose={onClose}
      records={records}
      onCancel={onCancel}
      onReschedule={onReschedule}
      onSendNow={onSendNow}
      onDelete={onDelete}
      onOpenDraft={onOpenDraft}
      onClearSent={onClearSent}
    />,
  );
  return { ...view, onClose, onCancel, onDelete, onSendNow, onOpenDraft, onReschedule, onClearSent };
}

function searchHistory(query: string) {
  renderHistory();
  fireEvent.change(screen.getByRole('textbox', { name: 'Поиск по истории' }), {
    target: { value: query },
  });
}

function mockHistoryRecordScroll(container: HTMLElement, recordBounds = { top: 350, height: 100 }) {
  const list = container.querySelector('.history-record-list') as HTMLDivElement;
  const record = list.querySelector('.history-record') as HTMLElement;
  const dateHeading = list.querySelector('.history-date-heading') as HTMLElement;
  const scrollTo = vi.fn();
  Object.defineProperties(list, {
    clientHeight: { configurable: true, value: 300 },
    scrollTop: { configurable: true, writable: true, value: 20 },
    getBoundingClientRect: { configurable: true, value: () => new DOMRect(0, 100, 400, 300) },
    scrollTo: { configurable: true, value: scrollTo },
  });
  Object.defineProperty(record, 'getBoundingClientRect', {
    configurable: true,
    value: () => new DOMRect(0, recordBounds.top, 400, recordBounds.height),
  });
  Object.defineProperty(dateHeading, 'getBoundingClientRect', {
    configurable: true,
    value: () => new DOMRect(0, 100, 400, 34),
  });
  return scrollTo;
}

function stubDownloads() {
  const blobs: Blob[] = [];
  const filenames: string[] = [];
  vi.spyOn(window, 'setTimeout').mockImplementation(((handler: TimerHandler) => {
    if (typeof handler === 'function') handler();
    return 0;
  }) as typeof window.setTimeout);
  const createObjectURL = vi.fn((blob: Blob) => {
    blobs.push(blob);
    return `blob:scheduled-export-${blobs.length}`;
  });
  const revokeObjectURL = vi.fn();
  const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    filenames.push(this.download);
  });

  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
  return { blobs, filenames, anchorClick };
}

function readBlob(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

describe('HistoryDrawer search', () => {
  it('groups search and navigation controls in one dock below the records', () => {
    const { container } = renderHistory();
    const recordList = container.querySelector('.history-record-list')!;
    const searchDock = container.querySelector('.history-search-dock')!;
    const navigationDock = container.querySelector('.history-drawer-footer')!;
    const toolsDock = container.querySelector('.history-drawer-tools')!;

    expect(recordList.compareDocumentPosition(searchDock) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(searchDock.compareDocumentPosition(navigationDock) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(searchDock.parentElement).toBe(toolsDock);
    expect(navigationDock.parentElement).toBe(toolsDock);
    expect(screen.getByRole('search')).toBeInTheDocument();
  });

  it('normalizes both sources without colliding on matching IDs', () => {
    const duplicateIdMessage = { ...scheduledMessage, id: '123' };
    const personal = normalizeScheduledMessages([duplicateIdMessage], 'personal', 'upcoming', []);
    const workspace = normalizeScheduledMessages([duplicateIdMessage], 'workspace', 'upcoming', []);

    expect(personal[0].source).toBe('personal');
    expect(workspace[0].source).toBe('workspace');
    expect(personal[0].id).not.toBe(workspace[0].id);
    expect(personal[0].status).toBe('scheduled');
  });

  it('normalizes persisted Studio drafts and sorts each category by its required time', () => {
    const draft = normalizeSavedDraft({
      id: 'draft-1',
      name: 'Launch note',
      body: 'A new feature is ready',
      createdAt: '2026-09-28T10:00:00.000Z',
      updatedAt: '2026-09-29T18:35:00.000Z',
    });
    const scheduled = normalizeScheduledMessages([
      { ...scheduledMessage, id: 'later', when: '2026-09-29T21:00:00.000Z' },
      { ...scheduledMessage, id: 'sooner', when: '2026-09-29T20:00:00.000Z' },
    ], 'workspace', 'upcoming', []);
    const sent = normalizeScheduledMessages([
      { ...scheduledMessage, id: 'older', sentAt: '2026-09-29T16:00:00.000Z' },
      { ...scheduledMessage, id: 'newer', sentAt: '2026-09-29T17:00:00.000Z' },
    ], 'personal', 'sent', []);

    expect(draft).toMatchObject({ source: 'workspace', status: 'draft', title: 'Launch note' });
    expect(sortHistoryItems(scheduled, 'scheduled').map((item) => item.original.kind === 'scheduled' && item.original.message.id))
      .toEqual(['sooner', 'later']);
    expect(sortHistoryItems(sent, 'sent').map((item) => item.original.kind === 'scheduled' && item.original.message.id))
      .toEqual(['newer', 'older']);
    expect(sortHistoryItems([draft, normalizeSavedDraft({
      id: 'draft-2',
      name: 'Older note',
      body: 'Earlier',
      createdAt: '2026-09-27T10:00:00.000Z',
      updatedAt: '2026-09-29T17:00:00.000Z',
    })], 'drafts')[0].id).toBe(draft.id);
  });

  it('normalizes failed and cancelled statuses already present in runtime data', () => {
    const errorMessage = { ...scheduledMessage, status: 'failed' as ScheduledMessage['status'] };
    const cancelledMessage = { ...scheduledMessage, id: 'cancelled-runtime', status: 'cancelled' as ScheduledMessage['status'] };
    const [errorRecord] = normalizeScheduledMessages([errorMessage], 'workspace', 'upcoming', []);
    const [cancelledRecord] = normalizeScheduledMessages([cancelledMessage], 'workspace', 'upcoming', []);

    expect(errorRecord.status).toBe('failed');
    expect(cancelledRecord.status).toBe('cancelled');
    expect(sortHistoryItems([
      { ...errorRecord, updatedAt: '2026-09-29T18:00:00.000Z' },
      { ...cancelledRecord, updatedAt: '2026-09-29T19:00:00.000Z' },
      normalizeScheduledMessages([{ ...scheduledMessage, id: 'soon', when: '2026-09-29T20:00:00.000Z' }], 'workspace', 'upcoming', [])[0],
    ], 'scheduled').map((record) => record.status)).toEqual(['scheduled', 'cancelled', 'failed']);
  });

  it('keeps drafts in a dedicated section instead of mixing them into the queue UI', async () => {
    const draft = {
      id: 'draft-queue-separate-1',
      name: 'Draft note',
      body: 'Draft body for separate history section',
      createdAt: '2026-09-28T10:00:00.000Z',
      updatedAt: '2026-09-29T18:35:00.000Z',
    };
    Object.defineProperty(window, 'draftStorage', {
      configurable: true,
      value: {
        load: async () => ({
          success: true,
          store: {
            schemaVersion: 1,
            migrationVersion: 1,
            savedDrafts: [draft],
            workspaceDraft: null,
          },
        }),
      },
    });

    renderHistory([upcomingRecord]);
    fireEvent.click(screen.getByRole('tab', { name: 'Черновики' }));

    expect(await screen.findByText('Draft note')).toBeInTheDocument();
    expect(screen.queryByText(/Черновики вынесены отдельно/i)).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Черновики' }).textContent).toContain('1');
    delete (window as { draftStorage?: unknown }).draftStorage;
  });

  it('opens the records list at the top', () => {
    const originalScrollHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get: () => 640,
    });

    try {
      const props = {
        onClose: vi.fn(),
        records: [upcomingRecord, personalUpcomingRecord],
        onCancel: vi.fn(),
        onReschedule: vi.fn(),
        onSendNow: vi.fn(),
        onDelete: vi.fn(),
        onOpenDraft: vi.fn(),
        onClearSent: vi.fn(),
      };
      const view = render(<HistoryDrawer {...props} isOpen={false} />);

      view.rerender(<HistoryDrawer {...props} isOpen />);

      expect(view.container.querySelector('.history-record-list')?.scrollTop).toBe(0);
    } finally {
      if (originalScrollHeight) {
        Object.defineProperty(HTMLElement.prototype, 'scrollHeight', originalScrollHeight);
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, 'scrollHeight');
      }
    }
  });

  it('finds records by scheduled time', () => {
    searchHistory('17:30');

    expect(screen.getByText('XMSGi Updates')).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(1);
  });

  it('finds records by message text', () => {
    searchHistory('шаблонов telegram');

    expect(screen.getByText('XMSGi Updates')).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(1);
  });

  it('finds records by chat name', () => {
    searchHistory('@xmsgi_updates');

    expect(screen.getByText('XMSGi Updates')).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(1);
  });

  it('shows matching totals and clears an empty search', () => {
    renderHistory([upcomingRecord, personalUpcomingRecord]);
    fireEvent.click(screen.getByRole('button', { name: 'Экспортировать текущую категорию' }));
    expect(screen.getByRole('menu', { name: 'Формат экспорта' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Поиск по истории' }), {
      target: { value: 'нет такого сообщения' },
    });

    expect(screen.getByText('Найдено 0 из 2')).toBeInTheDocument();
    expect(screen.getByText('Ничего не найдено')).toBeInTheDocument();
    expect(screen.queryByRole('menu', { name: 'Формат экспорта' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Очистить поиск' }));

    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(screen.getByText('2 записи')).toBeInTheDocument();
  });

  it('reserves the clear-button slot while the search is empty', () => {
    const { container } = renderHistory();
    const clearButton = container.querySelector<HTMLButtonElement>('.history-search-clear')!;

    expect(clearButton).toBeDisabled();
    expect(clearButton).toHaveClass('is-reserved');
    fireEvent.change(screen.getByRole('textbox', { name: 'Поиск по истории' }), {
      target: { value: 'Studio' },
    });
    expect(clearButton).toBeEnabled();
    expect(clearButton).not.toHaveClass('is-reserved');
  });

  it('places the clear button beside the input and keeps the result count last', () => {
    const { container } = renderHistory();
    const input = screen.getByRole('textbox', { name: 'Поиск по истории' });
    const clearButton = screen.getByRole('button', { name: 'Очистить поиск' });
    const resultCount = container.querySelector('.history-result-count')!;

    expect(input.compareDocumentPosition(clearButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(clearButton.compareDocumentPosition(resultCount) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('groups a long history list by calendar day', () => {
    const nextDayRecord = normalizeScheduledMessages([{
      ...scheduledMessage,
      id: 'scheduled-next-day',
      when: '2026-09-30T17:30:00.000Z',
    }], 'workspace', 'upcoming', [channel])[0];
    renderHistory([upcomingRecord, nextDayRecord]);

    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(2);
    expect(screen.getAllByRole('article')).toHaveLength(2);
  });

  it('shows attachment and failure details in compact rows', () => {
    const failedRecord = normalizeScheduledMessages([{
      ...scheduledMessage,
      id: 'failed-compact-row',
      attachments: [],
      status: 'failed' as ScheduledMessage['status'],
      lastError: 'Telegram не подтвердил отправку.',
      retryAction: 'send',
    }], 'workspace', 'upcoming', [channel])[0];
    const cancelledRecord = normalizeScheduledMessages([{
      ...scheduledMessage,
      id: 'cancelled-compact-row',
      attachments: [],
      status: 'cancelled' as ScheduledMessage['status'],
    }], 'personal', 'upcoming', [])[0];
    renderHistory([upcomingRecord, failedRecord, cancelledRecord]);

    expect(screen.getByLabelText('1 вложение')).toBeInTheDocument();
    expect(screen.getByText('Telegram не подтвердил отправку.')).toBeInTheDocument();
    expect(screen.getAllByRole('article')[2]).toHaveTextContent('Отменено');
  });

  it('filters the single list across All, Studio, and Personal sources', () => {
    renderHistory([upcomingRecord, personalUpcomingRecord]);

    expect(screen.getAllByRole('article')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Studio' }));
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByText('XMSGi Updates')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Личное' }));
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByRole('article')).toHaveTextContent('Подтвердить встречу');

    fireEvent.click(screen.getByRole('button', { name: 'Все' }));
    expect(screen.getAllByRole('article')).toHaveLength(2);
  });

  it('routes send-now to the existing callback without optimistic status changes', () => {
    const { onSendNow } = renderHistory([upcomingRecord]);

    fireEvent.click(screen.getByRole('button', { name: 'Отправить сейчас' }));

    expect(onSendNow).toHaveBeenCalledWith(upcomingRecord);
    expect(screen.getByRole('article')).toHaveTextContent('Запланировано');
    expect(screen.getByRole('article')).not.toHaveTextContent('Отправлено');
  });

  it('offers Reschedule only for Studio scheduled records', () => {
    const personalMessage = normalizeScheduledMessages([{
      ...scheduledMessage,
      id: 'personal-reschedule-1',
      chatName: 'Личное',
      text: 'Personal message',
    }], 'personal', 'upcoming', [])[0];
    const onReschedule = vi.fn();
    const { onClose } = renderHistory([upcomingRecord, personalMessage], vi.fn(), vi.fn(), vi.fn(), vi.fn(), onReschedule);

    expect(screen.getByRole('button', { name: 'Перепланировать: XMSGi Updates' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Перепланировать: Личное' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Перепланировать: XMSGi Updates' }));

    expect(onReschedule).toHaveBeenCalledWith(upcomingRecord);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it.each([
    { source: 'personal' as const, label: 'Личное', record: completedRecord },
    { source: 'workspace' as const, label: 'Studio', record: workspaceSentRecord },
  ])('clears sent records for the explicitly selected $source source', ({ source, label, record }) => {
    const onClearSent = vi.fn();
    renderHistory([completedRecord, workspaceSentRecord], undefined, undefined, undefined, undefined, undefined, onClearSent);
    fireEvent.click(screen.getByRole('tab', { name: 'Отправлено' }));
    const clearButton = screen.getByRole('button', { name: 'Очистить отправленные' });

    expect(clearButton).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: label }));
    expect(clearButton).toBeEnabled();
    fireEvent.click(clearButton);

    expect(record.source).toBe(source);
    expect(onClearSent).toHaveBeenCalledWith(source);
  });

  it('clears sent records across both sources when the All filter is active', () => {
    const onClearSent = vi.fn();
    renderHistory([completedRecord, workspaceSentRecord], undefined, undefined, undefined, undefined, undefined, onClearSent);
    fireEvent.click(screen.getByRole('tab', { name: 'Отправлено' }));

    const clearButton = screen.getByRole('button', { name: 'Очистить отправленные' });
    expect(clearButton).toBeEnabled();

    fireEvent.click(clearButton);

    expect(onClearSent).toHaveBeenCalledWith('all');
  });

  it('does not offer bulk cancellation for upcoming records', () => {
    renderHistory([upcomingRecord, personalUpcomingRecord]);

    expect(screen.queryByRole('button', { name: 'Отменить все запланированные' })).not.toBeInTheDocument();
  });

  it('keeps Failed and cancelled records visible without an Errors tab', () => {
    const failedRecord = normalizeScheduledMessages([{
      ...scheduledMessage,
      text: 'Failed entry for retry',
      status: 'failed' as ScheduledMessage['status'],
      lastError: 'Telegram is temporarily unavailable.',
      retryAction: 'send',
    }], 'personal', 'upcoming', [channel])[0];
    const cancelledRecord = normalizeScheduledMessages([{
      ...scheduledMessage,
      id: 'cancelled-history-entry',
      text: 'Cancelled entry remains visible',
      status: 'cancelled' as ScheduledMessage['status'],
    }], 'personal', 'upcoming', [channel])[0];
    const onSendNow = vi.fn();
    renderHistory([failedRecord, cancelledRecord], vi.fn(), vi.fn(), onSendNow);

    expect(screen.queryByRole('tab', { name: 'Ошибки' })).not.toBeInTheDocument();
    expect(screen.getByText('Failed entry for retry')).toBeInTheDocument();
    expect(screen.getByText('Cancelled entry remains visible')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));

    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(screen.getByText('Failed entry for retry').closest('article')).toHaveTextContent('Ошибка');
    expect(onSendNow).toHaveBeenCalledWith(failedRecord);
  });

  it('shows Sending in the scheduled list without exposing another send action', () => {
    const sendingRecord = normalizeScheduledMessages([{
      ...scheduledMessage,
      status: 'sending' as ScheduledMessage['status'],
    }], 'workspace', 'upcoming', [channel])[0];
    renderHistory([sendingRecord]);

    expect(screen.queryByRole('tab', { name: 'Отправляется' })).not.toBeInTheDocument();
    expect(screen.getByRole('article')).toHaveTextContent('Отправляется');
    expect(screen.getByRole('button', { name: 'Отправляется…' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Отправить сейчас' })).not.toBeInTheDocument();
  });

  it('loads Studio drafts through draftStorage and opens via the existing callback', async () => {
    const originalDraftStorage = Object.getOwnPropertyDescriptor(window, 'draftStorage');
    const draft = {
      id: 'studio-draft-1',
      name: 'Анонс функции',
      body: 'Скоро обновление',
      color: 'coral' as const,
      createdAt: '2026-09-28T10:00:00.000Z',
      updatedAt: '2026-09-29T18:35:00.000Z',
    };
    const load = vi.fn().mockResolvedValue({
      success: true,
      store: { schemaVersion: 1, migrationVersion: 1, savedDrafts: [draft], workspaceDraft: null },
    });
    Object.defineProperty(window, 'draftStorage', {
      configurable: true,
      value: { load },
    });

    try {
      const onOpenDraft = vi.fn();
      renderHistory([upcomingRecord], vi.fn(), vi.fn(), vi.fn(), onOpenDraft);
      fireEvent.click(screen.getByRole('tab', { name: 'Черновики' }));
      const draftCard = await screen.findByRole('article');
      expect(draftCard).toHaveClass('is-draft');
      expect(draftCard).toHaveAttribute('data-draft-color', 'coral');
      expect(screen.getByLabelText('Цвет черновика: coral')).toBeInTheDocument();
      fireEvent.click(await screen.findByRole('button', { name: 'Открыть черновик: Анонс функции' }));

      expect(load).toHaveBeenCalledOnce();
      expect(onOpenDraft).toHaveBeenCalledWith(expect.objectContaining({
        source: 'workspace',
        status: 'draft',
        original: { kind: 'saved-draft', draft: expect.objectContaining({ id: 'studio-draft-1' }) },
      }));
    } finally {
      if (originalDraftStorage) {
        Object.defineProperty(window, 'draftStorage', originalDraftStorage);
      } else {
        Reflect.deleteProperty(window, 'draftStorage');
      }
    }
  });

  it('offers text and JSON export options', () => {
    renderHistory();

    fireEvent.click(screen.getByRole('button', { name: 'Экспортировать текущую категорию' }));

    expect(screen.getByText('Текущая категория: Запланировано')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Экспортировать текущий список как TXT (.txt)' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Экспортировать текущий список как JSON (.json)' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Экспортировать текущий список как TXT (.txt)' }))
      .toHaveAttribute('title', 'Лучше для чтения, печати и отправки человеку.');
    expect(screen.getByRole('menuitem', { name: 'Экспортировать текущий список как JSON (.json)' }))
      .toHaveAttribute('title', 'Лучше для резервной копии и переноса данных.');
    expect(screen.queryByText('Завершённые')).not.toBeInTheDocument();
  });

  it('exports only the currently selected source, status, and search results', async () => {
    const downloads = stubDownloads();

    try {
      renderHistory([upcomingRecord, personalUpcomingRecord, completedRecord]);
      fireEvent.click(screen.getByRole('button', { name: 'Личное' }));
      fireEvent.click(screen.getByRole('tab', { name: 'Отправлено' }));
      fireEvent.change(screen.getByRole('textbox', { name: 'Поиск по истории' }), {
        target: { value: 'подтвердить' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Экспортировать текущую категорию' }));

      expect(screen.getByText('Текущая категория: Отправлено')).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: 'Экспортировать текущий список как JSON (.json)' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Экспортировать текущую категорию' })).toBeEnabled();

      fireEvent.click(screen.getByRole('menuitem', { name: 'Экспортировать текущий список как JSON (.json)' }));

      const payload = JSON.parse(await readBlob(downloads.blobs[0])) as {
        filters: { source: string; status: string; query: string };
        records: Array<{ id: string }>;
      };
      expect(payload.filters).toEqual({ source: 'personal', status: 'sent', query: 'подтвердить' });
      expect(payload.records.map((record) => record.id)).toEqual([completedRecord.id]);
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });

  it('exports a readable text file with the full message and attachment names', async () => {
    const downloads = stubDownloads();

    try {
      renderHistory();
      fireEvent.click(screen.getByRole('button', { name: 'Экспортировать текущую категорию' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Экспортировать текущий список как TXT (.txt)' }));

      expect(downloads.blobs[0].type).toBe('text/plain;charset=utf-8');
      expect(downloads.filenames[0]).toMatch(/xmsgi-scheduled-.*\.txt$/);
      const text = await readBlob(downloads.blobs[0]);
      expect(text).toContain('XMSGi — Запланировано');
      expect(text).toContain('Источник: Studio');
      expect(text).toContain('Чат: XMSGi Updates (@xmsgi_updates)');
      expect(text).toContain('Релиз нового набора шаблонов для Telegram-канала');
      expect(text).toContain('brief.pdf');
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });

  it('exports saved drafts from the selected drafts category', async () => {
    const originalDraftStorage = Object.getOwnPropertyDescriptor(window, 'draftStorage');
    const draft = {
      id: 'exported-studio-draft',
      name: 'Идея для следующего поста',
      body: 'Собрать заметки по обновлению.',
      createdAt: '2026-09-28T10:00:00.000Z',
      updatedAt: '2026-09-29T18:35:00.000Z',
    };
    Object.defineProperty(window, 'draftStorage', {
      configurable: true,
      value: {
        load: vi.fn().mockResolvedValue({
          success: true,
          store: { schemaVersion: 1, migrationVersion: 1, savedDrafts: [draft], workspaceDraft: null },
        }),
      },
    });

    try {
      renderHistory([]);
      fireEvent.click(screen.getByRole('tab', { name: 'Черновики' }));
      await screen.findByRole('article');
      const downloads = stubDownloads();
      fireEvent.click(screen.getByRole('button', { name: 'Экспортировать текущую категорию' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Экспортировать текущий список как JSON (.json)' }));

      const payload = JSON.parse(await readBlob(downloads.blobs[0])) as {
        filters: { source: string; status: string };
        records: Array<{ status: string; text: string; title: string }>;
      };
      expect(payload.filters).toEqual({ source: 'all', status: 'drafts', query: '' });
      expect(payload.records).toMatchObject([{ status: 'draft', title: draft.name, text: draft.body }]);
      expect(downloads.filenames[0]).toMatch(/xmsgi-drafts-.*\.json$/);
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
      if (originalDraftStorage) {
        Object.defineProperty(window, 'draftStorage', originalDraftStorage);
      } else {
        Reflect.deleteProperty(window, 'draftStorage');
      }
    }
  });

  it('exports completed records separately in a readable text file', async () => {
    const downloads = stubDownloads();

    try {
      renderHistory([upcomingRecord, completedRecord]);
      fireEvent.click(screen.getByRole('tab', { name: 'Отправлено' }));
      fireEvent.click(screen.getByRole('button', { name: 'Экспортировать текущую категорию' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Экспортировать текущий список как TXT (.txt)' }));

      expect(downloads.filenames[0]).toMatch(/xmsgi-sent-.*\.txt$/);
      const text = await readBlob(downloads.blobs[0]);
      expect(text).toContain('XMSGi — Отправлено');
      expect(text).toContain('Статус: Отправлено');
      expect(text).toContain('Подтвердить встречу');
      expect(text).not.toContain('Релиз нового набора шаблонов');
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });

  it('routes cancel and delete from an upcoming record to their handlers', () => {
    const onCancel = vi.fn();
    const onDelete = vi.fn();
    renderHistory([upcomingRecord, completedRecord], onCancel, onDelete);

    fireEvent.click(screen.getByRole('button', { name: 'Отменить' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Отправлено' }));
    fireEvent.click(screen.getByRole('button', { name: 'Удалить: Личные заметки' }));

    expect(onCancel).toHaveBeenCalledWith(upcomingRecord);
    expect(onDelete).toHaveBeenCalledWith(completedRecord);
  });

  it('expands a post in place, hides following posts and restores them on collapse', () => {
    renderHistory([upcomingRecord, personalUpcomingRecord]);

    fireEvent.click(screen.getByRole('button', { name: 'Открыть полностью: XMSGi Updates' }));

    expect(screen.getByRole('button', { name: 'Свернуть: XMSGi Updates' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByText('Релиз нового набора шаблонов для Telegram-канала')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Открыть полностью: Личное' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Свернуть: XMSGi Updates' }));

    expect(screen.getByRole('button', { name: 'Открыть полностью: Личное' })).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(2);
  });

  it.each([
    {
      name: 'summary row',
      record: upcomingRecord,
      status: null,
      trigger: 'Открыть публикацию: XMSGi Updates',
      bounds: { top: 350, height: 100 },
      expectedScrollTop: 70,
    },
    {
      name: 'summary row for a sent message',
      record: completedRecord,
      status: 'Отправлено',
      trigger: 'Открыть публикацию: Личные заметки',
      bounds: { top: 350, height: 100 },
      expectedScrollTop: 70,
    },
    {
      name: 'full-view action for a sent message',
      record: completedRecord,
      status: 'Отправлено',
      trigger: 'Открыть полностью: Личные заметки',
      bounds: { top: 350, height: 100 },
      expectedScrollTop: 70,
    },
    {
      name: 'full-view action for a message taller than the viewport',
      record: completedRecord,
      status: 'Отправлено',
      trigger: 'Открыть полностью: Личные заметки',
      bounds: { top: 250, height: 480 },
      expectedScrollTop: 136,
    },
  ])('keeps $name visible by scrolling only the history list', ({ record, status, trigger, bounds, expectedScrollTop }) => {
    const view = renderHistory([record]);
    if (status) fireEvent.click(screen.getByRole('tab', { name: status }));
    const scrollTo = mockHistoryRecordScroll(view.container, bounds);

    fireEvent.click(screen.getByRole('button', { name: trigger }));

    expect(scrollTo).toHaveBeenCalledWith({ top: expectedScrollTop, behavior: 'smooth' });
  });

  it('re-aligns an expanded sent message when its image attachment loads', () => {
    const sentImageRecord = normalizeScheduledMessages([{
      ...scheduledMessage,
      id: 'sent-image-1',
      status: 'sent',
      sentAt: '2026-09-29T18:00:00.000Z',
      attachments: ['C:\\files\\sent-image.png'],
    }], 'personal', 'sent', [channel])[0];
    const view = renderHistory([sentImageRecord]);
    fireEvent.click(screen.getByRole('tab', { name: 'Отправлено' }));
    const scrollTo = mockHistoryRecordScroll(view.container, { top: 350, height: 100 });

    fireEvent.click(screen.getByRole('button', { name: 'Открыть полностью: XMSGi Updates' }));
    expect(scrollTo).toHaveBeenCalledOnce();

    fireEvent.load(screen.getByRole('img', { name: 'sent-image.png' }));

    expect(scrollTo).toHaveBeenCalledTimes(2);
  });

  it('collapses an expanded message when switching to a category that hides it', () => {
    renderHistory([upcomingRecord, completedRecord]);
    fireEvent.click(screen.getByRole('button', { name: 'Открыть публикацию: XMSGi Updates' }));
    expect(screen.getByRole('article')).toHaveClass('is-expanded');

    fireEvent.click(screen.getByRole('tab', { name: 'Отправлено' }));

    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByRole('article')).not.toHaveClass('is-expanded');
  });

  it('shows image attachments in the full post view', () => {
    const imageRecord = normalizeScheduledMessages([
      {
        ...scheduledMessage,
        text: 'A caption below the photo',
        attachments: ['C:\\files\\launch-image.png'],
        replyMarkup: { inline_keyboard: [[{ text: 'Open details', url: 'https://example.com' }]] },
      },
    ], 'workspace', 'upcoming', [channel])[0];
    const view = renderHistory([imageRecord]);

    fireEvent.click(screen.getByRole('button', { name: 'Открыть публикацию: XMSGi Updates' }));

    expect(screen.getByRole('img', { name: 'launch-image.png' })).toHaveAttribute('src', 'file:///C:/files/launch-image.png');
    const bubble = view.container.querySelector('.history-post-bubble');
    expect(bubble?.firstElementChild).toHaveClass('history-post-attachments');
    expect(bubble?.querySelector('.history-post-text')).toHaveTextContent('A caption below the photo');
    expect(screen.getByLabelText('Inline keyboard preview')).toContainElement(screen.getByRole('button', { name: 'Open details' }));
  });

  it('shows schedule time and status only once the post is expanded', () => {
    const view = renderHistory([upcomingRecord]);
    const openButton = screen.getByRole('button', { name: 'Открыть публикацию: XMSGi Updates' });

    expect(openButton.querySelector('.history-record-date')).not.toBeNull();
    expect(openButton.querySelector('.history-record-heading time')).not.toBeNull();

    fireEvent.click(openButton);

    expect(openButton.querySelector('.history-record-date')).toBeNull();
    expect(openButton.querySelector('.history-record-heading time')).toBeNull();
    expect(view.container.querySelector('.history-post-time-row time')).toBeVisible();
    expect(view.container.querySelector('.history-post-time-row')).toHaveTextContent('Запланировано');
  });
});