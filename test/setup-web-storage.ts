/**
 * Node 24 exposes an experimental global `localStorage` getter that returns
 * `undefined` without `--localstorage-file`. Vitest's jsdom environment skips
 * copying window properties that already exist on `globalThis`, so the test
 * global ends up as Node's getter rather than jsdom's own `Storage` — and
 * `global.window === global`, so even `window.localStorage` is broken.
 *
 * Restore the live jsdom instance's storage before any web test runs, so
 * application code (`globalThis.localStorage`) and the tests share the same
 * per-test store.
 */
const jsdomWindow = (
  globalThis as typeof globalThis & {
    jsdom?: { window: { localStorage: Storage; sessionStorage: Storage } };
  }
).jsdom?.window;

if (jsdomWindow) {
  for (const key of ['localStorage', 'sessionStorage'] as const) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      get: () => jsdomWindow[key],
    });
  }
}
