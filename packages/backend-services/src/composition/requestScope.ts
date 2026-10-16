import { Container } from '@rexezuge/runtime';
import { KvCache, setLogLevel } from '@rexezuge/runtime';
import type { KvNamespaceLike } from '@rexezuge/runtime';
import { Tokens } from './tokens';
import type { RequestScopeEnv } from './serviceFactory';
import { bindDaoBindings } from './daoBindings';
import { bindServiceBindings } from './serviceBindings';

// Composition root: builds a per-request child scope wiring DAOs → services.
// Replaces the former scattered `new X(env)` call sites in apps/api and
// apps/background. DAO tables live in `daoBindings.ts`, service wiring in
// `serviceBindings.ts`; this module only owns scope lifecycle.
function createRequestScope(env: RequestScopeEnv): Container {
  // The kit's logger resolves its level per emit, but a module-scope logger is
  // constructed when the isolate starts, long before any request exists to hand
  // it an `env` — `setLogLevel` is the seam for exactly that, and this function
  // is the one place every request and every scheduled task passes through.
  // Without the call, `LOG_LEVEL` resolves to `info` and the knob below is
  // inert. An absent or unrecognized value clears the installation rather than
  // throwing, so a typo costs a level, never a request.
  setLogLevel((env as { LOG_LEVEL?: string }).LOG_LEVEL);

  const scope = new Container();
  scope.bindValue(Tokens.Env, env);
  scope.bindValue(Tokens.Db, env.DB);
  // Single CACHE binding (absent in tests → fail-soft cache).
  scope.bindValue(Tokens.KvCache, new KvCache((env as { CACHE?: KvNamespaceLike }).CACHE ?? null));

  bindDaoBindings(scope, env);
  bindServiceBindings(scope, env);

  return scope;
}

export { createRequestScope };
export type { RequestScopeEnv } from './serviceFactory';
