import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Chat, ScheduledMessage } from '@/types';
import { LocaleProvider } from '@/lib/i18n';
import { telegramGetChatHistory } from '@/services/chatAppService';
import {
  SAVED_STUDIO_DRAFTS_UPDATED_EVENT,
  writeWorkspaceDraftStoreFallback,
} from '@studio/lib/draftStore';
import { HistoryDrawer } from './HistoryDrawer';
import { QuickPlannerNavigationContext } from './QuickPlannerNavigationContext';
import { normalizePlannerDraft, normalizeSavedDraft, normalizeSavedPlannerDraft, normalizeScheduledMessages, sortHistoryItems } from './historyModel';

vi.mock('@/services/chatAppService', () => ({
  telegramGetChatHistory: vi.fn(),
}));

const globalStyles = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../index.css'), 'utf8');
const colorThemeStyles = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../styles/colorThemes.css'), 'utf8');

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

const anchoredSentRecord = normalizeScheduledMessages([{
  ...scheduledMessage,
  id: 'anchored-sent-1',
  status: 'sent',
  telegramMessageId: 567,
}], 'workspace', 'sent', [channel])[0];

const personalUpcomingRecord = normalizeScheduledMessages([{
    ...scheduledMessage,
    id: 'scheduled-personal-1',
    chatName: 'Личное',
    text: 'Подтвердить встречу',
    attachments: [],
  }], 'personal', 'upcoming', [])[0];

describe('App-owned history mapping', () => {
  it('normalizes forbidden symbols in scheduled posts and preserves original source data', () => {
    const sourceMessage = {
      ...scheduledMessage,
      text: 'A\u200BB\u00A0C',
      entities: [{ type: 'bold' as const, offset: 2, length: 1 }],
    };
    const [record] = normalizeScheduledMessages([sourceMessage], 'workspace', 'sent', [channel]);

    expect(record.text).toBe('AB C');
    expect(record.entities).toEqual([{ type: 'bold', offset: 1, length: 1 }]);
    expect(record.original.kind === 'scheduled' && record.original.message.text).toBe(sourceMessage.text);
  });

  it('keeps detailed message cards compact in both themes and provides text-size controls', () => {
    window.localStorage.removeItem('xmsgi-history-filters');
    window.localStorage.removeItem('xmsgi-history-text-size');
    const { container } = renderHistoryPage([upcomingRecord]);
    fireEvent.click(container.querySelector('.history-record-open')!);

    const detailBody = container.querySelector('.history-detail-body')!;
    const bubble = container.querySelector('.history-detail-body .history-post-bubble')!;
    const [decrease, increase] = Array.from(container.querySelectorAll<HTMLButtonElement>('.history-detail-font-button'));

    const readingControls = container.querySelector('.history-detail-reading-controls');
    expect(readingControls?.parentElement).toBe(container.querySelector('.history-detail-topline'));
    expect(container.querySelector('.history-detail-meta-line .history-detail-time')).toBeInTheDocument();
    expect(readingControls?.parentElement).not.toBe(detailBody);
    expect(container.querySelector('.history-detail-toolbar .history-detail-font-button')).toBeNull();
    expect(globalStyles).toMatch(/\.history-detail-reading-controls\s*\{[^}]*margin-left:\s*auto;/);
    expect(globalStyles).toMatch(/\.history-detail-reading-controls \.history-detail-font-button\s*\{[^}]*min-width:\s*28px;[^}]*height:\s*22px;/);
    expect(globalStyles).toMatch(/\.history-detail-body\.is-details \.history-post-bubble\s*\{[^}]*width:\s*fit-content;[^}]*max-width:\s*100%;[^}]*margin:\s*0 auto;/);
    expect(globalStyles).toMatch(/html\[data-theme\] \.history-drawer\.is-page \.history-detail-body\.is-details\[data-text-size='small'\] \.history-post-text\s*\{\s*font-size:\s*14px;/);
    expect(globalStyles).toMatch(/html\[data-theme\] \.history-drawer\.is-page \.history-detail-body\.is-details\[data-text-size='large'\] \.history-post-text\s*\{\s*font-size:\s*18px;/);
    expect(bubble).toHaveTextContent('Релиз нового набора шаблонов');
    expect(detailBody).toHaveAttribute('data-text-size', 'default');
    expect(decrease).toBeEnabled();
    expect(increase).toBeEnabled();

    fireEvent.click(decrease);
    expect(detailBody).toHaveAttribute('data-text-size', 'small');
    expect(decrease).toBeDisabled();
    expect(increase).toBeEnabled();

    fireEvent.click(increase);
    expect(detailBody).toHaveAttribute('data-text-size', 'default');
    expect(decrease).toBeEnabled();
    expect(increase).toBeEnabled();

    fireEvent.click(increase);
    expect(detailBody).toHaveAttribute('data-text-size', 'large');
    expect(increase).toBeDisabled();
  });

  it('remembers the selected text size when Posts is reopened', () => {
    window.localStorage.removeItem('xmsgi-history-text-size');
    const firstView = renderHistoryPage([upcomingRecord]);
    fireEvent.click(firstView.container.querySelector('.history-record-open')!);
    fireEvent.click(screen.getByRole('button', { name: 'Increase post text size' }));
    expect(firstView.container.querySelector('.history-detail-body')).toHaveAttribute('data-text-size', 'large');
    firstView.unmount();

    const reopenedView = renderHistoryPage([upcomingRecord]);
    fireEvent.click(reopenedView.container.querySelector('.history-record-open')!);

    expect(reopenedView.container.querySelector('.history-detail-body')).toHaveAttribute('data-text-size', 'large');
  });

  it('renders loaded Markdown templates as formatted post history text', () => {
    const [record] = normalizeScheduledMessages([{
      ...scheduledMessage,
      text: '**ДЕЙСТВУЙ**\n**[Название]**\n[Главный результат]',
    }], 'workspace', 'sent', [channel]);

    expect(record.text).toBe('ДЕЙСТВУЙ\n[Название]\n[Главный результат]');
    expect(record.entities).toEqual([
      { type: 'bold', offset: 0, length: 8 },
      { type: 'bold', offset: 9, length: 10 },
    ]);
  });

  it('preserves attachments in planner draft history so either editor can restore them', () => {
    const record = normalizePlannerDraft(
      'Проверяем откат текста',
      channel,
      '2026-09-29T18:00:00.000Z',
      [{ type: 'bold', offset: 0, length: 9 }],
      ['C:\\files\\photo.png', 'C:\\files\\brief.pdf'],
    );

    expect(record).not.toBeNull();
    expect(record?.text).toBe('Проверяем откат текста');
    expect(record?.attachments).toEqual(['C:\\files\\photo.png', 'C:\\files\\brief.pdf']);
    expect(record?.original).toMatchObject({
      kind: 'planner-draft',
      text: 'Проверяем откат текста',
      attachments: ['C:\\files\\photo.png', 'C:\\files\\brief.pdf'],
    });
  });

});

function renderHistory(
  records = [upcomingRecord],
  onCancel = vi.fn(),
  onDelete = vi.fn(),
  onSendNow = vi.fn(),
  onOpenDraft = vi.fn(),
  onReschedule = vi.fn(),
  onClearSent = vi.fn(),
  onClearDrafts = vi.fn().mockResolvedValue(true),
  onCancelQueue = vi.fn().mockResolvedValue(true),
  onUseDraft = vi.fn(),
  draftDestination: 'planner' | 'studio' = 'studio',
) {
  const onClose = vi.fn();
  const view = render(
    <LocaleProvider>
      <HistoryDrawer
        isOpen
        onClose={onClose}
        records={records}
        onCancel={onCancel}
        onReschedule={onReschedule}
        onSendNow={onSendNow}
        onDelete={onDelete}
        onOpenDraft={onOpenDraft}
        onUseDraft={onUseDraft}
        draftDestination={draftDestination}
        onClearSent={onClearSent}
        onClearDrafts={onClearDrafts}
        onCancelQueue={onCancelQueue}
      />
    </LocaleProvider>,
  );
  return { ...view, onClose, onCancel, onDelete, onSendNow, onOpenDraft, onUseDraft, onReschedule, onClearSent, onClearDrafts, onCancelQueue };
}

function renderHistoryPage(records = [upcomingRecord], onUseDraft = vi.fn()) {
  const onClose = vi.fn();
  const onOpenDraft = vi.fn();
  const view = render(
    <LocaleProvider>
      <HistoryDrawer
        isOpen
        pageMode
        onClose={onClose}
        records={records}
        onCancel={vi.fn()}
        onReschedule={vi.fn()}
        onSendNow={vi.fn()}
        onDelete={vi.fn()}
        onOpenDraft={onOpenDraft}
        onUseDraft={onUseDraft}
        onClearSent={vi.fn()}
        onCancelQueue={vi.fn()}
      />
    </LocaleProvider>,
  );
  return { ...view, onClose, onOpenDraft, onUseDraft };
}

function searchHistory(query: string) {
  renderHistory();
  fireEvent.change(screen.getByRole('textbox', { name: 'Поиск по истории' }), {
    target: { value: query },
  });
}

function selectHistorySource(label: string) {
  const filter = label === 'Studio'
    ? 'workspace'
    : label === 'Planner'
      ? 'personal'
      : 'all';
  const sourceMenuButton = document.querySelector<HTMLButtonElement>('.history-source-select');
  if (sourceMenuButton) {
    fireEvent.click(sourceMenuButton);
    fireEvent.click(document.querySelector(`.history-source-menu [data-history-filter="${filter}"]`)!);
    return;
  }

  fireEvent.click(document.querySelector(`.history-source-filters [data-history-filter="${filter}"]`)!);
}

function openSourceMenu() {
  fireEvent.click(document.querySelector('.history-source-select')!);
  const menu = document.querySelector<HTMLElement>('.history-source-menu')!;
  return { ...within(menu), container: menu };
}

function selectHistoryErrors() {
  const drawerErrorFilter = document.querySelector<HTMLButtonElement>('.history-source-filters [data-history-filter="errors"]');
  if (drawerErrorFilter) {
    fireEvent.click(drawerErrorFilter);
    return;
  }

  const sourceMenuButton = document.querySelector<HTMLButtonElement>('.history-source-select')!;
  fireEvent.click(sourceMenuButton);
  fireEvent.click(within(document.querySelector('.history-source-menu')!).getByRole('menuitemradio', { name: 'Ошибки' }));
}

