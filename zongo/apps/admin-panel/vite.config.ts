import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/backoffice/',
  server: {
    port: 5173,
    proxy: {
      '/admin': 'http://localhost:3002',
      '/health': 'http://localhost:3002',
    },
  },
});
