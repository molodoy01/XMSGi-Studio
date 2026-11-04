import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const sharedRoot = fileURLToPath(new URL('./packages/shared', import.meta.url));
const appSrcRoot = fileURLToPath(new URL('./src', import.meta.url));
const studioSrcRoot = fileURLToPath(new URL('./src/studio', import.meta.url));
const lucideReactRoot = fileURLToPath(new URL('./node_modules/lucide-react', import.meta.url));

function sharedTelegramTextBrowserPlugin() {
  return {
    name: 'shared-telegram-text-browser',
    transform(code, id) {
      if (!id.replace(/\\/g, '/').endsWith('/packages/shared/telegramText.cjs')) return null;
      return code.replace(
        'module.exports = { markdownToRichText, normalizeTelegramMessage, normalizeTelegramText };',
        'export { markdownToRichText, normalizeTelegramMessage, normalizeTelegramText };',
      );
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), sharedTelegramTextBrowserPlugin()],
  resolve: {
    alias: [
      { find: /^@\//, replacement: `${appSrcRoot}/` },
      { find: /^@studio\//, replacement: `${studioSrcRoot}/` },
      { find: /^@shared\//, replacement: `${sharedRoot}/` },
      { find: /^lucide-react$/, replacement: lucideReactRoot },
    ],
    dedupe: ['react', 'react-dom', 'lucide-react'],
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'ui-vendor': ['lucide-react'],
          'telegram-vendor': ['teleproto'],
        },
      },
    },
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
});
