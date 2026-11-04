import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import './styles/colorThemes.css';
import { LocaleProvider } from '@/lib/i18n';
import { applyColorTheme, readColorTheme } from '@/lib/colorTheme';
import { isDesktopTelegramRuntime } from '@/services/telegramAppService';

if ('scrollRestoration' in window.history) {
  window.history.scrollRestoration = 'manual';
}
document.documentElement.classList.toggle('electron-runtime', isDesktopTelegramRuntime());
applyColorTheme(readColorTheme());
window.scrollTo(0, 0);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LocaleProvider>
      <App />
    </LocaleProvider>
  </StrictMode>
);
