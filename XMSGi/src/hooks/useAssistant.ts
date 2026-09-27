import { useEffect, useRef, useState } from 'react';
import type { Chat } from '@/types';
import { useLocale } from '@/lib/i18n';

const TEXT_ANIMATION_CONFIG = {
  typingSpeed: 28,
  deletingSpeed: 22,
  maxCatchUpSteps: 4,
};

function splitGraphemes(value: string): string[] {
  const intlWithSegmenter = Intl as typeof Intl & {
    Segmenter?: new (
      locales?: string | string[],
      options?: { granularity: 'grapheme' }
    ) => {
      segment(value: string): Iterable<{ segment: string }>;
    };
  };

  if (intlWithSegmenter.Segmenter) {
    const segmenter = new intlWithSegmenter.Segmenter(undefined, {
      granularity: 'grapheme',
    });

    return Array.from(segmenter.segment(value), ({ segment }) => segment);
  }

  return Array.from(value);
}

function useAnimatedText(targetText: string): string {
  const [displayedText, setDisplayedText] = useState('');
  const targetRef = useRef<string[]>([]);
  const displayedRef = useRef<string[]>([]);
  const animationFrameRef = useRef<number | null>(null);
  const lastStepAtRef = useRef<number | null>(null);

  useEffect(() => {
    targetRef.current = splitGraphemes(targetText);
    lastStepAtRef.current = null;

    if (animationFrameRef.current === null) {
      animationFrameRef.current = window.requestAnimationFrame(function animate(now) {
        const current = displayedRef.current;
        const target = targetRef.current;
        let sharedLength = 0;
        while (
          sharedLength < current.length &&
          sharedLength < target.length &&
          current[sharedLength] === target[sharedLength]
        ) {
          sharedLength += 1;
        }
        const isDeleting = current.length > sharedLength;
        const interval = isDeleting
          ? TEXT_ANIMATION_CONFIG.deletingSpeed
          : TEXT_ANIMATION_CONFIG.typingSpeed;
        const elapsedSinceStep = lastStepAtRef.current === null
          ? interval
          : now - lastStepAtRef.current;
        const elapsed = Math.min(
          elapsedSinceStep,
          interval * TEXT_ANIMATION_CONFIG.maxCatchUpSteps
        );
        const steps = Math.floor(elapsed / interval);

        if (steps === 0) {
          animationFrameRef.current = window.requestAnimationFrame(animate);
          return;
        }

        if (isDeleting) {
          displayedRef.current = current.slice(
            0,
            Math.max(sharedLength, current.length - steps)
          );
        } else if (current.length < target.length) {
          displayedRef.current = target.slice(
            0,
            Math.min(target.length, current.length + steps)
          );
        }

        lastStepAtRef.current = elapsedSinceStep > elapsed
          ? now
          : (lastStepAtRef.current ?? now - interval) + steps * interval;
        setDisplayedText(displayedRef.current.join(''));

        if (displayedRef.current.join('') === targetRef.current.join('')) {
          animationFrameRef.current = null;
          lastStepAtRef.current = null;
          return;
        }

        animationFrameRef.current = window.requestAnimationFrame(animate);
      });
    }
  }, [targetText]);

  useEffect(() => () => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
    }
  }, []);

  return displayedText;
}

export type AssistantIntent = NonNullable<
  Awaited<ReturnType<Window['gemini']['generate']>>['intent']
>;
export type GeminiSettings = Awaited<ReturnType<Window['gemini']['getSettings']>>;

