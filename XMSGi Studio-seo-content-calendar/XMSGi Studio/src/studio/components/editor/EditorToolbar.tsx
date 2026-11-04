import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Bold, Download, History, ImagePlus, Italic, Link, Smile, Sparkles, Strikethrough, Underline } from 'lucide-react';
import { useLocale } from '@studio/lib/i18n';
import { EmojiPickerPanel } from '@/components/EmojiPickerPanel';
import { readRecentEmojis, recentEmojiStorageKey, type EmojiCategoryId } from '@/lib/emojiCatalog';
import { loadFreeTelegramMessageEffects, type TelegramMessageEffect } from '@/lib/telegramMessageEffects';
import type { StageMode } from '@studio/components/stages/types';
import type { EditorFormats } from './useEditorFormats';

export type EditorToolbarFormat = 'bold' | 'italic' | 'underline' | 'strike';

interface Props {
  stageMode: StageMode;
  activeFormats: EditorFormats;
  linkPopoverOpen: boolean;
  linkPopover?: ReactNode;
  onFormat: (format: EditorToolbarFormat) => void;
  onOpenAlbum?: () => void;
  albumDisabled?: boolean;
  onToggleLink: () => void;
  onExportText?: (format: 'txt' | 'json') => void;
  onOpenVersionHistory?: () => void;
  selectedEffectId?: string | null;
  onSelectEffect?: (effectId: string | null) => void;
  onInsertEmoji?: (emoji: string) => void;
}

