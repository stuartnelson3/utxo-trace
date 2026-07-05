import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Self-hosters who want a remote (non-localhost) custom Esplora endpoint set
// VITE_EXTRA_CONNECT_SRC (e.g. "https://esplora.example.com") to extend the
// CSP's connect-src at build time — Vite substitutes %VITE_EXTRA_CONNECT_SRC%
// in index.html natively (any %VITE_*% var is replaced from the build env).
// Empty by default: the hosted build never ships connect-src *, and
// localhost/127.0.0.1 (the real self-hosted-node use case) are always
// allowed regardless of this var.
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
