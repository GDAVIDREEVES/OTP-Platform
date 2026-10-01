import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// https://vitejs.dev/config/
// The browser only ever talks to the Vite origin: `/api/*` is proxied to the
// FastAPI backend, so there is no cross-origin hop (and no CORS dependency on
// whether the user opened `localhost` or `127.0.0.1`). Point VITE_PROXY_TARGET
// elsewhere to develop against a remote backend.
const API_TARGET = process.env.VITE_PROXY_TARGET ?? 'http://127.0.0.1:8000';
const apiProxy = { '/api': { target: API_TARGET, changeOrigin: true } };

export default defineConfig({
  plugins: [react()],
  server: { proxy: apiProxy },
  preview: { proxy: apiProxy },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    // Split heavy vendor libs into their own chunks so they can be cached
    // independently and aren't re-downloaded when the app code changes.
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-mui': [
            '@mui/material',
            '@mui/icons-material',
            '@emotion/react',
            '@emotion/styled',
          ],
          'vendor-charts': ['recharts', 'react-simple-maps'],
        },
      },
    },
    // Lift the per-chunk warning a bit since MUI alone is already ~300KB.
    chunkSizeWarningLimit: 700,
  },
});
