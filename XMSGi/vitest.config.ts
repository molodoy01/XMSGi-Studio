import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

const externalStudioEntry = fileURLToPath(
  new URL('../Studio/XMSGi/src/App.tsx', import.meta.url)
);
const studioEntry = existsSync(externalStudioEntry)
  ? externalStudioEntry
  : fileURLToPath(new URL('./src/workspace/StudioFallback.tsx', import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      $studio: studioEntry,
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    passWithNoTests: true,
  },
});
