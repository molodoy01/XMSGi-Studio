import { useEffect, useRef, useState } from 'react';
import type { MutableRefObject, ReactNode } from 'react';
import { Eraser } from 'lucide-react';
import type { RichTextEntity } from '@studio/types';
import { editorHtmlToRichText, normalizeEditorText, richTextToHtml, sliceRichText } from '@studio/lib/richText';
import { getMessageCounterTone, getRemainingMessageLength } from '@studio/lib/messageLimits';
import { useLocale } from '@studio/lib/i18n';
import { EditorToolbar } from '@studio/components/editor/EditorToolbar';
import type { EditorToolbarFormat } from '@studio/components/editor/EditorToolbar';
import { LogoIntroAnimation, type LogoIntroState } from '@studio/components/editor/LogoIntroAnimation';
import { useEditorFormats } from '@studio/components/editor/useEditorFormats';
import { useEditorSelection } from '@studio/components/editor/useEditorSelection';

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

function getNormalizedEditorTextLength(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) return normalizeEditorText(node.textContent ?? '').length;
  if (node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName === 'BR') return 1;
  return Array.from(node.childNodes).reduce((length, child) => length + getNormalizedEditorTextLength(child), 0);
}

function getNormalizedEditorTextOffset(root: HTMLElement, targetNode: Node, targetOffset: number): number | null {
  let offset = 0;

  const visit = (node: Node): boolean => {
    if (node === targetNode) {
      if (node.nodeType === Node.TEXT_NODE) {
        offset += normalizeEditorText((node.textContent ?? '').slice(0, targetOffset)).length;
      } else {
        const childLimit = Math.max(0, Math.min(targetOffset, node.childNodes.length));
        for (let childIndex = 0; childIndex < childLimit; childIndex += 1) {
          offset += getNormalizedEditorTextLength(node.childNodes[childIndex]);
        }
      }
      return true;
    }

    if (node.nodeType === Node.TEXT_NODE) {
      offset += normalizeEditorText(node.textContent ?? '').length;
      return false;
    }
    if (node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName === 'BR') {
      offset += 1;
      return false;
    }

    for (const child of Array.from(node.childNodes)) {
      if (visit(child)) return true;
    }
    return false;
  };

  return visit(root) ? offset : null;
}

export function RichTextEditor({ text, entities, onChange, onAddFiles, onPasteImages, inputRef, stageContent, stageMode = 'editor', maxLength, onOpenAlbum, albumDisabled, onExportText, onBeforeClear, onOpenVersionHistory, selectedEffectId, onEffectChange }: Props) {
  const { t } = useLocale();
  const editorRef = useRef<HTMLDivElement | null>(null);
  const logicalTextLengthRef = useRef(text.length);
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
    const editor = editorRef.current;
    if (!editor || document.activeElement === editor) return;
    const nextHtml = richTextToHtml(text, entities);
    if (editor.innerHTML !== nextHtml) editor.innerHTML = nextHtml;
  }, [text, entities]);

  const emitChange = () => {
    if (!editorRef.current) return;
    const editor = editorRef.current;
    const selection = window.getSelection();
    const selectionRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    const selectionOffsets = selectionRange
      && (selectionRange.startContainer === editor || editor.contains(selectionRange.startContainer))
      && (selectionRange.endContainer === editor || editor.contains(selectionRange.endContainer))
      ? {
          start: getNormalizedEditorTextOffset(editor, selectionRange.startContainer, selectionRange.startOffset),
          end: getNormalizedEditorTextOffset(editor, selectionRange.endContainer, selectionRange.endOffset),
        }
      : null;
    const value = editorHtmlToRichText(editor);
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
    } else if (selectionOffsets?.start !== null && selectionOffsets?.start !== undefined
      && selectionOffsets?.end !== null && selectionOffsets?.end !== undefined) {
      restoreTextSelection(selectionOffsets.start, selectionOffsets.end);
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
    logicalTextLengthRef.current = 0;
    clearSelection();
    onChange('', []);
    editor.focus();
    setEditorFocused(true);
    placeCaretAtStart();
  };

  const remainingCharacters = getRemainingMessageLength(text.length, maxLength);
  const counterTone = getMessageCounterTone(remainingCharacters);
  const hasEditorText = Boolean(text.trim());
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
        </div>
      )}
      <div className="workspace-page-rich-text-stage">
        <div
          ref={(element) => {
            editorRef.current = element;
            if (inputRef) inputRef.current = element;
          }}
          className={`workspace-page-textarea workspace-page-rich-text-input workspace-page-rich-text-stage-view ${stageMode === 'editor' ? 'is-active' : ''} ${text.trim() ? 'has-content' : 'is-empty'} ${isLogoIntroActive ? 'is-logo-intro' : ''} ${logoState.glowFinishing ? 'is-logo-intro-finishing' : ''}`}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-label={t('studio.postContent')}
          data-placeholder={t('studio.postPlaceholder')}
          spellCheck={false}
          aria-hidden={stageMode !== 'editor'}
          onFocus={() => {
            if (!suppressToolbarActivationRef.current) setToolbarActive(true);
            setEditorFocused(true);
            if (!text.trim()) placeCaretAtStart();
          }}
          onBeforeInput={handleBeforeInput}
          onKeyDown={(event) => {
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
              const start = getNormalizedEditorTextOffset(editor, currentRange.startContainer, currentRange.startOffset);
              const end = getNormalizedEditorTextOffset(editor, currentRange.endContainer, currentRange.endOffset);
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
          onInput={() => {
            if (!isApplyingFormatRef.current) emitChange();
            scheduleToolbarStateSync();
          }}
          onMouseUp={() => {
            if (editorRef.current?.textContent) saveSelection();
            else placeCaretAtStart();
            syncToolbarStateFromSelection();
          }}
          onKeyUp={() => {
            if (editorRef.current?.textContent) saveSelection();
            else placeCaretAtStart();
            syncToolbarStateFromSelection();
          }}
          onSelect={() => {
            saveSelection();
            scheduleToolbarStateSync();
          }}
          onBlur={() => {
            setEditorFocused(false);
            setLogoState((current) => ({ ...current, glowActive: false, glowFinishing: false }));
            if (editorRef.current?.parentElement?.contains(document.activeElement)) return;
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
          hasContent={Boolean(text.trim())}
          editorRef={editorRef}
          state={logoState}
          setState={setLogoState}
        />
        <div className="workspace-page-rich-text-stage-content">
          {stageContent}
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