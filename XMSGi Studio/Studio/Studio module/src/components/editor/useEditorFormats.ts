import { useEffect, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { StageMode } from '@/components/stages/types';

export type EditorFormats = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  unorderedList: boolean;
  orderedList: boolean;
};

const emptyFormats: EditorFormats = {
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  unorderedList: false,
  orderedList: false,
};

export function useEditorFormats(editorRef: MutableRefObject<HTMLDivElement | null>, stageMode: StageMode) {
  const [activeFormats, setActiveFormats] = useState(emptyFormats);

  const getSelectionFormatState = () => {
    const next = { ...emptyFormats };
    const selection = window.getSelection();
    const editor = editorRef.current;
    if (!selection || selection.rangeCount === 0 || !editor) return next;

    const range = selection.getRangeAt(0);
    const selectors = {
      bold: 'b,strong',
      italic: 'i,em',
      underline: 'u',
      strike: 's,strike,del',
      unorderedList: 'ul',
      orderedList: 'ol',
    } as const;

    const containsFormat = (selector: string) => {
      const candidates = new Set<Node | null>([
        range.commonAncestorContainer,
        range.startContainer,
        range.endContainer,
        selection.anchorNode,
        selection.focusNode,
      ]);

      if (range.collapsed) {
        const anchorNode = selection.anchorNode;
        if (anchorNode?.nodeType === Node.ELEMENT_NODE) {
          const element = anchorNode as Element;
          const anchorOffset = Math.max(0, Math.min(selection.anchorOffset, element.childNodes.length));
          candidates.add(element.childNodes[anchorOffset - 1] ?? null);
          candidates.add(element.childNodes[anchorOffset] ?? null);
        } else if (anchorNode?.parentElement) {
          candidates.add(anchorNode.parentElement);
        }
      }

      for (const candidate of candidates) {
        if (!candidate) continue;

        let current: Node | null = candidate;
        while (current) {
          if (current.nodeType === Node.ELEMENT_NODE) {
            const element = current as Element;
            if (element.matches(selector)) return true;
            if (element.closest(selector)) return true;
            if (current === editor) break;
          }
          current = current.parentNode;
        }
      }

      if (!range.collapsed) {
        const fragment = range.cloneContents();
        if (fragment.querySelector(selector)) return true;
      }

      return false;
    };

    next.bold = containsFormat(selectors.bold);
    next.italic = containsFormat(selectors.italic);
    next.underline = containsFormat(selectors.underline);
    next.strike = containsFormat(selectors.strike);
    next.unorderedList = containsFormat(selectors.unorderedList);
    next.orderedList = containsFormat(selectors.orderedList);
    return next;
  };

  const syncToolbarStateFromSelection = () => {
    setActiveFormats(getSelectionFormatState());
  };

  useEffect(() => {
    if (stageMode !== 'editor') return;

    const editor = editorRef.current;
    if (!editor) return;

    const handleNativeSelect = () => syncToolbarStateFromSelection();
    const handleSelectionChange = () => syncToolbarStateFromSelection();

    editor.addEventListener('select', handleNativeSelect);
    document.addEventListener('selectionchange', handleSelectionChange);
    return () => {
      editor.removeEventListener('select', handleNativeSelect);
      document.removeEventListener('selectionchange', handleSelectionChange);
    };
  }, [stageMode]);

  return { activeFormats, syncToolbarStateFromSelection };
}