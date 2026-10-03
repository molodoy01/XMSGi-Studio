import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { LocaleProvider } from '@/lib/i18n';

const DevPreviewHarness = import.meta.env.DEV
  ? lazy(() => import('./DevPreviewHarness.tsx'))
  : null;
const useDevPreview = import.meta.env.DEV
  && new URLSearchParams(window.location.search).get('devPreview') === '1';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LocaleProvider>
      {useDevPreview && DevPreviewHarness
        ? <Suspense fallback={null}><DevPreviewHarness /></Suspense>
        : <App />}
    </LocaleProvider>
  </StrictMode>
);
