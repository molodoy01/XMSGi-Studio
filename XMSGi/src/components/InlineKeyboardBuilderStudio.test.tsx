import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { InlineButtonRow } from '@/lib/inlineKeyboard';
import { LocaleProvider } from '@/lib/i18n';
import { InlineKeyboardBuilder } from '@/components/InlineKeyboardBuilder';

function renderBuilder(locale: 'en' | 'ru') {
  window.localStorage.setItem('awaitmsg_locale', locale);

  function Harness() {
    const [rows, setRows] = useState<InlineButtonRow[]>([]);
    return <InlineKeyboardBuilder rows={rows} onChange={setRows} open onClose={() => undefined} />;
  }

  return render(<LocaleProvider><Harness /></LocaleProvider>);
}

describe('Studio inline keyboard builder translations', () => {
  it('shows English labels and validation feedback', () => {
    renderBuilder('en');
    fireEvent.click(screen.getByRole('button', { name: '+ Add button' }));

    expect(screen.getByRole('heading', { name: 'Inline buttons' })).toBeInTheDocument();
    expect(screen.getByLabelText('Button 1 text')).toBeInTheDocument();
    expect(screen.getByText('Enter button text.')).toBeInTheDocument();
  });

  it('shows Russian labels and validation feedback', () => {
    renderBuilder('ru');
    fireEvent.click(screen.getByRole('button', { name: '+ Добавить кнопку' }));

    expect(screen.getByRole('heading', { name: 'Кнопки под сообщением' })).toBeInTheDocument();
    expect(screen.getByLabelText('Кнопка 1: текст')).toBeInTheDocument();
    expect(screen.getByText('Введите текст кнопки.')).toBeInTheDocument();
  });
});
