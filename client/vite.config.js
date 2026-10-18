import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The SPA talks to the API through /api. In development Vite proxies it to the
// Express server so cookies stay same-origin (no secrets in the frontend).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': { target: process.env.VITE_API_PROXY || 'http://localhost:4000', changeOrigin: false } },
  },
  test: { environment: 'node' },
});
