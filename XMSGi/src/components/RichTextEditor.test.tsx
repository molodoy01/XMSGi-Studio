import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RichTextEditor } from './RichTextEditor';

function renderEditor(text = '', maxLength = 20) {
  const onChange = vi.fn();
  render(
    <RichTextEditor
      text={text}
      entities={[]}
      maxLength={maxLength}
      onChange={onChange}
    />,
  );

  return {
    editor: screen.getByRole('textbox'),
    onChange,
  };
}

describe('RichTextEditor DOM behavior', () => {
  it('shows the placeholder before focus and hides it while focused', () => {
    const { editor } = renderEditor();

    expect(editor).toHaveClass('is-empty');
    expect(editor).toHaveAttribute('data-placeholder', 'Start writing your post...');

    fireEvent.focus(editor);
    expect(editor).toHaveClass('has-content');
    expect(editor).not.toHaveClass('is-empty');

    fireEvent.blur(editor);
    expect(editor).toHaveClass('is-empty');
  });

  it('hides the placeholder after the first entered character', () => {
    const { editor, onChange } = renderEditor();

    editor.textContent = 'H';
    fireEvent.input(editor);

    expect(onChange).toHaveBeenCalledWith('H', []);
  });

  it('truncates input at the configured limit', () => {
    const { editor, onChange } = renderEditor('', 5);

    editor.textContent = '123456789';
    fireEvent.input(editor);

    expect(editor.textContent).toBe('12345');
    expect(onChange).toHaveBeenCalledWith('12345', []);
  });

  it('adds one extra line when content exceeds the default editor height', () => {
    const { editor } = renderEditor();
    Object.defineProperty(editor, 'scrollHeight', {
      configurable: true,
      value: 220,
    });

    fireEvent.input(editor, { target: { textContent: 'line 1\nline 2\nline 3\nline 4' } });

    expect(editor.style.height).toBe('244px');
    expect(editor.style.minHeight).toBe('244px');
  });
});
