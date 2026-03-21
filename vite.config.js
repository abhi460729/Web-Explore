import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: process.env.VITE_API_BASE_URL || 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      // Do not externalize lodash, let Vite bundle it
      external: [], // Empty array to avoid externalizing dependencies unless explicitly needed
    },
  },
  resolve: {
    alias: {
      'lodash/debounce': 'lodash/debounce.js', // Ensure correct resolution
    },
  },
});