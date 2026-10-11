import { Container } from '@rexezuge/runtime';
import { KvCache } from '@rexezuge/runtime';
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
