import type { Ref } from 'react';
import type { CSSProperties } from 'react';
import { useLocale } from '@/lib/i18n';
import {
  emojiCategories,
  emojiCategoryTranslationKeys,
  emojiRussianNames,
  getVisibleEmojiOptions,
  type EmojiCategoryId,
} from '@/lib/emojiCatalog';

type EmojiPickerPanelProps = {
  categoryId: EmojiCategoryId;
  searchQuery: string;
  activeIndex: number;
  recentEmojis: string[];
  modifierHeld?: boolean;
  commandMode?: boolean;
  className?: string;
  pickerRef?: Ref<HTMLDivElement>;
  style?: CSSProperties;
  onCategoryChange: (categoryId: EmojiCategoryId) => void;
  onSearchQueryChange: (query: string) => void;
  onActiveIndexChange: (index: number) => void;
  onSelectEmoji: (emoji: string, keepOpen: boolean, updateRecent: boolean) => void;
};

export function EmojiPickerPanel({
  categoryId,
  searchQuery,
  activeIndex,
  recentEmojis,
  modifierHeld = false,
  commandMode = false,
  className = '',
  pickerRef,
  style,
  onCategoryChange,
  onSearchQueryChange,
  onActiveIndexChange,
  onSelectEmoji,
}: EmojiPickerPanelProps) {
  const { locale, t } = useLocale();
  const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase();
  const selectedCategory = emojiCategories.find((category) => category.id === categoryId) ?? emojiCategories[0];
  const visibleOptions = getVisibleEmojiOptions(searchQuery, categoryId, commandMode);

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!normalizedSearchQuery || visibleOptions.length === 0) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      onActiveIndexChange((activeIndex + direction + visibleOptions.length) % visibleOptions.length);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      onSelectEmoji(visibleOptions[activeIndex]?.emoji ?? visibleOptions[0].emoji, event.ctrlKey || event.metaKey, true);
    }
  };

  return (
    <div
      ref={pickerRef}
      style={style}
      className={`quick-planner-tool-popover quick-planner-emoji-picker${modifierHeld ? ' is-modifier-held' : ''} ${className}`.trim()}
      role="dialog"
      aria-label={t('quickPlanner.chooseEmoji')}
    >
      <div className="quick-planner-emoji-heading">
        <strong>{t('quickPlanner.emoji')}</strong>
        <span>{normalizedSearchQuery ? t('quickPlanner.searchResults') : t(emojiCategoryTranslationKeys[selectedCategory.id])}</span>
      </div>
      {!commandMode && (
        <div className="quick-planner-emoji-categories" role="tablist" aria-label={t('quickPlanner.emojiCategories')}>
          {emojiCategories.map((category) => (
            <button
              key={category.id}
              type="button"
              role="tab"
              aria-selected={categoryId === category.id}
              onClick={() => {
                onCategoryChange(category.id);
                onActiveIndexChange(0);
              }}
            >{t(emojiCategoryTranslationKeys[category.id])}</button>
          ))}
        </div>
      )}
      <input
        className="quick-planner-emoji-search"
        type="search"
        value={searchQuery}
        aria-label={t('quickPlanner.searchEmoji')}
        placeholder={t('quickPlanner.searchEmojiPlaceholder')}
        onChange={(event) => {
          onSearchQueryChange(event.target.value);
          onActiveIndexChange(0);
        }}
        onKeyDown={handleSearchKeyDown}
      />
      <div
        className="quick-planner-emoji-results"
        role="group"
        aria-label={normalizedSearchQuery
          ? t('quickPlanner.emojiSearchResults')
          : commandMode
            ? t('quickPlanner.emojiCommandResults')
            : t('quickPlanner.categoryEmoji', { category: t(emojiCategoryTranslationKeys[selectedCategory.id]) })}
      >
        {visibleOptions.length > 0 ? (
          <div className="quick-planner-emoji-grid quick-planner-emoji-options">
            {visibleOptions.map((option, index) => (
              <button
                key={`${option.categoryId}-${option.emoji}`}
                className={(normalizedSearchQuery || commandMode) && index === activeIndex ? 'is-keyboard-active' : ''}
                type="button"
                aria-label={t('quickPlanner.insertEmoji', { emoji: option.emoji })}
                title={`${option.emoji} ${locale === 'ru' ? emojiRussianNames[option.emoji] ?? option.name : option.name}`}
                onClick={(event) => onSelectEmoji(option.emoji, event.ctrlKey || event.metaKey, true)}
                onMouseEnter={() => onActiveIndexChange(index)}
              >{option.emoji}</button>
            ))}
          </div>
        ) : (
          <p className="quick-planner-emoji-empty" role="status">{t('quickPlanner.noEmojisFound')}</p>
        )}
      </div>
      <section className="quick-planner-emoji-recent" aria-label={t('quickPlanner.recentEmojis')}>
        <div className="quick-planner-emoji-recent-heading">
          <span>{t('quickPlanner.recent')}</span>
          <small className="quick-planner-emoji-multiselect-hint">{t('quickPlanner.holdCtrl')}</small>
        </div>
        {recentEmojis.length > 0 ? (
          <div className="quick-planner-emoji-grid" role="group" aria-label={t('quickPlanner.recentEmoji')}>
            {recentEmojis.map((emoji) => (
              <button
                key={emoji}
                type="button"
                aria-label={t('quickPlanner.insertRecentEmoji', { emoji })}
                title={t('quickPlanner.insertEmoji', { emoji })}
                onClick={(event) => onSelectEmoji(emoji, event.ctrlKey || event.metaKey, false)}
              >{emoji}</button>
            ))}
          </div>
        ) : (
          <span className="quick-planner-emoji-recent-empty">{t('quickPlanner.noRecentEmojis')}</span>
        )}
      </section>
    </div>
  );
}