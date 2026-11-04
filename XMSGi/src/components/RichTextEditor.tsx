import { useEffect, useRef, useState } from 'react';
import type { MutableRefObject, ReactNode } from 'react';
import type { RichTextEntity } from '@/types';
import { editorHtmlToRichText, richTextToHtml, sliceRichText } from '@/lib/richText';
import { getMessageCounterTone, getRemainingMessageLength } from '@/lib/messageLimits';

interface Props {
  text: string;
  entities: RichTextEntity[];
  onChange: (text: string, entities: RichTextEntity[]) => void;
  inputRef?: MutableRefObject<HTMLDivElement | null>;
  stageContent?: ReactNode;
  stageMode?: 'editor' | 'schedule' | 'template' | 'chat' | 'buttons';
  maxLength: number;
}

type FormatCommand = 'bold' | 'italic' | 'underline' | 'strikeThrough';

export function RichTextEditor({ text, entities, onChange, inputRef, stageContent, stageMode = 'editor', maxLength }: Props) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const savedRangeRef = useRef<Range | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [toolbarActive, setToolbarActive] = useState(false);
  const [editorFocused, setEditorFocused] = useState(false);
  const [linkUrl, setLinkUrl] = useState('https://');

  const syncEditorHeight = () => {
    const editor = editorRef.current;
    if (!editor) return;

    const baseHeight = 180;
    const lineHeight = 24;
    const nextHeight = Math.max(baseHeight, editor.scrollHeight + lineHeight);

    editor.style.height = `${nextHeight}px`;
    editor.style.minHeight = `${nextHeight}px`;
  };

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || document.activeElement === editor) return;
    const nextHtml = richTextToHtml(text, entities);
    if (editor.innerHTML !== nextHtml) editor.innerHTML = nextHtml;
    syncEditorHeight();
  }, [text, entities]);

  const emitChange = () => {
    if (!editorRef.current) return;
    const value = editorHtmlToRichText(editorRef.current);
    const limited = value.text.length > maxLength
      ? sliceRichText(value.text, value.entities, 0, maxLength)
      : value;

    if (limited !== value) {
      editorRef.current.innerHTML = richTextToHtml(limited.text, limited.entities);
    }
    onChange(limited.text, limited.entities);
    syncEditorHeight();
  };

  const handleBeforeInput = (event: React.FormEvent<HTMLDivElement>) => {
    if (!editorRef.current || !event.nativeEvent) return;
    const inputEvent = event.nativeEvent as InputEvent;
    if (!inputEvent.inputType.startsWith('insert')) return;

    const selection = window.getSelection();
    const selectedLength = selection?.toString().length ?? 0;
    const currentLength = editorHtmlToRichText(editorRef.current).text.length;
    if (currentLength - selectedLength >= maxLength) event.preventDefault();
  };

  const saveSelection = () => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !editorRef.current?.contains(selection.anchorNode)) return;
    const range = selection.getRangeAt(0);
    savedRangeRef.current = range.cloneRange();

    const startRange = range.cloneRange();
    startRange.selectNodeContents(editorRef.current);
    startRange.setEnd(range.startContainer, range.startOffset);
    const endRange = range.cloneRange();
    endRange.selectNodeContents(editorRef.current);
    endRange.setEnd(range.endContainer, range.endOffset);
    editorRef.current.dataset.selectionStart = String(startRange.toString().length);
    editorRef.current.dataset.selectionEnd = String(endRange.toString().length);
  };

  const restoreSelection = () => {
    const selection = window.getSelection();
    const range = savedRangeRef.current;
    if (!selection || !range || !editorRef.current) return;
    editorRef.current.focus();
    selection.removeAllRanges();
    selection.addRange(range);
  };

  const clearSelection = () => {
    const selection = window.getSelection();
    if (!selection) return;
    selection.removeAllRanges();
    savedRangeRef.current = null;
  };

  const runCommand = (command: FormatCommand) => {
    restoreSelection();
    document.execCommand(command);
    emitChange();
  };

  const applyLink = () => {
    const url = linkUrl.trim();
    if (!/^https?:\/\//i.test(url) && !/^tg:/i.test(url)) return;
    restoreSelection();
    document.execCommand('createLink', false, url);
    setLinkOpen(false);
    emitChange();
  };

  const remainingCharacters = getRemainingMessageLength(text.length, maxLength);
  const counterTone = getMessageCounterTone(remainingCharacters);

  return (
    <div
      className={`workspace-page-rich-text-editor ${stageMode === 'editor' && toolbarActive ? 'is-toolbar-active' : ''}`}
      onFocus={() => setToolbarActive(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setToolbarActive(false);
        }
      }}
    >
      <div className="workspace-page-rich-text-stage">
        <div
          ref={(element) => {
            editorRef.current = element;
            if (inputRef) inputRef.current = element;
          }}
          className={`workspace-page-textarea workspace-page-rich-text-input workspace-page-rich-text-stage-view ${stageMode === 'editor' ? 'is-active' : ''} ${text.trim() || editorFocused ? 'has-content' : 'is-empty'}`}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-label="Post content"
          data-placeholder="Start writing your post..."
          spellCheck
          aria-hidden={stageMode !== 'editor'}
          onFocus={() => setEditorFocused(true)}
          onBeforeInput={handleBeforeInput}
          onInput={emitChange}
          onMouseUp={saveSelection}
          onKeyUp={saveSelection}
          onSelect={saveSelection}
          onBlur={() => {
            setEditorFocused(false);
            const selection = window.getSelection();
            if (!selection || !editorRef.current?.contains(selection.anchorNode)) {
              clearSelection();
              return;
            }
            saveSelection();
          }}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
              event.preventDefault();
              saveSelection();
              setLinkOpen(true);
            }
          }}
        />
        <div className="workspace-page-rich-text-stage-content">
          {stageContent}
        </div>
      </div>
      <div className="workspace-page-rich-text-toolbar" aria-label="Text formatting">
        <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand('bold')} aria-label="Bold" title="Bold">B</button>
        <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand('italic')} aria-label="Italic" title="Italic"><em>I</em></button>
        <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand('underline')} aria-label="Underline" title="Underline"><u>U</u></button>
        <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand('strikeThrough')} aria-label="Strikethrough" title="Strikethrough"><s>S</s></button>
        <button
          type="button"
          onMouseDown={(event) => {
            event.preventDefault();
            saveSelection();
          }}
          onClick={() => setLinkOpen((value) => !value)}
          aria-label="Add link"
          title="Add link"
        >
          ↗
        </button>
        <span
          className={`workspace-page-character-count ${counterTone === 'critical' ? 'is-critical' : counterTone === 'warning' ? 'is-warning' : ''}`}
          aria-live="polite"
        >
          {remainingCharacters}
        </span>
      </div>
      {linkOpen && (
        <div className="workspace-page-rich-text-link-popover">
          <input
            value={linkUrl}
            onChange={(event) => setLinkUrl(event.target.value)}
            aria-label="Link URL"
            placeholder="https://example.com"
            autoFocus
          />
          <button type="button" onClick={applyLink}>Apply</button>
          <button type="button" onClick={() => setLinkOpen(false)}>Cancel</button>
        </div>
      )}
    </div>
  );
}