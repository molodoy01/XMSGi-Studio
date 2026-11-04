import { useRef } from 'react';
import type { MutableRefObject } from 'react';
import { editorHtmlToRichText } from '@studio/lib/richText';

function countEditorText(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent?.length ?? 0;
  if (node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName === 'BR') return 1;

  let length = 0;
  node.childNodes.forEach((child) => { length += countEditorText(child); });
  return length;
}

function getEditorTextOffset(root: HTMLElement, targetNode: Node, targetOffset: number): number | null {
  let length = 0;
  let found = false;

  const visit = (node: Node): boolean => {
    if (node === targetNode) {
      if (node.nodeType === Node.TEXT_NODE) {
        length += Math.max(0, Math.min(targetOffset, node.textContent?.length ?? 0));
      } else {
        const childLimit = Math.max(0, Math.min(targetOffset, node.childNodes.length));
        for (let childIndex = 0; childIndex < childLimit; childIndex += 1) {
          length += countEditorText(node.childNodes[childIndex]);
        }
      }
      found = true;
      return true;
    }

    if (node.nodeType === Node.TEXT_NODE) {
      length += node.textContent?.length ?? 0;
      return false;
    }
    if (node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName === 'BR') {
      length += 1;
      return false;
    }

    for (const child of Array.from(node.childNodes)) {
      if (visit(child)) return true;
    }
    return false;
  };

  visit(root);
  return found ? length : null;
}

function getEditorSelectionTextOffsets(root: HTMLElement, range: Range) {
  let length = 0;
  let start: number | null = null;
  let end: number | null = null;

  const getBoundaryOffset = (node: Node, offset: number) => {
    if (node.nodeType === Node.TEXT_NODE) {
      return length + Math.max(0, Math.min(offset, node.textContent?.length ?? 0));
    }

    const childLimit = Math.max(0, Math.min(offset, node.childNodes.length));
    let boundaryLength = length;
    for (let childIndex = 0; childIndex < childLimit; childIndex += 1) {
      boundaryLength += countEditorText(node.childNodes[childIndex]);
    }
    return boundaryLength;
  };

  const visit = (node: Node): boolean => {
    if (node === range.startContainer) start = getBoundaryOffset(node, range.startOffset);
    if (node === range.endContainer) end = getBoundaryOffset(node, range.endOffset);
    if (start !== null && end !== null) return true;

    if (node.nodeType === Node.TEXT_NODE) {
      length += node.textContent?.length ?? 0;
      return false;
    }
    if (node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName === 'BR') {
      length += 1;
      return false;
    }

    for (const child of Array.from(node.childNodes)) {
      if (visit(child)) return true;
    }
    return false;
  };

  visit(root);
  return start === null || end === null ? null : { start, end };
}

function getEditorBoundaryAtTextOffset(root: HTMLElement, targetOffset: number): { node: Node; offset: number } {
  let length = 0;
  let boundary: { node: Node; offset: number } | null = null;

  const visit = (node: Node): boolean => {
    if (node.nodeType === Node.TEXT_NODE) {
      const nodeLength = node.textContent?.length ?? 0;
      if (targetOffset <= length + nodeLength) {
        boundary = { node, offset: Math.max(0, targetOffset - length) };
        return true;
      }
      length += nodeLength;
      return false;
    }

    if (node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName === 'BR') {
      if (targetOffset <= length + 1 && node.parentNode) {
        const childIndex = Array.prototype.indexOf.call(node.parentNode.childNodes, node) as number;
        boundary = { node: node.parentNode, offset: childIndex + (targetOffset > length ? 1 : 0) };
        return true;
      }
      length += 1;
      return false;
    }

    for (const child of Array.from(node.childNodes)) {
      if (visit(child)) return true;
    }
    return false;
  };

  visit(root);
  return boundary ?? { node: root, offset: root.childNodes.length };
}

function restoreEditorSelection(root: HTMLElement, start: number, end: number) {
  const selection = window.getSelection();
  if (!selection) return;

  const startBoundary = getEditorBoundaryAtTextOffset(root, start);
  const endBoundary = getEditorBoundaryAtTextOffset(root, end);
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
    if (!selection || selection.rangeCount === 0 || !editor?.contains(selection.anchorNode)) return;
    const range = selection.getRangeAt(0);
    savedRangeRef.current = range.cloneRange();
    const offsets = getEditorSelectionTextOffsets(editor, range);
    if (!offsets) return;
    editor.dataset.selectionStart = String(offsets.start);
    editor.dataset.selectionEnd = String(offsets.end);
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