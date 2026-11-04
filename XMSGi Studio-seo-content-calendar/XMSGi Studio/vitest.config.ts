import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const sharedRoot = fileURLToPath(new URL('./packages/shared', import.meta.url));
const appSrcRoot = fileURLToPath(new URL('./src', import.meta.url));
const studioSrcRoot = fileURLToPath(new URL('./src/studio', import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^@\//, replacement: `${appSrcRoot}/` },
      { find: /^@studio\//, replacement: `${studioSrcRoot}/` },
      { find: /^@shared\//, replacement: `${sharedRoot}/` },
    ],
    dedupe: ['react', 'react-dom', 'lucide-react'],
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    passWithNoTests: true,
  },
});
