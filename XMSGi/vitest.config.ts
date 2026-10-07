import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const studioEntry = fileURLToPath(new URL('../Studio/Studio module/src/App.tsx', import.meta.url));
const sharedRoot = fileURLToPath(new URL('../packages/shared', import.meta.url));
const appSrcRoot = fileURLToPath(new URL('./src', import.meta.url));
const studioSrcRoot = fileURLToPath(new URL('../Studio/Studio module/src', import.meta.url));

function resolveProjectFile(baseRoot: string, specifier: string) {
  const trimmed = specifier.replace(/^@shared\/?/, '').replace(/^@\/?/, '');
  const candidates = [
    path.resolve(baseRoot, `${trimmed}.ts`),
    path.resolve(baseRoot, `${trimmed}.tsx`),
    path.resolve(baseRoot, `${trimmed}.js`),
    path.resolve(baseRoot, `${trimmed}.jsx`),
    path.resolve(baseRoot, trimmed, 'index.ts'),
    path.resolve(baseRoot, trimmed, 'index.tsx'),
    path.resolve(baseRoot, trimmed, 'index.js'),
    path.resolve(baseRoot, trimmed, 'index.jsx'),
    path.resolve(baseRoot, trimmed),
  ];

  const existing = candidates.find((candidate) => fs.existsSync(candidate));
  return existing ?? candidates[0];
}

function studioAwareAliasPlugin() {
  return {
    name: 'studio-aware-alias',
    enforce: 'pre',
    resolveId(id, importer) {
      if (id === '$studio') return studioEntry;

      if (id.startsWith('@/')) {
        const root = importer && importer.replace(/\\/g, '/').includes('/Studio/Studio module/src/') ? studioSrcRoot : appSrcRoot;
        return resolveProjectFile(root, id);
      }

      if (id.startsWith('@shared/')) {
        return resolveProjectFile(sharedRoot, id);
      }

      return null;
    },
  };
}

export default defineConfig({
  plugins: [react(), studioAwareAliasPlugin()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    passWithNoTests: true,
  },
});
