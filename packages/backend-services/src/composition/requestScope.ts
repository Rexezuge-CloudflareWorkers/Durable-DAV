import { Container, memoizeAsync } from '@duradav/backend-runtime/di';
import { KvCache } from '@duradav/backend-runtime/kv';
import type { KvNamespaceLike } from '@duradav/backend-runtime/kv';
import { Tokens } from './tokens';
import type { RequestKeys, RequestScopeEnv } from './serviceFactory';
import { bindDaoBindings } from './daoBindings';
import { bindServiceBindings } from './serviceBindings';

// Composition root: builds a per-request child scope wiring DAOs → services.
// Replaces the former scattered `new X(env)` / `new XDAO(env.DB)`
// call sites in apps/api and apps/background. DAO tables live in
// `daoBindings.ts`, service wiring in `serviceBindings.ts` (god-file guard);
// this module only owns scope lifecycle + memoized secrets.
function createRequestScope(env: RequestScopeEnv): Container {
  const scope = new Container();
  scope.bindValue(Tokens.Env, env);
  scope.bindValue(Tokens.Db, env.DB);
  // Single CACHE binding (absent in tests / legacy deploys → fail-soft cache).
  scope.bindValue(Tokens.KvCache, new KvCache((env as { CACHE?: KvNamespaceLike }).CACHE ?? null));

  // Per-feature encryption keys: Secrets Store binding first (production),
  // else a raw `*_ENCRYPTION_KEY` var (integration pool + local dev without a
  // Secrets Store — test-only, never set these vars in production), else
  // throw fail-closed. A declared-but-unreadable binding still throws: the
  // vars fallback never masks a broken production binding.
  const resolveKey = (
    binding: { get(): Promise<string> } | undefined,
    rawVar: string | undefined,
    bindingName: string,
    varName: string,
  ): (() => Promise<string>) =>
    memoizeAsync(async () => {
      if (binding) return binding.get();
      if (rawVar) return rawVar;
      throw new Error(`${bindingName} is not configured for this scope (set ${varName} for tests).`);
    });
  const webhookKey = resolveKey(env.WEBHOOK_ENCRYPTION_KEY_SECRET, env.WEBHOOK_ENCRYPTION_KEY, 'WEBHOOK_ENCRYPTION_KEY_SECRET', 'WEBHOOK_ENCRYPTION_KEY');
  const mirrorKey = resolveKey(env.MIRROR_ENCRYPTION_KEY_SECRET, env.MIRROR_ENCRYPTION_KEY, 'MIRROR_ENCRYPTION_KEY_SECRET', 'MIRROR_ENCRYPTION_KEY');
  const importKey = resolveKey(env.IMPORT_ENCRYPTION_KEY_SECRET, env.IMPORT_ENCRYPTION_KEY, 'IMPORT_ENCRYPTION_KEY_SECRET', 'IMPORT_ENCRYPTION_KEY');
  // Per-feature thunks: resolving one key never fetches the other two.
  scope.bindValue(Tokens.WebhookKey, webhookKey);
  scope.bindValue(Tokens.MirrorKey, mirrorKey);
  scope.bindValue(Tokens.ImportKey, importKey);
  const keys = memoizeAsync(async (): Promise<RequestKeys> => ({
    webhookKey: await webhookKey(),
    mirrorKey: await mirrorKey(),
    importKey: await importKey(),
  }));
  scope.bindValue(Tokens.Keys, keys);

  bindDaoBindings(scope, env);
  bindServiceBindings(scope, env);

  return scope;
}

export { createRequestScope };
export type { RequestKeys, RequestScopeEnv } from './serviceFactory';
