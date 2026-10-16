import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineWebViteConfig } from '@rexezuge/tooling/vite';

// A tool config *is* an executable module: the plugins are constructed and the
// proxy is read at import time, which is the only time there is.
export default defineWebViteConfig({
  plugins: [react(), tailwindcss()],
  proxy: {
    '/user': { target: 'http://localhost:8787', changeOrigin: true },
    '/users': { target: 'http://localhost:8787', changeOrigin: true },
    '/health': { target: 'http://localhost:8787', changeOrigin: true },
  },
  // The one repo-specific piece: where the built shell is embedded for the API
  // worker to serve. `root` is pinned to this config's own directory rather than
  // the build's working directory, so `pnpm run build`, `pnpm --filter
  // @durable-dav/web build` and a bare `vite build` all embed into the same
  // place; both `path` and the default `dist/index.html` resolve against it.
  spaShell: { path: '../../apps/api/src/generated/spa-shell.ts', root: new URL('.', import.meta.url) },
});
