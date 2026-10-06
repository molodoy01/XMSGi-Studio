// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { editorHtmlToRichText, markdownToRichText } from './richText';

describe('markdownToRichText', () => {
  it('converts strong and emphasis markers into entities', () => {
    expect(markdownToRichText('**Жирный**')).toMatchObject({
      text: 'Жирный',
      entities: [{ type: 'bold', offset: 0, length: 6 }],
      changed: true,
    });
    expect(markdownToRichText('*Курсив*')).toMatchObject({
      text: 'Курсив',
      entities: [{ type: 'italic', offset: 0, length: 6 }],
      changed: true,
    });
  });

  it('preserves ordinary and unmatched markers', () => {
    for (const source of ['2 * 2 = 4', 'Обычный текст * со звездочкой', '**не закрыто']) {
      expect(markdownToRichText(source)).toMatchObject({ text: source, entities: [], changed: false });
    }
  });

  it('converts multiple and nested styles with UTF-16 offsets', () => {
    expect(markdownToRichText('Привет **жирный** и *курсив*')).toMatchObject({
      text: 'Привет жирный и курсив',
      entities: [
        { type: 'bold', offset: 7, length: 6 },
        { type: 'italic', offset: 16, length: 6 },
      ],
    });
    expect(markdownToRichText('🙂 **bold *italic* and ~~strike~~**')).toMatchObject({
      text: '🙂 bold italic and strike',
      entities: [
        { type: 'bold', offset: 3, length: 22 },
        { type: 'italic', offset: 8, length: 6 },
        { type: 'strikethrough', offset: 19, length: 6 },
      ],
    });
  });

  it('keeps escaped asterisks literal', () => {
    expect(markdownToRichText('\\*not emphasis\\*')).toMatchObject({
      text: '*not emphasis*',
      entities: [],
      changed: true,
    });
  });

  it('preserves existing HTML entities while parsing Markdown', () => {
    const root = document.createElement('div');
    root.innerHTML = '<strong>HTML</strong> **Markdown** <em>курсив</em>';

    expect(editorHtmlToRichText(root)).toMatchObject({
      text: 'HTML Markdown курсив',
      entities: [
        { type: 'bold', offset: 0, length: 4 },
        { type: 'bold', offset: 5, length: 8 },
        { type: 'italic', offset: 14, length: 6 },
      ],
      markdownChanged: true,
    });
  });
});