export function useAssistant({ chats }: { chats: Chat[] }) {
  const { t } = useLocale();
  const [assistantPrompt, setAssistantPrompt] = useState('');
  const [assistantResponse, setAssistantResponse] = useState('');
  const displayedAssistantResponse = useAnimatedText(assistantResponse);
  const [assistantIntent, setAssistantIntent] = useState<AssistantIntent | null>(null);
  const [assistantExampleIndex, setAssistantExampleIndex] = useState(0);
  const [isThinking, setIsThinking] = useState(false);
  const [geminiSettings, setGeminiSettings] = useState<GeminiSettings>({
    hasKey: false,
    maskedKey: '',
    enabled: true,
    encryptionAvailable: true,
  });
  const [settingsKey, setSettingsKey] = useState('');
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsError, setSettingsError] = useState('');

  const assistantExamples = [
    t('assistant.example1'),
    t('assistant.example2'),
    t('assistant.example3'),
  ];

  useEffect(() => {
    if (typeof window.gemini?.getSettings !== 'function') return;

    window.gemini.getSettings().then(setGeminiSettings).catch(() => undefined);
  }, []);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setAssistantExampleIndex((index) => (index + 1) % assistantExamples.length);
    }, 5000);

    return () => window.clearInterval(intervalId);
  }, [assistantExamples.length]);

  async function handleSaveGeminiKey() {
    if (!settingsKey.trim() || settingsBusy) return;

    setSettingsBusy(true);
    setSettingsError('');

    try {
      const result = await window.gemini.saveKey(settingsKey.trim());

      if (!result.success || !result.settings) {
        setSettingsError(result.error || t('settings.geminiSaveFailed'));
        return;
      }

      setGeminiSettings(result.settings);
      setSettingsKey('');
    } catch {
      setSettingsError(t('settings.geminiSaveFailed'));
    } finally {
      setSettingsBusy(false);
    }
  }

  async function handleRemoveGeminiKey() {
    if (settingsBusy) return;

    setSettingsBusy(true);
    setSettingsError('');

    try {
      const result = await window.gemini.removeKey();

      if (!result.success || !result.settings) {
        setSettingsError(result.error || t('settings.geminiRemoveFailed'));
        return;
      }

      setGeminiSettings(result.settings);
      setSettingsKey('');
    } catch {
      setSettingsError(t('settings.geminiRemoveFailed'));
    } finally {
      setSettingsBusy(false);
    }
  }

  async function handleToggleAssistant() {
    if (settingsBusy) return;

    setSettingsBusy(true);
    setSettingsError('');

    try {
      const result = await window.gemini.setEnabled(!geminiSettings.enabled);

      if (!result.success || !result.settings) {
        setSettingsError(result.error || t('settings.assistantUpdateFailed'));
        return;
      }

      setGeminiSettings(result.settings);
    } catch {
      setSettingsError(t('settings.assistantUpdateFailed'));
    } finally {
      setSettingsBusy(false);
    }
  }

  async function handleAssistantSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!assistantPrompt.trim() || isThinking) return;

    setIsThinking(true);
    setAssistantResponse('');
    setAssistantIntent(null);

    try {
      const now = new Date();
      const result = await window.gemini.generate(assistantPrompt.trim(), {
        currentDate: now.toLocaleDateString('en-CA'),
        currentTime: now.toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        }),
        chats: chats.map(({ id, name }) => ({ id, name })),
      });

      setAssistantResponse(
        result.success
          ? result.intent?.action === 'clarify'
            ? result.intent.clarification
            : ''
          : result.errorCode === 'setup_required'
            ? t('assistant.addKey')
            : result.errorCode === 'quota'
            ? t('assistant.quota')
            : t('assistant.genericError')
      );

      setAssistantIntent(
        result.success && result.intent?.action === 'schedule'
          ? result.intent
          : null
      );
    } catch {
      setAssistantResponse(t('assistant.genericError'));
    } finally {
      setIsThinking(false);
    }
  }

  return {
    assistantPrompt,
    setAssistantPrompt,
    assistantResponse,
    setAssistantResponse,
    displayedAssistantResponse,
    assistantIntent,
    setAssistantIntent,
    assistantExampleIndex,
    isThinking,
    geminiSettings,
    settingsKey,
    setSettingsKey,
    settingsBusy,
    settingsError,
    setSettingsError,
    assistantExamples,
    handleSaveGeminiKey,
    handleRemoveGeminiKey,
    handleToggleAssistant,
    handleAssistantSubmit,
  };
}
