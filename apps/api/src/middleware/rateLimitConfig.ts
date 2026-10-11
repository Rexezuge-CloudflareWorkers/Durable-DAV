import type { Hono } from 'hono';
import { RESERVED_NAMESPACE_NAMES } from '@durable-dav/shared';
import { rateLimit } from '@rexezuge/http';
import type { RateLimitHandler } from '@rexezuge/http';

interface RateLimitDef {
  path: string;
  windowMs: number;
  max: number;
  keyPrefix: string;
  /**
   * Optional narrowing predicate. Required wherever a Hono pattern would
   * otherwise match a path owned by an earlier bucket: `/:owner/:volume/*` is
   * two-or-more labels and so also matches `/user/volumes`, which would charge
   * one request to two buckets.
   */
  exclude?: (pathname: string) => boolean;
}

/**
First path segment, lowercased, without the leading slash.
*/
function firstSegment(pathname: string): string {
  const rest = pathname.replace(/^\/+/, '');
  const slash = rest.indexOf('/');
  return (slash === -1 ? rest : rest.slice(0, slash)).toLowerCase();
}

/**
 * Table-driven rate-limit registry.
 *
 * All buckets stay per-isolate token buckets; cron/DOs remain the
 * cross-isolate backstop. Edit this table — not the worker — to tune limits.
 *
 * Two Hono matching facts drive the patterns below, both verified against the
 * pinned Hono version rather than assumed:
 *
 * - A trailing `/*` **also matches the bare path** (`/user/volumes/*` matches
 *   `/user/volumes`). Registering a root pattern *and* its sub-tree pattern
 *   therefore runs the same middleware twice per request and silently halves
 *   every effective limit. One pattern per bucket.
 * - `:param*` does **not** span `/`. `/:owner/:volume*` matches `/alice/photos`
 *   but not `/alice/photos/dir/f.txt`, so it left every real file operation
 *   unlimited. Sub-trees need an explicit `/*`.
 */
const RATE_LIMIT_DEFS: readonly RateLimitDef[] = [
  { path: '/user/volumes/*', windowMs: 60_000, max: 60, keyPrefix: 'volumes' },
  { path: '/user/me/username', windowMs: 60_000, max: 10, keyPrefix: 'username-rename' },
  { path: '/user/me', windowMs: 60_000, max: 120, keyPrefix: 'user-me' },
  { path: '/users/*', windowMs: 60_000, max: 120, keyPrefix: 'public-users' },
  {
    path: '/:owner/:volume/*',
    windowMs: 60_000,
    max: 600,
    keyPrefix: 'webdav',
    // `user` is a reserved namespace name, so `/user/volumes/...` is an API
    // path, never a volume. Without this the WebDAV bucket double-charged it.
    exclude: (pathname) => RESERVED_NAMESPACE_NAMES.has(firstSegment(pathname)),
  },
];

function registerRateLimits(app: Hono<{ Bindings: Env; Variables: { AuthenticatedUserEmailAddress: string; AuthenticatedUserId?: string } }>): void {
  for (const def of RATE_LIMIT_DEFS) {
    app.use(def.path, async (c, next) => {
      return def.exclude?.(new URL(c.req.url).pathname) ? next() : limiterFor(def)(c, next);
    });
  }
}

/**
 * The live limiter per bucket, created lazily and shared isolate-wide.
 *
 * The kit's limiter holds its buckets in a closure with no reset handle —
 * which is the right shape for production (one app per isolate, so one
 * limiter per bucket per isolate) but leaves the suites with no isolation:
 * `registerRateLimits` runs once per worker while a test file makes hundreds
 * of requests, so the 60/min `volumes` bucket trips mid-file for reasons that
 * have nothing to do with what is under test. Clearing this map drops every
 * bucket without touching the kit's fixed internals (per-request cap,
 * deferred sweep, `Retry-After`).
 */
const liveLimiters = new Map<string, RateLimitHandler>();

function limiterFor(def: RateLimitDef): RateLimitHandler {
  const existing = liveLimiters.get(def.keyPrefix);
  if (existing) return existing;
  const created = rateLimit({ windowMs: def.windowMs, max: def.max, keyPrefix: def.keyPrefix });
  liveLimiters.set(def.keyPrefix, created);
  return created;
}

function resetRateLimitForTests(): void {
  liveLimiters.clear();
}

export { RATE_LIMIT_DEFS, registerRateLimits, resetRateLimitForTests };
export type { RateLimitDef };
