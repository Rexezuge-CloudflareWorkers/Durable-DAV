import type { Next } from 'hono';
import { setRequestScope, asScopedContext } from '@durable-dav/backend-runtime/di';
import { createRequestScope } from '@durable-dav/backend-services/composition';
import type { ApiContext } from '@/types/ApiContext';

/**
 * Single-scope-per-request middleware (composition-root pattern).
 * Creates one `Container` per request and stores it on the Hono context.
 * Handlers resolve via `getRequestScope(c)` instead of calling
 * `createRequestScope(c.env)` per handler, which minted N scopes per request
 * and defeated singleton memoization.
 */
async function scopeMiddleware(c: ApiContext, next: Next): Promise<void> {
  setRequestScope(asScopedContext(c), createRequestScope(c.env));
  await next();
}

export { scopeMiddleware };
