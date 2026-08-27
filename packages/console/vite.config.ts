import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: process.env.VITE_ORCHESTRATOR_URL ?? 'http://127.0.0.1:4000', changeOrigin: true },
      '/bundles': { target: process.env.VITE_COMPILE_URL ?? 'http://127.0.0.1:4100', changeOrigin: true },
    },
  },
});