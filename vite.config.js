import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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