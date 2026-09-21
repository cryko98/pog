import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // the world generator in ../shared is imported by both the client and the API
    fs: { allow: ['..'] },
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
  },
});
