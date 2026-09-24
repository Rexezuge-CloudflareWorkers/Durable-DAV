import type { D1Queryable } from '@duradav/backend-data/utils';

// Minimal structural env for scope creation. Secrets are resolved lazily and
// memoized — requests that never touch encrypted state pay no Secrets Store
// round-trip. One master key per feature (webhook/mirror/import) so a single
// key compromise or rotation only affects one envelope type.
//
// NOTE: no `[key: string]: unknown` index signature on purpose — interfaces
// (e.g. endpoint `*Env`) do not carry an implicit index signature, so a target
// with one would reject every `createRequestScope(env)` call site. Extra
// bindings are still assignable structurally; services receive `env as never`.
interface SecretsStoreSecret {
  get(): Promise<string>;
}

interface RequestScopeEnv {
  DB: D1Queryable;
  WEBHOOK_ENCRYPTION_KEY_SECRET?: SecretsStoreSecret;
  MIRROR_ENCRYPTION_KEY_SECRET?: SecretsStoreSecret;
  IMPORT_ENCRYPTION_KEY_SECRET?: SecretsStoreSecret;
  // Raw-key escape hatch for the integration pool / local dev without Secrets
  // Store. Test-only: never set these vars in production (the template does
  // not declare them; production always uses the bindings above).
  WEBHOOK_ENCRYPTION_KEY?: string;
  MIRROR_ENCRYPTION_KEY?: string;
  IMPORT_ENCRYPTION_KEY?: string;
}

interface RequestKeys {
  webhookKey: string;
  mirrorKey: string;
  importKey: string;
}

// Single audited unsafe-cast location for service envs. Services declare
// narrow `*Env` interfaces (e.g. `{ DB, MAX_* }`); the composition root holds
// the minimal `RequestScopeEnv`. Centralizing `as never` here keeps ~30 call
// sites readable and makes future `ServiceEnv` migration a one-line change.
function asServiceEnv(env: RequestScopeEnv): never {
  return env as never;
}

// Generic service factory (AWS `createService` pattern). Kills `new X(env)`
// boilerplate repetition and keeps ctor-injection visible in one place.
function createService<T, D>(Ctor: new (env: never, deps?: D) => T, env: RequestScopeEnv, deps?: D): T {
  return new Ctor(asServiceEnv(env), deps);
}

export { asServiceEnv, createService };
export type { RequestKeys, RequestScopeEnv };
