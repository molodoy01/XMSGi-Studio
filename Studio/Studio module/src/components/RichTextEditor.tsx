import { useEffect, useRef, useState } from 'react';
import type { MutableRefObject, ReactNode } from 'react';
import { Eraser } from 'lucide-react';
import editorLogo from '@/assets/logo.png';
import type { RichTextEntity } from '@/types';
import { editorHtmlToRichText, normalizeEditorText, richTextToHtml, sanitizeEditorDom, sliceRichText } from '@/lib/richText';
import { getMessageCounterTone, getRemainingMessageLength } from '@/lib/messageLimits';

interface Props {
  text: string;
  entities: RichTextEntity[];
  onChange: (text: string, entities: RichTextEntity[]) => void;
  onPasteImages?: (files: File[]) => void;
  inputRef?: MutableRefObject<HTMLDivElement | null>;
  stageContent?: ReactNode;
  stageMode?: 'editor' | 'schedule' | 'template' | 'draft' | 'chat' | 'buttons';
  maxLength: number;
}

type FormatCommand = 'bold' | 'italic' | 'underline' | 'strikeThrough' | 'insertUnorderedList' | 'insertOrderedList' | 'removeFormat';

export function RichTextEditor({ text, entities, onChange, onPasteImages, inputRef, stageContent, stageMode = 'editor', maxLength }: Props) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const savedRangeRef = useRef<Range | null>(null);
  const linkInputRef = useRef<HTMLInputElement | null>(null);
  const logoImageRef = useRef<HTMLImageElement | null>(null);
  const logoHasPlayedRef = useRef(false);
  const logoAnimationTimerRef = useRef<number | null>(null);
  const [toolbarActive, setToolbarActive] = useState(false);
  const [linkInput, setLinkInput] = useState('');
  const [linkPopoverOpen, setLinkPopoverOpen] = useState(false);
  const [editorFocused, setEditorFocused] = useState(false);
  const [logoFlying, setLogoFlying] = useState(false);
  const [logoGlowActive, setLogoGlowActive] = useState(false);
  const [logoGlowFinishing, setLogoGlowFinishing] = useState(false);
  const [logoIntroReady, setLogoIntroReady] = useState(false);
  const [activeFormats, setActiveFormats] = useState({
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    unorderedList: false,
    orderedList: false,
  });

  const runExecCommand = typeof document.execCommand === 'function'
    ? document.execCommand.bind(document)
    : () => undefined;

  const getSelectionFormatState = () => {
    const next = {
      bold: false,
      italic: false,
      underline: false,
      strike: false,
      unorderedList: false,
      orderedList: false,
    };

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !editorRef.current) return next;

    const editor = editorRef.current;
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

  useEffect(() => {
    if (stageMode !== 'editor') {
      setLogoFlying(false);
      setLogoGlowActive(false);
      setLogoGlowFinishing(false);
      setLogoIntroReady(false);
      logoHasPlayedRef.current = false;
    }
  }, [stageMode]);

  useEffect(() => () => {
    if (logoAnimationTimerRef.current !== null) window.clearTimeout(logoAnimationTimerRef.current);
  }, []);

  useEffect(() => {
    if (stageMode !== 'editor') return;

    const editor = editorRef.current;
    if (!editor) return;

    const handleNativeSelect = () => {
      syncToolbarStateFromSelection();
    };
    const handleSelectionChange = () => {
      syncToolbarStateFromSelection();
    };

    editor.addEventListener('select', handleNativeSelect);
    document.addEventListener('selectionchange', handleSelectionChange);
    return () => {
      editor.removeEventListener('select', handleNativeSelect);
      document.removeEventListener('selectionchange', handleSelectionChange);
    };
  }, [stageMode]);

  useEffect(() => {
    if (stageMode !== 'editor' || !editorFocused || text.trim() || logoHasPlayedRef.current) return;
    const image = logoImageRef.current;
    if (!image) return;

    logoHasPlayedRef.current = true;
    setLogoIntroReady(true);
    setLogoFlying(true);
    setLogoGlowActive(true);

    const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const duration = prefersReducedMotion ? 1 : 4950;
    const editorBounds = editorRef.current?.getBoundingClientRect();
    const logoBounds = image.getBoundingClientRect();
    const targetSize = editorBounds ? Math.min(editorBounds.width, editorBounds.height) * 0.8 : 0;
    const logoBaseSize = Math.max(logoBounds.width, logoBounds.height);
    const targetScale = targetSize > 0 && logoBounds.width > 0
      ? Math.max(1, Math.min(targetSize / logoBaseSize, 5))
      : 2.6;
    const fullSurfaceScale = editorBounds && logoBounds.width > 0 && logoBounds.height > 0
      ? Math.min(Math.max(editorBounds.width / logoBounds.width, editorBounds.height / logoBounds.height) * 1.08, 10)
      : Math.max(targetScale * 2.5, 6);

    const finishLogoIntro = () => {
      setLogoFlying(false);
      setLogoIntroReady(false);
      if (logoAnimationTimerRef.current !== null) {
        window.clearTimeout(logoAnimationTimerRef.current);
      }
      setLogoGlowFinishing(true);
      logoAnimationTimerRef.current = window.setTimeout(() => {
        setLogoGlowActive(false);
        setLogoGlowFinishing(false);
        logoAnimationTimerRef.current = null;
      }, 180);
    };

    const fallbackAnimation = () => {
      image.classList.add('is-fallback-animating');
      window.setTimeout(() => {
        image.classList.remove('is-fallback-animating');
      }, duration + 100);
    };

    const animation = typeof image.animate === 'function'
      ? image.animate([
          { opacity: 0, transform: 'perspective(700px) translateZ(-320px) scale(0.24) rotateY(27deg)' },
          { opacity: 0.42, transform: 'perspective(700px) translateZ(-150px) scale(0.62) rotateY(27deg)', offset: 0.1439709, easing: 'cubic-bezier(0.32, 0.35, 0.4, 1)' },
          { opacity: 1, transform: `perspective(700px) translateZ(0) scale(${targetScale}) rotateY(27deg)`, offset: 0.4457218 },
          { opacity: 1, transform: `perspective(700px) translateZ(0) scale(${targetScale}) rotateY(27deg)`, offset: 0.8699642, easing: 'cubic-bezier(0.6, 0, 0.68, 0.65)' },
          { opacity: 0.78, transform: `perspective(700px) translateZ(120px) scale(${fullSurfaceScale}) rotateY(27deg)`, offset: 0.9208352, easing: 'linear' },
          { opacity: 0.32, transform: `perspective(700px) translateZ(190px) scale(${fullSurfaceScale * 1.35}) rotateY(27deg)`, offset: 0.9591442, easing: 'linear' },
          { opacity: 0, transform: `perspective(700px) translateZ(260px) scale(${fullSurfaceScale * 1.75}) rotateY(27deg)` },
        ], {
          duration,
          easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
          fill: 'forwards',
        })
      : null;

    if (animation) {
      animation.onfinish = finishLogoIntro;
    } else {
      fallbackAnimation();
      finishLogoIntro();
    }

    logoAnimationTimerRef.current = window.setTimeout(() => {
      logoAnimationTimerRef.current = null;
      if (!animation) {
        finishLogoIntro();
      } else {
        finishLogoIntro();
      }
    }, duration + 80);
  }, [editorFocused, stageMode, text]);

  const emitChange = () => {
    if (!editorRef.current) return;
    sanitizeEditorDom(editorRef.current);
    const value = editorHtmlToRichText(editorRef.current);
    const limited = value.text.length > maxLength
      ? sliceRichText(value.text, value.entities, 0, maxLength)
      : value;

    if (limited !== value) {
      editorRef.current.innerHTML = richTextToHtml(limited.text, limited.entities);
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editorRef.current);
      range.collapse(false);
      selection?.removeAllRanges();
      selection?.addRange(range);
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

    const clipboardFiles = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);
    const pastedImages = clipboardFiles.map((file) => {
      if (file.name) return file;
      const extension = file.type.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
      return new File([file], `pasted-image-${Date.now()}.${extension}`, {
        type: file.type,
        lastModified: file.lastModified,
      });
    });

    if (pastedImages.length > 0) onPasteImages?.(pastedImages);

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

  const restoreSelectionRange = (range: Range | null) => {
    const selection = window.getSelection();
    if (!selection || !range || !editorRef.current) return;

    try {
      const startContainer = range.startContainer;
      const endContainer = range.endContainer;
      const isInsideEditor = editorRef.current.contains(startContainer) || editorRef.current.contains(endContainer);
      if (!isInsideEditor) return;
      selection.removeAllRanges();
      selection.addRange(range.cloneRange());
    } catch {
      // keep the real browser selection state if the DOM structure changed during formatting
    }
  };

  const syncToolbarStateFromSelection = () => {
    setActiveFormats(getSelectionFormatState());
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
    && ((!text.trim() && (!logoHasPlayedRef.current || logoIntroReady)) || logoGlowActive || logoFlying || logoGlowFinishing);
  const shouldRenderIntroLogo = stageMode === 'editor'
    && editorFocused
    && (logoFlying || (!text.trim() && (!logoHasPlayedRef.current || logoIntroReady)));
  return (
    <div
      className={`workspace-page-rich-text-editor ${toolbarActive ? 'is-toolbar-active' : ''}`}
    >
      <div className="workspace-page-rich-text-stage">
        <div
          ref={(element) => {
            editorRef.current = element;
            if (inputRef) inputRef.current = element;
          }}
          className={`workspace-page-textarea workspace-page-rich-text-input workspace-page-rich-text-stage-view ${stageMode === 'editor' ? 'is-active' : ''} ${text.trim() ? 'has-content' : 'is-empty'} ${isLogoIntroActive ? 'is-logo-intro' : ''} ${logoGlowFinishing ? 'is-logo-intro-finishing' : ''}`}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-label="Post content"
          data-placeholder="Start writing your post..."
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
            setLogoGlowActive(false);
            setLogoGlowFinishing(false);
            if (editorRef.current?.parentElement?.contains(document.activeElement)) return;
            const selection = window.getSelection();
            if (!selection || !editorRef.current?.contains(selection.anchorNode)) {
              clearSelection();
              return;
            }
            saveSelection();
          }}
        />
        {shouldRenderIntroLogo && (
          <div
            className={`workspace-page-rich-text-empty-logo ${logoFlying ? 'is-flying' : ''}`}
            aria-hidden="true"
          >
            <img ref={logoImageRef} src={editorLogo} alt="" className={logoIntroReady ? 'is-animating' : ''} />
          </div>
        )}
        {stageMode === 'editor' && Boolean(text.trim()) && (
          <button
            type="button"
            className="workspace-page-rich-text-clear"
            onMouseDown={(event) => event.preventDefault()}
            onClick={clearEditorText}
            aria-label="Clear editor text"
            title="Clear text"
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
            aria-label="Insert link"
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
              Website URL
            </label>
            <input
              ref={linkInputRef}
              id="workspace-link-input"
              type="url"
              value={linkInput}
              onChange={(event) => setLinkInput(event.target.value)}
              placeholder="https://example.com"
              aria-label="Insert link URL"
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
                Cancel
              </button>
              <button
                type="submit"
                className="workspace-page-rich-text-link-popover__submit"
                disabled={!linkInput.trim()}
              >
                Confirm
              </button>
            </div>
          </form>
        )}
      </div>
      <div
        className="workspace-page-rich-text-toolbar"
        aria-label="Link tools"
        aria-hidden={stageMode !== 'editor'}
      >
          <span
            className={`workspace-page-character-count ${counterTone === 'critical' ? 'is-critical' : counterTone === 'warning' ? 'is-warning' : ''}`}
            aria-live="polite"
          >
            {remainingCharacters}
          </span>
          <div className="workspace-page-rich-text-toolbar-actions">
            <span className="workspace-page-rich-text-photo-slot" aria-hidden="true" />
            <button
              type="button"
              className={`workspace-page-rich-text-link-trigger ${linkPopoverOpen ? 'is-open' : ''}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setLinkPopoverOpen((open) => !open);
                if (!linkPopoverOpen) {
                  requestAnimationFrame(() => {
                    linkInputRef.current?.focus();
                  });
                }
              }}
              aria-label="Insert link"
              aria-expanded={linkPopoverOpen}
              title="Insert link"
            >
              <span className="workspace-page-rich-text-link-trigger__icon" aria-hidden="true">↗</span>
            </button>
          </div>
      </div>
    </div>
  );
}