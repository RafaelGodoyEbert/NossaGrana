import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  base: '/NossaGrana/',
  build: {
    outDir: 'dist',
    emptyOutDir: true
  },
  server: {
    port: 3000,
    open: true
  }
});
