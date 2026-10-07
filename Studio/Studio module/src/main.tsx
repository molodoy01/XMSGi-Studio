import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { LocaleProvider } from '@/lib/i18n';
import App from './App';
import './index.css';
import './styles/globals.css';
import './styles/tokens.css';
import './styles/layout.css';
import './styles/messages.css';
import './styles/overlays.css';

if ('scrollRestoration' in window.history) {
  window.history.scrollRestoration = 'manual';
}
window.scrollTo(0, 0);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LocaleProvider>
      <App />
    </LocaleProvider>
  </StrictMode>,
);
