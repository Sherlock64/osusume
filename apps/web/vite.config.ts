import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defaultClientConditions, defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    // Resolve @osusume/shared to its source.
    conditions: ['@osusume/source', ...defaultClientConditions],
  },
  server: {
    // Same origin as production: the browser only ever talks to one host.
    proxy: { '/api': 'http://localhost:3000' },
  },
});
