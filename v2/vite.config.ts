import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Command Center v2's page: built to dist/v2, served by v2/server/main.ts (pnpm v2).
export default defineConfig({
  root: 'v2/web',
  plugins: [react()],
  build: { outDir: '../../dist/v2', emptyOutDir: true },
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: true,
    proxy: { '/api': { target: 'http://127.0.0.1:7878', changeOrigin: false } },
  },
});
