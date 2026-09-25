import type { D1Queryable } from '@durable-dav/backend-data/utils';

// Minimal structural env for scope creation.
interface RequestScopeEnv {
  DB: D1Queryable;
}

// Single audited unsafe-cast location for service envs. Services declare
// narrow `*Env` interfaces (e.g. `{ DB, MAX_* }`); the composition root holds
// the minimal `RequestScopeEnv`. Centralizing `as never` here keeps call
// sites readable.
function asServiceEnv(env: RequestScopeEnv): never {
  return env as never;
}

// Generic service factory. Kills `new X(env)` boilerplate repetition and
// keeps ctor-injection visible in one place.
function createService<T, D>(Ctor: new (env: never, deps?: D) => T, env: RequestScopeEnv, deps?: D): T {
  return new Ctor(asServiceEnv(env), deps);
}

export { asServiceEnv, createService };
export type { RequestScopeEnv };
