import { defineConfig } from 'vite';
export default defineConfig({base: './', optimizeDeps: {entries:['index.html']}, server: {host: '127.0.0.1', port: 41739, strictPort: true}, build: {outDir: 'dist', sourcemap: false}});
