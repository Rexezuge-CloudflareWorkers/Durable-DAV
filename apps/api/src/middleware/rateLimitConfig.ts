import type { Hono } from 'hono';
import { rateLimit } from './rateLimit';

interface RateLimitDef {
  path: string;
  windowMs: number;
  max: number;
  keyPrefix: string;
}

/**
 * Table-driven rate-limit registry.
 *
 * All buckets stay per-isolate token buckets; cron/DOs remain the
 * cross-isolate backstop. Edit this table — not the worker — to tune limits.
 */
const RATE_LIMIT_DEFS: readonly RateLimitDef[] = [
  { path: '/user/tokens*', windowMs: 60_000, max: 30, keyPrefix: 'tokens' },
  { path: '/user/volumes*', windowMs: 60_000, max: 60, keyPrefix: 'volumes' },
  { path: '/user/me', windowMs: 60_000, max: 120, keyPrefix: 'user-me' },
  { path: '/users/*', windowMs: 60_000, max: 120, keyPrefix: 'public-users' },
  { path: '/:owner/:volume*', windowMs: 60_000, max: 600, keyPrefix: 'webdav' },
];

function registerRateLimits(app: Hono<{ Bindings: Env; Variables: { AuthenticatedUserEmailAddress: string } }>): void {
  for (const def of RATE_LIMIT_DEFS) {
    app.use(def.path, rateLimit({ windowMs: def.windowMs, max: def.max, keyPrefix: def.keyPrefix }));
  }
}

export { RATE_LIMIT_DEFS, registerRateLimits };
export type { RateLimitDef };
