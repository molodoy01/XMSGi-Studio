import { useEffect, useRef, useState } from 'react';
import type { MutableRefObject, ReactNode } from 'react';
import { Eraser } from 'lucide-react';
import type { RichTextEntity } from '@/types';
import { editorHtmlToRichText, normalizeEditorText, richTextToHtml, sanitizeEditorDom, sliceRichText } from '@/lib/richText';
import { getMessageCounterTone, getRemainingMessageLength } from '@/lib/messageLimits';
import { useLocale } from '@/lib/i18n';
import { EditorToolbar } from '@/components/editor/EditorToolbar';
import { LogoIntroAnimation, type LogoIntroState } from '@/components/editor/LogoIntroAnimation';
import { useEditorFormats } from '@/components/editor/useEditorFormats';
import { useEditorSelection } from '@/components/editor/useEditorSelection';

interface Props {
  text: string;
  entities: RichTextEntity[];
  onChange: (text: string, entities: RichTextEntity[]) => void;
  onAddFiles?: (files: File[], position: number) => void;
  onPasteImages?: (files: File[]) => void;
  inputRef?: MutableRefObject<HTMLDivElement | null>;
  stageContent?: ReactNode;
  stageMode?: 'editor' | 'schedule' | 'template' | 'draft' | 'chat' | 'buttons';
  maxLength: number;
}

type FormatCommand = 'bold' | 'italic' | 'underline' | 'strikeThrough' | 'insertUnorderedList' | 'insertOrderedList' | 'removeFormat';

