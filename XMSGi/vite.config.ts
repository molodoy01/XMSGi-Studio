import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import path from 'node:path';

const xmsgiSource = fileURLToPath(new URL('./src/', import.meta.url));
const externalStudioEntry = fileURLToPath(
  new URL('../Studio/XMSGi/src/App.tsx', import.meta.url)
);
const externalStudioRoot = path.dirname(externalStudioEntry);
const normalizedExternalStudioRoot = externalStudioRoot.replace(/\\/g, '/');
const studioEntry = existsSync(externalStudioEntry)
  ? externalStudioEntry
  : fileURLToPath(new URL('./src/workspace/StudioFallback.tsx', import.meta.url));

function resolveAliasTarget(source: string, candidateRoot: string) {
  const target = path.resolve(candidateRoot, source.replace(/^[/\\]/, ''));
  const withExtensions = [
    target,
    ...['.ts', '.tsx', '.js', '.jsx', '.css', '.json', '.svg']
      .map((extension) => `${target}${extension}`),
  ];

  return withExtensions.find((candidate) => existsSync(candidate)) ?? null;
}

const studioAwareAliasPlugin = {
  name: 'studio-aware-alias',
  enforce: 'pre',
  resolveId(id, importer) {
    if (!id.startsWith('@/')) {
      return null;
    }

    const source = id.replace(/^@\//, '');
    const importerPath = importer || '';
    const normalizedImporterPath = importerPath.replace(/\\/g, '/');
    const baseRoots = normalizedImporterPath.startsWith(normalizedExternalStudioRoot)
      ? [externalStudioRoot, xmsgiSource]
      : [xmsgiSource, externalStudioRoot];

    for (const baseRoot of baseRoots) {
      const resolved = resolveAliasTarget(source, baseRoot);
      if (resolved) {
        return resolved;
      }
    }

    return null;
  },
};

export default defineConfig({
  base: './',
  plugins: [react(), studioAwareAliasPlugin],
  resolve: {
    alias: [
      {
        find: '$studio',
        replacement: studioEntry,
      },
    ],
  },
  build: {
    outDir: 'dist',
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  server: {
    fs: {
      allow: [fileURLToPath(new URL('../../', import.meta.url))],
    },
  },
});
