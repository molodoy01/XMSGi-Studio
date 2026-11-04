import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '@/lib/i18n';
import { ConfirmDialogProvider } from './ConfirmDialog';
import { useConfirm } from './useConfirm';

function ConfirmHarness({ onResult }: { onResult: (confirmed: boolean) => void }) {
  const confirm = useConfirm();
  const [result, setResult] = useState('');
  return (
    <>
      <button type="button" onClick={() => void confirm({
        title: 'Delete draft?',
        message: 'This action cannot be undone.',
        confirmLabel: 'Delete',
        cancelLabel: 'Cancel',
        destructive: true,
      }).then((confirmed) => {
        onResult(confirmed);
        setResult(String(confirmed));
      })}>
        Open confirm
      </button>
      <output>{result}</output>
    </>
  );
}

function renderConfirm(onResult = vi.fn()) {
  return {
    onResult,
    ...render(
      <LocaleProvider>
        <ConfirmDialogProvider>
          <ConfirmHarness onResult={onResult} />
        </ConfirmDialogProvider>
      </LocaleProvider>,
    ),
  };
}

describe('ConfirmDialogProvider', () => {
  it('resolves true when the user confirms', async () => {
    const { onResult } = renderConfirm();
    fireEvent.click(screen.getByRole('button', { name: 'Open confirm' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Delete draft?' });
    expect(within(dialog).getAllByRole('button').map((button) => button.textContent)).toEqual(['Delete', 'Cancel']);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('true')).toBeInTheDocument();
    expect(onResult).toHaveBeenCalledWith(true);
  });

  it('resolves false on Escape without running the confirm action', async () => {
    const { onResult } = renderConfirm();
    fireEvent.click(screen.getByRole('button', { name: 'Open confirm' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(await screen.findByText('false')).toBeInTheDocument();
    expect(onResult).toHaveBeenCalledWith(false);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('confirms the dialog with Enter', async () => {
    const { onResult } = renderConfirm();
    fireEvent.click(screen.getByRole('button', { name: 'Open confirm' }));

    const dialog = screen.getByRole('alertdialog', { name: 'Delete draft?' });
    expect(within(dialog).getByRole('button', { name: 'Delete' })).toHaveFocus();
    fireEvent.keyDown(window, { key: 'Enter' });

    expect(await screen.findByText('true')).toBeInTheDocument();
    expect(onResult).toHaveBeenCalledWith(true);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('keeps Enter on the cancel button from confirming', async () => {
    const { onResult } = renderConfirm();
    fireEvent.click(screen.getByRole('button', { name: 'Open confirm' }));
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    cancel.focus();
    fireEvent.keyDown(cancel, { key: 'Enter' });

    expect(onResult).not.toHaveBeenCalled();
  });

  it('keeps keyboard focus inside the dialog', () => {
    renderConfirm();
    fireEvent.click(screen.getByRole('button', { name: 'Open confirm' }));
    const dialog = screen.getByRole('alertdialog');
    const cancel = within(dialog).getByRole('button', { name: 'Cancel' });
    const confirm = within(dialog).getByRole('button', { name: 'Delete' });

    cancel.focus();
    fireEvent.keyDown(window, { key: 'Tab' });

    expect(confirm).toHaveFocus();
  });
});