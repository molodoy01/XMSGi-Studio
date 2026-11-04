export const emojiCategories = [
  { id: 'faces', label: 'Faces', emojis: ['😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '🙂', '🙃', '😉', '😊', '😍', '🥰', '😘', '😎', '🥳', '🤔'] },
  { id: 'hands', label: 'Hands', emojis: ['👋', '🤚', '✋', '🖖', '👌', '🤌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👍', '👎', '👏', '🙌'] },
  { id: 'hearts', label: 'Hearts', emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '🩷', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘'] },
  { id: 'nature', label: 'Nature', emojis: ['🔥', '✨', '⭐', '🌟', '💫', '🌈', '☀️', '🌙', '🌸', '🌹', '🌻', '🌼', '🍀', '🌿', '🌊', '⚡', '❄️', '☔'] },
  { id: 'food', label: 'Food', emojis: ['🍎', '🍓', '🍒', '🍉', '🍇', '🍊', '🍋', '🍌', '🍍', '🥑', '🍕', '🍔', '🍟', '🍰', '🎂', '🍩', '☕', '🧋'] },
  { id: 'fun', label: 'Fun', emojis: ['🎉', '🎈', '🎁', '🏆', '⚽', '🏀', '🎸', '🎧', '🚀', '✈️', '💡', '📌', '💻', '📷', '💎', '🎨', '🎯', '🛠️'] },
] as const;

export type EmojiCategoryId = typeof emojiCategories[number]['id'];

export const emojiCategoryTranslationKeys: Record<EmojiCategoryId, `quickPlanner.category.${EmojiCategoryId}`> = {
  faces: 'quickPlanner.category.faces',
  hands: 'quickPlanner.category.hands',
  hearts: 'quickPlanner.category.hearts',
  nature: 'quickPlanner.category.nature',
  food: 'quickPlanner.category.food',
  fun: 'quickPlanner.category.fun',
};

const emojiCategoryRussianNames: Record<EmojiCategoryId, string> = {
  faces: 'лица улыбки',
  hands: 'жесты руки',
  hearts: 'сердца любовь',
  nature: 'природа',
  food: 'еда напитки',
  fun: 'разное развлечения',
};

export const emojiEnglishNames: Record<string, string> = {
  '😀': 'grinning face smile happy', '😃': 'smiley face happy', '😄': 'smiling face happy', '😁': 'grin smile happy',
  '😆': 'laughing face happy', '😅': 'sweat smile nervous', '😂': 'joy tears laugh', '🤣': 'rolling floor laugh',
  '🙂': 'slightly smiling face', '🙃': 'upside down smile', '😉': 'wink', '😊': 'blush smile', '😍': 'heart eyes love',
  '🥰': 'smiling hearts love', '😘': 'kiss love', '😎': 'cool sunglasses', '🥳': 'party celebration', '🤔': 'thinking face',
  '👋': 'wave hello goodbye', '👌': 'ok hand', '🤌': 'pinched fingers', '✌️': 'victory peace', '🤞': 'crossed fingers luck',
  '🤟': 'love you hand', '🤘': 'rock on hand', '👍': 'thumbs up like yes', '👎': 'thumbs down dislike no', '👏': 'clap applause',
  '🙌': 'raised hands celebrate', '❤️': 'red heart love', '🧡': 'orange heart love', '💛': 'yellow heart love',
  '💚': 'green heart love', '💙': 'blue heart love', '💜': 'purple heart love', '🖤': 'black heart love',
  '🤍': 'white heart love', '🤎': 'brown heart love', '🩷': 'pink heart love', '💔': 'broken heart heartbreak',
  '💕': 'two hearts love', '💞': 'revolving hearts love', '💓': 'beating heart love', '💗': 'growing heart love',
  '💖': 'sparkling heart love', '💘': 'heart arrow cupid love', '🔥': 'fire flame hot', '✨': 'sparkles shine magic',
  '⭐': 'star favorite', '🌟': 'glowing star', '💫': 'dizzy star', '🌈': 'rainbow', '☀️': 'sun sunny', '🌙': 'moon night',
  '🌸': 'cherry blossom flower', '🌹': 'rose flower love', '🌻': 'sunflower', '🍀': 'four leaf clover luck',
  '🌊': 'water wave ocean', '⚡': 'lightning bolt energy', '❄️': 'snowflake cold winter', '☔': 'umbrella rain',
  '🍎': 'red apple fruit', '🍓': 'strawberry fruit', '🍒': 'cherries fruit', '🍉': 'watermelon fruit',
  '🍇': 'grapes fruit', '🍊': 'orange fruit', '🍋': 'lemon fruit', '🍌': 'banana fruit', '🍍': 'pineapple fruit',
  '🥑': 'avocado fruit', '🍕': 'pizza food', '🍔': 'burger food', '🍟': 'fries food', '🍰': 'cake dessert',
  '🎂': 'birthday cake', '🍩': 'donut dessert', '☕': 'coffee drink', '🧋': 'bubble tea drink', '🎉': 'party popper celebration',
  '🎈': 'balloon party', '🎁': 'gift present', '🏆': 'trophy winner', '⚽': 'soccer football ball', '🏀': 'basketball ball',
  '🎸': 'guitar music', '🎧': 'headphones music', '🚀': 'rocket space', '✈️': 'airplane travel', '💡': 'light bulb idea',
  '💻': 'laptop computer', '📷': 'camera photo', '💎': 'gem diamond', '🎨': 'art palette', '🎯': 'target bullseye',
  '🛠️': 'tools hammer wrench',
};

export const emojiRussianNames: Record<string, string> = {
  '😀': 'улыбка радость смайлик счастливый', '😃': 'улыбка радостный', '😄': 'улыбается радость', '😁': 'широкая улыбка оскал',
  '😆': 'смеется смех', '😅': 'неловкость пот улыбка', '😂': 'смех слезы радость', '🤣': 'хохот катается смех',
  '🙂': 'улыбка', '🙃': 'перевернутый смайлик', '😉': 'подмигивание', '😊': 'улыбка румянец', '😍': 'влюбленный глаза сердечки',
  '🥰': 'любовь улыбка сердечки', '😘': 'поцелуй губы', '😎': 'очки круто', '🥳': 'праздник вечеринка', '🤔': 'думает размышляет',
  '👋': 'привет пока махать', '🤚': 'ладонь рука', '✋': 'стоп ладонь рука', '🖖': 'вулкан приветствие', '👌': 'ок отлично хорошо',
  '🤌': 'пальцы жест', '🤏': 'мало щепотка', '✌️': 'победа мир', '🤞': 'удача скрещенные пальцы', '🤟': 'люблю жест',
  '🤘': 'рок рога', '🤙': 'позвони мне', '👈': 'влево указатель', '👉': 'вправо указатель', '👍': 'лайк хорошо да палец вверх',
  '👎': 'дизлайк плохо нет палец вниз', '👏': 'аплодисменты хлопать', '🙌': 'руки вверх ура',
  '❤️': 'сердце красное любовь', '🧡': 'сердце оранжевое любовь', '💛': 'сердце желтое любовь', '💚': 'сердце зеленое любовь',
  '💙': 'сердце синее голубое любовь', '💜': 'сердце фиолетовое любовь', '🖤': 'сердце черное любовь', '🤍': 'сердце белое любовь',
  '🤎': 'сердце коричневое любовь', '🩷': 'сердце розовое любовь', '💔': 'разбитое сердце расставание', '❣️': 'сердце восклицание',
  '💕': 'два сердца любовь', '💞': 'вращающиеся сердца любовь', '💓': 'бьющееся сердце любовь', '💗': 'растущее сердце любовь',
  '💖': 'сверкающее сердце любовь', '💘': 'сердце стрела купидон любовь', '🔥': 'огонь пламя жарко', '✨': 'искры блеск магия',
  '⭐': 'звезда избранное', '🌟': 'сверкающая звезда', '💫': 'падающая звезда головокружение', '🌈': 'радуга', '☀️': 'солнце солнечно',
  '🌙': 'луна ночь', '🌸': 'цветок сакура', '🌹': 'роза цветок любовь', '🌻': 'подсолнух', '🌼': 'цветок ромашка',
  '🍀': 'клевер удача', '🌿': 'трава зелень', '🌊': 'волна море океан вода', '⚡': 'молния энергия', '❄️': 'снежинка зима холод',
  '☔': 'зонт дождь', '🍎': 'яблоко красное фрукт', '🍓': 'клубника ягода', '🍒': 'вишня ягоды', '🍉': 'арбуз фрукт',
  '🍇': 'виноград', '🍊': 'апельсин фрукт', '🍋': 'лимон фрукт', '🍌': 'банан фрукт', '🍍': 'ананас фрукт',
  '🥑': 'авокадо фрукт', '🍕': 'пицца еда', '🍔': 'бургер гамбургер еда', '🍟': 'картошка фри еда', '🍰': 'торт десерт',
  '🎂': 'торт день рождения', '🍩': 'пончик десерт', '☕': 'кофе напиток', '🧋': 'чай бабл ти напиток', '🎉': 'конфетти праздник вечеринка',
  '🎈': 'шарик воздушный вечеринка', '🎁': 'подарок', '🏆': 'кубок победа', '⚽': 'футбол мяч', '🏀': 'баскетбол мяч',
  '🎸': 'гитара музыка', '🎧': 'наушники музыка', '🚀': 'ракета космос', '✈️': 'самолет путешествие', '💡': 'лампочка идея',
  '📌': 'кнопка булавка', '💻': 'ноутбук компьютер', '📷': 'камера фото', '💎': 'алмаз бриллиант', '🎨': 'палитра искусство',
  '🎯': 'мишень цель', '🛠️': 'инструменты молоток ключ',
};

export const emojiOptions = emojiCategories.flatMap((category) => category.emojis.map((emoji) => ({
  emoji,
  categoryId: category.id,
  name: emojiEnglishNames[emoji] ?? `${category.label} emoji`,
  searchText: `${emojiEnglishNames[emoji] ?? ''} ${emojiRussianNames[emoji] ?? ''} ${category.label} ${emojiCategoryRussianNames[category.id]}`.toLocaleLowerCase(),
})));

export type EmojiOption = typeof emojiOptions[number];

export const recentEmojiStorageKey = 'xmsgi-quick-planner-recent-emojis';
export const knownEmojis: ReadonlySet<string> = new Set<string>(emojiCategories.flatMap((category) => category.emojis));

export function readRecentEmojis(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = JSON.parse(window.localStorage.getItem(recentEmojiStorageKey) ?? '[]');
    return Array.isArray(stored)
      ? stored.filter((emoji): emoji is string => typeof emoji === 'string' && knownEmojis.has(emoji)).slice(0, 6)
      : [];
  } catch {
    return [];
  }
}

export function getVisibleEmojiOptions(query: string, categoryId: EmojiCategoryId, showAll = false) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) {
    return showAll ? emojiOptions : emojiOptions.filter((option) => option.categoryId === categoryId);
  }

  return emojiOptions
    .filter((option) => option.searchText.includes(normalizedQuery))
    .sort((left, right) => {
      const leftHasExactWord = left.name.split(/\s+/).includes(normalizedQuery);
      const rightHasExactWord = right.name.split(/\s+/).includes(normalizedQuery);
      return Number(rightHasExactWord) - Number(leftHasExactWord);
    });
}