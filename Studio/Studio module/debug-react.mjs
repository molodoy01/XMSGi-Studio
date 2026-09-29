import { JSDOM } from 'jsdom';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { RichTextEditor } from './src/components/RichTextEditor.tsx';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
const { window } = dom;
const { document } = window;
globalThis.window = window;
globalThis.document = document;
globalThis.Node = window.Node;
globalThis.Element = window.Element;

document.body.innerHTML = '';
const container = document.createElement('div');
document.body.appendChild(container);
const root = createRoot(container);
const onChange = () => {};

act(() => {
  root.render(React.createElement(RichTextEditor, { text: '', entities: [], onChange, maxLength: 4096 }));
});
const editor = container.querySelector('[contenteditable="true"]');
const boldButton = container.querySelector('[aria-label="Bold"]');
const setElementSelection = (element) => {
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(range);
  editor.dispatchEvent(new Event('select', { bubbles: true }));
};

act(() => {
  editor.innerHTML = 'обычный <b>жирный текст</b> обычный';
  editor.dispatchEvent(new Event('input', { bubbles: true }));
});
const boldElement = editor.querySelector('b');
console.log('before selection', window.getSelection().toString(), window.getSelection().rangeCount, boldElement?.tagName);
act(() => {
  setElementSelection(boldElement);
});
console.log('after selection', window.getSelection().toString(), window.getSelection().rangeCount, window.getSelection().anchorNode && window.getSelection().anchorNode.nodeName);
console.log('toolbar aria', boldButton.getAttribute('aria-pressed'));
console.log('toolbar class', boldButton.className);
