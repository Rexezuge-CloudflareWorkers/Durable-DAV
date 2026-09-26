import type { Context, Hono } from 'hono';

/**
 * The single Hono context type for this worker.
 *
 * Why one declaration: the same type was previously re-declared under eight
 * different names across the route files (`HonoContext`, `RequestContext` ×2,
 * `App` ×3, `CredentialApp`, `UserApp`, `AppRouter`). Eight spellings of one
 * type is what forced the 25 `as never` casts at the `BaseRoute.getScope` and
 * `davAuthForVolume` call sites — a hand-rolled partial "DavContext" interface
 * that omitted `get`/`set`/`arrayBuffer` could not satisfy them.
 */
export type ApiEnv = {
  Bindings: Env;
  Variables: { AuthenticatedUserEmailAddress: string };
};

export type ApiContext = Context<ApiEnv>;

export type ApiApp = Hono<ApiEnv>;
