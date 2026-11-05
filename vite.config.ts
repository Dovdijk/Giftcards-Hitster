import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import legacy from '@vitejs/plugin-legacy';

export default defineConfig({
  root: 'client',
  plugins: [
    react(),
    // older browsers (smart TVs often run a Chrome 70-95 engine) get a separate compatible build
    legacy({ targets: ['chrome >= 64', 'safari >= 12', 'samsung >= 9', 'firefox >= 68'], modernPolyfills: true }),
  ],
  build: { outDir: '../dist/client', emptyOutDir: true },
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': 'http://localhost:3000',
      '/socket.io': { target: 'http://localhost:3000', ws: true },
    },
  },
});
