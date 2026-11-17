import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'web',
  plugins: [react()],
  base: './',
  build: { outDir: '../dist', emptyOutDir: true, chunkSizeWarningLimit: 900, rollupOptions: { output: { manualChunks: (id) => (id.includes('node_modules/three') ? 'three' : id.includes('node_modules/react') ? 'react' : undefined) } } },
});