export function EditorToolbar({ stageMode, activeFormats, linkPopoverOpen, linkPopover, onFormat, onOpenAlbum, albumDisabled = false, onToggleLink, onExportText, onOpenVersionHistory, selectedEffectId = null, onSelectEffect, onInsertEmoji }: Props) {
  const { t } = useLocale();
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [albumInfoVisible, setAlbumInfoVisible] = useState(false);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [emojiModifierHeld, setEmojiModifierHeld] = useState(false);
  const [emojiCategoryId, setEmojiCategoryId] = useState<EmojiCategoryId>('faces');
  const [emojiSearchQuery, setEmojiSearchQuery] = useState('');
  const [emojiActiveIndex, setEmojiActiveIndex] = useState(0);
  const [recentEmojis, setRecentEmojis] = useState(readRecentEmojis);
  const [effectPickerOpen, setEffectPickerOpen] = useState(false);
  const [effects, setEffects] = useState<TelegramMessageEffect[]>([]);
  const [effectsLoading, setEffectsLoading] = useState(false);
  const [effectsLoaded, setEffectsLoaded] = useState(false);
  const exportRef = useRef<HTMLDivElement | null>(null);
  const emojiPickerRef = useRef<HTMLDivElement | null>(null);
  const emojiPickerPanelRef = useRef<HTMLDivElement | null>(null);
  const effectsPickerRef = useRef<HTMLDivElement | null>(null);
  const albumInfoTimerRef = useRef<number | null>(null);
  const emojiReleaseCloseTimeoutRef = useRef<number | null>(null);
  const emojiSelectionWaitingForReleaseRef = useRef(false);
  const selectedEffect = effects.find((effect) => effect.id === selectedEffectId);
  const formatOptions = [
    { id: 'bold' as const, label: t('studio.bold'), icon: Bold },
    { id: 'italic' as const, label: t('studio.italic'), icon: Italic },
    { id: 'underline' as const, label: t('studio.underline'), icon: Underline },
    { id: 'strike' as const, label: t('studio.strikethrough'), icon: Strikethrough },
  ];

  useEffect(() => {
    if (!exportMenuOpen) return undefined;
    const onDown = (e: PointerEvent | MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) setExportMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setExportMenuOpen(false); };
    document.addEventListener('pointerdown', onDown as EventListener);
    document.addEventListener('mousedown', onDown as EventListener);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown as EventListener);
      document.removeEventListener('mousedown', onDown as EventListener);
      document.removeEventListener('keydown', onKey);
    };
  }, [exportMenuOpen]);

  useEffect(() => {
    if (!effectPickerOpen && !emojiPickerOpen) return undefined;
    const onDown = (event: PointerEvent) => {
      if (effectsPickerRef.current && !effectsPickerRef.current.contains(event.target as Node)) setEffectPickerOpen(false);
      const target = event.target as Node;
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(target) && !emojiPickerPanelRef.current?.contains(target)) {
        setEmojiPickerOpen(false);
        setEmojiSearchQuery('');
        setEmojiActiveIndex(0);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (emojiPickerOpen && (event.key === 'Control' || event.key === 'Meta')) setEmojiModifierHeld(true);
      if (event.key !== 'Escape') return;
      if (emojiReleaseCloseTimeoutRef.current !== null) {
        window.clearTimeout(emojiReleaseCloseTimeoutRef.current);
        emojiReleaseCloseTimeoutRef.current = null;
      }
      emojiSelectionWaitingForReleaseRef.current = false;
      setEmojiModifierHeld(false);
      setEffectPickerOpen(false);
      setEmojiPickerOpen(false);
      setEmojiSearchQuery('');
      setEmojiActiveIndex(0);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (emojiPickerOpen && (event.key === 'Control' || event.key === 'Meta')) setEmojiModifierHeld(false);
      if (!emojiPickerOpen || (event.key !== 'Control' && event.key !== 'Meta') || !emojiSelectionWaitingForReleaseRef.current) return;
      emojiSelectionWaitingForReleaseRef.current = false;
      if (emojiReleaseCloseTimeoutRef.current !== null) window.clearTimeout(emojiReleaseCloseTimeoutRef.current);
      emojiReleaseCloseTimeoutRef.current = window.setTimeout(() => {
        emojiReleaseCloseTimeoutRef.current = null;
        setEmojiPickerOpen(false);
        setEmojiSearchQuery('');
        setEmojiActiveIndex(0);
      }, 700);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
      if (emojiReleaseCloseTimeoutRef.current !== null) {
        window.clearTimeout(emojiReleaseCloseTimeoutRef.current);
        emojiReleaseCloseTimeoutRef.current = null;
      }
      emojiSelectionWaitingForReleaseRef.current = false;
    };
  }, [effectPickerOpen, emojiPickerOpen]);

  useLayoutEffect(() => {
    if (!emojiPickerOpen) return undefined;

    const updateEmojiPickerPosition = () => {
      const anchor = emojiPickerRef.current;
      const picker = emojiPickerPanelRef.current;
      if (!anchor || !picker) return;

      const anchorRect = anchor.getBoundingClientRect();
      const pickerRect = picker.getBoundingClientRect();
      const viewportInset = 12;
      const maxLeft = Math.max(viewportInset, window.innerWidth - pickerRect.width - viewportInset);
      const rightSideLeft = anchorRect.right + 12;
      const left = rightSideLeft <= maxLeft
        ? rightSideLeft
        : Math.max(viewportInset, anchorRect.left - pickerRect.width - 12);
      const maxTop = Math.max(viewportInset, window.innerHeight - pickerRect.height - viewportInset);
      const centeredTop = anchorRect.top + (anchorRect.height - pickerRect.height) / 2 + 7;
      const top = Math.min(maxTop, Math.max(viewportInset, centeredTop));

      picker.style.left = `${Math.min(maxLeft, left)}px`;
      picker.style.top = `${top}px`;
    };

    updateEmojiPickerPosition();
    window.addEventListener('resize', updateEmojiPickerPosition);
    window.addEventListener('scroll', updateEmojiPickerPosition, true);
    return () => {
      window.removeEventListener('resize', updateEmojiPickerPosition);
      window.removeEventListener('scroll', updateEmojiPickerPosition, true);
    };
  }, [emojiPickerOpen]);

  useEffect(() => {
    if (stageMode !== 'editor') return undefined;
    let active = true;
    setEffectsLoading(true);
    void loadFreeTelegramMessageEffects().then((loadedEffects) => {
      if (!active) return;
      setEffects(loadedEffects);
      setEffectsLoaded(true);
    }).finally(() => {
      if (active) setEffectsLoading(false);
    });
    return () => { active = false; };
  }, [stageMode]);

  useEffect(() => () => {
    if (albumInfoTimerRef.current !== null) window.clearTimeout(albumInfoTimerRef.current);
    if (emojiReleaseCloseTimeoutRef.current !== null) window.clearTimeout(emojiReleaseCloseTimeoutRef.current);
  }, []);

  const selectEmoji = (emoji: string, keepPickerOpen: boolean, updateRecent: boolean) => {
    if (emojiReleaseCloseTimeoutRef.current !== null) {
      window.clearTimeout(emojiReleaseCloseTimeoutRef.current);
      emojiReleaseCloseTimeoutRef.current = null;
    }
    emojiSelectionWaitingForReleaseRef.current = keepPickerOpen;
    onInsertEmoji?.(emoji);
    if (updateRecent) {
      setRecentEmojis((current) => {
        const next = [emoji, ...current.filter((recentEmoji) => recentEmoji !== emoji)].slice(0, 6);
        try {
          window.localStorage.setItem(recentEmojiStorageKey, JSON.stringify(next));
        } catch {
          // Keep the picker usable when storage is unavailable.
        }
        return next;
      });
    }
    setEmojiPickerOpen(keepPickerOpen);
    if (!keepPickerOpen) setEmojiSearchQuery('');
  };

  const scheduleAlbumInfo = () => {
    if (albumInfoTimerRef.current !== null) window.clearTimeout(albumInfoTimerRef.current);
    albumInfoTimerRef.current = window.setTimeout(() => {
      albumInfoTimerRef.current = null;
      setAlbumInfoVisible(true);
    }, 450);
  };

  const hideAlbumInfo = () => {
    if (albumInfoTimerRef.current !== null) {
      window.clearTimeout(albumInfoTimerRef.current);
      albumInfoTimerRef.current = null;
    }
    setAlbumInfoVisible(false);
  };

  if (stageMode !== 'editor') return null;

  return (
    <div className="workspace-page-rich-text-toolbar is-airy" role="toolbar" aria-label={t('studio.formattingTools')} aria-orientation="horizontal">
      <div className="workspace-page-rich-text-leading-tools" role="group" aria-label={t('studio.messageTools')}>
        {onSelectEffect && (
          <div className="workspace-page-rich-text-tool-anchor" ref={effectsPickerRef}>
            <button
              type="button"
              className={`workspace-page-rich-text-link-trigger workspace-page-rich-text-tool-icon-trigger${effectPickerOpen || selectedEffectId ? ' is-open' : ''}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => { setEffectPickerOpen((open) => !open); setEmojiPickerOpen(false); }}
              aria-label={t('studio.messageEffects')}
              aria-haspopup="dialog"
              aria-expanded={effectPickerOpen}
              aria-pressed={Boolean(selectedEffectId)}
              title={selectedEffect ? t('studio.effectSelectedTitle', { effect: selectedEffect.emoticon }) : t('studio.messageEffects')}
            >
              <Sparkles size={17} strokeWidth={1.8} aria-hidden="true" />
            </button>
            {effectPickerOpen && (
              <div className="workspace-page-rich-text-tool-popover workspace-page-rich-text-effects-picker" role="dialog" aria-label={t('studio.messageEffects')}>
                <strong>{t('studio.chooseMessageEffect')}</strong>
                <div className="workspace-page-rich-text-effect-options" role="group" aria-label={t('studio.chooseMessageEffect')}>
                  {[...effects.slice(0, 3), null, ...effects.slice(3)].map((effect) => effect === null ? (
                    <button key="no-effect" type="button" className={`workspace-page-rich-text-effect-option${selectedEffectId === null ? ' is-selected' : ''}`} aria-label={t('studio.noEffect')} aria-pressed={selectedEffectId === null} onMouseDown={(event) => event.preventDefault()} onClick={() => { onSelectEffect(null); setEffectPickerOpen(false); }}>
                      <span aria-hidden="true">−</span><small>{t('studio.noEffect')}</small>
                    </button>
                  ) : (
                    <button key={effect.id} type="button" className={`workspace-page-rich-text-effect-option${selectedEffectId === effect.id ? ' is-selected' : ''}`} aria-label={t(effect.premiumRequired ? 'studio.premiumEffectOption' : 'studio.effectOption', { emoticon: effect.emoticon })} aria-pressed={selectedEffectId === effect.id} title={`${effect.emoticon} · ${effect.id}`} onMouseDown={(event) => event.preventDefault()} onClick={() => { onSelectEffect(effect.id); setEffectPickerOpen(false); }}>
                      <span aria-hidden="true">{effect.emoticon}</span>
                    </button>
                  ))}
                </div>
                {effectsLoading && <span className="workspace-page-rich-text-picker-status" role="status">{t('studio.effectsLoading')}</span>}
                {!effectsLoading && effectsLoaded && effects.length === 0 && <span className="workspace-page-rich-text-picker-status" role="status">{t('studio.freeEffectsUnavailable')}</span>}
              </div>
            )}
          </div>
        )}
        {onInsertEmoji && (
          <div className="workspace-page-rich-text-tool-anchor" ref={emojiPickerRef}>
            <button type="button" className={`workspace-page-rich-text-link-trigger workspace-page-rich-text-tool-icon-trigger${emojiPickerOpen ? ' is-open' : ''}`} onMouseDown={(event) => event.preventDefault()} onClick={() => { const nextOpen = !emojiPickerOpen; setEmojiPickerOpen(nextOpen); setEffectPickerOpen(false); if (!nextOpen) { setEmojiSearchQuery(''); setEmojiActiveIndex(0); } }} aria-label={t('studio.chooseEmoji')} aria-haspopup="dialog" aria-expanded={emojiPickerOpen} title={t('studio.chooseEmoji')}>
              <Smile size={17} strokeWidth={1.8} aria-hidden="true" />
            </button>
            {emojiPickerOpen && createPortal(
              <EmojiPickerPanel
                categoryId={emojiCategoryId}
                searchQuery={emojiSearchQuery}
                activeIndex={emojiActiveIndex}
                recentEmojis={recentEmojis}
                modifierHeld={emojiModifierHeld}
                className="workspace-page-rich-text-emoji-picker workspace-page-rich-text-emoji-picker--floating"
                pickerRef={emojiPickerPanelRef}
                onCategoryChange={setEmojiCategoryId}
                onSearchQueryChange={setEmojiSearchQuery}
                onActiveIndexChange={setEmojiActiveIndex}
                onSelectEmoji={selectEmoji}
              />,
              document.body,
            )}
          </div>
        )}
      </div>
      <div className="workspace-page-rich-text-toolbar-actions" role="group" aria-label={t('studio.formattingTools')}>
        {formatOptions.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" className="workspace-page-rich-text-format-option" onMouseDown={(event) => event.preventDefault()} onClick={() => onFormat(id)} aria-label={label} aria-pressed={activeFormats[id]} title={label}>
            <Icon size={17} strokeWidth={1.8} aria-hidden="true" />
          </button>
        ))}
        <div className={`workspace-page-rich-text-link-controls${linkPopoverOpen ? ' is-open' : ''}`}>
          <button type="button" className={`workspace-page-rich-text-link-trigger${linkPopoverOpen ? ' is-open' : ''}`} onMouseDown={(event) => event.preventDefault()} onClick={onToggleLink} aria-label={t('studio.insertLink')} aria-haspopup="dialog" aria-expanded={linkPopoverOpen} title={t('studio.insertLink')}>
            <span className="workspace-page-rich-text-link-trigger__icon" aria-hidden="true">
              <Link size={17} strokeWidth={1.8} aria-hidden="true" />
            </span>
          </button>
          {linkPopover}
        </div>
        <span className="workspace-page-rich-text-toolbar-divider" aria-hidden="true" />
        {onOpenVersionHistory && (
          <button type="button" className="workspace-page-rich-text-link-trigger workspace-page-version-history-trigger" onMouseDown={(e) => e.preventDefault()} onClick={onOpenVersionHistory} aria-label={t('studio.openVersionHistory')} aria-haspopup="dialog" title={t('studio.openVersionHistory')}>
            <History size={17} strokeWidth={1.8} aria-hidden="true" />
          </button>
        )}
        {onExportText && (
          <div className="workspace-page-editor-export" ref={exportRef}>
            <button type="button" className={`workspace-page-editor-export-trigger${exportMenuOpen ? ' is-open' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={() => setExportMenuOpen((v) => !v)} aria-label={t('studio.exportEditorText')} aria-haspopup="menu" aria-expanded={exportMenuOpen} title={t('studio.exportEditorTextTitle')}>
              <Download size={17} strokeWidth={1.8} aria-hidden="true" />
            </button>
            {exportMenuOpen && (
              <div className="workspace-page-editor-export-menu" role="menu" aria-label={t('studio.exportTextFormat')}>
                <button type="button" role="menuitem" className="workspace-page-editor-export-option" onClick={() => { setExportMenuOpen(false); onExportText('txt'); }}><span>{t('studio.exportTextAsTxt')}</span></button>
                <button type="button" role="menuitem" className="workspace-page-editor-export-option" onClick={() => { setExportMenuOpen(false); onExportText('json'); }}><span>{t('studio.exportTextAsJson')}</span></button>
              </div>
            )}
          </div>
        )}
        {onOpenAlbum && (
          <div
            className={`workspace-page-rich-text-album-controls${albumInfoVisible ? ' is-info-visible' : ''}`}
            onMouseEnter={scheduleAlbumInfo}
            onMouseLeave={hideAlbumInfo}
            onFocusCapture={scheduleAlbumInfo}
            onBlurCapture={(event) => {
              const nextTarget = event.relatedTarget;
              if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
              hideAlbumInfo();
            }}
          >
            <button type="button" className="workspace-page-rich-text-link-trigger workspace-page-rich-text-album-trigger" onMouseDown={(event) => event.preventDefault()} onClick={onOpenAlbum} disabled={albumDisabled} aria-label={t('studio.addPhotoAlbum')} aria-describedby="workspace-page-photo-album-limits">
              <ImagePlus size={17} strokeWidth={1.8} aria-hidden="true" />
            </button>
            <div className="workspace-page-rich-text-album-info" id="workspace-page-photo-album-limits" role="tooltip">
              <strong>{t('studio.photoAlbum')}</strong>
              <span>{t('studio.photoAlbumLimitInfo', { albums: 3, perAlbum: 10, total: 30 })}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}