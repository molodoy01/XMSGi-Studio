import { useRef } from 'react';
import type { MutableRefObject } from 'react';
import { editorHtmlToRichText, getEditorTextBoundary, getEditorTextOffset } from '@studio/lib/richText';

function restoreEditorSelection(root: HTMLElement, start: number, end: number) {
  const selection = window.getSelection();
  if (!selection) return;

  const startBoundary = getEditorTextBoundary(root, start);
  const endBoundary = getEditorTextBoundary(root, end);
  const range = document.createRange();
  range.setStart(startBoundary.node, startBoundary.offset);
  range.setEnd(endBoundary.node, endBoundary.offset);
  selection.removeAllRanges();
  selection.addRange(range);
}

export function useEditorSelection(editorRef: MutableRefObject<HTMLDivElement | null>) {
  const savedRangeRef = useRef<Range | null>(null);
  const getCaretOffset = (fallbackOffset: number) => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection || selection.rangeCount === 0) return fallbackOffset;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.startContainer) && range.startContainer !== editor) return fallbackOffset;

    const rawOffset = getEditorTextOffset(editor, range.startContainer, range.startOffset);
    if (rawOffset === null) return fallbackOffset;
    return editorHtmlToRichText(editor).sourceOffsetMap?.[rawOffset] ?? rawOffset;
  };

  const placeCaretAtStart = () => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection) return;

    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    savedRangeRef.current = null;
  };

  const saveSelection = () => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection || selection.rangeCount === 0
      || (!editor.contains(selection.anchorNode) && selection.anchorNode !== editor)) return;
    const range = selection.getRangeAt(0);
    savedRangeRef.current = range.cloneRange();
    const start = getEditorTextOffset(editor, range.startContainer, range.startOffset);
    const end = getEditorTextOffset(editor, range.endContainer, range.endOffset);
    if (start === null || end === null) return;
    editor.dataset.selectionStart = String(start);
    editor.dataset.selectionEnd = String(end);
  };

  const restoreSelection = () => {
    const selection = window.getSelection();
    const range = savedRangeRef.current;
    const editor = editorRef.current;
    if (!selection || !editor) return;

    // Живой диапазон приоритетнее: после execCommand + emitChange узлы уже новые.
    const isUsable = Boolean(
      range
      && range.startContainer.isConnected
      && range.endContainer.isConnected
      && (range.startContainer === editor
        || range.endContainer === editor
        || editor.contains(range.startContainer)
        || editor.contains(range.endContainer)),
    );
    if (isUsable && range) {
      try {
        editor.focus();
        selection.removeAllRanges();
        selection.addRange(range.cloneRange());
        return;
      } catch {
        // Ниже — восстановление по текстовым оффсетам.
      }
    }

    // Сохранённый диапазон мог «отсохнуть» после нормализации innerHTML
    // (<b> → <strong>) при синхронизации состояния родителя: тогда клик по
    // следующей иконке подряд ничего не применял и тулбар «зависал».
    // Текстовые оффсеты переживают перерисовку, восстанавливаемся по ним.
    const start = editor.dataset.selectionStart !== undefined && editor.dataset.selectionStart !== ''
      ? Number(editor.dataset.selectionStart)
      : NaN;
    const end = editor.dataset.selectionEnd !== undefined && editor.dataset.selectionEnd !== ''
      ? Number(editor.dataset.selectionEnd)
      : NaN;
    if (Number.isFinite(start) && Number.isFinite(end)) {
      try {
        editor.focus();
        restoreEditorSelection(editor, Math.max(0, start), Math.max(0, end));
        const live = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
        if (live) savedRangeRef.current = live.cloneRange();
        return;
      } catch {
        // Игнорируем — ниже сбрасываем мёртвый диапазон.
      }
    }

    savedRangeRef.current = null;
  };

  const clearSelection = () => {
    const selection = window.getSelection();
    if (!selection) return;
    selection.removeAllRanges();
    savedRangeRef.current = null;
  };

  const getTextOffset = (node: Node, offset: number) => {
    const editor = editorRef.current;
    return editor ? getEditorTextOffset(editor, node, offset) : null;
  };

  const restoreTextSelection = (start: number, end: number) => {
    const editor = editorRef.current;
    if (editor) restoreEditorSelection(editor, start, end);
  };

  const restoreSelectionRange = (range: Range | null) => {
    const selection = window.getSelection();
    const editor = editorRef.current;
    if (!selection || !range || !editor) return;

    try {
      const isInsideEditor = editor.contains(range.startContainer) || editor.contains(range.endContainer);
      if (!isInsideEditor) return;
      selection.removeAllRanges();
      selection.addRange(range.cloneRange());
    } catch {
      // Keep the browser selection if the DOM changed during formatting.
    }
  };

  return {
    savedRangeRef,
    getCaretOffset,
    getTextOffset,
    placeCaretAtStart,
    saveSelection,
    restoreSelection,
    clearSelection,
    restoreTextSelection,
    restoreSelectionRange,
  };
}