import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // The video encoder library (mediabunny) is lazy-loaded only when exporting a video.
  build: { chunkSizeWarningLimit: 1000 },
});
