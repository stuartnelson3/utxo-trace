import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => ({
  test: {
    environment: 'node',
  },
  plugins: [react()],
  // Production builds are served from /utxo-trace/ on the blog.
  // Dev server stays at root so localhost:5173 works without changes.
  base: command === 'build' ? '/utxo-trace/' : '/',
  server: {
    port: 5173,
    strictPort: true,
  },
}));
