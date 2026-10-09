import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
export default defineConfig({
    base: './',
    plugins: [react()],
    resolve: {
        alias: [
            { find: '@/lib/i18n', replacement: fileURLToPath(new URL('../../XMSGi Studio/packages/shared/i18n/index.ts', import.meta.url)).replace(/\\/g, '/') },
            { find: '@shared', replacement: fileURLToPath(new URL('../../XMSGi Studio/packages/shared', import.meta.url)).replace(/\\/g, '/') },
            { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
        ],
    },
    test: {
        environment: 'jsdom',
        globals: true,
    },
});
