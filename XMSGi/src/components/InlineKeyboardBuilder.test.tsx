import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { InlineKeyboardBuilder } from './InlineKeyboardBuilder';
import type { InlineButtonRow } from '@/lib/inlineKeyboard';

function renderBuilder(initialRows: InlineButtonRow[] = []) {
  function Harness() {
    const [rows, setRows] = useState(initialRows);

    return (
      <InlineKeyboardBuilder
        rows={rows}
        onChange={setRows}
        open={true}
        onClose={vi.fn()}
      />
    );
  }

  return render(<Harness />);
}

describe('InlineKeyboardBuilder', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('opens the editor and adds a button to the current post', () => {
    renderBuilder();

    fireEvent.click(screen.getByRole('button', { name: '+ Add button' }));

    expect(screen.getByLabelText('Button 1 text')).toBeInTheDocument();
    expect(screen.getByText('Enter button text.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Button 1 text'), {
      target: { value: 'Open' },
    });

    expect(screen.getByLabelText('Button 1 text')).toHaveValue('Open');
    expect(screen.getByText('1 active')).toBeInTheDocument();
  });

  it('removes a button and updates the active count', () => {
    renderBuilder([
      [{ id: 'one', label: 'Open', action: { type: 'url', value: 'https://example.com' } }],
    ]);

    fireEvent.click(screen.getByRole('button', { name: /Buttons/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove button' }));

    expect(screen.getByText('No buttons added')).toBeInTheDocument();
    expect(screen.queryByLabelText('Button 1 text')).not.toBeInTheDocument();
  });

  it('shows the URL validation error and normalizes a bare domain on blur', () => {
    renderBuilder([
      [{ id: 'one', label: 'Open', action: { type: 'url', value: 'https://example.com' } }],
    ]);

    fireEvent.click(screen.getByRole('button', { name: /Buttons/i }));
    const linkInput = screen.getByLabelText('Button 1 link');

    fireEvent.change(linkInput, { target: { value: 'http://example.com' } });
    expect(screen.getByText('Use a valid https:// URL.')).toBeInTheDocument();

    fireEvent.change(linkInput, { target: { value: 'site.ru' } });
    fireEvent.blur(linkInput);

    expect(screen.getByLabelText('Button 1 link')).toHaveValue('https://site.ru');
  });

  it('saves and applies a preset', () => {
    renderBuilder([
      [{ id: 'one', label: 'Open', action: { type: 'url', value: 'https://example.com' } }],
    ]);

    fireEvent.click(screen.getByRole('button', { name: '+ Save as preset' }));
    expect(screen.getByText('1 saved')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(window.localStorage.getItem('awaitmsg-inline-button-presets')).toContain('Inline set 1');
  });

  it('trims an oversized incoming row to Telegram limits', () => {
    renderBuilder([Array.from({ length: 9 }, (_, index) => ({
      id: `button-${index}`,
      label: `Button ${index}`,
      action: { type: 'url' as const, value: 'https://example.com' },
    }))]);

    fireEvent.click(screen.getByRole('button', { name: /Buttons/i }));

    expect(screen.getAllByRole('textbox')).toHaveLength(16);
    expect(screen.getByText('8 active')).toBeInTheDocument();
  });
});
