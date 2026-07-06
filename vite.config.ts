import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import pkg from './package.json';

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
    // config.ts's Intl.DateTimeFormat instances are constructed once at
    // module-load time and keep whatever timezone was active at that
    // instant — a process.env.TZ assignment from inside a test file runs
    // too late to affect formatters config.ts already built during import.
    // Setting it here applies before the test process's modules even start
    // executing, so every formatter is built under it from the start —
    // needed so snapshot tests are deterministic regardless of which
    // machine or CI runner executes them.
    env: {
      TZ: 'UTC',
    },
  },
  plugins: [react()],
  // Production builds are served from /utxo-trace/ on the blog.
  // Dev server stays at root so localhost:5173 works without changes.
  base: command === 'build' ? '/utxo-trace/' : '/',
  server: {
    port: 5173,
    strictPort: true,
  },
  // CI (deploy.yml) sets VITE_COMMIT_SHA to the release's git sha;
  // falls back to "dev" for local builds until then.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __COMMIT__: JSON.stringify(process.env.VITE_COMMIT_SHA ?? 'dev'),
  },
}));