describe('history drawer transient menus', () => {
  it('closes export menus when the drawer closes', () => {
    const renderDrawer = (isOpen: boolean) => (
      <LocaleProvider>
        <HistoryDrawer
          isOpen={isOpen}
          onClose={vi.fn()}
          records={[upcomingRecord]}
          onCancel={vi.fn()}
          onReschedule={vi.fn()}
          onSendNow={vi.fn()}
          onDelete={vi.fn()}
          onOpenDraft={vi.fn()}
          onClearSent={vi.fn()}
          onClearDrafts={vi.fn().mockResolvedValue(true)}
          onCancelQueue={vi.fn().mockResolvedValue(true)}
        />
      </LocaleProvider>
    );
    const view = render(renderDrawer(true));
    const exportButton = screen.getByRole('button', { name: 'Export current category' });

    fireEvent.click(exportButton);
    expect(view.container.querySelector('.history-export-menu')).toBeInTheDocument();

    view.rerender(renderDrawer(false));
    view.rerender(renderDrawer(true));

    expect(view.container.querySelector('.history-export-menu')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export current category' })).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('Posts page split view', () => {
  beforeEach(() => {
    window.localStorage.removeItem('xmsgi-history-filters');
  });

  it('renders a text-only page title and one close control on the Posts page', () => {
    const { container } = renderHistoryPage([upcomingRecord]);
    const styles = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../index.css'), 'utf8');

    expect(screen.getByRole('heading', { name: 'Posts' })).toBeInTheDocument();
    expect(container.querySelector('.history-drawer-header-icon')).not.toBeInTheDocument();
    expect(container.querySelectorAll('.history-drawer-close')).toHaveLength(1);
    expect(container.querySelector('.history-drawer-controls')).toBeNull();
    expect(container.querySelector('.history-page-controls-close')).toBeNull();
    expect(styles).toMatch(
      /\.history-drawer-header\.is-page-header\s*\{[^}]*box-sizing:\s*border-box;[^}]*flex:\s*0 0 52px;[^}]*height:\s*52px;[^}]*min-height:\s*52px;/,
    );
    expect(styles).toMatch(/\.topbar\s*\{[^}]*flex:\s*0 0 var\(--app-topbar-height\);[^}]*height:\s*var\(--app-topbar-height\);/);
  });

  it('keeps the default selected post header compact on wide layouts', () => {
    const { container } = renderHistoryPage([upcomingRecord]);
    fireEvent.click(container.querySelector('.history-record-open')!);

    const detailHeader = container.querySelector('.history-detail-header')!;
    expect(detailHeader.querySelector('.history-detail-topline h2')).toHaveTextContent(upcomingRecord.title);
    expect(detailHeader.querySelector('.history-detail-topline .history-detail-category')).toBeInTheDocument();
    expect(detailHeader.querySelector('.history-detail-topline .history-detail-status')).toBeInTheDocument();
    expect(detailHeader.querySelector('.history-detail-topline time')).toBeInTheDocument();
    expect(detailHeader.querySelector('.history-detail-topline .history-detail-meta')).toBeInTheDocument();

    expect(globalStyles).toMatch(
      /\.history-detail-topline\s*\{[^}]*gap:\s*14px;[^}]*min-width:\s*0;/,
    );
    expect(globalStyles).toMatch(
      /\.history-detail-header h2\s*\{[^}]*font-size:\s*22px;[^}]*font-weight:\s*680;[^}]*letter-spacing:\s*-0\.035em;[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/,
    );
    expect(globalStyles).toMatch(
      /@media \(max-width:\s*1120px\)\s*\{\s*\.history-drawer\.is-page \.history-detail-topline\s*\{[^}]*grid-template-areas:\s*"title meta"\s*"heading controls";/,
    );
  });

  it('keeps search no-results feedback in the left list only', () => {
    const { container } = renderHistoryPage([upcomingRecord]);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search history' }), {
      target: { value: 'no matching post' },
    });

    expect(container.querySelector('.history-empty strong')).toHaveTextContent('No results found');
    expect(container.querySelector('.history-detail-panel h2')).toHaveTextContent('Select a post');
    expect(container.querySelector('.history-detail-panel')).not.toHaveTextContent('No results found');
    expect(container.querySelector('.history-detail-panel')).not.toHaveTextContent('Sent');
  });

  it('keeps the detail pane empty when search and the selected category have no posts', () => {
    const { container } = renderHistoryPage([upcomingRecord]);
    fireEvent.click(container.querySelector('[data-history-filter="sent"]')!);
    const search = screen.getByRole('textbox', { name: 'Search history' });

    fireEvent.change(search, { target: { value: 'no matching post' } });
    expect(container.querySelector('.history-empty strong')).toHaveTextContent('No results found');
    expect(container.querySelector('.history-detail-empty h2')).toHaveTextContent('Nothing to review yet');

    fireEvent.change(search, { target: { value: 'шаблонов' } });
    expect(container.querySelector('.history-record-open')).toBeInTheDocument();
    expect(container.querySelector('.history-detail-empty h2')).toHaveTextContent('Select a post');
  });

  it('uses a subtle neutral gray for the full dark Posts detail panel', () => {
    expect(colorThemeStyles).toMatch(/html\[data-theme='dark'\] \.history-drawer\.is-page \.history-detail-panel\s*\{[^}]*border-color:\s*var\(--line\);[^}]*background:\s*var\(--surface-raised\);/);
  });

  it('uses the shared raised surface for dark Posts date bars and detail panels', () => {
    expect(colorThemeStyles).toMatch(/html\[data-theme='dark'\] \.history-drawer\.is-page \.history-content\.is-page \.history-date-heading,[\s\S]*?background:\s*var\(--surface-raised\);/);
    expect(colorThemeStyles).toMatch(/html\[data-theme='dark'\] \.history-drawer\.is-page \.history-detail-panel\s*\{[^}]*background:\s*var\(--surface-raised\);/);
  });

  it('highlights the selected Posts status consistently with a subtle accent capsule', () => {
    expect(colorThemeStyles).toMatch(/html\[data-theme='light'\] \.history-drawer\.is-page \.history-list-status-section \.history-status-tab\.is-active,\s*html\[data-theme='light'\] \.history-drawer\.is-page \.history-list-status-section \.history-status-tab\.is-active:hover,\s*html\[data-theme='light'\] \.history-drawer\.is-page \.history-list-status-section \.history-status-tab\.is-active:focus-visible\s*\{\s*border-color:\s*rgba\(40, 125, 163, 0\.24\);\s*background:\s*rgba\(40, 125, 163, 0\.08\);\s*color:\s*#287da3;\s*box-shadow:\s*none;/);
    expect(colorThemeStyles).toMatch(/html\[data-theme='dark'\] \.history-drawer\.is-page \.history-list-status-section \.history-status-tab\.is-active,\s*html\[data-theme='dark'\] \.history-drawer\.is-page \.history-list-status-section \.history-status-tab\.is-active:hover,\s*html\[data-theme='dark'\] \.history-drawer\.is-page \.history-list-status-section \.history-status-tab\.is-active:focus-visible\s*\{\s*border-color:\s*rgba\(220, 226, 230, 0\.24\);\s*background:\s*rgba\(220, 226, 230, 0\.12\);\s*color:\s*var\(--accent\);\s*box-shadow:\s*none;/);
    expect(colorThemeStyles).toMatch(/html\[data-theme='light'\] \.history-drawer\.is-page \.history-list-status-section \.history-status-tab,\s*html\[data-theme='light'\] \.history-drawer\.is-page \.history-list-status-section \.history-status-tab:hover,\s*html\[data-theme='light'\] \.history-drawer\.is-page \.history-list-status-section \.history-status-tab:focus-visible\s*\{\s*border-color:\s*transparent;\s*outline:\s*none;\s*box-shadow:\s*none;/);
  });

  it('keeps the light category header aligned with the light Posts detail header', () => {
    expect(colorThemeStyles).toMatch(/html\[data-theme='light'\] \.history-drawer\.is-page \.history-detail-header\s*\{[^}]*background:\s*#fbfcfd;/);
    expect(colorThemeStyles).toMatch(/html\[data-theme='light'\] \.history-drawer\.is-page \.history-list-status-section\s*\{[^}]*background:\s*#fbfcfd;/);
  });

  it('keeps a soft highlight in the middle of the dark Posts category header gradient', () => {
    expect(colorThemeStyles).toMatch(
      /html\[data-theme='dark'\] \.history-drawer\.is-page \.history-list-status-section\s*\{[^}]*background-color:\s*#191f23;[^}]*background-image:\s*linear-gradient\(110deg,\s*rgba\(55,\s*96,\s*112,\s*0\.26\),\s*rgba\(67,\s*107,\s*121,\s*0\.2\)\s*52%,\s*rgba\(18,\s*25,\s*32,\s*0\)\s*94%\);/,
    );
  });

  it('uses the same compact Posts header layout in both themes', () => {
    expect(colorThemeStyles).not.toMatch(/html\[data-theme='dark'\] \.history-drawer\.is-page \.history-detail-header\s*\{[^}]*min-height:\s*82px;/);
    expect(colorThemeStyles).not.toMatch(/html\[data-theme='light'\] \.history-drawer\.is-page \.history-detail-header\s*\{[^}]*min-height:\s*82px;/);
    expect(globalStyles).toMatch(/@media \(min-width:\s*1121px\)\s*\{\s*\.history-drawer\.is-page \.history-detail-header\s*\{[^}]*min-height:\s*65px;/);
    expect(globalStyles).toMatch(/\.history-drawer\.is-page \.history-detail-topline\s*\{[^}]*grid-template-areas:\s*"title meta"\s*"heading controls";/);
    expect(globalStyles).toMatch(/\.history-drawer\.is-page \.history-detail-heading\s*\{[^}]*grid-area:\s*heading;[^}]*width:\s*100%;/);
    expect(globalStyles).toMatch(/\.history-detail-reading-controls \.history-detail-font-button\s*\{[^}]*min-width:\s*28px;[^}]*height:\s*22px;/);
    expect(colorThemeStyles).toMatch(/html\[data-theme='dark'\] \.history-drawer\.is-page \.history-detail-body\.is-details \.history-post-bubble\s*\{\s*width:\s*fit-content;\s*max-width:\s*100%;/);
  });

  it('keeps the light Posts header compact with category pills under the title and controls under the date', () => {
    expect(colorThemeStyles).not.toMatch(/html\[data-theme='light'\] \.history-drawer\.is-page \.history-detail-header\s*\{[^}]*min-height:\s*82px;/);
    expect(globalStyles).toMatch(/@media \(min-width:\s*1121px\)\s*\{\s*\.history-drawer\.is-page \.history-detail-header\s*\{[^}]*min-height:\s*65px;/);
    expect(globalStyles).toMatch(/\.history-detail-reading-controls\s*\{[^}]*margin-left:\s*auto;/);
  });

  it('uses a graphite scrollbar thumb for the dark Posts text panel', () => {
    expect(colorThemeStyles).toMatch(/html\[data-theme='dark'\] \.history-drawer\.is-page \.history-detail-body\s*\{\s*scrollbar-color:\s*#59636b #191f23;\s*scrollbar-width:\s*thin;/);
    expect(colorThemeStyles).toMatch(/html\[data-theme='dark'\] \.history-drawer\.is-page \.history-detail-body::-webkit-scrollbar-track\s*\{\s*background:\s*#191f23;/);
    expect(colorThemeStyles).toMatch(/html\[data-theme='dark'\] \.history-drawer\.is-page \.history-detail-body::-webkit-scrollbar-thumb\s*\{\s*border:\s*2px solid #191f23;\s*background:\s*#59636b;\s*background-clip:\s*padding-box;/);
  });

  it('uses the search focus outline color for the dark Posts empty-state logo', () => {
    expect(colorThemeStyles).toMatch(/html\[data-theme='dark'\] \.history-drawer\.is-page \.history-detail-empty-art-icon\s*\{\s*border-color:\s*rgba\(154, 168, 184, 0\.62\);\s*color:\s*#eef1f5;\s*filter:\s*drop-shadow\(0 0 6px rgba\(35, 157, 251, 0\.2\)\);\s*box-shadow:\s*0 0 14px rgba\(35, 157, 251, 0\.1\);/);
    expect(colorThemeStyles).toMatch(/html\[data-theme='dark'\] \.history-drawer\.is-page \.history-detail-empty-art-spark\s*\{\s*border-color:\s*rgba\(154, 168, 184, 0\.62\);\s*box-shadow:\s*0 0 8px rgba\(154, 168, 184, 0\.18\);/);
  });

  it('uses more visible gray empty-state orbits without glow in the dark theme', () => {
    expect(colorThemeStyles).toMatch(/html\[data-theme='dark'\] \.history-drawer\.is-page \.history-detail-empty-art-orbit\s*\{\s*border-color:\s*rgba\(238, 241, 245, 0\.68\);\s*box-shadow:\s*none;/);
    expect(colorThemeStyles).toMatch(/html\[data-theme='dark'\] \.history-drawer\.is-page \.history-detail-empty-art-orbit--inner\s*\{\s*border-color:\s*rgba\(238, 241, 245, 0\.76\);\s*box-shadow:\s*none;/);
  });

  it('matches both dark Posts empty-state logos with a subtle blue glow', () => {
    expect(colorThemeStyles).toMatch(/html\[data-theme='dark'\] \.history-drawer\.is-page \.history-empty-art-orbit\s*\{\s*border-color:\s*rgba\(238, 241, 245, 0\.68\);\s*box-shadow:\s*none;/);
    expect(colorThemeStyles).toMatch(/html\[data-theme='dark'\] \.history-drawer\.is-page \.history-empty-art-orbit--inner\s*\{\s*border-color:\s*rgba\(238, 241, 245, 0\.76\);\s*box-shadow:\s*none;/);
    expect(colorThemeStyles).toMatch(/html\[data-theme='dark'\] \.history-drawer\.is-page \.history-empty-art-icon\s*\{\s*border-color:\s*rgba\(154, 168, 184, 0\.62\);\s*color:\s*#eef1f5;\s*filter:\s*drop-shadow\(0 0 6px rgba\(35, 157, 251, 0\.2\)\);\s*box-shadow:\s*0 0 14px rgba\(35, 157, 251, 0\.1\);/);
    expect(colorThemeStyles).toMatch(/html\[data-theme='dark'\] \.history-drawer\.is-page \.history-empty-art-spark\s*\{\s*border-color:\s*rgba\(154, 168, 184, 0\.62\);\s*box-shadow:\s*0 0 8px rgba\(154, 168, 184, 0\.18\);/);
    expect(colorThemeStyles).toMatch(/html\[data-theme='dark'\] \.history-drawer\.is-page \.history-detail-empty-art-icon\s*\{\s*border-color:\s*rgba\(154, 168, 184, 0\.62\);\s*color:\s*#eef1f5;\s*filter:\s*drop-shadow\(0 0 6px rgba\(35, 157, 251, 0\.2\)\);\s*box-shadow:\s*0 0 14px rgba\(35, 157, 251, 0\.1\);/);
  });

  it('uses the original gradient and shadow for the dark Posts message card', () => {
    expect(colorThemeStyles).toMatch(/html\[data-theme='dark'\] \.history-drawer\.is-page \.history-detail-body \.history-post-bubble\s*\{[^}]*border-color:\s*rgba\(126, 169, 191, 0\.3\);[^}]*background:\s*linear-gradient\(145deg,\s*rgba\(39, 61, 73, 0\.94\),\s*rgba\(23, 36, 47, 0\.98\)\);[^}]*box-shadow:\s*inset 0 1px 0 rgba\(224, 240, 248, 0\.06\), 0 8px 22px rgba\(0, 0, 0, 0\.14\);/);
  });

  it('clearly marks the selected Posts record in both themes', () => {
    expect(globalStyles).toMatch(/\.history-drawer\.is-page \.history-content\.is-page \.history-record\.is-selected\s*\{\s*border-color:\s*transparent;[\s\S]*?border-bottom-color:[^;]+;[\s\S]*?background:\s*linear-gradient/);
    expect(globalStyles).toMatch(/\.history-content\.is-page \.history-list-pane \.history-record-list\s*\{\s*padding-right:\s*0;\s*padding-left:\s*0;\s*scrollbar-gutter:\s*auto;\s*scrollbar-width:\s*none;/);
    expect(globalStyles).toMatch(/\.history-drawer\.is-page \.history-content\.is-page \.history-record,\s*\.history-drawer\.is-page \.history-content\.is-page \.history-record\.is-draft\[data-draft-color\]\s*\{\s*padding:\s*3px 23px 3px 8px;/);
    expect(colorThemeStyles).toMatch(/html\[data-theme='dark'\] \.history-drawer\.is-page \.history-content\.is-page \.history-record\.is-selected,[\s\S]*?border-color:\s*transparent;[\s\S]*?border-right-color:\s*rgba\(170, 184, 194, 0\.3\);[\s\S]*?border-left-color:\s*rgba\(170, 184, 194, 0\.3\);/);
    expect(colorThemeStyles).toMatch(/html\[data-theme='dark'\] \.history-drawer\.is-page \.history-content\.is-page \.history-record\.is-selected,\s*html\[data-theme='dark'\] \.history-drawer\.is-page \.history-content\.is-page \.history-record\.is-selected:hover,\s*html\[data-theme='dark'\] \.history-drawer\.is-page \.history-content\.is-page \.history-record\.is-selected:focus-within,[\s\S]*?background:\s*linear-gradient\(90deg, rgba\(154, 168, 184, 0\.16\), rgba\(154, 168, 184, 0\.045\) 88%, transparent\);[\s\S]*?box-shadow:\s*inset 0 0 0 1px rgba\(170, 184, 194, 0\.1\);/);
    expect(colorThemeStyles).toMatch(/html\[data-theme='dark'\] \.history-drawer\.is-page \.history-content\.is-page \.history-record\.is-selected::before\s*\{[^}]*width:\s*3px;[^}]*background:\s*#aab8c2;[^}]*opacity:\s*1;/);
    expect(colorThemeStyles).toMatch(/html\[data-theme='light'\] \.history-drawer\.is-page \.history-content\.is-page \.history-record\.is-selected,\s*html\[data-theme='light'\] \.history-drawer\.is-page \.history-content\.is-page \.history-record\.is-selected:hover,\s*html\[data-theme='light'\] \.history-drawer\.is-page \.history-content\.is-page \.history-record\.is-selected:focus-within,[\s\S]*?background:\s*linear-gradient\(90deg, rgba\(71, 124, 158, 0\.12\), rgba\(71, 124, 158, 0\.035\) 88%, transparent\);[\s\S]*?box-shadow:\s*inset 0 0 0 1px rgba\(71, 124, 158, 0\.1\);/);
    expect(colorThemeStyles).toMatch(/html\[data-theme='light'\] \.history-drawer\.is-page \.history-content\.is-page \.history-record\.is-selected,[\s\S]*?border-color:\s*transparent;[\s\S]*?border-right-color:\s*rgba\(71, 124, 158, 0\.32\);[\s\S]*?border-left-color:\s*rgba\(71, 124, 158, 0\.32\);/);
    expect(colorThemeStyles).toMatch(/html\[data-theme='light'\] \.history-drawer\.is-page \.history-content\.is-page \.history-record\.is-selected::before\s*\{[^}]*width:\s*3px;[^}]*background:\s*#477c9e;[^}]*opacity:\s*1;/);
  });

  it('does not apply hover gradients to Posts rows in either theme', () => {
    expect(globalStyles).toMatch(/\.history-drawer\.is-page \.history-content\.is-page \.history-record:hover,\s*\.history-drawer\.is-page \.history-content\.is-page \.history-record:focus-within\s*\{[^}]*background:\s*transparent;/);
    expect(colorThemeStyles).toMatch(/html\[data-theme='light'\] \.history-drawer\.is-page \.history-content\.is-page \.history-record:hover,\s*html\[data-theme='light'\] \.history-drawer\.is-page \.history-content\.is-page \.history-record:focus-within\s*\{[^}]*background:\s*transparent;/);
  });

  it('enlarges the selected dark category label without shifting tab widths', () => {
    expect(colorThemeStyles).toMatch(/html\[data-theme='dark'\] \.history-drawer\.is-page \.history-list-status-section \.history-status-tab\.is-active\s*\{\s*border-color:\s*transparent;\s*background:\s*transparent;\s*color:\s*var\(--accent\);\s*box-shadow:\s*none;/);
    expect(colorThemeStyles).toMatch(/html\[data-theme='dark'\] \.history-drawer\.is-page \.history-list-status-section \.history-status-tab\s*\{\s*font-size:\s*13px;\s*font-weight:\s*700;/);
    expect(colorThemeStyles).toMatch(/html\[data-theme='dark'\] \.history-drawer\.is-page \.history-list-status-section \.history-status-label,\s*html\[data-theme='dark'\] \.history-drawer\.is-page \.history-list-status-section \.history-status-label-compact\s*\{\s*display:\s*inline-block;\s*transform:\s*scale\(0\.92\);/);
    expect(colorThemeStyles).toMatch(/html\[data-theme='dark'\] \.history-drawer\.is-page \.history-list-status-section \.history-status-label-compact\s*\{\s*display:\s*none;/);
    expect(colorThemeStyles).toMatch(/@media \(max-width:\s*760px\)\s*\{\s*html\[data-theme='dark'\] \.history-drawer\.is-page \.history-list-status-section \.history-status-label\s*\{\s*display:\s*none;/);
    expect(colorThemeStyles).toMatch(/html\[data-theme='dark'\] \.history-drawer\.is-page \.history-list-status-section \.history-status-label-compact\s*\{\s*display:\s*inline-block;/);
    expect(colorThemeStyles).toMatch(/html\[data-theme='dark'\] \.history-drawer\.is-page \.history-list-status-section \.history-status-tab\.is-active \.history-status-label,\s*html\[data-theme='dark'\] \.history-drawer\.is-page \.history-list-status-section \.history-status-tab\.is-active \.history-status-label-compact\s*\{\s*transform:\s*scale\(1\);/);
    expect(colorThemeStyles).toMatch(/html\[data-theme='dark'\] \.history-drawer\.is-page \.history-list-status-section \.history-status-tab\.is-active:hover,\s*html\[data-theme='dark'\] \.history-drawer\.is-page \.history-list-status-section \.history-status-tab\.is-active:focus-visible\s*\{\s*border-color:\s*transparent;\s*background-color:\s*transparent;\s*color:\s*var\(--accent\);\s*box-shadow:\s*none;/);
    expect(colorThemeStyles).toMatch(/html\[data-theme='dark'\] \.history-drawer\.is-page \.history-list-status-section \.history-status-tab\.is-active \.history-filter-count\s*\{\s*border-color:\s*rgba\(35, 157, 251, 0\.24\);\s*background:\s*rgba\(35, 157, 251, 0\.12\);\s*color:\s*#a9ddff;/);
  });

  it('removes the dark backing panel behind category tabs', () => {
    expect(colorThemeStyles).toMatch(
      /html\[data-theme='dark'\] \.history-drawer\.is-page \.history-list-status-section \.history-status-filters\s*\{\s*border-color:\s*transparent;\s*background:\s*transparent;\s*box-shadow:\s*none;/,
    );
  });

  it('uses the category accent for the selected dark source filter', () => {
    expect(colorThemeStyles).toMatch(
      /html\[data-theme='dark'\] \.history-drawer\.is-page \.history-list-source-row \.history-source-select > span:first-child,[\s\S]*?html\[data-theme='dark'\] \.history-drawer\.is-page \.history-list-source-row \.history-source-select\[aria-expanded='true'\] > span:first-child\s*\{\s*color:\s*var\(--accent\);/,
    );
    expect(colorThemeStyles).toMatch(
      /html\[data-theme='dark'\] \.history-source-menu \.history-source-option\[aria-checked='true'\]\s*\{\s*color:\s*var\(--accent\);/,
    );
    expect(colorThemeStyles).toMatch(
      /html\[data-theme='dark'\] \.history-source-menu \.history-source-option\[aria-checked='true'\] \.history-filter-count\s*\{\s*border-color:\s*rgba\(35, 157, 251, 0\.24\);\s*background:\s*rgba\(35, 157, 251, 0\.12\);\s*color:\s*#a9ddff;/,
    );
  });

  it('uses the selected category accent for the light source selector', () => {
    expect(colorThemeStyles).toMatch(
      /html\[data-theme='light'\] \.history-drawer\.is-page \.history-list-source-row \.history-source-select > span:first-child,[\s\S]*?html\[data-theme='light'\] \.history-source-menu \.history-source-option\[aria-checked='true'\]\s*\{\s*color:\s*#287da3;\s*font-weight:\s*700;/,
    );
  });

  it('keeps scrolling date and month separators white in the light theme', () => {
    expect(colorThemeStyles).toMatch(
      /html\[data-theme='light'\] \.history-drawer\.is-page \.history-date-heading,\s*html\[data-theme='light'\] \.history-drawer\.is-page \.history-date-sticky,\s*html\[data-theme='light'\] \.history-drawer\.is-page \.history-month-heading,\s*html\[data-theme='light'\] \.history-drawer\.is-page \.history-date-heading::before\s*\{\s*border-bottom-color:\s*#dce5e9;\s*background:\s*#ffffff;/,
    );
  });

  it('rebuilds mode tabs without shadows, filters, or decorative pseudo-elements', () => {
    const finalTabStyles = colorThemeStyles.slice(colorThemeStyles.lastIndexOf('html[data-theme] .history-drawer.is-page .history-list-status-section .history-status-filters'));
    expect(finalTabStyles).toMatch(/\.history-status-filters,[\s\S]*?\.history-status-tab \.history-filter-count\s*\{\s*box-shadow:\s*none;\s*filter:\s*none;\s*-webkit-filter:\s*none;/);
    expect(finalTabStyles).toMatch(/\.history-status-tab::before,[\s\S]*?\.history-status-tab::after\s*\{\s*display:\s*none;/);
    expect(finalTabStyles).toMatch(/html\[data-theme='dark'\][\s\S]*?\.history-status-tab\.is-active\s*\{\s*border-color:\s*transparent;\s*background:\s*transparent;/);
  });

  it('makes Posts section tabs slightly larger', () => {
    expect(colorThemeStyles).toMatch(
      /html\[data-theme\] \.history-drawer\.is-page \.history-list-status-section \.history-status-tab\s*\{\s*min-height:\s*38px;\s*padding-right:\s*11px;\s*padding-left:\s*11px;/,
    );
  });

  it('keeps Posts mode tabs free of shadows while highlighting the dark selection minimally', () => {
    const finalTabStyles = colorThemeStyles.slice(colorThemeStyles.lastIndexOf('html[data-theme] .history-drawer.is-page .history-list-status-section .history-status-filters'));
    expect(finalTabStyles).toMatch(/html\[data-theme='dark'\][\s\S]*?\.history-status-tab\.is-active\s*\{\s*border-color:\s*transparent;/);
    expect(finalTabStyles).toMatch(/html\[data-theme='light'\][\s\S]*?\.history-status-tab\.is-active:focus-visible\s*\{\s*border-color:\s*rgba\(103, 125, 139, 0\.2\);/);
    expect(finalTabStyles).toMatch(/box-shadow:\s*none;/);
  });

  it('anchors the empty-state logo independently from changing detail text', () => {
    expect(globalStyles).toMatch(/\.history-drawer\.is-page \.history-detail-empty\s*\{[^}]*display:\s*block;[^}]*position:\s*absolute;[^}]*inset:\s*0;/);
    expect(globalStyles).toMatch(/\.history-drawer\.is-page \.history-detail-empty-art\s*\{[^}]*position:\s*absolute;[^}]*top:\s*calc\(50% - 105px\);[^}]*left:\s*50%;/);
    expect(globalStyles).toMatch(/\.history-drawer\.is-page \.history-detail-empty h2\s*\{[^}]*top:\s*calc\(50% \+ 58px\);/);
    expect(globalStyles).toMatch(/\.history-drawer\.is-page \.history-detail-empty p\s*\{[^}]*top:\s*calc\(50% \+ 86px\);/);
  });

  it('closes the standalone Posts page when Escape is pressed', () => {
    const { container, onClose } = renderHistoryPage([upcomingRecord]);
    fireEvent.click(container.querySelector('.history-record-open')!);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  describe('Posts preview modes', () => {
    beforeEach(() => {
      vi.mocked(telegramGetChatHistory).mockReset();
    });

    it('shows plain text until Preview is explicitly opened', () => {
      const draft = normalizePlannerDraft(
        'Bold line\nsecond line',
        null,
        '2026-09-29T17:30:00.000Z',
        [{ type: 'bold', offset: 0, length: 4 }],
      );
      expect(draft).not.toBeNull();
      const { container } = renderHistoryPage([draft!]);
      fireEvent.click(container.querySelector('.history-record-open')!);

      expect(container.querySelector('.history-detail-body')).toHaveClass('is-details');
      expect(container.querySelector('.history-detail-plain-post')).toBeInTheDocument();
      expect(container.querySelector('.history-post-text')?.textContent).toBe('Bold line\nsecond line');
      expect(container.querySelector('.history-post-text strong')).toBeNull();
      expect(container.querySelector('.history-detail-preview-label')).toBeNull();
      expect(telegramGetChatHistory).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
      expect(telegramGetChatHistory).not.toHaveBeenCalled();
      expect(container.querySelector('.history-detail-body')).toHaveClass('is-preview');
      expect(container.querySelector('.history-post-text strong')).toHaveTextContent('Bold');
      expect(container.querySelector('.history-detail-header')).toHaveClass('is-preview-open');
      expect(container.querySelector('.history-detail-preview-label')).toBeNull();
      expect(container.querySelector('.history-detail-preview-badge')).toHaveTextContent('Preview');
      expect(container.querySelector('.history-detail-preview-badge svg')).toHaveAttribute('aria-hidden', 'true');
      expect(container.querySelector('.history-detail-topline h2')?.nextElementSibling)
        .toBe(container.querySelector('.history-detail-preview-badge'));
      expect(container.querySelector('.history-detail-header')?.nextElementSibling)
        .toBe(container.querySelector('.history-detail-body'));
      expect(container.querySelector('.history-detail-actions')).toHaveClass('is-preview-open');
      expect(globalStyles).toMatch(/\.history-detail-header\.is-preview-open\s*\{\s*border-bottom:\s*0;/);
      expect(globalStyles).toMatch(/\.history-drawer\.is-page \.history-detail-actions\.is-preview-open\s*\{\s*border-top:\s*0;/);
      expect(globalStyles).toMatch(
        /@media \(min-width:\s*1121px\)\s*\{\s*\.history-drawer\.is-page \.history-detail-header\s*\{[^}]*min-height:\s*65px;[^}]*justify-content:\s*center;/,
      );
      expect(container.querySelector('.history-detail-preview-current')).toBeInTheDocument();
      expect(container.querySelector('.history-detail-preview-current .history-post-bubble'))
        .toHaveTextContent('Bold line');
      expect(container.querySelector('.history-detail-preview-current .history-post-text br'))
        .toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
      expect(container.querySelector('.history-detail-body')).toHaveClass('is-details');
      expect(container.querySelector('.history-detail-plain-post')).toBeInTheDocument();
      expect(container.querySelector('.history-post-text strong')).toBeNull();
      expect(container.querySelector('.history-detail-preview-label')).toBeNull();
      expect(container.querySelector('.history-detail-preview-badge')).toBeNull();
      expect(screen.getByRole('button', { name: 'Preview' })).toHaveAttribute('aria-pressed', 'false');
    });

    it('opens the post preview without chat history or an empty spacer above the post', () => {
      const { container } = renderHistoryPage([anchoredSentRecord]);
      fireEvent.click(container.querySelector('.history-record-open')!);
      const detailBody = container.querySelector('.history-detail-body') as HTMLDivElement;

      fireEvent.click(screen.getByRole('button', { name: 'Preview' }));

      expect(detailBody).toHaveClass('is-preview');
      expect(telegramGetChatHistory).not.toHaveBeenCalled();
      expect(detailBody.scrollTop).toBe(0);
      expect(container.querySelector('.history-chat-preview')).not.toBeInTheDocument();
      expect(container.querySelector('.history-detail-preview-spacer')).not.toBeInTheDocument();
      expect(container.querySelector('.history-detail-preview-label')).not.toBeInTheDocument();
      expect(container.querySelector('.history-detail-reading-controls')?.parentElement)
        .toBe(container.querySelector('.history-detail-topline'));
      expect(container.querySelector('.history-detail-reading-controls')).toBeVisible();
      expect(container.querySelector('.history-detail-preview-badge')).toHaveTextContent('Preview');
      expect(container.querySelector('.history-detail-preview-badge svg')).toHaveAttribute('aria-hidden', 'true');
      expect(container.querySelector('.history-detail-preview-badge')?.compareDocumentPosition(
        container.querySelector('.history-detail-heading')!,
      )).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
      expect(container.querySelector('.history-detail-preview-current .history-post-bubble'))
        .toHaveTextContent('Релиз нового набора шаблонов для Telegram-канала');

      const [decrease, increase] = Array.from(container.querySelectorAll<HTMLButtonElement>('.history-detail-font-button'));
      fireEvent.click(increase);
      expect(detailBody).toHaveAttribute('data-text-size', 'large');
      expect(increase).toBeDisabled();
      fireEvent.click(decrease);
      expect(detailBody).toHaveAttribute('data-text-size', 'default');
    });

    it('keeps draft previews independent from selected chat history', () => {
      const draft = normalizeSavedDraft({
        id: 'draft-with-chat',
        name: 'Draft with selected chat',
        body: 'Saved Studio draft post',
        selectedChat: channel,
        attachments: [],
        createdAt: '2026-09-29T16:00:00.000Z',
        updatedAt: '2026-09-29T16:30:00.000Z',
      });
      const { container } = renderHistoryPage([draft]);
      fireEvent.click(container.querySelector('.history-record-open')!);
      fireEvent.click(screen.getByRole('button', { name: 'Preview' }));

      expect(telegramGetChatHistory).not.toHaveBeenCalled();
      expect(container.querySelector('.history-detail-body')).toHaveClass('is-preview');
      expect(container.querySelector('.history-detail-preview-current .history-post-bubble'))
        .toHaveTextContent('Saved Studio draft post');
    });

    it('keeps saved and active Planner draft previews free of chat history', () => {
      const savedDraft = normalizeSavedPlannerDraft({
        id: 'planner-draft-with-chat',
        message: 'Saved Planner draft post',
        attachments: [],
        entities: [],
        selectedChat: channel,
        reminderType: null,
        savedAt: '2026-09-29T16:30:00.000Z',
      });
      const savedView = renderHistoryPage([savedDraft]);
      fireEvent.click(savedView.container.querySelector('.history-record-open')!);
      fireEvent.click(screen.getByRole('button', { name: 'Preview' }));

      expect(telegramGetChatHistory).not.toHaveBeenCalled();
      expect(savedView.container.querySelector('.history-detail-preview-current .history-post-bubble'))
        .toHaveTextContent('Saved Planner draft post');
      savedView.unmount();

      const activeDraft = normalizePlannerDraft('Active Planner draft post', channel, '2026-09-29T16:30:00.000Z');
      expect(activeDraft).not.toBeNull();
      const activeView = renderHistoryPage([activeDraft!]);
      fireEvent.click(activeView.container.querySelector('.history-record-open')!);
      fireEvent.click(screen.getByRole('button', { name: 'Preview' }));

      expect(telegramGetChatHistory).not.toHaveBeenCalled();
      expect(activeView.container.querySelector('.history-detail-preview-current .history-post-bubble'))
        .toHaveTextContent('Active Planner draft post');
    });

    it('keeps Telegram preview typography by default and supports text-size controls', () => {
      expect(globalStyles).toMatch(/html\[data-theme\] \.history-drawer\.is-page \.history-detail-body\.is-preview \.history-post-text\s*\{[^}]*font-family:\s*Roboto,[^}]*font-size:\s*16px;[^}]*line-height:\s*1\.4;[^}]*white-space:\s*pre-wrap;/);
      expect(globalStyles).toMatch(/html\[data-theme\] \.history-drawer\.is-page \.history-detail-body\.is-preview\[data-text-size='small'\] \.history-post-text,\s*html\[data-theme\] \.history-drawer\.is-page \.history-detail-body\.is-details\[data-text-size='small'\] \.history-post-text\s*\{\s*font-size:\s*14px;/);
      expect(globalStyles).toMatch(/html\[data-theme\] \.history-drawer\.is-page \.history-detail-body\.is-preview\[data-text-size='large'\] \.history-post-text,\s*html\[data-theme\] \.history-drawer\.is-page \.history-detail-body\.is-details\[data-text-size='large'\] \.history-post-text\s*\{\s*font-size:\s*18px;/);
      expect(globalStyles).not.toContain('.history-detail-preview-spacer');
      expect(globalStyles).toMatch(/\.history-detail-preview-current\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*none;[^}]*justify-content:\s*flex-end;[^}]*margin-top:\s*auto;/);
      expect(globalStyles).toMatch(/\.history-detail-preview-current \.history-post-bubble\s*\{[^}]*max-width:\s*min\(78%, 340px\);/);
    });

    it('anchors long previews at the bottom and keeps the selected text size in sync', () => {
      const { container } = renderHistoryPage([anchoredSentRecord]);
      fireEvent.click(container.querySelector('.history-record-open')!);

      const detailBody = container.querySelector('.history-detail-body') as HTMLDivElement;
      Object.defineProperties(detailBody, {
        clientHeight: { configurable: true, value: 300 },
        scrollHeight: { configurable: true, value: 520 },
      });

      fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
      expect(detailBody.scrollTop).toBe(220);
      expect(detailBody).toHaveAttribute('data-text-size', 'default');

      fireEvent.click(screen.getByRole('button', { name: 'Increase post text size' }));
      expect(detailBody.scrollTop).toBe(220);
      expect(detailBody).toHaveAttribute('data-text-size', 'large');

      fireEvent.click(screen.getByRole('button', { name: 'Decrease post text size' }));
      fireEvent.click(screen.getByRole('button', { name: 'Decrease post text size' }));
      expect(detailBody.scrollTop).toBe(220);
      expect(detailBody).toHaveAttribute('data-text-size', 'small');
    });
  });

  it('shows schedule-specific actions instead of Copy and Use text', () => {
    const { container } = renderHistoryPage([upcomingRecord]);
    fireEvent.click(container.querySelector('.history-record-open')!);
    const toolbar = container.querySelector<HTMLDivElement>('.history-detail-toolbar')!;

    expect(within(toolbar).getByRole('button', { name: 'Preview' })).toBeInTheDocument();
    expect(within(toolbar).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(within(toolbar).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(within(toolbar).queryByRole('button', { name: 'Copy' })).not.toBeInTheDocument();
    expect(within(toolbar).queryByRole('button', { name: 'Use text' })).not.toBeInTheDocument();
  });

  it('restores Copy for drafts and hides Edit and Use in Studio from More', () => {
    const draft = normalizePlannerDraft(
      'A planner draft',
      null,
      '2026-09-29T17:30:00.000Z',
    );
    expect(draft).not.toBeNull();
    const { container, onOpenDraft } = renderHistoryPage([draft!], vi.fn());
    fireEvent.click(container.querySelector('.history-record-open')!);
    const toolbar = container.querySelector<HTMLDivElement>('.history-detail-toolbar')!;

    expect(within(toolbar).getByRole('button', { name: 'Preview' })).toBeInTheDocument();
    expect(within(toolbar).getByRole('button', { name: 'Copy' })).toBeInTheDocument();
    expect(within(toolbar).getByRole('button', { name: 'Use text' })).toBeInTheDocument();
    expect(within(toolbar).queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    fireEvent.click(within(toolbar).getByRole('button', { name: 'More' }));
    expect(screen.queryByRole('menuitem', { name: 'Chat Preview' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Use draft' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Use in Studio' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Open in Planner' })).not.toBeInTheDocument();
    expect(onOpenDraft).not.toHaveBeenCalled();
  });

  it('right-aligns the detail toolbar and preserves themed message-card surfaces', () => {
    expect(globalStyles).toMatch(
      /\.history-drawer\.is-page \.history-detail-actions\s*\{[^}]*padding-top:\s*6px;[^}]*padding-bottom:\s*4px;[^}]*justify-content:\s*flex-end;/,
    );
    expect(globalStyles).toMatch(/\.history-drawer\.is-page \.history-delete-button,\s*\.history-drawer\.is-page \.history-export-button\s*\{[^}]*height:\s*44px;[^}]*min-height:\s*44px;/);
    expect(globalStyles).toMatch(/\.history-drawer\.is-page \.history-export-control\s*\{[^}]*gap:\s*2px;[^}]*transform:\s*translate\(10px,\s*3px\);/);
    expect(globalStyles).toMatch(/\.history-drawer\.is-page \.history-delete-button\s*\{[^}]*width:\s*44px;[^}]*flex-basis:\s*44px;/);
    expect(globalStyles).toMatch(
      /\.history-drawer\.is-page \.history-delete-action\.is-page-action\s*\{[^}]*flex-direction:\s*column;[^}]*margin-left:\s*36px;[^}]*transform:\s*translateY\(3px\);/,
    );
    expect(globalStyles).toMatch(/\.history-drawer\.is-page \.history-export-button\s*\{[^}]*width:\s*44px;[^}]*min-width:\s*44px;[^}]*justify-content:\s*center;[^}]*padding:\s*0;/);
    expect(globalStyles).toMatch(/\.history-drawer\.is-page \.history-action-label\s*\{[^}]*font-size:\s*10px;[^}]*line-height:\s*12px;[^}]*white-space:\s*nowrap;/);
    expect(globalStyles).toMatch(/\.history-drawer\.is-page \.history-export-button::before\s*\{\s*left:\s*50%;\s*transform:\s*translate\(-50%,\s*-50%\);/);
    expect(globalStyles).toMatch(/\.history-drawer\.is-page \.history-drawer-tools \.history-delete-button > svg,\s*\.history-drawer\.is-page \.history-drawer-tools \.history-export-button > svg\s*\{\s*transform:\s*translateY\(-1px\);/);
    expect(readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), './HistoryDrawer.tsx'), 'utf8'))
      .toMatch(/<Download size=\{24\}[\s\S]*?<Trash2 size=\{25\}/);
    expect(readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), './HistoryDrawer.tsx'), 'utf8'))
      .toMatch(/<Eye size=\{26\}[\s\S]*?<Copy size=\{23\}[\s\S]*?<Ellipsis size=\{24\}/);
    expect(globalStyles).toMatch(/\.history-drawer\.is-page \.history-detail-toolbar\s*\{[^}]*transform:\s*translateY\(0\);/);
    expect(globalStyles).toMatch(/\.history-detail-tool-button\s*\{[^}]*min-height:\s*64px;/);
    expect(globalStyles).toMatch(/\.history-detail-tool-button > span:last-child\s*\{\s*transform:\s*translateY\(-3px\);/);
    expect(globalStyles).toMatch(/\.history-detail-tool-icon\s*\{[^}]*border-radius:\s*10px;/);
    expect(globalStyles).toMatch(
      /\.history-detail-body\.is-details\s*\{\s*padding:\s*14px;\s*white-space:\s*normal;/,
    );
    expect(globalStyles).toMatch(
      /\.history-detail-body\.is-details \.history-post-bubble\s*\{\s*width:\s*fit-content;\s*max-width:\s*100%;\s*margin:\s*0 auto;/,
    );
    expect(globalStyles).toMatch(
      /\.history-detail-body\.is-details \.history-post-attachments img\s*\{\s*max-width:\s*min\(100%,\s*360px\);\s*max-height:\s*min\(280px,\s*35vh\);/,
    );
    expect(globalStyles).toMatch(
      /html\[data-theme\] \.history-drawer\.is-page \.history-detail-body\.is-details \.history-post-text\s*\{\s*padding:\s*8px 10px;\s*font-size:\s*16px;\s*line-height:\s*1\.5;/,
    );
    expect(colorThemeStyles).toMatch(
      /html\[data-theme='dark'\] \.history-drawer\.is-page \.history-detail-body \.history-post-bubble\s*\{[^}]*border-color:\s*rgba\(126, 169, 191, 0\.3\);[^}]*background:\s*linear-gradient\(145deg, rgba\(39, 61, 73, 0\.94\), rgba\(23, 36, 47, 0\.98\)\);/,
    );
    expect(colorThemeStyles).toMatch(
      /html\[data-theme='light'\] \.history-drawer\.is-page \.history-detail-tool-icon\s*\{[^}]*background:\s*linear-gradient\(155deg,\s*#ffffff,\s*#f0f4f6\);/,
    );
    expect(colorThemeStyles).toMatch(
      /html\[data-theme='dark'\] \.history-drawer\.is-page \.history-detail-tool-button:not\(:hover\):not\(:focus-visible\):not\(\[aria-expanded='true'\]\) \.history-detail-tool-icon,[\s\S]*?html\[data-theme='light'\] \.history-drawer\.is-page \.history-detail-tool-button:not\(:hover\):not\(:focus-visible\):not\(\[aria-expanded='true'\]\) \.history-detail-tool-icon\s*\{[^}]*border-color:\s*transparent;[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;/,
    );
    expect(colorThemeStyles).toMatch(
      /html\[data-theme='dark'\] \.history-drawer\.is-page \.history-detail-tool-button:hover:not\(:disabled\) \.history-detail-tool-icon,[\s\S]*?\.history-detail-tool-button\[aria-expanded='true'\] \.history-detail-tool-icon\s*\{[^}]*border-radius:\s*10px;[^}]*border-color:\s*rgba\(154,\s*183,\s*202,\s*0\.49\);[^}]*background:\s*linear-gradient\(/,
    );
    expect(colorThemeStyles).toMatch(
      /html\[data-theme='light'\] \.history-drawer\.is-page \.history-detail-tool-button:hover:not\(:disabled\) \.history-detail-tool-icon,[\s\S]*?\.history-detail-tool-button\[aria-expanded='true'\] \.history-detail-tool-icon\s*\{[^}]*border-radius:\s*10px;[^}]*border-color:\s*#b5cbd5;[^}]*background:\s*linear-gradient\(/,
    );
    expect(colorThemeStyles).toMatch(
      /html\[data-theme='light'\] \.history-drawer\.is-page \.history-detail-tool-button:hover:not\(:disabled\),\s*html\[data-theme='light'\] \.history-drawer\.is-page \.history-detail-tool-button:focus-visible,\s*html\[data-theme='light'\] \.history-drawer\.is-page \.history-detail-tool-button\[aria-expanded='true'\]\s*\{\s*color:\s*#315a6b;/,
    );
    expect(colorThemeStyles).toMatch(
      /html\[data-theme='light'\] \.history-drawer\.is-page \.history-detail-actions\s*\{[^}]*border-color:\s*#e3eaee;/,
    );
    expect(colorThemeStyles).toMatch(
      /html\[data-theme='light'\] \.history-drawer\.is-page \.history-detail-action-menu\s*\{[^}]*border-radius:\s*16px;[^}]*background:\s*rgba\(255,\s*255,\s*255,\s*0\.96\);[^}]*box-shadow:/,
    );
    expect(colorThemeStyles).toMatch(
      /html\[data-theme='light'\] \.history-drawer\.is-page \.history-detail-menu-item:hover:not\(:disabled\),[\s\S]*?background:\s*#edf5f7;/,
    );
    expect(colorThemeStyles).toMatch(
      /html\[data-theme='dark'\] \.history-drawer\.is-page \.history-drawer-tools \.history-delete-button,[\s\S]*?html\[data-theme='light'\] \.history-drawer\.is-page \.history-drawer-tools \.history-export-button:disabled\s*\{[^}]*border-color:\s*transparent;/,
    );
    expect(colorThemeStyles).toMatch(
      /html\[data-theme='dark'\] \.history-drawer\.is-page \.history-drawer-tools \.history-delete-button:not\(:hover\):not\(:focus-visible\):not\(\[aria-expanded='true'\]\),[\s\S]*?html\[data-theme='light'\] \.history-drawer\.is-page \.history-drawer-tools \.history-export-button:not\(:hover\):not\(:focus-visible\)\s*\{[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;/,
    );
    expect(globalStyles).toMatch(
      /\.history-drawer\.is-page \.history-delete-button::before,\s*\.history-drawer\.is-page \.history-export-button::before\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px;[^}]*border-radius:\s*10px;[^}]*background:\s*transparent;/,
    );
    expect(colorThemeStyles).toMatch(
      /html\[data-theme='dark'\] \.history-drawer\.is-page \.history-drawer-tools \.history-delete-button:hover:not\(:disabled\)::before,[\s\S]*?html\[data-theme='light'\] \.history-drawer\.is-page \.history-drawer-tools \.history-export-button:focus-visible::before\s*\{[^}]*border-color:\s*rgba\(154,\s*183,\s*202,\s*0\.49\);[^}]*background:\s*linear-gradient\(155deg,/,
    );
    expect(colorThemeStyles).toMatch(
      /html\[data-theme='dark'\] \.history-drawer\.is-page \.history-drawer-tools \.history-delete-button:hover:not\(:disabled\),[\s\S]*?html\[data-theme='light'\] \.history-drawer\.is-page \.history-drawer-tools \.history-export-button:focus-visible\s*\{[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;/,
    );
  });

  it('opens the first non-empty category for the selected source', async () => {
    const studioDraft = normalizeSavedDraft({
      id: 'studio-draft',
      name: 'Studio draft',
      body: 'A saved Studio draft',
      entities: [],
      attachments: [],
      selectedChat: null,
      createdAt: '2026-10-25T10:00:00.000Z',
      updatedAt: '2026-10-25T10:00:00.000Z',
    });
    const plannerDraft = normalizePlannerDraft(
      'A Planner draft',
      null,
      '2026-10-25T11:00:00.000Z',
      [],
      [],
    )!;
    const { container } = renderHistoryPage([studioDraft, plannerDraft]);
    const statusFilters = container.querySelector('.history-status-filters')!;

    await waitFor(() => {
      expect(statusFilters.querySelector('[data-history-filter="drafts"]')).toHaveAttribute('aria-selected', 'true');
    });

    fireEvent.click(statusFilters.querySelector('[data-history-filter="scheduled"]')!);
    selectHistorySource('Studio');
    expect(statusFilters.querySelector('[data-history-filter="drafts"]')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('article')).toHaveTextContent('Studio draft');
  });

  it('shows both Studio and Planner drafts in All and separates them by source', () => {
    const studioDraft = normalizeSavedDraft({
      id: 'all-studio-draft',
      name: 'Studio-only draft',
      body: 'Studio draft content',
      entities: [],
      attachments: [],
      selectedChat: null,
      createdAt: '2026-10-25T10:00:00.000Z',
      updatedAt: '2026-10-25T10:00:00.000Z',
    });
    const plannerDraft = normalizePlannerDraft(
      'Planner-only draft',
      null,
      '2026-10-25T11:00:00.000Z',
    )!;
    const { container } = renderHistoryPage([studioDraft, plannerDraft]);

    fireEvent.click(container.querySelector('[data-history-filter="drafts"]')!);

    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(screen.getByText('Studio-only draft')).toBeInTheDocument();
    expect(screen.getByText('Planner-only draft')).toBeInTheDocument();

    selectHistorySource('Studio');
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByText('Studio-only draft')).toBeInTheDocument();
    expect(screen.queryByText('Planner-only draft')).not.toBeInTheDocument();

    selectHistorySource('Planner');
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByText('Planner-only draft')).toBeInTheDocument();
    expect(screen.queryByText('Studio-only draft')).not.toBeInTheDocument();
  });

  it('keeps the scheduled category selected when the chosen source has no records', async () => {
    const { container } = renderHistoryPage([]);
    const statusFilters = container.querySelector('.history-status-filters')!;
    await waitFor(() => {
      expect(statusFilters.querySelector('[data-history-filter="scheduled"]')).toHaveAttribute('aria-selected', 'true');
    });
    expect(screen.getByText('Nothing in this category yet')).toBeInTheDocument();
    expect(container.querySelector('[data-history-filter="scheduled"] .history-filter-count')).toHaveClass('is-zero');
    expect(container.querySelector('.history-detail-empty h2')).toHaveTextContent('Nothing to review yet');
    expect(container.querySelector('.history-detail-empty p')).toHaveTextContent('Posts matching the selected category and source will appear here.');
  });

  it('keeps the Posts page full-height when switching between empty categories', () => {
    const { container } = renderHistoryPage([]);
    const statusFilters = container.querySelector<HTMLDivElement>('.history-status-filters')!;

    expect(globalStyles).toMatch(
      /\.history-drawer\.is-page\s*\{[^}]*grid-template-rows:\s*auto\s+minmax\(0,\s*1fr\)\s+auto;/,
    );

    for (const category of ['scheduled', 'sent', 'drafts']) {
      const tab = statusFilters.querySelector<HTMLButtonElement>(`[data-history-filter="${category}"]`)!;
      fireEvent.click(tab);
      expect(tab).toHaveAttribute('aria-selected', 'true');
      expect(container.querySelector('.history-drawer.is-page')).toBeInTheDocument();
      expect(screen.getByText('Nothing in this category yet')).toBeInTheDocument();
    }
  });

  it('anchors Posts below the topbar and preserves bottom dock alignment', () => {
    expect(globalStyles).toMatch(
      /\.product-shell-content\.is-posts\s*\{[^}]*height:\s*calc\(100dvh - var\(--app-topbar-height\)\);[^}]*min-height:\s*0;[^}]*flex:\s*0\s*0\s*calc\(100dvh - var\(--app-topbar-height\)\);/,
    );
    expect(globalStyles).toMatch(
      /\.history-drawer\.is-page \.history-drawer-tools\s*\{[^}]*position:\s*sticky;[^}]*inset-block-end:\s*0;[^}]*bottom:\s*0;[^}]*align-self:\s*end;/,
    );
  });

  it('offers product-specific create actions for an empty category, but not empty search results', () => {
    const openStudio = vi.fn();
    const openQuickPlan = vi.fn();
    render(
      <LocaleProvider>
        <QuickPlannerNavigationContext.Provider value={{
          currentSection: 'posts',
          openStudio,
          openQuickPlan,
          openPosts: vi.fn(),
          openSettings: vi.fn(),
        }}>
          <HistoryDrawer
            isOpen
            pageMode
            onClose={vi.fn()}
            records={[]}
            onCancel={vi.fn()}
            onReschedule={vi.fn()}
            onSendNow={vi.fn()}
            onDelete={vi.fn()}
            onOpenDraft={vi.fn()}
            onClearSent={vi.fn()}
          />
        </QuickPlannerNavigationContext.Provider>
      </LocaleProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Create in Studio' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create in Planner' }));
    expect(openStudio).toHaveBeenCalledOnce();
    expect(openQuickPlan).toHaveBeenCalledOnce();
    expect(document.querySelector('.history-empty-art')).toHaveAttribute('aria-hidden', 'true');

    fireEvent.change(screen.getByRole('textbox', { name: 'Search history' }), {
      target: { value: 'no match' },
    });
    expect(screen.queryByRole('button', { name: 'Create in Studio' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create in Planner' })).not.toBeInTheDocument();
  });

  it('offers an empty-state create action matching the selected source', () => {
    renderHistoryPage([]);

    selectHistorySource('Studio');
    expect(screen.getByRole('button', { name: 'Create in Studio' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create in Planner' })).not.toBeInTheDocument();

    selectHistorySource('Planner');
    expect(screen.queryByRole('button', { name: 'Create in Studio' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create in Planner' })).toBeInTheDocument();
  });

  it('keeps search and bottom actions in the Posts dock', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-28T12:00:00.000Z'));
    try {
      const { container } = renderHistoryPage([upcomingRecord, workspaceSentRecord]);
      const pageHeader = container.querySelector<HTMLDivElement>('.history-drawer-header')!;
      const listPane = container.querySelector<HTMLDivElement>('.history-list-pane')!;
      const statusFilters = listPane.querySelector<HTMLDivElement>('.history-status-filters')!;
      const statusSection = listPane.querySelector<HTMLDivElement>('.history-list-status-section')!;
      const sourceRow = statusSection.querySelector<HTMLDivElement>('.history-list-source-row')!;
      const sourceSection = sourceRow.querySelector<HTMLDivElement>('.is-source-section')!;
      const sourceFilters = sourceSection.querySelector<HTMLDivElement>('.history-source-filters')!;
      const statusHeading = statusSection.querySelector<HTMLDivElement>('.history-list-status-heading')!;
      const detailPanel = container.querySelector<HTMLDivElement>('.history-detail-panel')!;
      const recordList = container.querySelector<HTMLDivElement>('.history-record-list')!;
      const tools = container.querySelector<HTMLDivElement>('.history-drawer-tools')!;
      const footer = tools.querySelector<HTMLDivElement>('.history-drawer-footer')!;
      const searchDock = tools.querySelector<HTMLDivElement>('.history-search-dock')!;

      expect(container.querySelector('.history-drawer-controls')).toBeNull();
      expect(container.querySelector('.history-page-controls-close')).toBeNull();
      expect(pageHeader.querySelectorAll('.history-drawer-close')).toHaveLength(1);
      expect(listPane).toContainElement(statusFilters);
      expect(statusSection).toContainElement(statusFilters);
      expect(colorThemeStyles).toMatch(
        /@media \(min-width:\s*1121px\)\s*\{[\s\S]*?\.history-drawer\.is-page \.history-list-status-heading > \.history-status-filters\s*\{\s*width:\s*max-content;[^}]*flex:\s*0 1 auto;[\s\S]*?\.history-drawer\.is-page \.history-list-status-section \.history-status-filters\s*\{\s*justify-content:\s*flex-start;[^}]*gap:\s*4px;[\s\S]*?\.history-drawer\.is-page \.history-list-status-section \.history-status-tab\s*\{\s*flex:\s*0 0 auto;/,
      );
      expect(colorThemeStyles).toMatch(
        /html\[data-theme='dark'\] \.history-drawer\.is-page \.history-list-status-section \.history-status-tab\s*\{[^}]*font-size:\s*12px;/,
      );
      expect(colorThemeStyles).toMatch(
        /html\[data-theme='dark'\] \.history-drawer\.is-page \.history-list-status-section \.history-status-tab \.history-filter-count\s*\{[^}]*font-size:\s*11px;/,
      );
      expect(colorThemeStyles).toMatch(
        /html\[data-theme='light'\] \.history-drawer\.is-page \.history-list-status-section \.history-status-tab \.history-filter-count\s*\{[^}]*font-size:\s*11px;/,
      );
      expect(colorThemeStyles).toMatch(
        /html\[data-theme='light'\] \.history-drawer\.is-page \.history-list-status-section \.history-status-tab \.history-filter-count\.is-zero\s*\{[^}]*color:\s*#687b82;/,
      );
      expect(colorThemeStyles).toMatch(
        /html\[data-theme='dark'\] \.history-drawer\.is-page \.history-list-status-section \.history-status-tab \.history-filter-count\.is-zero\s*\{[^}]*color:\s*#87969d;/,
      );
      expect(globalStyles).toMatch(
        /\.history-drawer\.is-page \.history-drawer-tools\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto;[^}]*gap:\s*20px;/,
      );
      expect(colorThemeStyles).toMatch(
        /@media \(min-width:\s*761px\)\s*\{[\s\S]*?\.history-drawer\.is-page \.history-list-status-section\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+164px;[\s\S]*?\.history-drawer\.is-page \.history-list-source-row \.history-page-filter-section\.is-source-section\s*\{[^}]*width:\s*164px;[^}]*min-width:\s*164px;[^}]*flex:\s*0 0 164px;[^}]*justify-content:\s*flex-end;[^}]*padding-right:\s*10px;/,
      );
      expect(colorThemeStyles).toMatch(
        /\.history-drawer\.is-page \.history-list-source-row \.history-page-filter-section\.is-source-section\s*\{[^}]*padding:\s*0 10px 0 12px;/,
      );
      expect(colorThemeStyles).toMatch(
        /\.history-drawer\.is-page \.history-list-source-label\s*\{\s*font-size:\s*12px;/,
      );
      expect(colorThemeStyles).toMatch(
        /html\[data-theme='light'\] \.history-drawer\.is-page \.history-list-status-heading \.history-page-filter-label,\s*html\[data-theme='light'\] \.history-drawer\.is-page \.history-list-source-label\s*\{\s*color:\s*#5b7079;\s*font-size:\s*12px;\s*font-weight:\s*600;\s*letter-spacing:\s*0\.07em;/,
      );
      expect(colorThemeStyles).toMatch(
        /\.history-drawer\.is-page \.history-list-source-row \.history-source-select\s*\{\s*min-height:\s*38px;[^}]*padding:\s*0 12px;[^}]*font-size:\s*12px;/,
      );
      expect(colorThemeStyles).toMatch(/\.history-source-option\s*\{\s*min-height:\s*44px;\s*font-size:\s*13px;/);
      expect(globalStyles).toMatch(/\.history-source-menu\s*\{\s*position:\s*absolute;[^}]*width:\s*208px;[^}]*border:\s*0;[^}]*box-shadow:\s*0 6px 14px rgba\(0, 0, 0, 0\.24\);/);
      expect(globalStyles).toMatch(/\.history-source-menu\s*\{[^}]*transform-origin:\s*top right;[^}]*animation:\s*history-source-menu-drop-in 180ms cubic-bezier\(0\.2, 0\.8, 0\.2, 1\) both;/);
      expect(globalStyles).toMatch(/@media \(prefers-reduced-motion:\s*reduce\)\s*\{\s*\.history-source-menu\s*\{\s*animation:\s*none;/);
      expect(colorThemeStyles).toMatch(
        /@media \(min-width:\s*1121px\)\s*\{[\s\S]*?\.history-drawer\.is-page \.history-list-source-row \.history-page-filter-section\.is-source-section\s*\{\s*justify-content:\s*space-between;\s*padding:\s*0 10px 0 12px;/,
      );
      expect(globalStyles).not.toMatch(/\.history-list-status-section \.history-status-tab::before/);
      expect(colorThemeStyles).not.toMatch(/\.history-list-status-section \.history-status-tab(?::not\(\.is-active\))?:(?:hover|focus-visible)::before/);
      expect(statusSection.compareDocumentPosition(recordList) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(pageHeader.compareDocumentPosition(statusSection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(recordList.compareDocumentPosition(tools) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(tools).toContainElement(searchDock);
      expect(searchDock.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(globalStyles).toMatch(/\.history-drawer\.is-page \.history-drawer-tools\s*\{[^}]*width:\s*calc\(45% - 17\.2px\);[^}]*margin-right:\s*0;[^}]*margin-left:\s*10px;[^}]*padding:\s*11px 8px;[^}]*transform:\s*translateY\(-17px\);/);
      expect(globalStyles).toMatch(/\.history-drawer\.is-page \.history-drawer-tools\s*\{[^}]*border-top-left-radius:\s*0;[^}]*border-top-right-radius:\s*0;/);
      expect(globalStyles).toMatch(/\.history-content\.is-page \.history-list-pane\s*\{[^}]*border-radius:\s*12px 12px 0 0;/);
      expect(globalStyles).not.toMatch(/\.history-content\.is-page \.history-list-pane\s*\{[^}]*top:\s*-2px;/);
      expect(globalStyles).toMatch(/@media \(min-width:\s*761px\)\s*\{\s*\.history-drawer\.is-page \.history-drawer-tools\s*\{\s*padding-top:\s*5px;[^}]*position:\s*sticky;[^}]*inset-block-end:\s*0;[^}]*left:\s*4px;[^}]*transform:\s*translateY\(-11px\);/);
      expect(globalStyles).toMatch(/\.history-drawer\.is-page \.history-export-control\s*\{[^}]*gap:\s*2px;[^}]*transform:\s*translate\(10px,\s*3px\);/);
      expect(globalStyles).toMatch(/\.history-content\.is-page \.history-list-pane\s*\{[^}]*margin-bottom:\s*2px;/);
      expect(globalStyles).toMatch(/\.history-drawer\.is-page \.history-search-dock\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;/);
      expect(globalStyles).toMatch(/\.history-drawer\.is-page \.history-result-count\s*\{[^}]*padding-left:\s*0;[^}]*text-align:\s*center;/);
      expect(footer).not.toContainElement(statusFilters);
      expect(footer).toContainElement(container.querySelector('.history-export-button'));
      expect(footer).toContainElement(container.querySelector('.history-delete-button'));
      const exportControl = footer.querySelector('.history-export-control')!;
      const deleteAction = footer.querySelector('.history-delete-action')!;
      expect(exportControl.compareDocumentPosition(deleteAction) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(screen.getByRole('search')).toBeInTheDocument();
      expect(screen.getByRole('tablist', { name: 'Post status' })).toBeInTheDocument();
      expect(statusHeading).toContainElement(statusFilters);
      expect(sourceSection).toContainElement(sourceFilters);
      expect(sourceRow).toContainElement(sourceSection);
      expect(statusHeading.compareDocumentPosition(sourceRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(detailPanel).not.toContainElement(sourceFilters);
      expect(pageHeader).toBeInTheDocument();
      expect(sourceSection.querySelector('.history-list-source-label')).toHaveTextContent('Source');
      expect(sourceSection.querySelector('.history-source-select')).toHaveTextContent('All');
      expect(statusHeading).toHaveTextContent('Category');
      expect(statusHeading).toContainElement(statusFilters);
      fireEvent.click(screen.getByRole('tab', { name: 'Sent' }));
      expect(container.querySelector('.history-drawer-tools')).toBeInTheDocument();
      const deleteButton = container.querySelector<HTMLButtonElement>('.history-delete-button');
      expect(deleteButton).toBeInTheDocument();
      expect(deleteButton).not.toHaveAttribute('title');
      expect(deleteButton).toHaveAttribute('aria-label');
      expect(container.querySelector('.history-export-button')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the full list visible while showing the selected post details separately', async () => {
    const secondRecord = normalizeScheduledMessages([{
      ...scheduledMessage,
      id: 'scheduled-studio-2',
      text: 'Вторая публикация остаётся в списке',
      when: '2026-09-30T17:30:00.000Z',
    }], 'workspace', 'upcoming', [channel])[0];
    const { container } = renderHistoryPage([upcomingRecord, secondRecord]);

    expect(container.querySelectorAll('.history-record')).toHaveLength(2);
    expect(container.querySelector('.history-detail-empty h2')).toHaveTextContent('Select a post');
    expect(container.querySelector('.history-detail-empty-art')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('.history-detail-empty-art-icon')).toBeInTheDocument();
    expect(container.querySelector('.history-detail-empty-art-orbit--outer')).toBeInTheDocument();
    expect(container.querySelector('.history-detail-empty-art-spark--left')).toBeInTheDocument();

    fireEvent.click(container.querySelector('.history-record-open')!);

    expect(container.querySelectorAll('.history-record')).toHaveLength(2);
    expect(screen.getAllByText('Релиз нового набора шаблонов для Telegram-канала').length).toBeGreaterThan(0);
    expect(screen.getByText('Вторая публикация остаётся в списке')).toBeInTheDocument();
    expect(container.querySelector('.history-detail-preview-label')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'brief.pdf' }))
      .toHaveAttribute('download', 'brief.pdf');
    expect(screen.getByRole('button', { name: 'Back to posts' })).toBeInTheDocument();
    expect(container.querySelector('.history-detail-category')).toHaveTextContent('Category: Scheduled');
    expect(container.querySelector('.history-record-open')).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(container.querySelector('.history-detail-body')).toHaveClass('is-preview');
    expect(telegramGetChatHistory).not.toHaveBeenCalled();
    expect(container.querySelector('.history-detail-preview-spacer')).not.toBeInTheDocument();
    expect(container.querySelector('.history-detail-preview-current')).toHaveTextContent('Релиз нового набора шаблонов для Telegram-канала');
  });

  it('closes the selected post when its row is clicked again', () => {
    const { container } = renderHistoryPage([upcomingRecord]);
    const recordButton = container.querySelector<HTMLButtonElement>('.history-record-open')!;

    fireEvent.click(recordButton);
    expect(container.querySelector('.history-detail-panel')).toHaveTextContent('Релиз нового набора шаблонов для Telegram-канала');
    expect(recordButton).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(recordButton);
    expect(container.querySelector('.history-detail-empty h2')).toHaveTextContent('Select a post');
    expect(recordButton).toHaveAttribute('aria-pressed', 'false');
  });

  it('closes the selected draft when its row is clicked again', () => {
    const draft = normalizePlannerDraft('A draft to close', null, '2026-10-06T10:00:00.000Z');
    expect(draft).not.toBeNull();
    const { container } = renderHistoryPage([draft!]);
    fireEvent.click(container.querySelector('[data-history-filter="drafts"]')!);
    const recordButton = container.querySelector<HTMLButtonElement>('.history-record-open')!;

    fireEvent.click(recordButton);
    expect(container.querySelector('.history-detail-panel')).toHaveTextContent('A draft to close');
    expect(recordButton).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(recordButton);
    expect(container.querySelector('.history-detail-empty h2')).toHaveTextContent('Select a post');
    expect(recordButton).toHaveAttribute('aria-pressed', 'false');
  });

  it('shows the compact preview and copy toolbar without sharing and keeps record actions in its menu', async () => {
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    try {
      const { container } = renderHistoryPage([completedRecord]);
      fireEvent.click(container.querySelector('.history-record-open')!);

      const toolbar = container.querySelector<HTMLDivElement>('.history-detail-toolbar')!;
      expect(within(toolbar).getByRole('button', { name: 'Preview' })).toBeInTheDocument();
      expect(within(toolbar).getByRole('button', { name: 'Copy' })).toBeInTheDocument();
      expect(within(toolbar).getByRole('button', { name: 'Use text' })).toBeInTheDocument();
      expect(within(toolbar).getByRole('button', { name: 'More' })).toBeInTheDocument();
      expect(within(toolbar).queryByRole('button', { name: /share/i })).not.toBeInTheDocument();

      fireEvent.click(within(toolbar).getByRole('button', { name: 'Copy' }));
      await waitFor(() => expect(writeText).toHaveBeenCalledWith(completedRecord.text));
      expect(within(toolbar).getByRole('button', { name: 'Copied' })).toBeInTheDocument();

      const scheduledView = renderHistoryPage([upcomingRecord]);
      fireEvent.click(scheduledView.container.querySelector('.history-record-open')!);
      const scheduledToolbar = scheduledView.container.querySelector<HTMLDivElement>('.history-detail-toolbar')!;
      fireEvent.click(within(scheduledToolbar).getByRole('button', { name: 'More' }));
      const actionsMenu = within(scheduledToolbar).getByRole('menu');
      expect(within(actionsMenu).queryByRole('menuitem', { name: 'Edit' })).not.toBeInTheDocument();
      expect(within(actionsMenu).getByRole('menuitem', { name: 'Send now' })).toBeInTheDocument();
      expect(within(actionsMenu).getByRole('menuitem', { name: 'Cancel' })).toBeInTheDocument();
    } finally {
      if (clipboardDescriptor) {
        Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
      } else {
        Reflect.deleteProperty(navigator, 'clipboard');
      }
    }
  });

  it('copies a single photo with the post text, but copies only text for multiple photos', async () => {
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const writeText = vi.fn().mockResolvedValue(undefined);
    const write = vi.fn().mockResolvedValue(undefined);
    class MockClipboardItem {
      constructor(public readonly items: Record<string, Blob>) {}
    }
    vi.stubGlobal('ClipboardItem', MockClipboardItem);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText, write },
    });

    try {
      const singlePhoto = normalizePlannerDraft(
        'Post with one photo',
        null,
        '2026-10-25T10:00:00.000Z',
        [],
        ['data:image/png;base64,aW1hZ2U='],
      )!;
      const singleView = renderHistoryPage([singlePhoto]);
      fireEvent.click(singleView.container.querySelector('.history-record-open')!);
      fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

      await waitFor(() => expect(write).toHaveBeenCalledOnce());
      const clipboardItem = write.mock.calls[0][0][0] as MockClipboardItem;
      expect(clipboardItem.items['image/png']).toBeInstanceOf(Blob);
      expect(await clipboardItem.items['text/plain'].text()).toBe('Post with one photo');
      expect(writeText).not.toHaveBeenCalled();

      singleView.unmount();
      const multiplePhotos = normalizePlannerDraft(
        'Post with multiple photos',
        null,
        '2026-10-25T10:00:00.000Z',
        [],
        ['data:image/png;base64,aW1hZ2U=', 'data:image/png;base64,b3RoZXI='],
      )!;
      const multipleView = renderHistoryPage([multiplePhotos]);
      fireEvent.click(multipleView.container.querySelector('.history-record-open')!);
      fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

      await waitFor(() => expect(writeText).toHaveBeenCalledWith('Post with multiple photos'));
      expect(write).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
      if (clipboardDescriptor) {
        Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
      } else {
        Reflect.deleteProperty(navigator, 'clipboard');
      }
    }
  });

  it('falls back to copying the post text when copying a single photo fails', async () => {
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const writeText = vi.fn().mockResolvedValue(undefined);
    const write = vi.fn().mockRejectedValue(new Error('Image clipboard is unavailable.'));
    class MockClipboardItem {
      constructor(public readonly items: Record<string, Blob>) {}
    }
    vi.stubGlobal('ClipboardItem', MockClipboardItem);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText, write },
    });

    try {
      const draft = normalizePlannerDraft(
        'Keep this text even if the image fails',
        null,
        '2026-10-25T10:00:00.000Z',
        [],
        ['data:image/png;base64,aW1hZ2U='],
      )!;
      const { container } = renderHistoryPage([draft]);
      fireEvent.click(container.querySelector('.history-record-open')!);
      const toolbar = container.querySelector<HTMLDivElement>('.history-detail-toolbar')!;
      fireEvent.click(within(toolbar).getByRole('button', { name: 'Copy' }));

      await waitFor(() => expect(writeText).toHaveBeenCalledWith(draft.text));
      expect(within(toolbar).getByRole('button', { name: 'Copied' })).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
      if (clipboardDescriptor) {
        Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
      } else {
        Reflect.deleteProperty(navigator, 'clipboard');
      }
    }
  });

  it('resets the copy button after its temporary confirmation', async () => {
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    vi.useFakeTimers();

    try {
      const { container } = renderHistoryPage([completedRecord]);
      fireEvent.click(container.querySelector('.history-record-open')!);
      const toolbar = container.querySelector<HTMLDivElement>('.history-detail-toolbar')!;
      fireEvent.click(within(toolbar).getByRole('button', { name: 'Copy' }));

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(within(toolbar).getByRole('button', { name: 'Copied' })).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(1600);
      });
      expect(within(toolbar).getByRole('button', { name: 'Copy' })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
      if (clipboardDescriptor) {
        Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
      } else {
        Reflect.deleteProperty(navigator, 'clipboard');
      }
    }
  });

  it('uses the selected post text with the active editor from the detail toolbar', async () => {
    const onUseDraft = vi.fn().mockResolvedValue(true);
    const { container, onClose } = renderHistoryPage([completedRecord], onUseDraft);
    fireEvent.click(container.querySelector('.history-record-open')!);
    fireEvent.click(screen.getByRole('button', { name: 'Use text' }));

    await waitFor(() => {
      expect(onUseDraft).toHaveBeenCalledWith(completedRecord, 'studio');
      expect(onClose).toHaveBeenCalledWith(false);
    });
  });

  it('hides Edit and Use in Studio from the scheduled post detail actions menu', () => {
    const { container } = renderHistoryPage([upcomingRecord]);
    fireEvent.click(container.querySelector('.history-record-open')!);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.queryByRole('menuitem', { name: 'Use in Studio' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Open in Planner' })).not.toBeInTheDocument();
  });

  it('returns the post list to the top when source, category, or search changes', () => {
    const { container } = renderHistoryPage([upcomingRecord, workspaceSentRecord]);
    const recordList = container.querySelector<HTMLDivElement>('.history-record-list')!;

    recordList.scrollTop = 240;
    fireEvent.click(screen.getByRole('tab', { name: 'Sent' }));
    expect(recordList.scrollTop).toBe(0);

    recordList.scrollTop = 180;
    selectHistorySource('Studio');
    expect(recordList.scrollTop).toBe(0);

    recordList.scrollTop = 120;
    fireEvent.change(screen.getByRole('textbox', { name: 'Search history' }), {
      target: { value: 'release' },
    });
    expect(recordList.scrollTop).toBe(0);
  });

  it('supports arrow, Home, and End navigation across status tabs', () => {
    renderHistoryPage([upcomingRecord, workspaceSentRecord]);
    const scheduledTab = screen.getByRole('tab', { name: 'Scheduled' });
    const sentTab = screen.getByRole('tab', { name: 'Sent' });
    const draftsTab = screen.getByRole('tab', { name: 'Drafts' });

    expect(scheduledTab).toHaveAttribute('tabindex', '0');
    expect(sentTab).toHaveAttribute('tabindex', '-1');

    fireEvent.keyDown(scheduledTab, { key: 'ArrowRight' });
    expect(sentTab).toHaveFocus();
    expect(sentTab).toHaveAttribute('aria-selected', 'true');
    expect(sentTab).toHaveAttribute('tabindex', '0');
    fireEvent.keyDown(sentTab, { key: 'End' });
    expect(draftsTab).toHaveFocus();
    expect(draftsTab).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(draftsTab, { key: 'ArrowRight' });
    expect(scheduledTab).toHaveFocus();
    expect(scheduledTab).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(scheduledTab, { key: 'Home' });
    expect(scheduledTab).toHaveFocus();
  });

  it('focuses and selects the history query with Ctrl+F or Cmd+F', () => {
    renderHistoryPage([upcomingRecord]);
    const search = screen.getByRole('textbox', { name: 'Search history' }) as HTMLInputElement;
    fireEvent.change(search, { target: { value: 'launch' } });

    fireEvent.keyDown(document, { key: 'f', ctrlKey: true });

    expect(search).toHaveFocus();
    expect(search.selectionStart).toBe(0);
    expect(search.selectionEnd).toBe('launch'.length);
  });

  it('returns keyboard focus to the selected post after leaving mobile details', async () => {
    const previousMatchMedia = Object.getOwnPropertyDescriptor(window, 'matchMedia');
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn((media: string) => ({
        matches: media === '(max-width: 900px)',
        media,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    try {
      const { container } = renderHistoryPage([upcomingRecord]);
      const rowButton = container.querySelector('.history-record-open') as HTMLButtonElement;
      fireEvent.click(rowButton);
      fireEvent.click(screen.getByRole('button', { name: 'Back to posts' }));

      await waitFor(() => expect(container.querySelector('.history-record-open')).toHaveFocus());
    } finally {
      if (previousMatchMedia) Object.defineProperty(window, 'matchMedia', previousMatchMedia);
      else Reflect.deleteProperty(window, 'matchMedia');
    }
  });
});

describe('history filter selected states', () => {
  it('keeps full Russian category labels accessible', () => {
    window.localStorage.removeItem('xmsgi-history-filters');
    window.localStorage.setItem('awaitmsg_locale', 'ru');
    const { container } = renderHistory([upcomingRecord, workspaceSentRecord]);
    const statusFilters = container.querySelector('.history-status-filters') as HTMLElement;
    const scheduledTab = statusFilters.querySelector('[data-history-filter="scheduled"]') as HTMLElement;

    expect(scheduledTab).toHaveAttribute('aria-label', 'План');
    expect(scheduledTab.querySelector('.history-status-label')?.textContent).toBe('План');
  });

  it('shows All, Studio, Planner, and Errors in the source dropdown', () => {
    window.localStorage.removeItem('xmsgi-history-filters');
    window.localStorage.setItem('awaitmsg_locale', 'en');
    const { container } = renderHistoryPage([upcomingRecord, workspaceSentRecord]);
    const sourceFilters = container.querySelector('.history-source-filters') as HTMLDivElement;
    const statusFilters = container.querySelector('.history-status-filters') as HTMLDivElement;
    const activeStatus = statusFilters.querySelector<HTMLButtonElement>('[aria-selected="true"]')!;

    expect(sourceFilters.querySelector('.history-source-select')).toHaveTextContent('All');
    expect(activeStatus).toHaveAttribute('data-history-filter', 'scheduled');
    expect(activeStatus).toHaveClass('is-active');
    expect(container.querySelector('.history-glass-indicator')).toBeNull();

    const sourceMenu = openSourceMenu();
    expect(sourceMenu.container.querySelectorAll('[role="menuitemradio"]')).toHaveLength(4);
    expect(sourceMenu.container.querySelector('[data-history-filter="all"]')).toBeInTheDocument();
    expect(sourceMenu.container.querySelector('[data-history-filter="workspace"]')).toBeInTheDocument();
    expect(sourceMenu.container.querySelector('[data-history-filter="personal"]')).toBeInTheDocument();
    expect(sourceMenu.container.querySelector('[data-history-filter="errors"]')).toBeInTheDocument();
    fireEvent.click(sourceMenu.container.querySelector('[data-history-filter="workspace"]')!);
    fireEvent.click(statusFilters.querySelector('[data-history-filter="sent"]')!);

    expect(sourceFilters.querySelector('.history-source-select')).toHaveTextContent('Studio');
    expect(statusFilters.querySelector('[data-history-filter="sent"]')).toHaveClass('is-active');
  });

  it('keeps light category tabs borderless except for the selected accent capsule', () => {
    expect(colorThemeStyles).toMatch(
      /html\[data-theme='light'\] \.history-drawer\.is-page \.history-list-status-section \.history-status-tab,\s*html\[data-theme='light'\] \.history-drawer\.is-page \.history-list-status-section \.history-status-tab:hover,\s*html\[data-theme='light'\] \.history-drawer\.is-page \.history-list-status-section \.history-status-tab:focus-visible\s*\{\s*border-color:\s*transparent;\s*outline:\s*none;\s*box-shadow:\s*none;/,
    );
    expect(colorThemeStyles).toMatch(
      /html\[data-theme='light'\] \.history-drawer\.is-page \.history-list-status-section \.history-status-tab\.is-active:focus-visible\s*\{\s*background:\s*rgba\(40, 125, 163, 0\.08\);/,
    );
    expect(colorThemeStyles).toMatch(
      /html\[data-theme='light'\] \.history-drawer\.is-page \.history-list-status-section \.history-status-tab\.is-active,[\s\S]*?border-color:\s*rgba\(40, 125, 163, 0\.24\);[\s\S]*?background:\s*rgba\(40, 125, 163, 0\.08\);[\s\S]*?color:\s*#287da3;[\s\S]*?box-shadow:\s*none;/,
    );
    expect(colorThemeStyles).toMatch(
      /html\[data-theme='light'\] \.history-drawer\.is-page \.history-list-status-section \.history-status-tab \.history-filter-count,\s*html\[data-theme='light'\] \.history-drawer\.is-page \.history-list-status-section \.history-status-tab\.is-active \.history-filter-count\s*\{\s*border-color:\s*transparent;/,
    );
    expect(colorThemeStyles).toMatch(
      /html\[data-theme='dark'\] \.history-source-menu \.history-filter-count,[\s\S]*?html\[data-theme='light'\] \.history-source-menu \.history-source-option\[aria-checked='true'\] \.history-filter-count\s*\{\s*border-color:\s*transparent;\s*box-shadow:\s*none;/,
    );
    expect(globalStyles).toMatch(
      /\.history-list-status-section \.history-status-tab\s*\{[^}]*transition:\s*color 160ms ease;/,
    );
  });

  it('keeps Posts search borderless and matching the detail panel in both states', () => {
    expect(colorThemeStyles).toMatch(
      /html\[data-theme='light'\] \.history-drawer\.is-page \.history-search,\s*html\[data-theme='light'\] \.history-drawer\.is-page \.history-search:not\(:focus-within\)\s*\{\s*border-color:\s*transparent;\s*background:\s*#edf1f3;\s*box-shadow:\s*none;/,
    );
    expect(colorThemeStyles).toMatch(
      /html\[data-theme='dark'\] \.history-drawer\.is-page \.history-search,\s*html\[data-theme='dark'\] \.history-drawer\.is-page \.history-search:not\(:focus-within\),\s*html\[data-theme='dark'\] \.history-drawer\.is-page \.history-search:focus-within\s*\{\s*border-color:\s*transparent;\s*background:\s*rgba\(16,\s*23,\s*29,\s*0\.72\);\s*box-shadow:\s*none;/,
    );
  });

  it('uses a subtle neutral gray outline for the focused Posts search in both themes', () => {
    expect(colorThemeStyles).toMatch(
      /html\[data-theme='dark'\] \.history-drawer\.is-page \.history-search:focus-within,\s*html\[data-theme='light'\] \.history-drawer\.is-page \.history-search:focus-within\s*\{\s*border-color:\s*rgba\(154, 168, 184, 0\.36\);\s*box-shadow:\s*none;/,
    );
  });

  it('uses a larger search icon in both themes', () => {
    expect(globalStyles).toMatch(/\.history-search > svg\s*\{\s*width:\s*21px;\s*height:\s*21px;\s*flex:\s*0 0 auto;/);
  });

  it('shortens the search placeholder and ellipsizes it when the Posts dock is narrow', () => {
    expect(globalStyles).toMatch(/\.history-search input\s*\{[^}]*text-overflow:\s*ellipsis;/);
    window.localStorage.removeItem('xmsgi-history-filters');
    window.localStorage.setItem('awaitmsg_locale', 'ru');
    renderHistoryPage([upcomingRecord]);

    expect(screen.getByRole('textbox', { name: 'Поиск по истории' })).toHaveAttribute('placeholder', 'Поиск по истории...');
  });

  it('wraps long error previews within narrow Posts records', () => {
    expect(globalStyles).toMatch(
      /\.history-record-error-preview\s*\{[^}]*max-width:\s*100%;[^}]*overflow-wrap:\s*anywhere;[^}]*white-space:\s*normal;/,
    );
    expect(colorThemeStyles).toMatch(
      /html\[data-theme='light'\] \.history-drawer\.is-page \.history-record-error-preview\s*\{\s*color:\s*#8f211b;\s*font-size:\s*13px;\s*font-weight:\s*600;/,
    );
  });

  it('keeps the global search hint while changing categories', () => {
    window.localStorage.removeItem('xmsgi-history-filters');
    window.localStorage.setItem('awaitmsg_locale', 'ru');
    const { container } = renderHistoryPage([upcomingRecord, workspaceSentRecord]);
    const search = screen.getByRole('textbox', { name: 'Поиск по истории' });
    const statusFilters = container.querySelector('.history-status-filters')!;

    expect(search).toHaveAttribute('placeholder', 'Поиск по истории...');

    fireEvent.click(statusFilters.querySelector('[data-history-filter="sent"]')!);
    expect(screen.getByRole('textbox', { name: 'Поиск по истории' })).toHaveAttribute('placeholder', 'Поиск по истории...');

    fireEvent.click(statusFilters.querySelector('[data-history-filter="drafts"]')!);
    expect(screen.getByRole('textbox', { name: 'Поиск по истории' })).toHaveAttribute('placeholder', 'Поиск по истории...');
  });

  it('searches across categories while respecting the selected source', () => {
    const { container } = renderHistoryPage([upcomingRecord, personalUpcomingRecord, completedRecord]);
    const search = screen.getByRole('textbox', { name: 'Поиск по истории' });

    fireEvent.change(search, { target: { value: 'подтвердить' } });

    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(screen.getByText('Найдено 2 из 3')).toBeInTheDocument();
    const results = screen.getAllByRole('article');
    expect(results.some((result) => result.textContent?.includes('Запланировано'))).toBe(true);
    expect(results.some((result) => result.textContent?.includes('Отправлено'))).toBe(true);

    const sentResult = results.find((result) => result.textContent?.includes('Отправлено'))!;
    fireEvent.click(sentResult.querySelector('.history-record-open')!);
    expect(container.querySelector('.history-detail-category')).toHaveTextContent('Категория: Отправлено');

    fireEvent.click(container.querySelector('[data-history-filter="sent"]')!);
    expect(screen.getAllByRole('article')).toHaveLength(2);

    selectHistorySource('Studio');
    expect(screen.queryAllByRole('article')).toHaveLength(0);
    expect(screen.getByText('Найдено 0 из 1')).toBeInTheDocument();
    expect(container.querySelector('[data-history-filter="scheduled"]')).toBeInTheDocument();
  });

  it('includes errors in All, excludes them from Studio and Planner, and isolates the Errors section', () => {
    const failedRecord = normalizeScheduledMessages([{
      ...scheduledMessage,
      id: 'failed-source-total',
      status: 'failed' as ScheduledMessage['status'],
      lastError: 'Telegram is temporarily unavailable.',
    }], 'workspace', 'upcoming', [channel])[0];
    window.localStorage.setItem('xmsgi-history-filters', JSON.stringify({
      sourceFilter: 'all',
      statusFilter: 'sent',
    }));
    const { container } = renderHistoryPage([completedRecord, workspaceSentRecord, failedRecord]);
    expect(screen.getAllByRole('article')).toHaveLength(3);
    expect(screen.getByText('Telegram is temporarily unavailable.')).toBeInTheDocument();
    let sourceMenu = openSourceMenu();
    expect(sourceMenu.container.querySelector('[data-history-filter="all"]')).toHaveTextContent('3');
    expect(sourceMenu.container.querySelector('[data-history-filter="workspace"]')).toHaveTextContent('1');
    expect(sourceMenu.container.querySelector('[data-history-filter="personal"]')).toHaveTextContent('1');
    expect(sourceMenu.container.querySelector('[data-history-filter="errors"]')).toHaveTextContent('1');

    fireEvent.click(sourceMenu.container.querySelector('[data-history-filter="errors"]')!);
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByText('Telegram is temporarily unavailable.')).toBeInTheDocument();
    expect(container.querySelector('.history-source-select')).toHaveTextContent(/^(Errors|Ошибки)/);
    expect(container.querySelectorAll('.history-status-tab .history-filter-count')).toHaveLength(0);

    sourceMenu = openSourceMenu();
    expect(sourceMenu.container.querySelector('[data-history-filter="all"]')).toHaveTextContent('3');
    expect(sourceMenu.container.querySelector('[data-history-filter="workspace"]')).toHaveTextContent('1');
    expect(sourceMenu.container.querySelector('[data-history-filter="personal"]')).toHaveTextContent('1');
    fireEvent.click(sourceMenu.container.querySelector('[data-history-filter="workspace"]')!);
    expect(screen.queryByText('Telegram is temporarily unavailable.')).not.toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByText('Релиз нового набора шаблонов для Telegram-канала')).toBeInTheDocument();

    fireEvent.click(container.querySelector('[data-history-filter="scheduled"]')!);
    sourceMenu = openSourceMenu();
    expect(sourceMenu.container.querySelector('[data-history-filter="all"]')).toHaveTextContent('3');
    expect(sourceMenu.container.querySelector('[data-history-filter="workspace"]')).toHaveTextContent('1');
    expect(sourceMenu.container.querySelector('[data-history-filter="personal"]')).toHaveTextContent('1');
  });

  it('formats source, status, and result counters correctly at one thousand', () => {
    window.localStorage.setItem('awaitmsg_locale', 'en');
    const records = Array.from({ length: 1000 }, (_, index) => ({
      ...upcomingRecord,
      id: `scheduled-studio-${index}`,
    }));
    const { container, unmount } = renderHistoryPage(records);

    expect(container.querySelector('[data-history-filter="scheduled"] .history-filter-count')).toHaveTextContent('1,000');
    expect(container.querySelector('.history-result-count')).toHaveTextContent('Showing 1,000 of 1,000');

    const sourceMenu = openSourceMenu();
    expect(sourceMenu.getByRole('menuitemradio', { name: 'All' })).toHaveTextContent('1,000');
    expect(sourceMenu.getByRole('menuitemradio', { name: 'Studio' })).toHaveTextContent('1,000');

    unmount();
    const recordWithManyAttachments = {
      ...upcomingRecord,
      attachments: Array.from({ length: 1000 }, (_, index) => `C:\\files\\attachment-${index}.pdf`),
    };
    const { container: attachmentContainer } = renderHistoryPage([recordWithManyAttachments]);
    expect(attachmentContainer.querySelector('.history-record-attachment-count')).toHaveTextContent('1,000');
  });

  it('opens on the Planner source until a user-selected source is saved across reopen', () => {
    window.localStorage.removeItem('xmsgi-history-filters');
    const renderDrawer = (isOpen: boolean, sourceFilterOnOpen?: 'personal' | 'workspace') => (
      <LocaleProvider>
        <HistoryDrawer
          isOpen={isOpen}
          sourceFilterOnOpen={sourceFilterOnOpen}
          onClose={vi.fn()}
          records={[upcomingRecord, personalUpcomingRecord]}
          onCancel={vi.fn()}
          onReschedule={vi.fn()}
          onSendNow={vi.fn()}
          onDelete={vi.fn()}
          onOpenDraft={vi.fn()}
          onClearSent={vi.fn()}
          onClearDrafts={vi.fn().mockResolvedValue(true)}
          onCancelQueue={vi.fn().mockResolvedValue(true)}
        />
      </LocaleProvider>
    );
    const { container, rerender } = render(renderDrawer(true, 'personal'));

    expect(container.querySelector('[data-history-filter="personal"]')).toHaveAttribute('aria-pressed', 'true');
    expect(container.querySelector('[data-history-filter="workspace"]')).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(container.querySelector('[data-history-filter="workspace"]')!);
    expect(container.querySelector('[data-history-filter="workspace"]')).toHaveAttribute('aria-pressed', 'true');
    expect(container.querySelector('[data-history-filter="personal"]')).toHaveAttribute('aria-pressed', 'false');
    expect(JSON.parse(window.localStorage.getItem('xmsgi-history-filters') ?? '{}')).toMatchObject({
      sourceFilter: 'workspace',
      sourceFilterPinned: true,
    });

    rerender(renderDrawer(false));
    rerender(renderDrawer(true, 'personal'));
    expect(container.querySelector('[data-history-filter="workspace"]')).toHaveAttribute('aria-pressed', 'true');
    window.localStorage.removeItem('xmsgi-history-filters');
  });

  it('uses the active product source on first open even when an older source is pinned', () => {
    window.localStorage.setItem('xmsgi-history-filters', JSON.stringify({
      sourceFilter: 'workspace',
      sourceFilterPinned: true,
      statusFilter: 'scheduled',
    }));
    const { container } = render(
      <LocaleProvider>
        <HistoryDrawer
          isOpen
          sourceFilterOnOpen="personal"
          sourceFilterOnOpenMode="initial"
          onClose={vi.fn()}
          records={[upcomingRecord, personalUpcomingRecord]}
          onCancel={vi.fn()}
          onReschedule={vi.fn()}
          onSendNow={vi.fn()}
          onDelete={vi.fn()}
          onOpenDraft={vi.fn()}
          onClearSent={vi.fn()}
          onClearDrafts={vi.fn().mockResolvedValue(true)}
          onCancelQueue={vi.fn().mockResolvedValue(true)}
        />
      </LocaleProvider>,
    );

    expect(container.querySelector('[data-history-filter="personal"]')).toHaveAttribute('aria-pressed', 'true');
    expect(JSON.parse(window.localStorage.getItem('xmsgi-history-filters') ?? '{}')).toMatchObject({
      sourceFilter: 'personal',
      sourceFilterPinned: true,
    });
  });

  it('opens the requested Posts category and restores the saved category on close', () => {
    window.localStorage.setItem('xmsgi-history-filters', JSON.stringify({
      sourceFilter: 'all',
      statusFilter: 'scheduled',
    }));
    const renderDrawer = (isOpen: boolean, statusFilterOnOpen?: 'sent' | 'scheduled' | 'drafts') => (
      <LocaleProvider>
        <HistoryDrawer
          isOpen={isOpen}
          statusFilterOnOpen={statusFilterOnOpen}
          onClose={vi.fn()}
          records={[upcomingRecord, completedRecord, workspaceSentRecord]}
          onCancel={vi.fn()}
          onReschedule={vi.fn()}
          onSendNow={vi.fn()}
          onDelete={vi.fn()}
          onOpenDraft={vi.fn()}
          onClearSent={vi.fn()}
          onClearDrafts={vi.fn().mockResolvedValue(true)}
          onCancelQueue={vi.fn().mockResolvedValue(true)}
        />
      </LocaleProvider>
    );
    const { container, rerender } = render(renderDrawer(true, 'sent'));

    expect(container.querySelector('[data-history-filter="sent"]')).toHaveAttribute('aria-selected', 'true');
    expect(container.querySelector('[data-history-filter="scheduled"]')).toHaveAttribute('aria-selected', 'false');
    expect(JSON.parse(window.localStorage.getItem('xmsgi-history-filters') ?? '{}').statusFilter).toBe('scheduled');

    rerender(renderDrawer(false));
    expect(JSON.parse(window.localStorage.getItem('xmsgi-history-filters') ?? '{}').statusFilter).toBe('scheduled');
    rerender(renderDrawer(true));
    expect(container.querySelector('[data-history-filter="scheduled"]')).toHaveAttribute('aria-selected', 'true');
    window.localStorage.removeItem('xmsgi-history-filters');
  });

});

function mockHistoryRecordScroll(container: HTMLElement, recordBounds = { top: 350, height: 100 }, scale = 1) {
  const list = container.querySelector('.history-record-list') as HTMLDivElement;
  const record = list.querySelector('.history-record') as HTMLElement;
  const dateHeading = list.querySelector('.history-date-heading') as HTMLElement;
  const scrollTo = vi.fn();
  Object.defineProperties(list, {
    clientHeight: { configurable: true, value: 300 },
    offsetHeight: { configurable: true, value: 300 },
    scrollTop: { configurable: true, writable: true, value: 20 },
    getBoundingClientRect: { configurable: true, value: () => new DOMRect(0, 100 * scale, 400 * scale, 300 * scale) },
    scrollTo: { configurable: true, value: scrollTo },
  });
  Object.defineProperty(record, 'getBoundingClientRect', {
    configurable: true,
    value: () => new DOMRect(0, recordBounds.top * scale, 400 * scale, recordBounds.height * scale),
  });
  Object.defineProperty(dateHeading, 'getBoundingClientRect', {
    configurable: true,
    value: () => new DOMRect(0, 100 * scale, 400 * scale, 34 * scale),
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
  beforeEach(() => {
    window.localStorage.removeItem('xmsgi-history-filters');
    window.localStorage.setItem('awaitmsg_locale', 'ru');
  });

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

  it('renders the history interface in English when English is selected', () => {
    window.localStorage.setItem('awaitmsg_locale', 'en');
    renderHistory();

    expect(screen.getByRole('dialog', { name: 'Posts' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Search history' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Search history' })).toHaveAttribute('placeholder', 'Search history...');
    expect(screen.getByRole('tab', { name: 'Scheduled' })).toBeInTheDocument();
  });

  it('hides the reminders category in Personal posts', () => {
    renderHistory([]);

    fireEvent.click(screen.getByRole('button', { name: 'Планер' }));

    expect(screen.queryByRole('tab', { name: /Напоминания/ })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /План/ })).toBeInTheDocument();
  });

  it('resets a previously selected reminders category when opening Posts', () => {
    window.localStorage.setItem('xmsgi-history-filters', JSON.stringify({
      sourceFilter: 'personal',
      statusFilter: 'notes',
    }));
    renderHistory([]);

    expect(screen.queryByRole('tab', { name: /Напоминания/ })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /План/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('restores the source and status tabs after remounting', () => {
    const draft = normalizeSavedDraft({
      id: 'persisted-history-draft',
      name: 'Persisted draft',
      body: 'Draft content',
      color: 'coral',
      createdAt: '2026-09-28T10:00:00.000Z',
      updatedAt: '2026-09-29T18:35:00.000Z',
    });
    const firstView = renderHistory([upcomingRecord, draft]);
    fireEvent.click(screen.getByRole('button', { name: 'Studio' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Черновики' }));
    firstView.unmount();

    const secondView = renderHistory([upcomingRecord, draft]);
    try {
      expect(screen.getByRole('button', { name: 'Studio' })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByRole('tab', { name: 'Черновики' })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByText('Persisted draft')).toBeInTheDocument();
    } finally {
      secondView.unmount();
    }
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

  it('shows failed retry attempts in All and hides them from Studio', () => {
    const retryFailure = normalizeScheduledMessages([{
      ...scheduledMessage,
      id: 'failed-attempt-1',
      text: 'Неудачная повторная отправка',
      status: 'failed',
      lastError: 'Telegram rejected the previous attempt.',
      retryAction: 'send',
    }], 'workspace', 'upcoming', [channel])[0];

    renderHistory([upcomingRecord, retryFailure]);

    expect(screen.getByText('Релиз нового набора шаблонов для Telegram-канала')).toBeInTheDocument();
    expect(screen.getByText('Неудачная повторная отправка')).toBeInTheDocument();
    selectHistorySource('Studio');
    expect(screen.queryByText('Неудачная повторная отправка')).not.toBeInTheDocument();
    expect(screen.queryByText('Telegram rejected the previous attempt.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Повторить отправку' })).not.toBeInTheDocument();
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

  it('loads saved Studio drafts from browser fallback storage when the desktop bridge is unavailable', async () => {
    const originalDraftStorage = Object.getOwnPropertyDescriptor(window, 'draftStorage');
    try {
      Reflect.deleteProperty(window, 'draftStorage');
      expect(writeWorkspaceDraftStoreFallback({
        schemaVersion: 3,
        migrationVersion: 1,
        savedDrafts: [{
          id: 'browser-studio-draft',
          name: 'Browser draft',
          body: 'Draft available without the desktop bridge',
          createdAt: '2026-09-28T10:00:00.000Z',
          updatedAt: '2026-09-29T18:35:00.000Z',
        }],
        workspaceDraft: null,
        documentHistories: {},
      })).toBe(true);

      renderHistory([]);
      fireEvent.click(screen.getByRole('tab', { name: 'Черновики' }));

      expect(await screen.findByText('Browser draft')).toBeInTheDocument();
    } finally {
      if (originalDraftStorage) Object.defineProperty(window, 'draftStorage', originalDraftStorage);
      else Reflect.deleteProperty(window, 'draftStorage');
      window.localStorage.removeItem('xmsgi-draft-store-fallback');
      window.localStorage.removeItem('awaitmsg-draft-store-fallback');
    }
  });

  it('shows a load error instead of claiming saved drafts are absent', async () => {
    const originalDraftStorage = Object.getOwnPropertyDescriptor(window, 'draftStorage');
    try {
      Object.defineProperty(window, 'draftStorage', {
        configurable: true,
        value: { load: vi.fn().mockResolvedValue({ success: false, error: 'storage unavailable' }) },
      });

      renderHistory([]);
      fireEvent.click(screen.getByRole('tab', { name: 'Черновики' }));

      expect(await screen.findByText('Черновики не загружены.')).toBeInTheDocument();
      expect(screen.queryByText('В этой категории пока пусто')).not.toBeInTheDocument();
    } finally {
      if (originalDraftStorage) Object.defineProperty(window, 'draftStorage', originalDraftStorage);
      else Reflect.deleteProperty(window, 'draftStorage');
    }
  });

  it('refreshes saved Studio drafts while Posts remains open', async () => {
    const originalDraftStorage = Object.getOwnPropertyDescriptor(window, 'draftStorage');
    const draft = {
      id: 'live-studio-draft',
      name: 'Newly saved draft',
      body: 'Saved while Posts is open',
      createdAt: '2026-09-28T10:00:00.000Z',
      updatedAt: '2026-09-29T18:35:00.000Z',
    };
    const load = vi.fn()
      .mockResolvedValueOnce({
        success: true,
        store: { schemaVersion: 1, migrationVersion: 1, savedDrafts: [], workspaceDraft: null },
      })
      .mockResolvedValue({
        success: true,
        store: { schemaVersion: 1, migrationVersion: 1, savedDrafts: [draft], workspaceDraft: null },
      });
    Object.defineProperty(window, 'draftStorage', {
      configurable: true,
      value: { load },
    });

    try {
      renderHistory([]);
      fireEvent.click(screen.getByRole('tab', { name: 'Черновики' }));
      expect(await screen.findByText('В этой категории пока пусто')).toBeInTheDocument();

      window.dispatchEvent(new Event(SAVED_STUDIO_DRAFTS_UPDATED_EVENT));

      expect(await screen.findByText('Newly saved draft')).toBeInTheDocument();
      expect(load).toHaveBeenCalledTimes(2);
    } finally {
      if (originalDraftStorage) Object.defineProperty(window, 'draftStorage', originalDraftStorage);
      else Reflect.deleteProperty(window, 'draftStorage');
    }
  });

  it('does not show stale Studio drafts while reloading Posts after closing and reopening', async () => {
    const originalDraftStorage = Object.getOwnPropertyDescriptor(window, 'draftStorage');
    const oldDraft = {
      id: 'old-draft',
      name: 'Old draft',
      body: 'Old content',
      createdAt: '2026-09-28T10:00:00.000Z',
      updatedAt: '2026-09-28T10:00:00.000Z',
    };
    const newDraft = {
      id: 'new-draft',
      name: 'New draft',
      body: 'New content',
      createdAt: '2026-09-29T10:00:00.000Z',
      updatedAt: '2026-09-29T10:00:00.000Z',
    };
    const storeFor = (draft: typeof oldDraft) => ({
      schemaVersion: 1,
      migrationVersion: 1,
      savedDrafts: [draft],
      workspaceDraft: null,
    });
    let resolveReload!: (result: { success: boolean; store: ReturnType<typeof storeFor> }) => void;
    const reload = new Promise<{ success: boolean; store: ReturnType<typeof storeFor> }>((resolve) => {
      resolveReload = resolve;
    });
    const load = vi.fn()
      .mockResolvedValueOnce({ success: true, store: storeFor(oldDraft) })
      .mockReturnValueOnce(reload);
    Object.defineProperty(window, 'draftStorage', {
      configurable: true,
      value: { load },
    });

    const drawer = (isOpen: boolean) => (
      <LocaleProvider>
        <HistoryDrawer
          isOpen={isOpen}
          onClose={vi.fn()}
          records={[]}
          onCancel={vi.fn()}
          onReschedule={vi.fn()}
          onSendNow={vi.fn()}
          onDelete={vi.fn()}
          onOpenDraft={vi.fn()}
          onClearSent={vi.fn()}
          onClearDrafts={vi.fn().mockResolvedValue(true)}
        />
      </LocaleProvider>
    );

    try {
      const view = render(drawer(true));
      fireEvent.click(screen.getByRole('tab', { name: 'Черновики' }));
      expect(await screen.findByText('Old draft')).toBeInTheDocument();

      view.rerender(drawer(false));
      view.rerender(drawer(true));

      expect(screen.queryByText('Old draft')).not.toBeInTheDocument();
      expect(screen.getByText('Черновики загружаются.')).toBeInTheDocument();
      await act(async () => {
        resolveReload({ success: true, store: storeFor(newDraft) });
        await reload;
      });
      expect(await screen.findByText('New draft')).toBeInTheDocument();
    } finally {
      if (originalDraftStorage) Object.defineProperty(window, 'draftStorage', originalDraftStorage);
      else Reflect.deleteProperty(window, 'draftStorage');
    }
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
      const view = render(<LocaleProvider><HistoryDrawer {...props} isOpen={false} /></LocaleProvider>);

      view.rerender(<LocaleProvider><HistoryDrawer {...props} isOpen /></LocaleProvider>);

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

  it('finds records by attachment name', () => {
    searchHistory('brief.pdf');

    expect(screen.getByText('XMSGi Updates')).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(1);
  });

  it('shows frequent hashtags as quick filters and searches by clicking one', () => {
    const taggedRecord = normalizeScheduledMessages([{
      ...scheduledMessage,
      id: 'tagged-record',
      text: 'Запуск #studio #release',
    }], 'workspace', 'sent', [channel])[0];
    const repeatedTagRecord = normalizeScheduledMessages([{
      ...scheduledMessage,
      id: 'repeated-tag-record',
      text: 'План #release',
      attachments: [],
    }], 'personal', 'sent', [])[0];
    const { container } = renderHistory([taggedRecord, repeatedTagRecord]);

    const tagGroup = within(screen.getByRole('group', { name: 'Фильтр по хэштегам' }));
    expect(tagGroup.getByRole('button', { name: '#release' })).toHaveAttribute('title', '#release (2)');
    expect(tagGroup.getByRole('button', { name: '#studio' })).toBeInTheDocument();

    fireEvent.click(tagGroup.getByRole('button', { name: '#release' }));

    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(screen.getByRole('textbox', { name: 'Поиск по истории' })).toHaveValue('#release');
    expect(container.querySelector('.history-search-tags')).not.toBeInTheDocument();
  });

  it('matches hashtags without case sensitivity and supports Cyrillic hashtags', () => {
    const taggedRecord = normalizeScheduledMessages([{
      ...scheduledMessage,
      id: 'cyrillic-tagged-record',
      text: 'Обновление #РелизКанала',
    }], 'workspace', 'sent', [channel])[0];

    renderHistory([taggedRecord]);
    fireEvent.change(screen.getByRole('textbox', { name: 'Поиск по истории' }), {
      target: { value: '#релизканала' },
    });

    expect(screen.getByText('XMSGi Updates')).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(1);
  });

  it('finds Planner drafts by reminder type', () => {
    const plannerDraft = normalizePlannerDraft(
      'Собрать материалы',
      null,
      '2026-09-29T17:30:00.000Z',
      [],
      [],
      'meeting',
    );
    renderHistory(plannerDraft ? [plannerDraft] : []);
    fireEvent.click(screen.getByRole('tab', { name: 'Черновики' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Поиск по истории' }), {
      target: { value: 'встреча' },
    });

    expect(screen.getByRole('article')).toHaveTextContent('Собрать материалы');
  });

  it('counts results within the selected category and clears an empty search', () => {
    renderHistory([upcomingRecord, personalUpcomingRecord, completedRecord]);
    expect(screen.getByText('Показано 2 из 2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Планер' }));
    expect(screen.getByText('Показано 1 из 1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Экспортировать текущую категорию' }));
    expect(screen.getByRole('menu', { name: 'Формат экспорта' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Поиск по истории' }), {
      target: { value: 'нет такого сообщения' },
    });

    expect(screen.getByText('Найдено 0 из 2')).toBeInTheDocument();
    expect(screen.getByText('Ничего не найдено')).toBeInTheDocument();
    expect(screen.queryByRole('menu', { name: 'Формат экспорта' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Очистить поиск' }));

    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByText('Показано 1 из 1')).toBeInTheDocument();
  });

  it('reserves the clear-button slot while the search is empty', () => {
    const { container } = renderHistory();
    const clearButton = container.querySelector<HTMLButtonElement>('.history-search-clear')!;

    expect(clearButton).toBeDisabled();
    expect(clearButton).toHaveClass('is-reserved');
    fireEvent.change(screen.getByRole('textbox', { name: 'Поиск по истории' }), {
      target: { value: 'x' },
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

  it('keeps one date strip pinned and updates its label while scrolling Posts', () => {
    const styles = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../index.css'), 'utf8');
    window.localStorage.setItem('xmsgi-history-filters', JSON.stringify({ statusFilter: 'drafts' }));
    const firstDraft = normalizeSavedDraft({
      id: 'posts-first-day',
      name: 'First draft',
      body: 'First',
      createdAt: '2026-09-29T10:00:00.000Z',
      updatedAt: '2026-09-29T10:00:00.000Z',
    });
    const secondDraft = normalizeSavedDraft({
      id: 'posts-next-day',
      name: 'Second draft',
      body: 'Second',
      createdAt: '2026-09-30T10:00:00.000Z',
      updatedAt: '2026-09-30T10:00:00.000Z',
    });
    const { container } = renderHistoryPage([firstDraft, secondDraft]);
    const list = container.querySelector<HTMLDivElement>('.history-record-list')!;
    const stickyDate = container.querySelector<HTMLDivElement>('.history-date-sticky')!;
    const [firstRecord, secondRecord] = Array.from(list.querySelectorAll<HTMLElement>('.history-record'));

    expect(list.querySelectorAll('.history-date-heading')).toHaveLength(0);
    expect(container.querySelector('.history-list-pane')).toContainElement(stickyDate);
    expect(container.querySelector('.history-list-pane')).toContainElement(list);
    expect(stickyDate.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(stickyDate).toHaveTextContent(firstRecord.dataset.historyDayLabel!);
    expect(styles).toMatch(
      /\.history-date-sticky\s*\{[^}]*display:\s*block;[^}]*flex:\s*0 0 auto;[^}]*width:\s*100%;[^}]*box-sizing:\s*border-box;/,
    );
    Object.defineProperty(list, 'clientTop', { configurable: true, value: 0 });
    Object.defineProperty(list, 'getBoundingClientRect', {
      configurable: true,
      value: () => new DOMRect(0, 0, 400, 300),
    });
    Object.defineProperty(firstRecord, 'getBoundingClientRect', {
      configurable: true,
      value: () => new DOMRect(0, -120, 400, 100),
    });
    Object.defineProperty(secondRecord, 'getBoundingClientRect', {
      configurable: true,
      value: () => new DOMRect(0, 20, 400, 100),
    });

    fireEvent.scroll(list);
    expect(stickyDate).toHaveTextContent(secondRecord.dataset.historyDayLabel!);
  });

  it('renders a month heading inside the scrolling list for each scheduled and sent month', () => {
    const scheduledStudioRecord = normalizeScheduledMessages([{
      ...scheduledMessage,
      id: 'scheduled-studio-september',
      when: '2026-09-30T17:30:00.000Z',
    }], 'workspace', 'upcoming', [channel])[0];
    const scheduledPlannerRecord = normalizeScheduledMessages([{
      ...scheduledMessage,
      id: 'scheduled-planner-october',
      when: '2026-10-01T17:30:00.000Z',
    }], 'personal', 'upcoming', [])[0];
    const sentStudioRecord = normalizeScheduledMessages([{
      ...scheduledMessage,
      id: 'sent-studio-september',
      sentAt: '2026-09-30T18:00:00.000Z',
      status: 'sent',
    }], 'workspace', 'sent', [channel])[0];
    const sentPlannerRecord = normalizeScheduledMessages([{
      ...scheduledMessage,
      id: 'sent-planner-october',
      sentAt: '2026-10-01T18:00:00.000Z',
      status: 'sent',
    }], 'personal', 'sent', [])[0];
    const { container } = renderHistoryPage([
      scheduledStudioRecord,
      scheduledPlannerRecord,
      sentStudioRecord,
      sentPlannerRecord,
    ]);
    const styles = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../index.css'), 'utf8');
    const list = container.querySelector<HTMLDivElement>('.history-record-list')!;
    const scheduledRows = Array.from(list.querySelectorAll<HTMLElement>('.history-record'));
    const monthHeadings = Array.from(list.querySelectorAll<HTMLElement>('.history-month-heading'));

    expect(container.querySelector('.history-date-sticky')).toBeInTheDocument();
    expect(list).toContainElement(monthHeadings[0]);
    expect(monthHeadings).toHaveLength(2);
    expect(monthHeadings[0]).toHaveTextContent(scheduledRows[0].dataset.historyMonthLabel!);
    expect(styles).toMatch(
      /\.history-month-heading\s*\{[^}]*width:\s*calc\(100% \+ 32px\);[^}]*margin:\s*0 -16px;/,
    );
    expect(scheduledRows).toHaveLength(2);
    expect(scheduledRows[0].dataset.historyMonthLabel).not.toBe(scheduledRows[1].dataset.historyMonthLabel);

    fireEvent.click(container.querySelector('[data-history-filter="sent"]')!);
    const sentRows = Array.from(container.querySelectorAll<HTMLElement>('.history-record'));
    const sentHeadings = Array.from(container.querySelectorAll<HTMLElement>('.history-month-heading'));
    expect(container.querySelector('.history-date-sticky')).toBeInTheDocument();
    expect(sentRows).toHaveLength(2);
    expect(sentHeadings).toHaveLength(2);
    expect(sentHeadings[0]).toHaveTextContent(sentRows[0].dataset.historyMonthLabel!);
  });

  it('orders scheduled Posts by their planned date instead of their update time', () => {
    const records = normalizeScheduledMessages([
      {
        ...scheduledMessage,
        id: 'scheduled-sooner',
        when: '2026-09-29T17:30:00.000Z',
        lastAttemptAt: '2026-09-30T17:30:00.000Z',
      },
      {
        ...scheduledMessage,
        id: 'scheduled-later',
        when: '2026-09-30T17:30:00.000Z',
        lastAttemptAt: '2026-09-29T17:30:00.000Z',
      },
    ], 'workspace', 'upcoming', [channel]);
    const { container } = renderHistoryPage(records);
    const recordIds = Array.from(container.querySelectorAll<HTMLElement>('[data-history-record-id]'))
      .map((record) => record.dataset.historyRecordId);

    expect(recordIds).toEqual([
      'workspace:message:scheduled-sooner',
      'workspace:message:scheduled-later',
    ]);
  });

  it('shows failed retry rows in the dedicated Errors category', () => {
    const failedRecord = normalizeScheduledMessages([{
      ...scheduledMessage,
      id: 'failed-compact-row',
      attachments: [],
      status: 'failed' as ScheduledMessage['status'],
      lastError: 'Telegram не подтвердил отправку.',
      lastErrorDetails: {
        operation: 'publish',
        category: 'flood',
        retryable: true,
        message: 'Telegram не подтвердил отправку.',
        code: 'FLOOD_WAIT_45',
        waitSeconds: 45,
      },
      retryAction: 'send',
    }], 'workspace', 'upcoming', [channel])[0];
    const cancelledRecord = normalizeScheduledMessages([{
      ...scheduledMessage,
      id: 'cancelled-compact-row',
      attachments: [],
      text: 'Cancelled entry remains visible',
      status: 'cancelled' as ScheduledMessage['status'],
    }], 'personal', 'upcoming', [])[0];
    const imageRecord = { ...upcomingRecord, attachments: ['C:\\files\\launch-image.png'] };

    const { container } = renderHistoryPage([imageRecord, failedRecord, cancelledRecord]);

    const attachmentPreview = screen.getByLabelText('1 вложение');
    expect(attachmentPreview).toBeInTheDocument();
    expect(attachmentPreview.querySelector('img')).toHaveAttribute('src', expect.stringContaining('launch-image.png'));
    fireEvent.error(attachmentPreview.querySelector('img') as HTMLImageElement);
    expect(attachmentPreview.querySelector('.history-record-attachment-image')).toHaveClass('is-unavailable');
    expect(screen.getAllByText(/Запланировано ·/)[0].parentElement).toHaveClass('history-record-meta');
    expect(screen.getByText('Cancelled entry remains visible')).toBeInTheDocument();
    expect(screen.getByText('Telegram не подтвердил отправку.')).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Ошибки' })).not.toBeInTheDocument();
    const errorFilter = openSourceMenu().container.querySelector<HTMLButtonElement>('[data-history-filter="errors"]')!;
    expect(errorFilter).toHaveTextContent('1');
    fireEvent.click(errorFilter);
    expect(screen.getByText('Telegram не подтвердил отправку.')).toBeInTheDocument();
    fireEvent.click(container.querySelector('.history-record-open')!);
    expect(screen.getByRole('button', { name: 'Открыть в редакторе' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Повторить отправку' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(1);
  });

  it('switches from Errors to the selected source without showing its errors', () => {
    const failedRecord = normalizeScheduledMessages([{
      ...scheduledMessage,
      id: 'failed-source-switch',
      status: 'failed' as ScheduledMessage['status'],
      lastError: 'Telegram is temporarily unavailable.',
    }], 'workspace', 'upcoming', [channel])[0];
    const plannerFailedRecord = normalizeScheduledMessages([{
      ...scheduledMessage,
      id: 'failed-planner-source-switch',
      status: 'failed' as ScheduledMessage['status'],
      lastError: 'Planner error should stay hidden for Studio.',
    }], 'personal', 'upcoming', [channel])[0];
    const { container } = renderHistoryPage([failedRecord, plannerFailedRecord, upcomingRecord]);

    selectHistoryErrors();
    expect(screen.getByText('Telegram is temporarily unavailable.')).toBeInTheDocument();

    selectHistorySource('Studio');

    expect(container.querySelector('.history-source-select')).toHaveTextContent(/Studio/);
    expect(screen.queryByText('Telegram is temporarily unavailable.')).not.toBeInTheDocument();
    expect(screen.queryByText('Planner error should stay hidden for Studio.')).not.toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByText('Релиз нового набора шаблонов для Telegram-канала')).toBeInTheDocument();
  });

  it('shows all sources with errors in All, but keeps Studio and Planner free of errors', () => {
    const studioError = normalizeScheduledMessages([{
      ...scheduledMessage,
      id: 'failed-studio-section',
      status: 'failed' as ScheduledMessage['status'],
      lastError: 'Studio section error.',
    }], 'workspace', 'upcoming', [channel])[0];
    const plannerError = normalizeScheduledMessages([{
      ...scheduledMessage,
      id: 'failed-planner-section',
      status: 'failed' as ScheduledMessage['status'],
      lastError: 'Planner section error.',
    }], 'personal', 'upcoming', [channel])[0];

    renderHistoryPage([upcomingRecord, personalUpcomingRecord, studioError, plannerError]);
    expect(screen.getAllByRole('article')).toHaveLength(4);
    expect(screen.getByText('Studio section error.')).toBeInTheDocument();
    expect(screen.getByText('Planner section error.')).toBeInTheDocument();

    selectHistorySource('Studio');
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByText('Релиз нового набора шаблонов для Telegram-канала')).toBeInTheDocument();
    expect(screen.queryByText('Studio section error.')).not.toBeInTheDocument();
    expect(screen.queryByText('Planner section error.')).not.toBeInTheDocument();

    selectHistorySource('Planner');
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByText('Подтвердить встречу')).toBeInTheDocument();
    expect(screen.queryByText('Studio section error.')).not.toBeInTheDocument();
    expect(screen.queryByText('Planner section error.')).not.toBeInTheDocument();

    selectHistoryErrors();
    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(screen.getByText('Studio section error.')).toBeInTheDocument();
    expect(screen.getByText('Planner section error.')).toBeInTheDocument();
    expect(screen.queryByText('Подтвердить встречу')).not.toBeInTheDocument();
  });

  it('keeps failed records out of Drafts even when All is selected', () => {
    const failedRecord = normalizeScheduledMessages([{
      ...scheduledMessage,
      id: 'failed-excluded-from-drafts',
      status: 'failed' as ScheduledMessage['status'],
      lastError: 'This error must not appear in Drafts.',
    }], 'workspace', 'upcoming', [channel])[0];
    const plannerDraft = normalizePlannerDraft('Actual Planner draft', null, '2026-10-25T11:00:00.000Z');
    const { container } = renderHistoryPage(plannerDraft ? [failedRecord, plannerDraft] : [failedRecord]);

    fireEvent.click(container.querySelector('[data-history-filter="drafts"]')!);

    expect(screen.getByText('Actual Planner draft')).toBeInTheDocument();
    expect(screen.queryByText('This error must not appear in Drafts.')).not.toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(container.querySelector('[data-history-filter="drafts"] .history-filter-count')).toHaveTextContent('1');
  });

  it('does not restore Errors as the active category from saved filters', () => {
    const failedRecord = normalizeScheduledMessages([{
      ...scheduledMessage,
      id: 'failed-saved-errors-filter',
      status: 'failed' as ScheduledMessage['status'],
      lastError: 'Saved Errors should not remain selected.',
    }], 'workspace', 'upcoming', [channel])[0];
    window.localStorage.setItem('xmsgi-history-filters', JSON.stringify({
      sourceFilter: 'all',
      statusFilter: 'errors',
    }));

    const { container } = renderHistoryPage([failedRecord]);

    expect(screen.getByText('Saved Errors should not remain selected.')).toBeInTheDocument();
    expect(container.querySelector('[data-history-filter="scheduled"]')).toHaveAttribute('aria-selected', 'true');
  });

  it('selects Errors as its own source section without offering a second source menu', () => {
    const failedRecord = normalizeScheduledMessages([{
      ...scheduledMessage,
      id: 'failed-exclusive-menu-selection',
      status: 'failed' as ScheduledMessage['status'],
      lastError: 'Exclusive Errors category.',
    }], 'workspace', 'upcoming', [channel])[0];
    const { container } = renderHistoryPage([failedRecord]);

    selectHistoryErrors();
    expect(container.querySelector('.history-source-select')).toHaveTextContent(/^(Errors|Ошибки)/);
    const sourceMenu = openSourceMenu();
    expect(sourceMenu.getByRole('menuitemradio', { name: 'Ошибки' })).toHaveAttribute('aria-checked', 'true');
    expect(sourceMenu.getByRole('menuitemradio', { name: 'Studio' })).toHaveAttribute('aria-checked', 'false');
    expect(sourceMenu.getByRole('menuitemradio', { name: 'Все' })).toHaveAttribute('aria-checked', 'false');
    expect(sourceMenu.getByRole('menuitemradio', { name: 'Планер' })).toHaveAttribute('aria-checked', 'false');
  });

  it('switches from Errors to the All source when a regular category is selected', () => {
    const failedRecord = normalizeScheduledMessages([{
      ...scheduledMessage,
      id: 'failed-switch-to-all-source',
      status: 'failed' as ScheduledMessage['status'],
      lastError: 'The error is not part of the Sent list.',
    }], 'workspace', 'upcoming', [channel])[0];
    window.localStorage.setItem('xmsgi-history-filters', JSON.stringify({
      sourceFilter: 'workspace',
      statusFilter: 'scheduled',
    }));
    const { container } = renderHistoryPage([failedRecord, completedRecord, workspaceSentRecord]);

    selectHistoryErrors();
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByText('The error is not part of the Sent list.')).toBeInTheDocument();

    fireEvent.click(container.querySelector('[data-history-filter="sent"]')!);

    expect(container.querySelector('.history-source-select')).toHaveTextContent(/All|Все/);
    expect(container.querySelector('[data-history-filter="sent"]')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByRole('article')).toHaveLength(3);
    expect(screen.getByText('Подтвердить встречу')).toBeInTheDocument();
    expect(screen.getByText('The error is not part of the Sent list.')).toBeInTheDocument();
  });

  it('switches from compact Errors to Studio records without filtering the Errors list by source', () => {
    const plannerFailedRecord = normalizeScheduledMessages([{
      ...scheduledMessage,
      id: 'failed-planner-compact-source-switch',
      status: 'failed' as ScheduledMessage['status'],
      lastError: 'Planner compact error.',
    }], 'personal', 'upcoming', [channel])[0];
    const failedRecord = normalizeScheduledMessages([{
      ...scheduledMessage,
      id: 'failed-compact-source-switch',
      status: 'failed' as ScheduledMessage['status'],
      lastError: 'Telegram is temporarily unavailable.',
    }], 'workspace', 'upcoming', [channel])[0];
    renderHistory([failedRecord, plannerFailedRecord, upcomingRecord]);

    selectHistoryErrors();
    expect(screen.getByText('Telegram is temporarily unavailable.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Studio' }));

    expect(screen.getByRole('button', { name: 'Ошибки' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByText('Telegram is temporarily unavailable.')).not.toBeInTheDocument();
    expect(screen.queryByText('Planner compact error.')).not.toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByText('Релиз нового набора шаблонов для Telegram-канала')).toBeInTheDocument();
  });

  it('opens a failed post in Studio and puts deletion in its overflow menu', async () => {
    const failedRecord = normalizeScheduledMessages([{
      ...scheduledMessage,
      id: 'failed-open-editor',
      status: 'failed' as ScheduledMessage['status'],
      lastError: 'Telegram is temporarily unavailable.',
      retryAction: 'send',
    }], 'workspace', 'upcoming', [channel])[0];
    const onUseDraft = vi.fn().mockResolvedValue(true);
    const { container } = renderHistory(
      [failedRecord],
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn().mockResolvedValue(true),
      vi.fn().mockResolvedValue(true),
      onUseDraft,
    );
    selectHistoryErrors();

    expect(screen.queryByRole('button', { name: 'Повторить отправку' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Открыть в редакторе' }));
    await waitFor(() => expect(onUseDraft).toHaveBeenCalledWith(failedRecord, 'studio'));

    const overflowButton = container.querySelector<HTMLButtonElement>('.history-record-action.is-more')!;
    fireEvent.click(overflowButton);
    expect(screen.getByRole('menuitem', { name: 'Удалить' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Повторить отправку' })).not.toBeInTheDocument();
  });

  it('explains why a failed post did not go through in the Errors details panel', () => {
    const failedRecord = normalizeScheduledMessages([{
      ...scheduledMessage,
      id: 'failed-reason-details',
      status: 'failed' as ScheduledMessage['status'],
      lastError: 'A wait of 45 seconds is required.',
      lastErrorDetails: {
        operation: 'publish',
        category: 'flood',
        retryable: true,
        message: 'A wait of 45 seconds is required.',
        code: 'FLOOD_WAIT_45',
        waitSeconds: 45,
      },
      retryAction: 'send',
    }], 'workspace', 'upcoming', [channel])[0];
    const { container } = renderHistoryPage([failedRecord], vi.fn());
    selectHistoryErrors();
    fireEvent.click(container.querySelector('.history-record-open')!);

    const toolbar = container.querySelector<HTMLElement>('.history-detail-toolbar')!;
    expect(within(toolbar).getAllByRole('button')).toHaveLength(2);
    expect(within(toolbar).getByRole('button', { name: 'Открыть в редакторе' })).toBeInTheDocument();
    expect(within(toolbar).getByRole('button', { name: 'Ещё' })).toBeInTheDocument();
    expect(within(toolbar).queryByRole('button', { name: 'Просмотр' })).not.toBeInTheDocument();
    expect(within(toolbar).queryByRole('button', { name: 'Копировать' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Почему произошла ошибка' })).toHaveTextContent('Telegram временно ограничил частоту публикаций.');
    expect(screen.getByRole('region', { name: 'Почему произошла ошибка' })).not.toHaveTextContent('A wait of 45 seconds is required.');
    expect(screen.getByRole('region', { name: 'Почему произошла ошибка' })).toHaveTextContent('Отправка публикации');
    expect(screen.getByRole('region', { name: 'Почему произошла ошибка' })).toHaveTextContent('Можно попробовать ещё раз.');
    expect(screen.getByRole('region', { name: 'Почему произошла ошибка' })).toHaveTextContent('Дождитесь окончания ограничения и попробуйте снова.');
    expect(screen.getByRole('region', { name: 'Почему произошла ошибка' })).toHaveTextContent('45 сек.');
    expect(screen.getByRole('region', { name: 'Почему произошла ошибка' })).toHaveTextContent('FLOOD_WAIT_45');
  });

  const commonTelegramErrors: Array<[string, string, string]> = [
    ['CHAT_WRITE_FORBIDDEN', 'Telegram не разрешает этому аккаунту публиковать такой материал в чате.', 'Попросите администратора чата разрешить публикации или выберите другой чат.'],
    ['PEER_ID_INVALID', 'Telegram не смог открыть этот чат.', 'Проверьте, открывается ли чат и есть ли у аккаунта к нему доступ.'],
    ['FILE_PART_2_MISSING', 'Telegram не смог обработать одно из вложений.', 'Проверьте файл и попробуйте прикрепить его заново.'],
    ['MESSAGE_TOO_LONG', 'Сообщение превышает допустимую длину Telegram.', 'Сократите сообщение и попробуйте снова.'],
    ['SCHEDULE_DATE_TOO_LATE', 'Telegram не принял выбранное время планирования.', 'Выберите более позднее время и запланируйте публикацию снова.'],
  ];

  it.each(commonTelegramErrors)('shows a clear explanation and next step for %s', (code, cause, nextStep) => {
    const rawError = `Telegram error: ${code}`;
    const failedRecord = normalizeScheduledMessages([{
      ...scheduledMessage,
      id: `failed-${code}`,
      status: 'failed' as ScheduledMessage['status'],
      lastError: rawError,
      lastErrorDetails: {
        operation: 'publish',
        category: 'unknown',
        retryable: false,
        message: rawError,
        code,
      },
      retryAction: 'send',
    }], 'workspace', 'upcoming', [channel])[0];
    const { container, unmount } = renderHistoryPage([failedRecord]);
    selectHistoryErrors();
    fireEvent.click(container.querySelector('.history-record-open')!);

    const explanation = screen.getByRole('region', { name: 'Почему произошла ошибка' });
    expect(explanation).toHaveTextContent(cause);
    expect(explanation).toHaveTextContent(nextStep);
    expect(explanation).not.toHaveTextContent(rawError);
    expect(explanation).toHaveTextContent(code);
    unmount();
  });

  it('shows a concise actionable description when Telegram sent a scheduled post immediately', () => {
    const rawError = 'Telegram sent the message immediately instead of scheduling it.';
    const failedRecord = normalizeScheduledMessages([{
      ...scheduledMessage,
      id: 'failed-immediate-schedule',
      status: 'failed' as ScheduledMessage['status'],
      lastError: rawError,
      lastErrorDetails: {
        operation: 'publish',
        category: 'unknown',
        retryable: false,
        message: rawError,
        code: 'TELEGRAM_SCHEDULE_SENT_IMMEDIATELY',
      },
      retryAction: 'schedule',
    }], 'workspace', 'upcoming', [channel])[0];
    const { container } = renderHistoryPage([failedRecord]);
    selectHistoryErrors();
    fireEvent.click(container.querySelector('.history-record-open')!);

    const explanation = container.querySelector<HTMLElement>('.history-detail-error-explanation')!;
    expect(explanation).toHaveAttribute('aria-label', 'Что произошло');
    expect(explanation).toHaveTextContent('Что произошло');
    expect(explanation).toHaveTextContent(
      'Telegram отправил публикацию сразу, не запланировав её. Проверьте чат перед повторной отправкой.',
    );
    expect(explanation).not.toHaveTextContent(rawError);
    expect(explanation).not.toHaveTextContent('Автоматически повторить действие нельзя.');
    expect(explanation).not.toHaveTextContent('Планирование публикации');
    expect(explanation).not.toHaveTextContent('TELEGRAM_SCHEDULE_SENT_IMMEDIATELY');
  });

  it('filters the single Posts list across All, Studio, and Planner sources', () => {
    renderHistory([upcomingRecord, personalUpcomingRecord]);

    expect(screen.getAllByRole('article')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Studio' }));
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByText('XMSGi Updates')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Планер' }));
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByRole('article')).toHaveTextContent('Подтвердить встречу');

    fireEvent.click(screen.getByRole('button', { name: 'Все' }));
    expect(screen.getAllByRole('article')).toHaveLength(2);
  });

  it('shows the most recently created scheduled record first across Planner and Studio in All', () => {
    const olderPersonalRecord = normalizeScheduledMessages([{
      ...scheduledMessage,
      id: 'older-personal',
      chatName: 'Planner older',
      createdAt: '2026-10-05T10:00:00.000Z',
      when: '2026-10-13T23:17:00.000Z',
    }], 'personal', 'upcoming', [])[0];
    const newerStudioRecord = normalizeScheduledMessages([{
      ...scheduledMessage,
      id: 'newer-studio',
      chatName: 'Studio newer',
      createdAt: '2026-10-05T12:00:00.000Z',
      when: '2026-10-07T23:17:00.000Z',
    }], 'workspace', 'upcoming', [channel])[0];

    renderHistory([olderPersonalRecord, newerStudioRecord]);

    const titles = screen.getAllByRole('article').map((article) => (
      article.querySelector('.history-record-heading strong')?.textContent
    ));
    expect(titles).toEqual(['Studio newer', 'Planner older']);
  });

  it('shows Planner drafts beside Studio posts in the shared Posts history', () => {
    const plannerDraft = normalizePlannerDraft('A saved Planner draft', null, '2026-10-06T10:00:00.000Z', [], [], 'meeting');
    renderHistory([upcomingRecord, personalUpcomingRecord, ...(plannerDraft ? [plannerDraft] : [])]);

    fireEvent.click(screen.getByRole('tab', { name: 'Черновики' }));
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByRole('article')).toHaveTextContent('A saved Planner draft');
    expect(screen.getByLabelText('Встреча')).toHaveAttribute('data-reminder-type', 'meeting');
    fireEvent.click(screen.getByRole('button', { name: 'Планер' }));

    expect(screen.getByRole('tab', { name: 'Черновики' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Черновики' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByRole('article')).toHaveTextContent('A saved Planner draft');
  });

  it('opens saved Quick Planner drafts in the editor that opened Posts', async () => {
    const savedPlannerDraft = normalizeSavedPlannerDraft({
      id: 'saved-idea-1',
      message: 'An idea saved from Quick Planner',
      attachments: [],
      entities: [],
      reminderType: 'idea',
      savedAt: '2026-10-06T10:00:00.000Z',
    });
    const onUseDraft = vi.fn();
    renderHistory(
      [savedPlannerDraft],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      onUseDraft,
      'planner',
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Черновики' }));
    expect(screen.getByRole('article')).toHaveTextContent('An idea saved from Quick Planner');
    expect(screen.getByLabelText('Идея')).toHaveAttribute('data-reminder-type', 'idea');
    fireEvent.click(screen.getByRole('button', { name: /Использовать черновик/ }));

    expect(onUseDraft).toHaveBeenCalledWith(savedPlannerDraft, 'planner');
    expect(screen.queryByText(/Где открыть черновик/)).not.toBeInTheDocument();
    expect(document.querySelector('.history-detail-draft-menu')).toBeNull();
    expect(document.querySelector('.history-draft-destination-menu')).toBeNull();
  });

  it('keeps Posts rendering for a legacy Quick Planner draft without a saved date', () => {
    const legacyDraft = normalizeSavedPlannerDraft({
      id: 'legacy-saved-idea',
      message: 'A legacy Planner draft without a date',
      attachments: [],
      entities: [],
      reminderType: null,
      savedAt: '',
    });
    renderHistory([legacyDraft]);

    fireEvent.click(screen.getByRole('tab', { name: 'Черновики' }));

    expect(screen.getByRole('article')).toHaveTextContent('A legacy Planner draft without a date');
    expect(screen.getByRole('article').querySelector('time')).not.toHaveAttribute('datetime', '');
  });

  it.each([
    ['Планер', 'planner'],
    ['Студия', 'studio'],
  ] as const)('opens a Quick Planner draft directly in the active %s editor', async (_destinationLabel, destination) => {
    const plannerDraft = normalizePlannerDraft(
      'An editable Quick Planner note',
      channel,
      '2026-10-06T10:00:00.000Z',
      [{ type: 'bold', offset: 3, length: 8 }],
      ['C:\\files\\planner-note.pdf'],
    );
    expect(plannerDraft).not.toBeNull();
    const { onUseDraft, onClose } = renderHistory(
      [plannerDraft!],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      destination,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Черновики' }));

    fireEvent.click(screen.getByRole('button', { name: `Использовать черновик: ${plannerDraft!.title}` }));

    expect(onUseDraft).toHaveBeenCalledWith(plannerDraft, destination);
    expect(screen.queryByText(/Where would you like to open/)).not.toBeInTheDocument();
    expect(document.querySelector('.history-detail-draft-menu')).toBeNull();
    expect(document.querySelector('.history-draft-destination-menu')).toBeNull();
    await waitFor(() => expect(onClose).toHaveBeenCalledWith(false));
  });

  it('keeps Posts open when using a draft in the active editor fails', async () => {
    window.localStorage.setItem('awaitmsg_locale', 'en');
    const plannerDraft = normalizePlannerDraft(
      'An editable Quick Planner note',
      channel,
      '2026-10-06T10:00:00.000Z',
    )!;
    const onUseDraft = vi.fn().mockResolvedValue(false);
    const { onClose } = renderHistory([plannerDraft], undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, onUseDraft);
    fireEvent.click(screen.getByRole('tab', { name: 'Drafts' }));
    fireEvent.click(screen.getByRole('button', { name: `Open post: ${plannerDraft.title}` }));
    fireEvent.click(screen.getByRole('button', { name: /Use draft/ }));
    await waitFor(() => expect(onUseDraft).toHaveBeenCalledWith(plannerDraft, 'studio'));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Posts' })).toBeInTheDocument();
    expect(screen.queryByText(/Where would you like to open/)).not.toBeInTheDocument();
  });

  it('uses the active editor from the draft detail toolbar', async () => {
    window.localStorage.setItem('awaitmsg_locale', 'en');
    const plannerDraft = normalizePlannerDraft(
      'An editable Quick Planner note',
      channel,
      '2026-10-06T10:00:00.000Z',
    )!;
    const onUseDraft = vi.fn().mockResolvedValue(true);
    const onClose = vi.fn();
    render(
      <LocaleProvider>
        <HistoryDrawer
          isOpen
          pageMode
          onClose={onClose}
          records={[plannerDraft]}
          onCancel={vi.fn()}
          onReschedule={vi.fn()}
          onSendNow={vi.fn()}
          onDelete={vi.fn()}
          onOpenDraft={vi.fn()}
          onUseDraft={onUseDraft}
          draftDestination="planner"
          onClearSent={vi.fn()}
        />
      </LocaleProvider>,
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Drafts' }));
    fireEvent.click(screen.getByRole('button', { name: `Open post: ${plannerDraft.title}` }));
    fireEvent.click(screen.getByRole('button', { name: 'Use text' }));

    await waitFor(() => {
      expect(onUseDraft).toHaveBeenCalledWith(plannerDraft, 'studio');
      expect(onClose).toHaveBeenCalledWith(false);
    });
    expect(screen.queryByText(/Where would you like to open/)).not.toBeInTheDocument();
    expect(document.querySelector('.history-detail-draft-menu')).toBeNull();
    expect(document.querySelector('.history-draft-destination-menu')).toBeNull();
  });

  it('mentions drafts in the empty Planner state', () => {
    renderHistory([upcomingRecord]);

    fireEvent.click(screen.getByRole('button', { name: 'Планер' }));

    expect(screen.getByText('Публикации и черновики планера появятся здесь.')).toBeInTheDocument();
  });

  it('places a personal scheduled send action in More and asks for confirmation', () => {
    const { onSendNow } = renderHistory([personalUpcomingRecord]);

    expect(screen.queryByRole('button', { name: 'Отправить сейчас' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ещё' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Отправить сейчас' }));

    const confirmation = screen.getByRole('alertdialog', { name: 'Подтвердить отправку' });
    expect(confirmation).toHaveAttribute('aria-modal', 'true');
    expect(within(confirmation).getByRole('button', { name: 'Отмена' })).toHaveFocus();
    expect(confirmation).toHaveTextContent(`Отправить публикацию в «${personalUpcomingRecord.title}» сейчас?`);
    expect(onSendNow).not.toHaveBeenCalled();
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Отправить сейчас' }));

    expect(onSendNow).toHaveBeenCalledWith(personalUpcomingRecord);
  });

  it('closes history layers in order when Escape is pressed', () => {
    const { onClose } = renderHistory([upcomingRecord]);

    fireEvent.click(screen.getByRole('button', { name: 'Экспортировать текущую категорию' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu', { name: 'Формат экспорта' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Публикации' })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Ещё' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Отменить' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog', { name: 'Подтвердить отмену публикации' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Публикации' })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('makes Edit primary for Studio messages and moves Send now into Actions', () => {
    const onReschedule = vi.fn();
    const onSendNow = vi.fn();
    const { onClose } = renderHistory([upcomingRecord, personalUpcomingRecord], vi.fn(), vi.fn(), onSendNow, vi.fn(), onReschedule);

    const rescheduleButton = screen.getByRole('button', { name: 'Изменить: XMSGi Updates' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Ещё' })[0]);
    expect(screen.getByRole('menuitem', { name: 'Отправить сейчас' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Изменить: XMSGi Updates' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Отправить сейчас' }));
    const confirmation = screen.getByRole('alertdialog', { name: 'Подтвердить отправку' });
    expect(onSendNow).not.toHaveBeenCalled();
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Отправить сейчас' }));
    expect(onSendNow).toHaveBeenCalledWith(upcomingRecord);

    fireEvent.click(rescheduleButton);

    expect(onReschedule).toHaveBeenCalledWith(upcomingRecord);
    expect(onClose).toHaveBeenCalledOnce();

    fireEvent.click(screen.getAllByRole('button', { name: 'Ещё' })[1]);
    expect(screen.getByRole('menuitem', { name: 'Отправить сейчас' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Отправить сейчас' })).not.toBeInTheDocument();
  });

  it('confirms before deleting the selected sent-history category', async () => {
    const onClearSent = vi.fn();
    renderHistory([completedRecord, workspaceSentRecord], undefined, undefined, undefined, undefined, undefined, onClearSent);
    fireEvent.click(screen.getByRole('tab', { name: 'Отправлено' }));

    fireEvent.click(screen.getByRole('button', { name: 'Удалить историю отправленных' }));
    const confirmation = screen.getByRole('alertdialog', { name: 'Подтвердить удаление категории' });
    expect(confirmation).toHaveTextContent('Удалить 2 записи из истории?');
    expect(confirmation).toHaveTextContent('Сообщения в Telegram останутся.');
    expect(onClearSent).not.toHaveBeenCalled();

    fireEvent.click(within(confirmation).getByRole('button', { name: 'Отмена' }));
    expect(onClearSent).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Studio' }));
    fireEvent.click(screen.getByRole('button', { name: 'Удалить историю отправленных' }));
    const studioConfirmation = screen.getByRole('alertdialog', { name: 'Подтвердить удаление категории' });
    expect(studioConfirmation).toHaveTextContent('Удалить 1 запись из истории?');
    fireEvent.mouseDown(studioConfirmation.parentElement!);
    expect(screen.queryByRole('alertdialog', { name: 'Подтвердить удаление категории' })).not.toBeInTheDocument();
    expect(onClearSent).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Удалить историю отправленных' }));
    const finalConfirmation = screen.getByRole('alertdialog', { name: 'Подтвердить удаление категории' });
    fireEvent.click(within(finalConfirmation).getByRole('button', { name: 'Удалить 1 запись' }));
    await waitFor(() => expect(onClearSent).toHaveBeenCalledWith('workspace'));
  });

  it('confirms and clears all drafts as one category action', async () => {
    const originalDraftStorage = Object.getOwnPropertyDescriptor(window, 'draftStorage');
    const drafts = [
      { id: 'draft-a', name: 'Draft A', body: 'Body A', createdAt: '2026-09-28T10:00:00.000Z', updatedAt: '2026-09-29T18:35:00.000Z' },
      { id: 'draft-b', name: 'Draft B', body: 'Body B', createdAt: '2026-09-28T10:00:00.000Z', updatedAt: '2026-09-29T18:36:00.000Z' },
    ];
    const onClearDrafts = vi.fn().mockResolvedValue(true);
    Object.defineProperty(window, 'draftStorage', {
      configurable: true,
      value: { load: vi.fn().mockResolvedValue({ success: true, store: { schemaVersion: 1, migrationVersion: 1, savedDrafts: drafts, workspaceDraft: null } }) },
    });

    try {
      renderHistory([], undefined, undefined, undefined, undefined, undefined, vi.fn(), onClearDrafts);
      fireEvent.click(screen.getByRole('tab', { name: 'Черновики' }));
      await screen.findByText('Draft A');
      fireEvent.click(screen.getByRole('button', { name: 'Удалить черновики' }));

      const confirmation = screen.getByRole('alertdialog', { name: 'Подтвердить удаление категории' });
      expect(confirmation).toHaveTextContent('Удалить 2 черновика? Восстановление невозможно.');
      expect(confirmation).toHaveAttribute('aria-modal', 'true');
      expect(within(confirmation).getByRole('button', { name: 'Удалить 2 черновика' })).toHaveFocus();
      expect(onClearDrafts).not.toHaveBeenCalled();
      fireEvent.keyDown(confirmation, { key: 'Enter' });

      await waitFor(() => expect(onClearDrafts).toHaveBeenCalledOnce());
      expect(screen.queryByText('Draft A')).not.toBeInTheDocument();
      expect(screen.queryByText('Draft B')).not.toBeInTheDocument();
    } finally {
      if (originalDraftStorage) Object.defineProperty(window, 'draftStorage', originalDraftStorage);
      else Reflect.deleteProperty(window, 'draftStorage');
    }
  });

  it('deletes only the expanded sent record when the trash icon is used', async () => {
    const onDelete = vi.fn();
    renderHistory([completedRecord, workspaceSentRecord], vi.fn(), onDelete);
    fireEvent.click(screen.getByRole('tab', { name: 'Отправлено' }));
    fireEvent.click(screen.getByRole('button', { name: 'Открыть публикацию: Личные заметки' }));
    fireEvent.click(screen.getByRole('button', { name: 'Удалить Личные заметки' }));

    const confirmation = screen.getByRole('alertdialog', { name: 'Подтвердить удаление записи' });
    expect(confirmation).toHaveTextContent('Удалить «Личные заметки» из истории?');
    expect(confirmation).toHaveTextContent('Сообщение в Telegram останется.');
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Удалить запись' }));

    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(completedRecord));
  });

  it('deletes only the expanded draft when the trash icon is used', async () => {
    const originalDraftStorage = Object.getOwnPropertyDescriptor(window, 'draftStorage');
    const draft = {
      id: 'single-delete-draft',
      name: 'Draft to delete',
      body: 'Saved content',
      createdAt: '2026-09-28T10:00:00.000Z',
      updatedAt: '2026-09-29T18:35:00.000Z',
    };
    const onDelete = vi.fn().mockResolvedValue(true);
    Object.defineProperty(window, 'draftStorage', {
      configurable: true,
      value: { load: vi.fn().mockResolvedValue({ success: true, store: { schemaVersion: 1, migrationVersion: 1, savedDrafts: [draft], workspaceDraft: null } }) },
    });

    try {
      renderHistory([], vi.fn(), onDelete);
      fireEvent.click(screen.getByRole('tab', { name: 'Черновики' }));
      await screen.findByRole('button', { name: 'Открыть публикацию: Draft to delete' });
      fireEvent.click(screen.getByRole('button', { name: 'Открыть публикацию: Draft to delete' }));
      fireEvent.click(screen.getByRole('button', { name: 'Удалить Draft to delete' }));

      const confirmation = screen.getByRole('alertdialog', { name: 'Подтвердить удаление записи' });
      expect(confirmation).toHaveTextContent('Удалить черновик «Draft to delete»? Восстановление невозможно.');
      expect([...confirmation.querySelectorAll('.history-record-confirmation-action')].map((button) => button.textContent?.trim()))
        .toEqual(['Удалить черновик', 'Отмена']);
      expect(within(confirmation).getByRole('button', { name: 'Удалить черновик' })).toHaveFocus();
      fireEvent.keyDown(confirmation, { key: 'Enter' });

      await waitFor(() => expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({
        id: 'workspace:draft:single-delete-draft',
        status: 'draft',
      })));
      expect(screen.queryByText('Draft to delete')).not.toBeInTheDocument();
    } finally {
      if (originalDraftStorage) Object.defineProperty(window, 'draftStorage', originalDraftStorage);
      else Reflect.deleteProperty(window, 'draftStorage');
    }
  });

  it('confirms cancellation of only Telegram-confirmed entries from the queue category', async () => {
    const queueRecord = normalizeScheduledMessages([{
      ...scheduledMessage,
      telegramMessageId: 'telegram-queue-1',
    }], 'workspace', 'upcoming', [channel])[0];
    const onCancelQueue = vi.fn().mockResolvedValue(true);
    renderHistory([queueRecord], undefined, undefined, undefined, undefined, undefined, undefined, undefined, onCancelQueue);

    fireEvent.click(screen.getByRole('button', { name: 'Отменить запланированные публикации' }));
    const confirmation = screen.getByRole('alertdialog', { name: 'Подтвердить отмену очереди' });
    expect(confirmation).toHaveTextContent('Снять с расписания 1 запись в Telegram?');
    expect(onCancelQueue).not.toHaveBeenCalled();
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Отменить 1 запись' }));

    await waitFor(() => expect(onCancelQueue).toHaveBeenCalledWith([queueRecord]));
  });

  it('hides failed local schedule errors and retry actions from Posts', () => {
    const localFailure = normalizeScheduledMessages([{
      ...scheduledMessage,
      id: 'ipc-schedule-failure',
      status: 'failed' as const,
      lastError: "Error invoking remote method 'telegram-schedule': Invalid IPC input: message is required",
      retryAction: 'schedule' as const,
      telegramMessageId: undefined,
    }], 'workspace', 'upcoming', [channel])[0];
    const onDelete = vi.fn();
    const onCancelQueue = vi.fn().mockResolvedValue(true);

    renderHistory([localFailure], undefined, onDelete, undefined, undefined, undefined, undefined, undefined, onCancelQueue);
    selectHistorySource('Studio');

    expect(screen.queryByText("Error invoking remote method 'telegram-schedule': Invalid IPC input: message is required")).not.toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Повторить планирование' })).not.toBeInTheDocument();
    expect(onDelete).not.toHaveBeenCalled();
    expect(onCancelQueue).not.toHaveBeenCalled();
  });

  it('shows valid queue entries but hides failed schedule retries', () => {
    const queueRecord = normalizeScheduledMessages([{
      ...scheduledMessage,
      telegramMessageId: 'telegram-queue-mixed',
    }], 'workspace', 'upcoming', [channel])[0];
    const localFailure = normalizeScheduledMessages([{
      ...scheduledMessage,
      id: 'ipc-schedule-failure-mixed',
      text: 'Failed schedule that can be retried',
      status: 'failed' as const,
      retryAction: 'schedule' as const,
      telegramMessageId: undefined,
    }], 'workspace', 'upcoming', [channel])[0];
    const onDelete = vi.fn();
    const onCancelQueue = vi.fn().mockResolvedValue(true);

    renderHistory([queueRecord, localFailure], undefined, onDelete, undefined, undefined, undefined, undefined, undefined, onCancelQueue);
    selectHistorySource('Studio');

    expect(screen.getByText('Релиз нового набора шаблонов для Telegram-канала')).toBeInTheDocument();
    expect(screen.queryByText('Failed schedule that can be retried')).not.toBeInTheDocument();
    expect(screen.queryByText(/Error invoking remote method|Invalid IPC input/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Повторить планирование' })).not.toBeInTheDocument();
    expect(onDelete).not.toHaveBeenCalled();
    expect(onCancelQueue).not.toHaveBeenCalled();
  });

  it('cancels only the expanded scheduled record from the queue trash action', async () => {
    const queueRecord = normalizeScheduledMessages([{
      ...scheduledMessage,
      telegramMessageId: 'telegram-queue-selected',
    }], 'workspace', 'upcoming', [channel])[0];
    const otherRecord = normalizeScheduledMessages([{
      ...scheduledMessage,
      id: 'other-queue-record',
      chatName: 'Other channel',
      telegramMessageId: 'telegram-queue-other',
    }], 'workspace', 'upcoming', [])[0];
    const onCancelQueue = vi.fn().mockResolvedValue(true);
    renderHistory([queueRecord, otherRecord], undefined, undefined, undefined, undefined, undefined, undefined, undefined, onCancelQueue);

    fireEvent.click(screen.getByRole('button', { name: 'Показать полностью: XMSGi Updates' }));
    fireEvent.click(screen.getByRole('button', { name: 'Отменить XMSGi Updates' }));
    const confirmation = screen.getByRole('alertdialog', { name: 'Подтвердить отмену публикации' });
    expect(confirmation).toHaveTextContent('Убрать публикацию «XMSGi Updates» из расписания Telegram?');
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Отменить расписание' }));

    await waitFor(() => expect(onCancelQueue).toHaveBeenCalledWith([queueRecord]));
  });

  it('does not offer bulk cancellation for upcoming records', () => {
    const { container } = renderHistory([upcomingRecord, personalUpcomingRecord]);

    expect(screen.queryByRole('button', { name: 'Отменить все запланированные' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Удалить историю отправленных' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Удалить черновики' })).not.toBeInTheDocument();
    expect(container.querySelector('.history-delete-button')).toBeDisabled();
    expect(container.querySelector('.history-export-button')).toBeEnabled();
  });

  it('keeps delete and export buttons visible but disabled when history is empty', () => {
    const { container } = renderHistory([]);

    expect(container.querySelector('.history-delete-button')).toBeInTheDocument();
    expect(container.querySelector('.history-delete-button')).toBeDisabled();
    expect(container.querySelector('.history-export-button')).toBeInTheDocument();
    expect(container.querySelector('.history-export-button')).toBeDisabled();
    expect(colorThemeStyles).toMatch(
      /html\[data-theme='light'\] \.history-drawer\.is-page \.history-delete-button:disabled\s*\{[^}]*border-color:\s*transparent;[^}]*background:\s*transparent;[^}]*color:\s*#697984;[^}]*opacity:\s*0\.75;/,
    );
    expect(colorThemeStyles).toMatch(
      /html\[data-theme='dark'\] \.history-drawer\.is-page \.history-delete-button:disabled\s*\{[^}]*border-color:\s*transparent;[^}]*background:\s*transparent;[^}]*color:\s*#8496a1;[^}]*opacity:\s*0\.75;/,
    );
    expect(colorThemeStyles).toMatch(
      /html\[data-theme='dark'\] \.history-drawer\.is-page \.history-drawer-tools \.history-delete-button:disabled:hover::before,\s*html\[data-theme='light'\] \.history-drawer\.is-page \.history-drawer-tools \.history-delete-button:disabled:hover::before\s*\{\s*border-color:\s*transparent;\s*background:\s*rgba\(100,\s*112,\s*121,\s*0\.18\);\s*box-shadow:\s*none;/,
    );
  });

  it('labels the Posts delete and export icons without changing other drawer actions', () => {
    const { container } = renderHistoryPage([upcomingRecord]);

    expect(container.querySelector('.history-delete-action .history-action-label')).toHaveTextContent('Удалить');
    expect(container.querySelector('.history-export-control .history-action-label')).toHaveTextContent('Экспорт');
    expect(container.querySelector('.history-delete-button')).toHaveAttribute('aria-label');
    expect(container.querySelector('.history-export-button')).toHaveAttribute('aria-label');
  });

  it('hides failed retry attempts but keeps cancelled entries in scheduled history', () => {
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
    selectHistorySource('Planner');

    expect(screen.queryByRole('tab', { name: 'Ошибки' })).not.toBeInTheDocument();
    expect(screen.queryByText('Failed entry for retry')).not.toBeInTheDocument();
    expect(screen.getByText('Cancelled entry remains visible')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Повторить отправку' })).not.toBeInTheDocument();
    expect(onSendNow).not.toHaveBeenCalled();
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

  it('uses Studio drafts in the composer and puts Edit and Delete in More', async () => {
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
      const onUseDraft = vi.fn();
      const onDelete = vi.fn().mockResolvedValue(true);
      renderHistory([upcomingRecord], vi.fn(), onDelete, vi.fn(), onOpenDraft, vi.fn(), vi.fn(), vi.fn().mockResolvedValue(true), vi.fn().mockResolvedValue(true), onUseDraft);
      fireEvent.click(screen.getByRole('tab', { name: 'Черновики' }));
      const draftCard = await screen.findByRole('article');
      expect(draftCard).toHaveClass('is-draft');
      expect(draftCard).toHaveAttribute('data-draft-color', 'coral');
      expect(screen.getByLabelText('Цвет черновика: coral')).toBeInTheDocument();
      fireEvent.click(await screen.findByRole('button', { name: 'Использовать черновик: Анонс функции' }));

      expect(load).toHaveBeenCalledOnce();
      expect(onUseDraft).toHaveBeenCalledWith(expect.objectContaining({
        source: 'workspace',
        status: 'draft',
        original: { kind: 'saved-draft', draft: expect.objectContaining({ id: 'studio-draft-1' }) },
      }), 'studio');
      expect(onOpenDraft).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole('button', { name: 'Ещё' }));
      expect(screen.queryByRole('menuitem', { name: 'Редактировать' })).not.toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: 'Удалить' })).toBeInTheDocument();

      fireEvent.click(screen.getByRole('menuitem', { name: 'Удалить' }));
      expect(onDelete).not.toHaveBeenCalled();
      const confirmation = screen.getByRole('alertdialog', { name: 'Подтвердить удаление записи' });
      expect(confirmation).toHaveTextContent('Удалить черновик «Анонс функции»? Восстановление невозможно.');
      fireEvent.click(within(confirmation).getByRole('button', { name: 'Удалить черновик' }));
      await waitFor(() => expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ status: 'draft' })));
      expect(screen.queryByRole('article')).not.toBeInTheDocument();
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

    expect(screen.getByText('Текущая категория: План')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Экспортировать текущий список как TXT (.txt)' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Экспортировать текущий список как JSON (.json)' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Экспортировать текущий список как TXT (.txt)' }))
      .toHaveAttribute('title', 'Лучше для чтения, печати и отправки человеку.');
    expect(screen.getByRole('menuitem', { name: 'Экспортировать текущий список как JSON (.json)' }))
      .toHaveAttribute('title', 'Лучше для резервной копии и переноса данных.');
    expect(screen.queryByText('Завершённые')).not.toBeInTheDocument();
  });

  it('exports global search results within the selected source', async () => {
    const downloads = stubDownloads();

    try {
      renderHistory([upcomingRecord, personalUpcomingRecord, completedRecord]);
      fireEvent.click(screen.getByRole('button', { name: 'Планер' }));
      fireEvent.click(screen.getByRole('tab', { name: 'Отправлено' }));
      fireEvent.change(screen.getByRole('textbox', { name: 'Поиск по истории' }), {
        target: { value: 'подтвердить' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Экспортировать результаты поиска' }));

      expect(screen.getByText('Результаты поиска')).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: 'Экспортировать текущий список как JSON (.json)' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Экспортировать результаты поиска' })).toBeEnabled();

      fireEvent.click(screen.getByRole('menuitem', { name: 'Экспортировать текущий список как JSON (.json)' }));

      const payload = JSON.parse(await readBlob(downloads.blobs[0])) as {
        filters: { source: string; status: string; query: string };
        records: Array<{ id: string }>;
      };
      expect(payload.filters).toEqual({ source: 'personal', status: 'all', query: 'подтвердить' });
      expect(payload.records.map((record) => record.id).sort()).toEqual([completedRecord.id, personalUpcomingRecord.id].sort());
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
      expect(text).toContain('XMSGi — План');
      expect(text).toContain('Источник: Studio');
      expect(text).toContain('Чат: XMSGi Updates (@xmsgi_updates)');
      expect(text).toContain('Релиз нового набора шаблонов для Telegram-канала');
      expect(text).toContain('brief.pdf');
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });

  it('exports only the expanded record with its title in the menu and filename', async () => {
    const downloads = stubDownloads();

    try {
      renderHistory([upcomingRecord, personalUpcomingRecord]);
      fireEvent.click(screen.getByRole('button', { name: 'Показать полностью: XMSGi Updates' }));
      fireEvent.click(screen.getByRole('button', { name: 'Экспортировать XMSGi Updates' }));

      const exportMenu = screen.getByRole('menu', { name: 'Формат экспорта' });
      expect(exportMenu).toHaveTextContent('Экспортируется: XMSGi Updates');
      expect(exportMenu).not.toHaveTextContent('Вся категория');
      expect(within(exportMenu).getAllByRole('menuitem')).toHaveLength(2);
      fireEvent.click(within(exportMenu).getByRole('menuitem', { name: 'Экспортировать «XMSGi Updates» как TXT (.txt)' }));

      expect(downloads.filenames[0]).toMatch(/xmsgi-scheduled-xmsgi-updates-.*\.txt$/i);
      const text = await readBlob(downloads.blobs[0]);
      expect(text).toContain('Всего: 1');
      expect(text).toContain('XMSGi Updates');
      expect(text).toContain('Релиз нового набора шаблонов для Telegram-канала');
      expect(text).not.toContain('Подтвердить встречу');
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

  it('asks for confirmation before destructive history actions', () => {
    const onCancel = vi.fn();
    const onDelete = vi.fn();
    renderHistory([upcomingRecord, completedRecord], onCancel, onDelete);

    fireEvent.click(screen.getAllByRole('button', { name: 'Ещё' })[0]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Отменить' }));
    expect(screen.getByRole('alertdialog', { name: 'Подтвердить отмену публикации' })).toBeInTheDocument();
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Отменить публикацию' }));
    expect(onCancel).toHaveBeenCalledWith(upcomingRecord);

    fireEvent.click(screen.getByRole('tab', { name: 'Отправлено' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Ещё' })[0]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Удалить' }));
    expect(screen.getByRole('alertdialog', { name: 'Подтвердить удаление' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Удалить запись' }));
    expect(onDelete).toHaveBeenCalledWith(completedRecord);
  });

  it('hides failed records and their retry and history actions', () => {
    const failedRecord = normalizeScheduledMessages([{
      ...scheduledMessage,
      id: 'failed-history-delete',
      status: 'failed' as ScheduledMessage['status'],
      lastError: 'Telegram did not confirm that the reminder was saved.',
      retryAction: 'schedule',
    }], 'workspace', 'upcoming', [channel])[0];
    const onDelete = vi.fn();

    renderHistory([failedRecord], vi.fn(), onDelete);
    selectHistorySource('Studio');

    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ещё' })).not.toBeInTheDocument();
    expect(screen.queryByText('Telegram did not confirm that the reminder was saved.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Повторить планирование' })).not.toBeInTheDocument();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('expands a post in place, hides following posts and restores them on collapse', () => {
    renderHistory([upcomingRecord, personalUpcomingRecord]);

    fireEvent.click(screen.getByRole('button', { name: 'Показать полностью: XMSGi Updates' }));

    expect(screen.getByRole('button', { name: 'Свернуть: XMSGi Updates' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByText('Релиз нового набора шаблонов для Telegram-канала')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Показать полностью: Личное' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Свернуть: XMSGi Updates' }));

    expect(screen.getByRole('button', { name: 'Показать полностью: Личное' })).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(2);
  });

  it('collapses an expanded post from the empty rail beside its message', () => {
    const view = renderHistory([upcomingRecord, personalUpcomingRecord]);
    fireEvent.click(screen.getByRole('button', { name: 'Показать полностью: XMSGi Updates' }));
    const expandedBody = view.container.querySelector('.history-post-expanded')!;
    const bubble = expandedBody.querySelector('.history-post-bubble')!;
    const messageText = expandedBody.querySelector('.history-post-text')!;
    Object.defineProperty(bubble, 'getBoundingClientRect', {
      configurable: true,
      value: () => new DOMRect(100, 200, 240, 100),
    });

    fireEvent.click(messageText, { clientX: 20 });
    expect(screen.getByRole('article')).toHaveClass('is-expanded');

    fireEvent.click(expandedBody, { clientX: 20 });

    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(view.container.querySelector('.history-record.is-expanded')).toBeNull();
  });

  it('restores the history list position after collapsing a full-size post', () => {
    const view = renderHistory([upcomingRecord]);
    mockHistoryRecordScroll(view.container);
    const list = view.container.querySelector('.history-record-list') as HTMLDivElement;

    fireEvent.click(screen.getByRole('button', { name: 'Показать полностью: XMSGi Updates' }));
    list.scrollTop = 180;
    fireEvent.click(screen.getByRole('button', { name: 'Свернуть: XMSGi Updates' }));

    expect(list.scrollTop).toBe(20);
  });

  it.each([
    {
      name: 'summary row',
      record: upcomingRecord,
      status: null,
      trigger: 'Открыть публикацию: XMSGi Updates',
      bounds: { top: 350, height: 100 },
      scale: 1,
      expectedScrollTop: 70,
    },
    {
      name: 'summary row for a sent message',
      record: completedRecord,
      status: 'Отправлено',
      trigger: 'Открыть публикацию: Личные заметки',
      bounds: { top: 350, height: 100 },
      scale: 1,
      expectedScrollTop: 70,
    },
    {
      name: 'full-view action for a sent message',
      record: completedRecord,
      status: 'Отправлено',
      trigger: 'Показать полностью: Личные заметки',
      bounds: { top: 350, height: 100 },
      scale: 1,
      expectedScrollTop: 70,
    },
    {
      name: 'full-view action for a message taller than the viewport',
      record: completedRecord,
      status: 'Отправлено',
      trigger: 'Показать полностью: Личные заметки',
      bounds: { top: 250, height: 480 },
      scale: 1,
      expectedScrollTop: 350,
    },
    {
      name: 'full-view action at Electron zoom',
      record: completedRecord,
      status: 'Отправлено',
      trigger: 'Показать полностью: Личные заметки',
      bounds: { top: 350, height: 100 },
      scale: 0.7,
      expectedScrollTop: 70,
    },
  ])('keeps $name visible by scrolling only the history list', ({ record, status, trigger, bounds, scale, expectedScrollTop }) => {
    const view = renderHistory([record]);
    if (status) fireEvent.click(screen.getByRole('tab', { name: status }));
    const scrollTo = mockHistoryRecordScroll(view.container, bounds, scale);

    fireEvent.click(screen.getByRole('button', { name: trigger }));

    expect(scrollTo).toHaveBeenCalledWith({ top: expectedScrollTop, behavior: 'smooth' });
  });

  it('scrolls the history list to keep the opened actions menu visible', () => {
    const view = renderHistory([upcomingRecord]);
    const scrollTo = mockHistoryRecordScroll(view.container);
    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
    const getBoundingClientRect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect');
    getBoundingClientRect.mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('history-record-action-menu')
        ? new DOMRect(0, 350, 170, 100)
        : originalGetBoundingClientRect.call(this);
    });

    try {
      fireEvent.click(screen.getByRole('button', { name: 'Ещё' }));

      expect(scrollTo).toHaveBeenCalledWith({ top: 70, behavior: 'smooth' });
    } finally {
      getBoundingClientRect.mockRestore();
    }
  });

  it('scrolls the history list to keep the opened actions menu visible at Electron zoom', () => {
    const view = renderHistory([upcomingRecord]);
    const scrollTo = mockHistoryRecordScroll(view.container, { top: 350, height: 100 }, 0.7);
    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
    const getBoundingClientRect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect');
    getBoundingClientRect.mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('history-record-action-menu')
        ? new DOMRect(0, 245, 119, 70)
        : originalGetBoundingClientRect.call(this);
    });

    try {
      fireEvent.click(screen.getByRole('button', { name: 'Ещё' }));

      expect(scrollTo).toHaveBeenCalledWith({ top: 70, behavior: 'smooth' });
    } finally {
      getBoundingClientRect.mockRestore();
    }
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

    fireEvent.click(screen.getByRole('button', { name: 'Показать полностью: XMSGi Updates' }));
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
      },
    ], 'workspace', 'upcoming', [channel])[0];
    const view = renderHistory([imageRecord]);

    fireEvent.click(screen.getByRole('button', { name: 'Открыть публикацию: XMSGi Updates' }));

    expect(screen.getByRole('img', { name: 'launch-image.png' })).toHaveAttribute('src', 'file:///C:/files/launch-image.png');
    const bubble = view.container.querySelector('.history-post-bubble');
    expect(bubble?.firstElementChild).toHaveClass('history-post-attachments');
    expect(bubble?.querySelector('.history-post-text')).toHaveTextContent('A caption below the photo');
  });

  it('loads local JFIF attachments for the Posts list and details view', async () => {
    const originalDraftStorage = Object.getOwnPropertyDescriptor(window, 'draftStorage');
    const readImageDataUrl = vi.fn().mockResolvedValue({
      success: true,
      dataUrl: 'data:image/jpeg;base64,dGVzdA==',
    });
    Object.defineProperty(window, 'draftStorage', {
      configurable: true,
      value: { load: vi.fn(), readImageDataUrl },
    });
    const imagePath = 'file:///C:/Users/malod/AppData/Local/XMSGi-Workspace-Agent/drafts/OIP%20(1).jfif';
    const imageRecord = normalizeScheduledMessages([{
      ...scheduledMessage,
      attachments: [imagePath],
    }], 'workspace', 'upcoming', [channel])[0];

    try {
      const view = renderHistoryPage([imageRecord]);
      await waitFor(() => expect(readImageDataUrl).toHaveBeenCalledWith(
        'C:/Users/malod/AppData/Local/XMSGi-Workspace-Agent/drafts/OIP (1).jfif',
      ));
      await waitFor(() => expect(
        view.container.querySelector('.history-record-attachment-image img'),
      ).toHaveAttribute('src', 'data:image/jpeg;base64,dGVzdA=='));
      fireEvent.click(view.container.querySelector('.history-record-open')!);
      expect(view.container.querySelector('.history-post-attachments img')).toHaveAttribute(
        'src',
        'data:image/jpeg;base64,dGVzdA==',
      );
    } finally {
      if (originalDraftStorage) Object.defineProperty(window, 'draftStorage', originalDraftStorage);
      else Reflect.deleteProperty(window, 'draftStorage');
    }
  });

  it('does not repeat a chat name below an identical message title', () => {
    const savedMessagesRecord = normalizeScheduledMessages([{
      ...scheduledMessage,
      chatName: 'Saved Messages',
    }], 'workspace', 'upcoming', [])[0];
    const view = renderHistory([savedMessagesRecord]);

    expect(view.container.querySelector('.history-record-heading strong')).toHaveTextContent('Saved Messages');
    expect(view.container.querySelector('.history-record-chat')).toBeNull();
  });

  it('shows a magnified preview after hovering over history photos', () => {
    const imageRecord = normalizeScheduledMessages([{
      ...scheduledMessage,
      attachments: ['C:\\files\\launch-image.png'],
    }], 'workspace', 'upcoming', [channel])[0];
    const view = renderHistory([imageRecord]);
    const thumbnail = view.container.querySelector('.history-record-attachment-image img');
    if (!thumbnail) throw new Error('History photo thumbnail was not rendered.');
    vi.useFakeTimers();

    try {
      fireEvent.pointerEnter(thumbnail);
      act(() => vi.advanceTimersByTime(599));
      expect(document.body.querySelector('.message-attachment-preview')).toBeNull();

      act(() => vi.advanceTimersByTime(1));
      expect(document.body.querySelector('.message-attachment-preview img')).toHaveAttribute('src', 'file:///C:/files/launch-image.png');

      fireEvent.pointerLeave(thumbnail);
      expect(document.body.querySelector('.message-attachment-preview')).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: 'Открыть публикацию: XMSGi Updates' }));
      const fullSizeImage = screen.getByRole('img', { name: 'launch-image.png' });
      fireEvent.pointerEnter(fullSizeImage);
      act(() => vi.advanceTimersByTime(600));
      expect(document.body.querySelector('.message-attachment-preview')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
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