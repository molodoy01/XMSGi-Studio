import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { ChatAvatar } from './ChatAvatar';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('ChatAvatar', () => {
  it('replaces a failed image with the chat initial', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    try {
      act(() => root.render(<ChatAvatar name="News channel" src="broken-avatar.png" className="avatar" />));
      const image = container.querySelector('img');
      expect(image).not.toBeNull();

      act(() => image?.dispatchEvent(new Event('error')));

      expect(container.querySelector('img')).toBeNull();
      expect(container.querySelector('.avatar')?.textContent).toBe('N');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});