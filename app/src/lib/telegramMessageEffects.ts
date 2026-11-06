export type TelegramMessageEffect = {
  id: string;
  emoticon: string;
  premiumRequired: boolean;
};

function isObsceneEffect(effect: TelegramMessageEffect) {
  const id = effect.id.toLowerCase();
  const emoticon = effect.emoticon;
  return id.includes('poo') || id.includes('poop') || id.includes('shit') || emoticon === '💩';
}

export async function loadFreeTelegramMessageEffects(): Promise<TelegramMessageEffect[]> {
  const loadEffects = window.telegram?.getAvailableEffects;
  if (typeof loadEffects !== 'function') return [];

  try {
    const result = await loadEffects();
    if (!result.success) return [];
    return (result.effects ?? [])
      .filter((effect) => !effect.premiumRequired)
      .filter((effect) => !isObsceneEffect(effect));
  } catch {
    return [];
  }
}