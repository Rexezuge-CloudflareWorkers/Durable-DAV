import type { Container } from './Container';

/**
 * Single-scope-per-request helper.
 * Middleware creates one `Container` per request and stores it on the Hono
 * context; handlers resolve via `getRequestScope(c)` instead of calling
 * `createRequestScope(c.env)` per handler (which minted N scopes per request
 * and broke singleton memoization).
 */
interface ScopedContext {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  readonly env: unknown;
}

const SCOPE_KEY = '__davScope';

function setRequestScope(c: ScopedContext, scope: Container): void {
  c.set(SCOPE_KEY, scope);
}

/**
 * Structural adapter for Hono contexts.
 * Hono's `Context.get` overloads are not assignable to `ScopedContext['get']`,
 * so call sites used `c as never`. Centralize that single unsafe cast here —
 * one audited location instead of many scattered ones.
 */
function asScopedContext(c: { get(key: string): unknown; set?(key: string, value: unknown): void; readonly env: unknown }): ScopedContext {
  return c as unknown as ScopedContext;
}

function getRequestScope(c: ScopedContext): Container {
  const scope = c.get(SCOPE_KEY) as Container | undefined;
  if (!scope) throw new Error('Request scope is not set. Register scopeMiddleware before routes.');
  return scope;
}

export { setRequestScope, getRequestScope, asScopedContext };
export type { ScopedContext };
