import type { PropsWithChildren } from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '@/lib/i18n';
import { useAssistant } from './useAssistant';

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useAssistant async response lifecycle', () => {
  it('does not apply an intent after the prompt changes while generation is pending', async () => {
    const response = createDeferred<Awaited<ReturnType<Window['gemini']['generate']>>>();
    const generate = vi.fn(() => response.promise);
    vi.stubGlobal('gemini', {
      generate,
      getSettings: vi.fn().mockResolvedValue({
        hasKey: true,
        maskedKey: '••••1234',
        enabled: true,
        encryptionAvailable: true,
      }),
    });
    const wrapper = ({ children }: PropsWithChildren) => <LocaleProvider>{children}</LocaleProvider>;
    const { result } = renderHook(() => useAssistant({ chats: [] }), { wrapper });

    act(() => result.current.setAssistantPrompt('Schedule the old request'));
    let submission!: Promise<void>;
    await act(async () => {
      submission = result.current.handleAssistantSubmit({ preventDefault: vi.fn() } as unknown as React.FormEvent<HTMLFormElement>);
      await Promise.resolve();
    });
    expect(generate).toHaveBeenCalledTimes(1);

    act(() => result.current.setAssistantPrompt('A different request'));
    response.resolve({
      success: true,
      intent: {
        action: 'schedule',
        chat: 'Alpha Team',
        message: 'Stale generated message',
        date: '2035-01-15',
        time: '18:30',
        clarification: '',
      },
    });
    await act(async () => submission);

    expect(result.current.assistantPrompt).toBe('A different request');
    expect(result.current.assistantIntent).toBeNull();
  });

  it('sends only one Gemini request for duplicate submits in the same React batch', async () => {
    const response = createDeferred<Awaited<ReturnType<Window['gemini']['generate']>>>();
    const generate = vi.fn(() => response.promise);
    vi.stubGlobal('gemini', {
      generate,
      getSettings: vi.fn().mockResolvedValue({
        hasKey: true,
        maskedKey: '',
        enabled: true,
        encryptionAvailable: true,
      }),
    });
    const wrapper = ({ children }: PropsWithChildren) => <LocaleProvider>{children}</LocaleProvider>;
    const { result } = renderHook(() => useAssistant({ chats: [] }), { wrapper });
    const event = { preventDefault: vi.fn() } as unknown as React.FormEvent<HTMLFormElement>;
    let submissions: Promise<void>[] = [];

    act(() => result.current.setAssistantPrompt('Create one schedule'));
    await act(async () => {
      submissions = [
        result.current.handleAssistantSubmit(event),
        result.current.handleAssistantSubmit(event),
      ];
      await Promise.resolve();
    });

    expect(generate).toHaveBeenCalledTimes(1);
    response.resolve({ success: true, intent: undefined });
    await act(async () => Promise.all(submissions));
    expect(result.current.isThinking).toBe(false);
  });
});