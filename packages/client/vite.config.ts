import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@collab/protocol': path.resolve(__dirname, '../protocol/src/index.ts'),
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/healthz': 'http://localhost:4000',
      '/metrics': 'http://localhost:4000',
      '/': {
        target: 'ws://localhost:4000',
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
});
