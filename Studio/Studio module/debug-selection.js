const { JSDOM } = require('jsdom');
const dom = new JSDOM('<div contenteditable="true">обычный <b>жирный текст</b> обычный</div>');
const { window } = dom;
const document = window.document;
const Node = window.Node;
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
    if (anchorNode && anchorNode.nodeType === Node.ELEMENT_NODE) {
      const element = anchorNode;
      const anchorOffset = Math.max(0, Math.min(selection.anchorOffset, element.childNodes.length));
      const prevNode = element.childNodes[anchorOffset - 1] ?? null;
      const nextNode = element.childNodes[anchorOffset] ?? null;
      candidates.add(prevNode);
      candidates.add(nextNode);
    } else if (anchorNode && anchorNode.parentElement) {
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
          console.log('MATCH selector', selector, 'on element', element.tagName, 'path', getPath(element));
          return true;
        }
        if (current === editor) break;
      }
      current = current.parentNode;
    }
  }

  if (!range.collapsed) {
    const fragment = range.cloneContents();
    console.log('fragment html', fragment.firstChild && fragment.firstChild.outerHTML, 'query', fragment.querySelector(selector));
    if (fragment.querySelector(selector)) return true;
  }

  return false;
};
function getPath(node) {
  const parts = [];
  let current = node;
  while (current) {
    parts.push(current.nodeName);
    if (current === editor) break;
    current = current.parentNode;
  }
  return parts.reverse().join(' > ');
}
console.log('selection info', { collapsed: range.collapsed, start: range.startContainer.nodeName, end: range.endContainer.nodeName, common: range.commonAncestorContainer.nodeName, anchorNode: selection.anchorNode && selection.anchorNode.nodeName, focusNode: selection.focusNode && selection.focusNode.nodeName });
console.log('bold matched?', isInsideFormat('b,strong'));
