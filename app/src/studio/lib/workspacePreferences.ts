import type { ChatWallpaper } from '../components/ChatPreviewStand';

const PREVIEW_LAYOUT_KEY = 'xmsgi-preview-layout';
const LEGACY_PREVIEW_LAYOUT_KEY = 'awaitmsg-preview-layout';
const CHAT_WALLPAPER_STORAGE_KEY = 'xmsgi-chat-preview-wallpaper';
const LEGACY_CHAT_WALLPAPER_STORAGE_KEY = 'awaitmsg-chat-preview-wallpaper';

export type PreviewLayout = {
  collapsed?: boolean;
  visible?: boolean;
};

export const DEFAULT_PREVIEW_LAYOUT: PreviewLayout = { visible: true };

export function isLivePreviewSurface() {
  const portMatches = ['4175', '4176'].includes(window.location.port);
  return portMatches || document.body?.dataset?.livePreview === 'true';
}

export function readPreviewLayout(): PreviewLayout | null {
  try {
    const primaryRaw = window.localStorage.getItem(PREVIEW_LAYOUT_KEY);
    const raw = primaryRaw ?? window.localStorage.getItem(LEGACY_PREVIEW_LAYOUT_KEY);
    if (!raw) return null;
    if (!primaryRaw) {
      window.localStorage.setItem(PREVIEW_LAYOUT_KEY, raw);
    }

    const parsed = JSON.parse(raw) as Partial<PreviewLayout>;
    return {
      collapsed: parsed.collapsed === true,
      visible: typeof parsed.visible === 'boolean' ? parsed.visible : true,
    };
  } catch {
    return null;
  }
}

export function writePreviewLayout(layout: PreviewLayout) {
  const serialized = JSON.stringify(layout);
  window.localStorage.setItem(PREVIEW_LAYOUT_KEY, serialized);
  window.localStorage.setItem(LEGACY_PREVIEW_LAYOUT_KEY, serialized);
}

export function readChatWallpaper(): ChatWallpaper {
  try {
    const primaryRaw = window.localStorage.getItem(CHAT_WALLPAPER_STORAGE_KEY);
    const raw = primaryRaw ?? window.localStorage.getItem(LEGACY_CHAT_WALLPAPER_STORAGE_KEY);
    if (!raw) return { theme: 'telegram', image: '', accent: '' };
    if (!primaryRaw) {
      window.localStorage.setItem(CHAT_WALLPAPER_STORAGE_KEY, raw);
    }

    const parsed = JSON.parse(raw) as Partial<ChatWallpaper>;
    return {
      theme: parsed.theme === 'custom' ? 'custom' : parsed.theme === 'graphite' ? 'graphite' : 'telegram',
      image: typeof parsed.image === 'string' ? parsed.image : '',
      accent: typeof parsed.accent === 'string' ? parsed.accent : '',
    };
  } catch {
    return { theme: 'telegram', image: '', accent: '' };
  }
}
