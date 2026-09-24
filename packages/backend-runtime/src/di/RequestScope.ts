import type { Container } from './Container';
import { createServiceContext } from './ServiceContext';
import type { ServiceContext, ServiceContextOverrides } from './ServiceContext';
import type { ServiceEnv } from '../config/ServiceEnv';

/**
 * Memoized async factory helper for the composition root.
 * Replaces hand-rolled `let pending; return () => (pending ??= fn())`
 * closures scattered across `requestScope.ts`.
 *
 * Rejections are never cached: a transient Secrets Store / D1 failure must
 * not poison the whole request scope — the next call retries.
 */
function memoizeAsync<T>(fn: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () => {
    if (!pending) {
      pending = fn();
      pending.catch(() => {
        pending = undefined;
      });
    }
    return pending;
  };
}

/**
 * Single-scope-per-request helper (Otter pattern).
 * Middleware creates one `Container` + one `ServiceContext` per request and
 * stores them on the Hono context; handlers resolve via `getScope(c)` instead
 * of calling `createRequestScope(c.env)` per handler (which minted N scopes
 * per request and broke singleton memoization).
 */
interface ScopedContext {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  readonly env: ServiceEnv;
}

const SCOPE_KEY = '__edgeGitScope';
const SERVICE_CONTEXT_KEY = '__edgeGitServiceContext';

function setRequestScope(c: ScopedContext, scope: Container, ctx: ServiceContext): void {
  c.set(SCOPE_KEY, scope);
  c.set(SERVICE_CONTEXT_KEY, ctx);
}

/**
 * Structural adapter for Hono contexts.
 * Hono's `Context.get` overloads are not assignable to
 * `ScopedContext['get']`, so call sites used `c as never`. Centralize that
 * single unsafe cast here — one audited location instead of ~30 scattered
 * ones (readability/maintainability; runtime behavior identical).
 */
function asScopedContext(c: { get(key: string): unknown; set?(key: string, value: unknown): void; readonly env: unknown }): ScopedContext {
  return c as unknown as ScopedContext;
}

function getRequestScope(c: ScopedContext): Container {
  const scope = c.get(SCOPE_KEY) as Container | undefined;
  if (!scope) throw new Error('Request scope is not set. Register scopeMiddleware before routes.');
  return scope;
}

function getServiceContext(c: ScopedContext): ServiceContext {
  const ctx = c.get(SERVICE_CONTEXT_KEY) as ServiceContext | undefined;
  if (!ctx) throw new Error('Service context is not set. Register scopeMiddleware before routes.');
  return ctx;
}

function createRequestContext(env: ServiceEnv, overrides: ServiceContextOverrides = {}): ServiceContext {
  return createServiceContext(env, overrides);
}

export {
  memoizeAsync,
  setRequestScope,
  getRequestScope,
  getServiceContext,
  createRequestContext,
  asScopedContext,
  SCOPE_KEY,
  SERVICE_CONTEXT_KEY,
};
export type { ScopedContext };
