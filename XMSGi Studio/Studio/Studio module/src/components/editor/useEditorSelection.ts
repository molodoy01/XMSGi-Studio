import { useRef } from 'react';
import type { MutableRefObject } from 'react';
import { editorHtmlToRichText } from '@/lib/richText';

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
    return editorHtmlToRichText(editor).sourceOffsetMap[rawOffset] ?? rawOffset;
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

    const startRange = range.cloneRange();
    startRange.selectNodeContents(editor);
    startRange.setEnd(range.startContainer, range.startOffset);
    const endRange = range.cloneRange();
    endRange.selectNodeContents(editor);
    endRange.setEnd(range.endContainer, range.endOffset);
    editor.dataset.selectionStart = String(startRange.toString().length);
    editor.dataset.selectionEnd = String(endRange.toString().length);
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