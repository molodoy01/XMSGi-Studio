import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ScheduledMessage } from '@/types';
import { HistoryDrawer, type HistoryDrawerRecord } from './HistoryDrawer';

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

const upcomingRecord: HistoryDrawerRecord = {
  source: 'studio',
  status: 'upcoming',
  chatLabel: '@xmsgi_updates',
  message: scheduledMessage,
};

const completedRecord: HistoryDrawerRecord = {
  source: 'personal',
  status: 'completed',
  chatLabel: 'Личное',
  message: {
    ...scheduledMessage,
    id: 'completed-personal-1',
    chatName: 'Личные заметки',
    text: 'Подтвердить встречу',
    attachments: [],
    status: 'sent',
  },
};

const personalUpcomingRecord: HistoryDrawerRecord = {
  source: 'personal',
  status: 'upcoming',
  chatLabel: '',
  message: {
    ...scheduledMessage,
    id: 'scheduled-personal-1',
    chatName: 'Личное',
    text: 'Подтвердить встречу',
    attachments: [],
  },
};

function renderHistory(records: HistoryDrawerRecord[] = [upcomingRecord], onCancel = vi.fn(), onDelete = vi.fn()) {
  render(
    <HistoryDrawer
      isOpen
      onClose={() => undefined}
      records={records}
      onCancel={onCancel}
      onDelete={onDelete}
    />,
  );
  return { onCancel, onDelete };
}

function searchHistory(query: string) {
  renderHistory();
  fireEvent.change(screen.getByRole('textbox', { name: 'Поиск по истории' }), {
    target: { value: query },
  });
}

function stubDownloads() {
  const blobs: Blob[] = [];
  const filenames: string[] = [];
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

  it('offers text and JSON export options', () => {
    renderHistory();

    fireEvent.click(screen.getByRole('button', { name: 'Экспортировать записи' }));

    expect(screen.getByRole('menuitem', { name: 'Запланированные — текстовый файл (.txt)' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Запланированные — резервная копия (.json)' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Завершённые — текстовый файл (.txt)' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Завершённые — резервная копия (.json)' })).toBeInTheDocument();
  });

  it('exports all upcoming records regardless of active source and status filters', async () => {
    const downloads = stubDownloads();

    try {
      renderHistory([upcomingRecord, personalUpcomingRecord, completedRecord]);
      fireEvent.click(screen.getByRole('button', { name: 'Личное' }));
      fireEvent.click(screen.getByRole('tab', { name: 'Завершённые' }));
      fireEvent.click(screen.getByRole('button', { name: 'Экспортировать записи' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Запланированные — резервная копия (.json)' }));

      expect(downloads.blobs).toHaveLength(1);
      expect(downloads.blobs[0].type).toBe('application/json;charset=utf-8');
      expect(downloads.filenames[0]).toMatch(/\.json$/);
      const payload = JSON.parse(await readBlob(downloads.blobs[0])) as { messages: ScheduledMessage[] };
      expect(payload.messages.map((message) => message.id)).toEqual(['scheduled-studio-1', 'scheduled-personal-1']);
      expect(downloads.anchorClick).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });

  it('exports a readable text file with the full message and attachment names', async () => {
    const downloads = stubDownloads();

    try {
      renderHistory();
      fireEvent.click(screen.getByRole('button', { name: 'Экспортировать записи' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Запланированные — текстовый файл (.txt)' }));

      expect(downloads.blobs[0].type).toBe('text/plain;charset=utf-8');
      expect(downloads.filenames[0]).toMatch(/\.txt$/);
      const text = await readBlob(downloads.blobs[0]);
      expect(text).toContain('Источник: Studio');
      expect(text).toContain('Чат: XMSGi Updates (@xmsgi_updates)');
      expect(text).toContain('Релиз нового набора шаблонов для Telegram-канала');
      expect(text).toContain('brief.pdf');
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });

  it('exports completed records separately in a readable text file', async () => {
    const downloads = stubDownloads();

    try {
      renderHistory([upcomingRecord, completedRecord]);
      fireEvent.click(screen.getByRole('button', { name: 'Экспортировать записи' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Завершённые — текстовый файл (.txt)' }));

      expect(downloads.filenames[0]).toMatch(/xmsgi-completed-.*\.txt$/);
      const text = await readBlob(downloads.blobs[0]);
      expect(text).toContain('XMSGi — Завершённые сообщения');
      expect(text).toContain('Статус: Отправлено');
      expect(text).toContain('Подтвердить встречу');
      expect(text).not.toContain('Релиз нового набора шаблонов');
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });

  it('routes cancel and delete from an upcoming record to their handlers', () => {
    const { onCancel, onDelete } = renderHistory();

    fireEvent.click(screen.getByRole('button', { name: 'Отменить' }));
    fireEvent.click(screen.getByRole('button', { name: 'Удалить: XMSGi Updates' }));

    expect(onCancel).toHaveBeenCalledWith(upcomingRecord);
    expect(onDelete).toHaveBeenCalledWith(upcomingRecord);
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

  it('shows image attachments in the full post view', () => {
    const imageRecord: HistoryDrawerRecord = {
      ...upcomingRecord,
      message: { ...scheduledMessage, attachments: ['C:\\files\\launch-image.png'] },
    };
    renderHistory([imageRecord]);

    fireEvent.click(screen.getByRole('button', { name: 'Открыть публикацию: XMSGi Updates' }));

    expect(screen.getByRole('img', { name: 'launch-image.png' })).toHaveAttribute('src', 'file:///C:/files/launch-image.png');
  });
});