export function RichTextEditor({ text, entities, onChange, onAddFiles, onPasteImages, inputRef, stageContent, stageMode = 'editor', maxLength }: Props) {
  const { t } = useLocale();
  const editorRef = useRef<HTMLDivElement | null>(null);
  const {
    savedRangeRef,
    getCaretOffset,
    getTextOffset,
    placeCaretAtStart,
    saveSelection,
    restoreSelection,
    clearSelection,
    restoreTextSelection,
    restoreSelectionRange,
  } = useEditorSelection(editorRef);
  const { syncToolbarStateFromSelection } = useEditorFormats(editorRef, stageMode);
  const linkInputRef = useRef<HTMLInputElement | null>(null);
  const [toolbarActive, setToolbarActive] = useState(false);
  const [linkInput, setLinkInput] = useState('');
  const [linkPopoverOpen, setLinkPopoverOpen] = useState(false);
  const [editorFocused, setEditorFocused] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [logoState, setLogoState] = useState<LogoIntroState>({
    hasPlayed: false,
    flying: false,
    glowActive: false,
    glowFinishing: false,
    introReady: false,
  });
  const runExecCommand = typeof document.execCommand === 'function'
    ? document.execCommand.bind(document)
    : () => undefined;

  const getInlineTagNames = (tagName: 'b' | 'i' | 'u' | 's') => {
    switch (tagName) {
      case 'b': return ['b', 'strong'];
      case 'i': return ['i', 'em'];
      case 'u': return ['u'];
      case 's': return ['s', 'strike', 'del'];
      default: return [tagName];
    }
  };

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || document.activeElement === editor) return;
    const nextHtml = richTextToHtml(text, entities);
    if (editor.innerHTML !== nextHtml) editor.innerHTML = nextHtml;
  }, [text, entities]);

  const emitChange = () => {
    if (!editorRef.current) return;
    const editor = editorRef.current;
    sanitizeEditorDom(editor);
    const selection = window.getSelection();
    const selectionRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    const selectionOffsets = selectionRange
      && (selectionRange.startContainer === editor || editor.contains(selectionRange.startContainer))
      && (selectionRange.endContainer === editor || editor.contains(selectionRange.endContainer))
      ? {
          start: getTextOffset(selectionRange.startContainer, selectionRange.startOffset),
          end: getTextOffset(selectionRange.endContainer, selectionRange.endOffset),
        }
      : null;

    const value = editorHtmlToRichText(editor);
    const limited = value.text.length > maxLength
      ? sliceRichText(value.text, value.entities, 0, maxLength)
      : value;

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
          const safeOffset = Math.max(0, Math.min(sourceOffset, value.sourceOffsetMap.length - 1));
          return Math.min(value.sourceOffsetMap[safeOffset] ?? limited.text.length, limited.text.length);
        };
        restoreTextSelection(
          mapOffset(selectionOffsets?.start ?? null),
          mapOffset(selectionOffsets?.end ?? null),
        );
      }
    }
    onChange(limited.text, limited.entities);
  };

  const handleBeforeInput = (event: React.FormEvent<HTMLDivElement>) => {
    if (!editorRef.current || !event.nativeEvent) return;

    const inputEvent = event.nativeEvent as Partial<InputEvent> | undefined;
    const inputType = typeof inputEvent?.inputType === 'string' ? inputEvent.inputType : '';

    if (inputType && !inputType.startsWith('insert')) return;
    if (!inputType) return;

    const selection = window.getSelection();
    const selectedLength = selection?.toString().length ?? 0;
    const currentLength = editorHtmlToRichText(editorRef.current).text.length;
    if (currentLength - selectedLength >= maxLength) event.preventDefault();
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

  const clearEditorText = () => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.innerHTML = '';
    clearSelection();
    onChange('', []);
    editor.focus();
    setEditorFocused(true);
    placeCaretAtStart();
  };

  const unwrapElement = (element: Element) => {
    const parent = element.parentNode;
    if (!parent) return false;

    const fragment = document.createDocumentFragment();
    while (element.firstChild) {
      fragment.appendChild(element.firstChild);
    }

    parent.insertBefore(fragment, element);
    parent.removeChild(element);
    return true;
  };

  const findNearestTag = (node: Node | null, tagName: string): Element | null => {
    let current: Node | null = node;
    while (current) {
      if (current.nodeType === Node.ELEMENT_NODE) {
        const element = current as Element;
        if (element.tagName.toLowerCase() === tagName) return element;
      }
      current = current.parentNode;
    }
    return null;
  };

  const findNearestMatchingTag = (node: Node | null, tagNames: string[]): Element | null => {
    let current: Node | null = node;
    while (current) {
      if (current.nodeType === Node.ELEMENT_NODE) {
        const element = current as Element;
        if (tagNames.includes(element.tagName.toLowerCase())) return element;
      }
      current = current.parentNode;
    }
    return null;
  };

  const isRangeInsideTag = (tagNames: string[], range: Range) => {
    const startTag = findNearestMatchingTag(range.startContainer, tagNames);
    const endTag = findNearestMatchingTag(range.endContainer, tagNames);
    if (startTag && endTag && startTag === endTag) return true;

    const commonAncestor = range.commonAncestorContainer;
    const commonTag = findNearestMatchingTag(commonAncestor, tagNames);
    if (!commonTag) return false;

    const root = commonTag;
    const startsInside = root.contains(range.startContainer);
    const endsInside = root.contains(range.endContainer);
    return startsInside && endsInside;
  };

  const wrapSelectionInTag = (tagName: 'b' | 'i' | 'u' | 's') => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !editorRef.current) return false;

    const range = selection.getRangeAt(0);
    const tagNames = getInlineTagNames(tagName);

    if (range.collapsed) return false;
    if (isRangeInsideTag(tagNames, range)) {
      const wrapper = findNearestMatchingTag(range.startContainer, tagNames)
        ?? findNearestMatchingTag(range.commonAncestorContainer, tagNames);
      if (wrapper) {
        unwrapElement(wrapper);
      }
      return true;
    }

    const wrapper = document.createElement(tagName);
    const fragment = range.extractContents();
    wrapper.appendChild(fragment);
    range.insertNode(wrapper);

    const rebuiltRange = document.createRange();
    rebuiltRange.selectNodeContents(wrapper);
    selection.removeAllRanges();
    selection.addRange(rebuiltRange);
    return true;
  };

  const toggleCollapsedSelectionFormat = (tagName: 'b' | 'i' | 'u' | 's') => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !editorRef.current) return false;

    const anchorNode = selection.anchorNode;
    const parentElement = anchorNode && anchorNode.nodeType === Node.ELEMENT_NODE
      ? anchorNode as Element
      : anchorNode?.parentElement;
    const tagNames = getInlineTagNames(tagName);
    const existingTag = parentElement?.closest(tagNames.join(','));

    if (existingTag) {
      unwrapElement(existingTag);
      return true;
    }

    const wrapper = document.createElement(tagName);
    const marker = document.createTextNode('\u200B');
    wrapper.appendChild(marker);
    const range = selection.getRangeAt(0);
    range.insertNode(wrapper);

    const caretRange = document.createRange();
    caretRange.setStart(marker, 0);
    caretRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(caretRange);
    return true;
  };

  const removeInlineFormattingFromSelection = () => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !editorRef.current) return false;

    const range = selection.getRangeAt(0);
    const root = editorRef.current;
    const tags = ['b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del'];
    const elements = Array.from(root.querySelectorAll(tags.join(',')));

    if (!range.collapsed) {
      const fragment = range.cloneContents();
      const formatNodes = Array.from(fragment.querySelectorAll(tags.join(',')));
      formatNodes.forEach((node) => {
        const parent = node.parentNode;
        if (!parent) return;
        while (node.firstChild) parent.insertBefore(node.firstChild, node);
        parent.removeChild(node);
      });
      if (formatNodes.length > 0) {
        const replacement = document.createDocumentFragment();
        replacement.appendChild(fragment);
        range.deleteContents();
        range.insertNode(replacement);
        return true;
      }
    }

    const ancestorNode = range.commonAncestorContainer;
    const target = ancestorNode.nodeType === Node.ELEMENT_NODE
      ? ancestorNode as Element
      : ancestorNode.parentElement;
    const closest = target?.closest(tags.join(','));
    if (closest) {
      unwrapElement(closest);
      return true;
    }

    const selectedText = range.toString();
    if (!selectedText) {
      for (const element of elements) {
        if (element.contains(range.startContainer) || element.contains(range.endContainer)) {
          unwrapElement(element);
          return true;
        }
      }
    }

    return false;
  };

  const runCommand = (command: FormatCommand) => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    const preservedRange = selection && selection.rangeCount > 0
      ? selection.getRangeAt(0).cloneRange()
      : savedRangeRef.current?.cloneRange() ?? null;

    if (editor && !editor.contains(document.activeElement)) {
      editor.focus();
    }

    const inlineMap = {
      bold: 'b',
      italic: 'i',
      underline: 'u',
      strikeThrough: 's',
    } as const;

    if (command === 'removeFormat') {
      removeInlineFormattingFromSelection();
      if (typeof document.execCommand === 'function') {
        runExecCommand(command);
      }
      restoreSelectionRange(preservedRange);
      emitChange();
      requestAnimationFrame(() => {
        if (editor) editor.focus();
        syncToolbarStateFromSelection();
      });
      return;
    }

    if (command in inlineMap) {
      const tagName = inlineMap[command as keyof typeof inlineMap];
      const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
      if (range && range.collapsed) {
        toggleCollapsedSelectionFormat(tagName);
      } else {
        const tagNames = getInlineTagNames(tagName);
        if (range && range.collapsed === false && isRangeInsideTag(tagNames, range)) {
          const wrapper = findNearestMatchingTag(range.startContainer, tagNames)
            ?? findNearestMatchingTag(range.commonAncestorContainer, tagNames);
          if (wrapper) unwrapElement(wrapper);
        } else {
          wrapSelectionInTag(tagName);
        }
      }

      if (typeof document.execCommand === 'function') {
        runExecCommand(command);
      }

      restoreSelectionRange(preservedRange);
      emitChange();
      requestAnimationFrame(() => {
        if (editor) editor.focus();
        syncToolbarStateFromSelection();
      });
      return;
    }

    restoreSelection();
    if (typeof document.execCommand === 'function') {
      runExecCommand(command);
    }

    if (editor && preservedRange) {
      const nextSelection = window.getSelection();
      if (nextSelection) {
        try {
          const restoredRange = preservedRange.cloneRange();
          if (editor.contains(restoredRange.startContainer) && editor.contains(restoredRange.endContainer)) {
            nextSelection.removeAllRanges();
            nextSelection.addRange(restoredRange);
          }
        } catch {
          // keep the actual browser selection state and resync from the DOM below
        }
      }
    }

    emitChange();
    requestAnimationFrame(() => {
      if (editor) editor.focus();
      syncToolbarStateFromSelection();
    });
  };

  const insertLink = () => {
    const url = linkInput.trim();
    restoreSelection();
    const selection = window.getSelection();
    const editor = editorRef.current;
    if (!url || !selection || !editor || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';

    if (range.collapsed) {
      const text = document.createTextNode(url);
      link.appendChild(text);
      range.insertNode(link);
      const newRange = document.createRange();
      newRange.selectNodeContents(link);
      selection.removeAllRanges();
      selection.addRange(newRange);
    } else {
      const fragment = range.extractContents();
      link.appendChild(fragment);
      range.insertNode(link);
      const newRange = document.createRange();
      newRange.selectNodeContents(link);
      selection.removeAllRanges();
      selection.addRange(newRange);
    }

    setLinkInput('');
    setLinkPopoverOpen(false);
    emitChange();
    requestAnimationFrame(() => {
      syncToolbarStateFromSelection();
      editor.focus();
    });
  };

  const remainingCharacters = getRemainingMessageLength(text.length, maxLength);
  const counterTone = getMessageCounterTone(remainingCharacters);
  useEffect(() => {
    const updateHighlightFromPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return;
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
          spellCheck
          aria-hidden={stageMode !== 'editor'}
          onFocus={() => {
            setToolbarActive(true);
            setEditorFocused(true);
            if (!text.trim()) placeCaretAtStart();
          }}
          onBeforeInput={handleBeforeInput}
          onPaste={handlePaste}
          onInput={() => {
            emitChange();
            syncToolbarStateFromSelection();
          }}
          onMouseUp={() => {
            if (text.trim()) saveSelection();
            else placeCaretAtStart();
            syncToolbarStateFromSelection();
          }}
          onKeyUp={() => {
            if (text.trim()) saveSelection();
            else placeCaretAtStart();
            syncToolbarStateFromSelection();
          }}
          onSelect={() => {
            saveSelection();
            syncToolbarStateFromSelection();
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
        {stageMode === 'editor' && Boolean(text.trim()) && (
          <button
            type="button"
            className="workspace-page-rich-text-clear"
            onMouseDown={(event) => event.preventDefault()}
            onClick={clearEditorText}
            aria-label={t('studio.clearEditorText')}
            title={t('studio.clearText')}
          >
            <Eraser size={16} strokeWidth={1.8} aria-hidden="true" />
          </button>
        )}
        <div className="workspace-page-rich-text-stage-content">
          {stageContent}
        </div>
        {linkPopoverOpen && (
          <form
            className="workspace-page-rich-text-link-popover"
            role="dialog"
            aria-label={t('studio.insertLink')}
            onSubmit={(event) => {
              event.preventDefault();
              insertLink();
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setLinkInput('');
                setLinkPopoverOpen(false);
              }
            }}
          >
            <label className="workspace-page-rich-text-link-popover__label" htmlFor="workspace-link-input">
              {t('studio.websiteUrl')}
            </label>
            <input
              ref={linkInputRef}
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
              <button
                type="button"
                className="workspace-page-rich-text-link-popover__cancel"
                onClick={() => {
                  setLinkInput('');
                  setLinkPopoverOpen(false);
                }}
              >
                {t('common.cancel')}
              </button>
              <button
                type="submit"
                className="workspace-page-rich-text-link-popover__submit"
                disabled={!linkInput.trim()}
              >
                {t('studio.confirm')}
              </button>
            </div>
          </form>
        )}
      </div>
      <EditorToolbar
        stageMode={stageMode}
        remainingCharacters={remainingCharacters}
        counterClassName={`workspace-page-character-count ${counterTone === 'critical' ? 'is-critical' : counterTone === 'warning' ? 'is-warning' : ''}`}
        linkPopoverOpen={linkPopoverOpen}
        onToggleLink={() => {
          setLinkPopoverOpen((open) => !open);
          if (!linkPopoverOpen) {
            requestAnimationFrame(() => {
              linkInputRef.current?.focus();
            });
          }
        }}
      />
    </div>
  );
}