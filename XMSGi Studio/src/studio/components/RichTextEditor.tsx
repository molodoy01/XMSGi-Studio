import { useEffect, useRef, useState } from 'react';
import type { MutableRefObject, ReactNode } from 'react';
import { Eraser } from 'lucide-react';
import type { RichTextEntity } from '@studio/types';
import {
  editorHtmlToRichText,
  getEditorTextBoundary,
  getEditorTextOffset,
  normalizeEditorText,
  richTextToHtml,
  sliceRichText,
} from '@studio/lib/richText';
import { getMessageCounterTone, getRemainingMessageLength } from '@studio/lib/messageLimits';
import { useLocale } from '@studio/lib/i18n';
import { EditorToolbar } from '@studio/components/editor/EditorToolbar';
import type { EditorToolbarFormat } from '@studio/components/editor/EditorToolbar';
import { LogoIntroAnimation, type LogoIntroState } from '@studio/components/editor/LogoIntroAnimation';
import { useEditorFormats } from '@studio/components/editor/useEditorFormats';
import { useEditorSelection } from '@studio/components/editor/useEditorSelection';

const INDENT_WIDTH = 2;

interface Props {
  text: string;
  entities: RichTextEntity[];
  onChange: (text: string, entities: RichTextEntity[]) => void;
  onAddFiles?: (files: File[], position: number) => void;
  onPasteImages?: (files: File[]) => void;
  inputRef?: MutableRefObject<HTMLDivElement | null>;
  stageContent?: ReactNode;
  stageMode?: 'editor' | 'schedule' | 'template' | 'draft' | 'chat';
  maxLength: number;
  onOpenAlbum?: (position: number) => void;
  albumDisabled?: boolean;
  onExportText?: (text: string, format: 'txt' | 'json') => void;
  onBeforeClear?: () => Promise<boolean>;
  onOpenVersionHistory?: () => void;
  selectedEffectId?: string | null;
  onEffectChange?: (effectId: string | null) => void;
}

export function shouldPreventEditorInsertion(currentLength: number, selectedLength: number, maxLength: number) {
  return currentLength - selectedLength >= maxLength;
}

function isValidEditorLink(value: string): boolean {
  if (!value || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'tg:';
  } catch {
    return false;
  }
}

