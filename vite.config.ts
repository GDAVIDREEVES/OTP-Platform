import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
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
