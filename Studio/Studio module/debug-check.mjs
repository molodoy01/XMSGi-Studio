import { JSDOM } from 'jsdom';

const dom = new JSDOM('<div contenteditable="true">обычный <b>жирный текст</b> обычный</div>');
const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
globalThis.Node = window.Node;
const editor = document.querySelector('[contenteditable="true"]');
const bold = editor.querySelector('b');
const selection = window.getSelection();
const range = document.createRange();
range.selectNodeContents(bold);
selection.removeAllRanges();
selection.addRange(range);

const isInsideFormat = (selector) => {
  const candidates = new Set([
    range.commonAncestorContainer,
    range.startContainer,
    range.endContainer,
    selection.anchorNode,
    selection.focusNode,
  ]);
  if (range.collapsed) {
    const anchorNode = selection.anchorNode;
    if (anchorNode?.nodeType === Node.ELEMENT_NODE) {
      const element = anchorNode;
      const anchorOffset = Math.max(0, Math.min(selection.anchorOffset, element.childNodes.length));
      const prevNode = element.childNodes[anchorOffset - 1] ?? null;
      const nextNode = element.childNodes[anchorOffset] ?? null;
      candidates.add(prevNode);
      candidates.add(nextNode);
    } else if (anchorNode?.parentElement) {
      candidates.add(anchorNode.parentElement);
    }
  }
  for (const candidate of candidates) {
    if (!candidate) continue;
    let current = candidate;
    while (current) {
      if (current.nodeType === Node.ELEMENT_NODE) {
        const element = current;
        if (element.matches(selector)) {
          console.log('MATCH', selector, 'path', (() => { const path=[]; let x = element; while (x) { path.push(x.nodeName); if (x === editor) break; x = x.parentNode; } return path.reverse().join(' > '); })());
          return true;
        }
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
console.log({ collapsed: range.collapsed, start: range.startContainer.nodeName, end: range.endContainer.nodeName, common: range.commonAncestorContainer.nodeName, anchor: selection.anchorNode?.nodeName, focus: selection.focusNode?.nodeName, text: selection.toString() });
console.log('bold?', isInsideFormat('b,strong'));
console.log('italic?', isInsideFormat('i,em'));