export function RichTextEditor({ text, entities, onChange, onAddFiles, onPasteImages, inputRef, stageContent, stageMode = 'editor', maxLength, onOpenAlbum, albumDisabled, onExportText, onBeforeClear, onOpenVersionHistory, selectedEffectId, onEffectChange }: Props) {
  const { t } = useLocale();
  const [hasIndentedLineBreak, setHasIndentedLineBreak] = useState(false);
  const hasEditorContent = Boolean(text.trim()) || hasIndentedLineBreak;
  const editorRef = useRef<HTMLDivElement | null>(null);
  const editorScrollbarRef = useRef<HTMLDivElement | null>(null);
  const editorScrollDragRef = useRef<{ pointerY: number; scrollTop: number } | null>(null);
  const logicalTextLengthRef = useRef(text.length);
  const previousTextRef = useRef(text);
  const pendingTabEnterRef = useRef(false);
  const [editorScrollMetrics, setEditorScrollMetrics] = useState({
    scrollTop: 0,
    scrollHeight: 0,
    clientHeight: 0,
  });
  const [editorScrollbarDragging, setEditorScrollbarDragging] = useState(false);
  const {
    getCaretOffset,
    placeCaretAtStart,
    saveSelection,
    clearSelection,
    restoreSelection,
    restoreTextSelection,
  } = useEditorSelection(editorRef);
  const { activeFormats, syncToolbarStateFromSelection, scheduleToolbarStateSync } = useEditorFormats(editorRef, stageMode);
  const [toolbarActive, setToolbarActive] = useState(false);
  const [editorFocused, setEditorFocused] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [linkInput, setLinkInput] = useState('');
  const [linkPopoverOpen, setLinkPopoverOpen] = useState(false);
  const linkPopoverRef = useRef<HTMLFormElement | null>(null);
  const suppressToolbarActivationRef = useRef(false);
  const isApplyingFormatRef = useRef(false);
  const [logoState, setLogoState] = useState<LogoIntroState>({
    hasPlayed: false,
    flying: false,
    glowActive: false,
    glowFinishing: false,
    introReady: false,
  });
  useEffect(() => {
    logicalTextLengthRef.current = text.length;
    if (previousTextRef.current && !text) setHasIndentedLineBreak(false);
    previousTextRef.current = text;
    const editor = editorRef.current;
    if (!editor || document.activeElement === editor) return;
    const nextHtml = richTextToHtml(text, entities);
    if (editor.innerHTML !== nextHtml) editor.innerHTML = nextHtml;
  }, [text, entities]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return undefined;

    const syncScrollMetrics = () => {
      const next = {
        scrollTop: editor.scrollTop,
        scrollHeight: editor.scrollHeight,
        clientHeight: editor.clientHeight,
      };
      setEditorScrollMetrics((current) => (
        current.scrollTop === next.scrollTop
        && current.scrollHeight === next.scrollHeight
        && current.clientHeight === next.clientHeight
          ? current
          : next
      ));
    };

    editor.addEventListener('scroll', syncScrollMetrics, { passive: true });
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(syncScrollMetrics);
    resizeObserver?.observe(editor);
    const mutationObserver = typeof MutationObserver === 'undefined' ? null : new MutationObserver(syncScrollMetrics);
    mutationObserver?.observe(editor, { childList: true, characterData: true, subtree: true });
    syncScrollMetrics();

    return () => {
      editor.removeEventListener('scroll', syncScrollMetrics);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    };
  }, []);

  const editorScrollbarCanScroll = editorScrollMetrics.scrollHeight > editorScrollMetrics.clientHeight + 1;
  const editorScrollbarThumbHeight = editorScrollbarCanScroll
    ? Math.min(100, Math.max(10, editorScrollMetrics.clientHeight / editorScrollMetrics.scrollHeight * 100))
    : 100;
  const editorScrollbarThumbTop = editorScrollbarCanScroll
    ? editorScrollMetrics.scrollTop / (editorScrollMetrics.scrollHeight - editorScrollMetrics.clientHeight)
      * (100 - editorScrollbarThumbHeight)
    : 0;

  const handleEditorScrollbarPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const editor = editorRef.current;
    const track = editorScrollbarRef.current;
    if (!editor || !track) return;

    const maxScroll = Math.max(0, editor.scrollHeight - editor.clientHeight);
    const trackHeight = track.clientHeight;
    const thumbHeight = Math.min(trackHeight, Math.max(16, editor.clientHeight / Math.max(1, editor.scrollHeight) * trackHeight));
    const target = event.target as HTMLElement;

    if (target.closest('.workspace-page-rich-text-scrollbar-thumb')) {
      editorScrollDragRef.current = { pointerY: event.clientY, scrollTop: editor.scrollTop };
      setEditorScrollbarDragging(true);
      track.setPointerCapture(event.pointerId);
    } else {
      const trackBounds = track.getBoundingClientRect();
      const travel = Math.max(1, trackHeight - thumbHeight);
      const position = (event.clientY - trackBounds.top - thumbHeight / 2) / travel;
      editor.scrollTop = Math.max(0, Math.min(maxScroll, position * maxScroll));
    }
    event.preventDefault();
  };

  const handleEditorScrollbarPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = editorScrollDragRef.current;
    const editor = editorRef.current;
    const track = editorScrollbarRef.current;
    if (!drag || !editor || !track) return;

    const maxScroll = Math.max(0, editor.scrollHeight - editor.clientHeight);
    const trackHeight = track.clientHeight;
    const thumbHeight = Math.min(trackHeight, Math.max(16, editor.clientHeight / Math.max(1, editor.scrollHeight) * trackHeight));
    const travel = Math.max(1, trackHeight - thumbHeight);
    editor.scrollTop = Math.max(0, Math.min(maxScroll, drag.scrollTop + (event.clientY - drag.pointerY) / travel * maxScroll));
  };

  const handleEditorScrollbarKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const editor = editorRef.current;
    if (!editor) return;

    const pageStep = Math.max(40, editor.clientHeight * 0.75);
    const nextScrollTop = event.key === 'ArrowDown' ? editor.scrollTop + 40
      : event.key === 'ArrowUp' ? editor.scrollTop - 40
        : event.key === 'PageDown' ? editor.scrollTop + pageStep
          : event.key === 'PageUp' ? editor.scrollTop - pageStep
            : event.key === 'Home' ? 0
              : event.key === 'End' ? editor.scrollHeight - editor.clientHeight
                : null;
    if (nextScrollTop === null) return;

    event.preventDefault();
    editor.scrollTop = nextScrollTop;
  };

  const emitChange = () => {
    if (!editorRef.current) return;
    const editor = editorRef.current;
    const selection = window.getSelection();
    const selectionRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    const selectionNodes = selectionRange ? {
      startContainer: selectionRange.startContainer,
      startOffset: selectionRange.startOffset,
      endContainer: selectionRange.endContainer,
      endOffset: selectionRange.endOffset,
    } : null;
    const selectionOffsets = selectionRange
      && (selectionRange.startContainer === editor || editor.contains(selectionRange.startContainer))
      && (selectionRange.endContainer === editor || editor.contains(selectionRange.endContainer))
      ? {
          start: getEditorTextOffset(editor, selectionRange.startContainer, selectionRange.startOffset),
          end: getEditorTextOffset(editor, selectionRange.endContainer, selectionRange.endOffset),
        }
      : null;
    const editorHtmlBeforeParsing = editor.innerHTML;
    const value = editorHtmlToRichText(editor);
    const editorDomChanged = editor.innerHTML !== editorHtmlBeforeParsing;
    const limited = value.text.length > maxLength
      ? sliceRichText(value.text, value.entities, 0, maxLength)
      : value;
    logicalTextLengthRef.current = limited.text.length;

    if (value.markdownChanged || limited.text !== value.text) {
      editor.innerHTML = richTextToHtml(limited.text, limited.entities);
      if (limited.text !== value.text) {
        const range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(false);
        selection?.removeAllRanges();
        selection?.addRange(range);
      } else {
        const mapOffset = (sourceOffset: number | null) => {
          if (sourceOffset === null) return limited.text.length;
          if (!value.markdownChanged) return Math.min(sourceOffset, limited.text.length);
          const sourceOffsetMap = value.sourceOffsetMap ?? [];
          const safeOffset = Math.max(0, Math.min(sourceOffset, sourceOffsetMap.length - 1));
          return Math.min(sourceOffsetMap[safeOffset] ?? limited.text.length, limited.text.length);
        };
        if (selectionOffsets) {
          restoreTextSelection(
            mapOffset(selectionOffsets.start),
            mapOffset(selectionOffsets.end),
          );
        }
      }
    } else if (editorDomChanged
      && selectionOffsets?.start !== null && selectionOffsets?.start !== undefined
      && selectionOffsets?.end !== null && selectionOffsets?.end !== undefined) {
      const startNode = selectionNodes?.startContainer;
      const endNode = selectionNodes?.endContainer;
      if (startNode?.isConnected && endNode?.isConnected
        && (startNode === editor || editor.contains(startNode))
        && (endNode === editor || editor.contains(endNode))) {
        const getRestoredOffset = (node: Node, offset: number) => node.nodeType === Node.TEXT_NODE
          ? normalizeEditorText((node.textContent ?? '').slice(0, offset)).length
          : Math.min(offset, node.childNodes.length);
        const restoredRange = document.createRange();
        restoredRange.setStart(startNode, getRestoredOffset(startNode, selectionNodes!.startOffset));
        restoredRange.setEnd(endNode, getRestoredOffset(endNode, selectionNodes!.endOffset));
        selection?.removeAllRanges();
        selection?.addRange(restoredRange);
      } else {
        restoreTextSelection(selectionOffsets.start, selectionOffsets.end);
      }
    }
    if (selectionOffsets) saveSelection();
    onChange(limited.text, limited.entities);
  };

  const insertEmoji = (emoji: string) => {
    const editor = editorRef.current;
    if (!editor) return;

    restoreSelection();
    let selection = window.getSelection();
    let range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    if (!selection || !range || (range.startContainer !== editor && !editor.contains(range.startContainer))) {
      editor.focus();
      placeCaretAtStart();
      selection = window.getSelection();
      range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    }
    if (!selection || !range) return;

    const selectedLength = range.toString().length;
    if (logicalTextLengthRef.current - selectedLength + emoji.length > maxLength) return;

    range.deleteContents();
    const emojiNode = document.createTextNode(emoji);
    range.insertNode(emojiNode);
    const nextRange = document.createRange();
    nextRange.setStartAfter(emojiNode);
    nextRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(nextRange);
    saveSelection();
    emitChange();
    syncToolbarStateFromSelection();
    requestAnimationFrame(() => {
      restoreSelection();
      saveSelection();
    });
  };

  const applyFormat = (format: EditorToolbarFormat) => {
    const editor = editorRef.current;
    if (!editor) return;

    const commands = {
      bold: 'bold',
      italic: 'italic',
      underline: 'underline',
      strike: 'strikeThrough',
    } as const;

    restoreSelection();
    let selection = window.getSelection();
    let range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    if (!selection || !range || (range.startContainer !== editor && !editor.contains(range.startContainer))) {
      editor.focus();
      placeCaretAtStart();
      selection = window.getSelection();
      range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    }
    if (!selection || !range) return;

    if (range.collapsed) {
      const tagByFormat = {
        bold: 'b',
        italic: 'i',
        underline: 'u',
        strike: 's',
      } as const;
      const selectors = {
        bold: 'b,strong',
        italic: 'i,em',
        underline: 'u',
        strike: 's,strike,del',
      } as const;
      const anchorElement = selection.anchorNode?.nodeType === Node.ELEMENT_NODE
        ? selection.anchorNode as Element
        : selection.anchorNode?.parentElement;
      const activeTag = anchorElement?.closest(selectors[format]);

      if (activeTag?.textContent === '\u200B' && activeTag.firstChild) {
        const marker = activeTag.firstChild;
        activeTag.parentNode?.insertBefore(marker, activeTag);
        activeTag.remove();
        const caretRange = document.createRange();
        caretRange.setStart(marker, marker.textContent?.length ?? 0);
        caretRange.collapse(true);
        selection.removeAllRanges();
        selection.addRange(caretRange);
      } else if (activeTag) {
        if (typeof document.execCommand === 'function') document.execCommand(commands[format], false);
      } else {
        const wrapper = document.createElement(tagByFormat[format]);
        const marker = document.createTextNode('\u200B');
        wrapper.appendChild(marker);
        range.insertNode(wrapper);
        const caretRange = document.createRange();
        caretRange.setStart(marker, marker.length);
        caretRange.collapse(true);
        selection.removeAllRanges();
        selection.addRange(caretRange);
      }

      saveSelection();
      syncToolbarStateFromSelection();
      return;
    }

    isApplyingFormatRef.current = true;
    try {
      if (typeof document.execCommand === 'function') document.execCommand(commands[format], false);
    } finally {
      isApplyingFormatRef.current = false;
    }

    saveSelection();
    emitChange();
    syncToolbarStateFromSelection();
    requestAnimationFrame(() => {
      restoreSelection();
      saveSelection();
      syncToolbarStateFromSelection();
    });
  };

  const toggleLinkPopover = () => {
    if (linkPopoverOpen) {
      closeLinkPopover();
      return;
    }
    const editor = editorRef.current;
    if (!editor) return;
    const selection = window.getSelection();
    const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    if (range && (range.startContainer === editor || editor.contains(range.startContainer))) {
      saveSelection();
    } else {
      suppressToolbarActivationRef.current = true;
      try {
        restoreSelection();
        const restoredSelection = window.getSelection();
        const restoredRange = restoredSelection && restoredSelection.rangeCount > 0 ? restoredSelection.getRangeAt(0) : null;
        if (!restoredRange || (restoredRange.startContainer !== editor && !editor.contains(restoredRange.startContainer))) {
          editor.focus();
          placeCaretAtStart();
        }
      } finally {
        suppressToolbarActivationRef.current = false;
      }
      saveSelection();
    }
    setLinkInput('');
    setLinkPopoverOpen(true);
  };

  const closeLinkPopover = () => {
    setLinkInput('');
    setLinkPopoverOpen(false);
  };

  const insertLink = () => {
    const url = linkInput.trim();
    const editor = editorRef.current;
    if (!editor || !isValidEditorLink(url)) return;

    restoreSelection();
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (range.startContainer !== editor && !editor.contains(range.startContainer)) return;

    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    if (range.collapsed) {
      link.textContent = url;
    } else {
      link.appendChild(range.extractContents());
    }
    range.insertNode(link);

    const nextRange = document.createRange();
    nextRange.selectNodeContents(link);
    selection.removeAllRanges();
    selection.addRange(nextRange);
    saveSelection();
    closeLinkPopover();
    emitChange();
    syncToolbarStateFromSelection();
    requestAnimationFrame(() => {
      saveSelection();
      syncToolbarStateFromSelection();
    });
  };

  useEffect(() => {
    if (!linkPopoverOpen) return undefined;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return;
      if (linkPopoverRef.current?.contains(event.target)) return;
      if (event.target.closest('.workspace-page-rich-text-link-trigger')) return;
      closeLinkPopover();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeLinkPopover();
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [linkPopoverOpen]);

  const handleBeforeInput = (event: React.FormEvent<HTMLDivElement>) => {
    if (!editorRef.current || !event.nativeEvent) return;

    const inputEvent = event.nativeEvent as Partial<InputEvent> | undefined;
    const inputType = typeof inputEvent?.inputType === 'string' ? inputEvent.inputType : '';

    if (inputType && !inputType.startsWith('insert')) return;
    if (!inputType) return;

    const selection = window.getSelection();
    const selectedLength = selection?.toString().length ?? 0;
    const currentLength = logicalTextLengthRef.current;
    if (shouldPreventEditorInsertion(currentLength, selectedLength, maxLength)) event.preventDefault();
  };

  const saveOrInitializeEditorSelection = () => {
    const editor = editorRef.current;
    if (!editor) return;
    if (editor.childNodes.length === 0) placeCaretAtStart();
    else saveSelection();
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault();

    const clipboardItems = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);
    const clipboardFiles = clipboardItems.length > 0 ? clipboardItems : Array.from(event.clipboardData.files ?? []);
    const preparedFiles = clipboardFiles.map((file) => {
      if (file.name) return file;
      const extension = file.type.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
      return new File([file], `pasted-image-${Date.now()}.${extension}`, {
        type: file.type,
        lastModified: file.lastModified,
      });
    });
    const attachmentPosition = getCaretOffset(text.length);
    if (preparedFiles.length > 0) {
      if (onAddFiles) onAddFiles(preparedFiles, attachmentPosition);
      else onPasteImages?.(preparedFiles.filter((file) => file.type.startsWith('image/')));
    }

    const readyText = normalizeEditorText(event.clipboardData.getData('text/plain') || '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n');

    if (!readyText) return;

    const selection = window.getSelection();
    if (!selection || !editorRef.current) return;

    const range = selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : document.createRange();
    range.deleteContents();
    const textNode = document.createTextNode(readyText);
    range.insertNode(textNode);
    range.setStartAfter(textNode);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    emitChange();
  };

  const isFileDrag = (event: React.DragEvent<HTMLDivElement>) => (
    stageMode === 'editor' && Array.from(event.dataTransfer.types).includes('Files')
  );

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setDragOver(true);
  };

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    setDragOver(false);
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    setDragOver(false);
    const files = Array.from(event.dataTransfer.files);
    if (files.length > 0) onAddFiles?.(files, getCaretOffset(text.length));
  };

  const clearEditorText = async () => {
    if (onBeforeClear && !await onBeforeClear()) return;
    const editor = editorRef.current;
    if (!editor) return;
    editor.innerHTML = '';
    setHasIndentedLineBreak(false);
    logicalTextLengthRef.current = 0;
    clearSelection();
    onChange('', []);
    editor.focus();
    setEditorFocused(true);
    placeCaretAtStart();
  };

  const remainingCharacters = getRemainingMessageLength(text.length, maxLength);
  const counterTone = getMessageCounterTone(remainingCharacters);
  const hasEditorText = text.length > 0 || hasIndentedLineBreak;
  useEffect(() => {
    const updateHighlightFromPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return;
      if (event.target.closest('.workspace-page-rich-text-link-controls')) return;
      const inWorkspace = event.target.closest('.workspace-page');
      const interactiveTarget = event.target.closest('button, a[href], input, textarea, select, [contenteditable="true"], [role="button"], [role="menuitem"], [role="option"], [role="tab"], [role="checkbox"], [role="switch"], [role="combobox"], [role="spinbutton"], [tabindex]:not([tabindex="-1"])');
      let scrollContainer = event.target instanceof HTMLElement ? event.target : event.target.parentElement;
      let isExternalScrollInteraction = false;

      while (scrollContainer && scrollContainer !== document.body && scrollContainer !== document.documentElement && !scrollContainer.closest('.workspace-page')) {
        const styles = window.getComputedStyle(scrollContainer);
        const canScrollVertically = ['auto', 'scroll', 'overlay'].includes(styles.overflowY)
          && scrollContainer.scrollHeight > scrollContainer.clientHeight;
        const canScrollHorizontally = ['auto', 'scroll', 'overlay'].includes(styles.overflowX)
          && scrollContainer.scrollWidth > scrollContainer.clientWidth;
        if (canScrollVertically || canScrollHorizontally) {
          isExternalScrollInteraction = true;
          break;
        }
        scrollContainer = scrollContainer.parentElement;
      }

      if (inWorkspace && interactiveTarget) {
        setToolbarActive(true);
        return;
      }
      if (!inWorkspace && (isExternalScrollInteraction || event.target.closest('dialog, [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [role="tree"], [role="grid"]'))) return;
      if (interactiveTarget) return;
      if (toolbarActive) setToolbarActive(false);
    };
    const activateHighlightFromWorkspaceClick = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      if (event.target.closest('.workspace-page-rich-text-link-controls')) return;
      if (event.target.closest('.workspace-page') && event.target.closest('button, a[href], input, textarea, select, [contenteditable="true"], [role="button"], [role="menuitem"], [role="option"], [role="tab"], [role="checkbox"], [role="switch"], [role="combobox"], [role="spinbutton"], [tabindex]:not([tabindex="-1"])')) {
        setToolbarActive(true);
      }
    };

    document.addEventListener('pointerdown', updateHighlightFromPointerDown);
    document.addEventListener('click', activateHighlightFromWorkspaceClick);
    return () => {
      document.removeEventListener('pointerdown', updateHighlightFromPointerDown);
      document.removeEventListener('click', activateHighlightFromWorkspaceClick);
    };
  }, [toolbarActive]);
  const isLogoIntroActive = stageMode === 'editor'
    && editorFocused
    && ((!text.trim() && (!logoState.hasPlayed || logoState.introReady)) || logoState.glowActive || logoState.flying || logoState.glowFinishing);
  const editorClearButton = stageMode === 'editor' ? (
    <button
      type="button"
      className={`workspace-page-rich-text-clear${hasEditorText ? '' : ' is-hidden'}`}
      onMouseDown={(event) => event.preventDefault()}
      onClick={clearEditorText}
      aria-label={t('studio.clearEditorText')}
      aria-hidden={!hasEditorText}
      disabled={!hasEditorText}
      tabIndex={hasEditorText ? 0 : -1}
      title={t('studio.clearText')}
    >
      <Eraser size={16} strokeWidth={1.8} aria-hidden="true" />
    </button>
  ) : null;
  return (
    <div
      className={`workspace-page-rich-text-editor ${toolbarActive ? 'is-toolbar-active' : ''} ${dragOver ? 'is-drag-over' : ''}`}
      onDragEnter={(event) => { if (isFileDrag(event)) setDragOver(true); }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {stageMode === 'editor' && (
        <div className="workspace-page-rich-text-meta-row">
          <span
            className={`workspace-page-character-count ${counterTone === 'critical' ? 'is-critical' : counterTone === 'warning' ? 'is-warning' : ''}`}
            aria-live="polite"
          >
            {remainingCharacters}
          </span>
          {editorClearButton}
        </div>
      )}
      <div className="workspace-page-rich-text-stage-shell">
        <div className="workspace-page-rich-text-stage">
          <div
            ref={(element) => {
              editorRef.current = element;
              if (inputRef) inputRef.current = element;
            }}
            className={`workspace-page-textarea workspace-page-rich-text-input workspace-page-rich-text-stage-view ${stageMode === 'editor' ? 'is-active' : ''} ${hasEditorContent ? 'has-content' : 'is-empty'} ${editorFocused ? 'is-focused' : ''} ${isLogoIntroActive ? 'is-logo-intro' : ''} ${logoState.glowFinishing ? 'is-logo-intro-finishing' : ''}`}
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            id="workspace-page-rich-text-input"
            aria-label={t('studio.postContent')}
            data-placeholder={t('studio.postPlaceholder')}
            spellCheck={false}
            aria-hidden={stageMode !== 'editor'}
            onFocus={() => {
              if (!suppressToolbarActivationRef.current) setToolbarActive(true);
              setEditorFocused(true);
              if (!hasEditorContent) placeCaretAtStart();
            }}
            onBeforeInput={handleBeforeInput}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && event.nativeEvent.isComposing) {
                pendingTabEnterRef.current = false;
                return;
              }
              if (
                event.key !== 'Tab'
                && (event.key !== 'Enter' || event.ctrlKey || event.metaKey || event.altKey)
              ) {
                pendingTabEnterRef.current = false;
              }
              if (event.key === 'Tab') {
                pendingTabEnterRef.current = false;
                const editor = editorRef.current;
                const selection = window.getSelection();
                const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
                if (!editor || !selection || !range
                  || (range.startContainer !== editor && !editor.contains(range.startContainer))) {
                  event.preventDefault();
                  return;
                }

                const start = getEditorTextOffset(editor, range.startContainer, range.startOffset);
                const end = getEditorTextOffset(editor, range.endContainer, range.endOffset);
                if (start === null || end === null) {
                  event.preventDefault();
                  return;
                }

                event.preventDefault();
                const value = editorHtmlToRichText(editor).text;
                if (event.shiftKey) setHasIndentedLineBreak(false);
                const lineStart = value.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
                const lineStarts = [lineStart];
                let newline = value.indexOf('\n', lineStart);
                while (newline !== -1 && newline + 1 < end) {
                  lineStarts.push(newline + 1);
                  newline = value.indexOf('\n', newline + 1);
                }

                if (!event.shiftKey && logicalTextLengthRef.current + lineStarts.length * INDENT_WIDTH > maxLength) {
                  pendingTabEnterRef.current = false;
                  event.preventDefault();
                  return;
                }

                const editAtTextOffset = (offset: number, insertedText: string) => {
                  const boundary = getEditorTextBoundary(editor, offset);
                  const insertionRange = document.createRange();
                  insertionRange.setStart(boundary.node, boundary.offset);
                  insertionRange.collapse(true);
                  insertionRange.insertNode(document.createTextNode(insertedText));
                };

                if (!event.shiftKey && start === end) {
                  range.deleteContents();
                  const indent = document.createTextNode('  ');
                  range.insertNode(indent);
                  range.setStartAfter(indent);
                  range.collapse(true);
                  selection.removeAllRanges();
                  selection.addRange(range);
                } else if (event.shiftKey) {
                  const removals = lineStarts.flatMap((offset) => {
                    const leadingSpaces = value.slice(offset).match(/^ +/)?.[0].length ?? 0;
                    return leadingSpaces > 0 ? [{ offset, length: Math.min(INDENT_WIDTH, leadingSpaces) }] : [];
                  });
                  if (removals.length === 0) return;

                  const mapOffset = (offset: number) => {
                    let removed = 0;
                    for (const removal of removals) {
                      if (offset <= removal.offset) break;
                      if (offset <= removal.offset + removal.length) {
                        return removal.offset - removed;
                      }
                      removed += removal.length;
                    }
                    return offset - removed;
                  };
                  for (const removal of [...removals].reverse()) {
                    const removalRange = document.createRange();
                    const from = getEditorTextBoundary(editor, removal.offset);
                    const to = getEditorTextBoundary(editor, removal.offset + removal.length);
                    removalRange.setStart(from.node, from.offset);
                    removalRange.setEnd(to.node, to.offset);
                    removalRange.deleteContents();
                  }
                  restoreTextSelection(mapOffset(start), mapOffset(end));
                } else {
                  for (const offset of [...lineStarts].reverse()) editAtTextOffset(offset, '  ');
                  const insertedBeforeStart = lineStarts.filter((offset) => offset <= start).length * INDENT_WIDTH;
                  const insertedBeforeEnd = lineStarts.filter((offset) => offset < end).length * INDENT_WIDTH;
                  restoreTextSelection(start + insertedBeforeStart, end + insertedBeforeEnd);
                }

                pendingTabEnterRef.current = !event.shiftKey;
                emitChange();
                saveSelection();
                return;
              }

              if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey && !event.altKey) {
                if (!pendingTabEnterRef.current) return;
                const editor = editorRef.current;
                if (!editor) return;
                event.preventDefault();
                const selection = window.getSelection();
                let range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
                const hasEditorRange = Boolean(range
                  && (range.startContainer === editor || editor?.contains(range.startContainer))
                  && (range.endContainer === editor || editor?.contains(range.endContainer)));
                if (!range || !hasEditorRange) {
                  range = document.createRange();
                  range.selectNodeContents(editor);
                  range.collapse(false);
                }
                if (!selection) return;

                let indent = '';
                if (pendingTabEnterRef.current && range) {
                  const offset = getEditorTextOffset(editor, range.startContainer, range.startOffset);
                  if (offset !== null) {
                    const value = editorHtmlToRichText(editor).text;
                    const lineStart = value.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
                    indent = value.slice(lineStart).match(/^[ \t]*/)?.[0] ?? '';
                  }
                }
                pendingTabEnterRef.current = false;

                const selectedLength = range.toString().length;
                if (logicalTextLengthRef.current - selectedLength + 2 + indent.length > maxLength) return;

                range.deleteContents();
                const firstLineBreak = document.createElement('br');
                const secondLineBreak = document.createElement('br');
                range.insertNode(firstLineBreak);
                firstLineBreak.parentNode?.insertBefore(secondLineBreak, firstLineBreak.nextSibling);
                const caretMarker = document.createTextNode(indent);
                secondLineBreak.parentNode?.insertBefore(caretMarker, secondLineBreak.nextSibling);
                const nextRange = document.createRange();
                nextRange.setStart(caretMarker, caretMarker.length);
                nextRange.collapse(true);
                selection.removeAllRanges();
                selection.addRange(nextRange);
                setHasIndentedLineBreak(true);
                emitChange();
                saveSelection();
                return;
              }

              if (!(event.ctrlKey || event.metaKey) || !event.shiftKey || event.key.toLowerCase() !== 'h') return;
              event.preventDefault();
              onOpenVersionHistory?.();
            }}
            onPaste={handlePaste}
            onClick={(event) => {
              const editor = editorRef.current;
              const selection = window.getSelection();
              if (!editor || !selection || event.detail < 3) return;
              if (event.detail >= 4) {
                const range = document.createRange();
                range.selectNodeContents(editor);
                selection.removeAllRanges();
                selection.addRange(range);
              } else {
                const currentRange = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
                if (!currentRange) return;
                const start = getEditorTextOffset(editor, currentRange.startContainer, currentRange.startOffset);
                const end = getEditorTextOffset(editor, currentRange.endContainer, currentRange.endOffset);
                if (start === null || end === null) return;

                const editorText = editorHtmlToRichText(editor).text;
                const position = Math.floor((start + end) / 2);
                const lineStart = editorText.lastIndexOf('\n', Math.max(0, position - 1)) + 1;
                const nextLineBreak = editorText.indexOf('\n', position);
                const lineEnd = nextLineBreak === -1 ? editorText.length : nextLineBreak;
                restoreTextSelection(lineStart, lineEnd);
              }
              saveSelection();
              syncToolbarStateFromSelection();
            }}
            onInput={(event) => {
              const inputType = (event.nativeEvent as InputEvent).inputType;
              if (inputType === 'insertParagraph' || inputType === 'insertLineBreak') {
                setHasIndentedLineBreak(true);
              } else {
                pendingTabEnterRef.current = false;
                if (inputType?.startsWith('delete') && editorRef.current) {
                  const value = editorHtmlToRichText(editorRef.current).text;
                  setHasIndentedLineBreak(/[ \t]+\n/.test(value));
                }
              }
              if (!isApplyingFormatRef.current) emitChange();
              scheduleToolbarStateSync();
            }}
            onMouseUp={() => {
              saveOrInitializeEditorSelection();
              syncToolbarStateFromSelection();
            }}
            onKeyUp={() => {
              saveOrInitializeEditorSelection();
              syncToolbarStateFromSelection();
            }}
            onSelect={() => {
              saveSelection();
              scheduleToolbarStateSync();
            }}
            onBlur={() => {
              setEditorFocused(false);
              setLogoState((current) => ({ ...current, glowActive: false, glowFinishing: false }));
              if (editorRef.current?.closest('.workspace-page-rich-text-editor')?.contains(document.activeElement)) return;
              const selection = window.getSelection();
              if (!selection || !editorRef.current?.contains(selection.anchorNode)) {
                clearSelection();
                return;
              }
              saveSelection();
            }}
          />
          <LogoIntroAnimation
            stageMode={stageMode}
            editorFocused={editorFocused}
            hasContent={hasEditorContent}
            editorRef={editorRef}
            state={logoState}
            setState={setLogoState}
          />
          <div className="workspace-page-rich-text-stage-content">
            {stageContent}
          </div>
        </div>
        <div
          className={`workspace-page-rich-text-scrollbar-track${editorScrollbarCanScroll && stageMode === 'editor' ? '' : ' is-hidden'}${editorScrollbarDragging ? ' is-dragging' : ''}`}
          ref={editorScrollbarRef}
          role="scrollbar"
          tabIndex={editorScrollbarCanScroll && stageMode === 'editor' ? 0 : -1}
          aria-label={t('studio.postContent')}
          aria-controls="workspace-page-rich-text-input"
          aria-orientation="vertical"
          aria-hidden={!editorScrollbarCanScroll || stageMode !== 'editor'}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={editorScrollbarCanScroll
            ? Math.round(editorScrollMetrics.scrollTop / (editorScrollMetrics.scrollHeight - editorScrollMetrics.clientHeight) * 100)
            : 0}
          onPointerDown={handleEditorScrollbarPointerDown}
          onPointerMove={handleEditorScrollbarPointerMove}
          onPointerUp={() => { editorScrollDragRef.current = null; setEditorScrollbarDragging(false); }}
          onPointerCancel={() => { editorScrollDragRef.current = null; setEditorScrollbarDragging(false); }}
          onLostPointerCapture={() => { editorScrollDragRef.current = null; setEditorScrollbarDragging(false); }}
          onKeyDown={handleEditorScrollbarKeyDown}
        >
          {editorScrollbarCanScroll && stageMode === 'editor' && (
            <div
              className="workspace-page-rich-text-scrollbar-thumb"
              style={{
                height: `${editorScrollbarThumbHeight}%`,
                top: `${editorScrollbarThumbTop}%`,
              }}
            />
          )}
        </div>
      </div>
      <EditorToolbar
        stageMode={stageMode}
        activeFormats={activeFormats}
        linkPopoverOpen={linkPopoverOpen}
        albumDisabled={albumDisabled}
        linkPopover={stageMode === 'editor' && linkPopoverOpen ? (
          <form
            ref={linkPopoverRef}
            className="workspace-page-rich-text-link-popover"
            role="dialog"
            aria-label={t('studio.insertLink')}
            onSubmit={(event) => {
              event.preventDefault();
              insertLink();
            }}
          >
            <label className="workspace-page-rich-text-link-popover__label" htmlFor="workspace-link-input">
              {t('studio.websiteUrl')}
            </label>
            <input
              id="workspace-link-input"
              type="url"
              value={linkInput}
              onChange={(event) => setLinkInput(event.target.value)}
              placeholder="https://example.com"
              aria-label={t('studio.insertLinkUrl')}
              className="workspace-page-rich-text-link-popover__input"
              autoFocus
            />
            <div className="workspace-page-rich-text-link-popover__actions">
              <button type="button" className="workspace-page-rich-text-link-popover__cancel" onClick={closeLinkPopover}>
                {t('common.cancel')}
              </button>
              <button type="submit" className="workspace-page-rich-text-link-popover__submit" disabled={!linkInput.trim()}>
                {t('studio.confirm')}
              </button>
            </div>
          </form>
        ) : null}
        onFormat={(format) => applyFormat(format)}
        selectedEffectId={selectedEffectId}
        onSelectEffect={onEffectChange}
        onInsertEmoji={insertEmoji}
        onOpenAlbum={onOpenAlbum ? () => onOpenAlbum(getCaretOffset(text.length)) : undefined}
        onToggleLink={toggleLinkPopover}
        onExportText={onExportText ? (format) => onExportText(text, format) : undefined}
        onOpenVersionHistory={onOpenVersionHistory}
      />
    </div>
  );
}