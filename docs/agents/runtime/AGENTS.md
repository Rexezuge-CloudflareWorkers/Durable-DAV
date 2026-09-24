# Edge-Git — Runtime And Configuration

Scope: Wrangler bindings, build output, env vars. Parent index: `../../../AGENTS.md`.

- Root `@duradav/monorepo`, pnpm workspaces (`apps/*`, `packages/*`).
- `apps/web/vite.config.ts` proxies `/user` + `/repos` → `http://localhost:8787` in dev; `closeBundle` embeds `dist/index.html` into `apps/api/src/generated/spa-shell.ts` (`SPA_HTML`) on build.
- `apps/api/wrangler.template.jsonc` is the config template — copy to `wrangler.jsonc` per deployer; no committed `wrangler.jsonc`. Local `wrangler.jsonc` uses `DEV_AUTH_EMAIL=test@example.com`.
- The Worker always serves the SPA from `/`, `/new`, `/settings`, `/:owner/:repo`, `/user/*` catch-all in `DuraDavWorker` (non-matching paths return `404`) so Smart HTTP routes are never intercepted.
- Bindings: D1 `DB`, KV `CACHE` (single namespace, domain-prefixed keys via `KvCache` in `@duradav/backend-runtime/kv`: `jwks`/`oauth2`/`code`/`searchCursor`/`refs`/`ratelimit`), DOs `REPO` (`RepoWorker`, `getByName(canonicalDoKey)` lowercased `owner/name` via `repoDoKeyForFullName`, device size from `DO_DEVICE_BYTES`, `/repo` bare) / `CRON_TASKS` (`CronTasksWorker`, `idFromName('global')`), cron `*/10 * * * *`; no R2/Queues/AI bindings.

## Required vars (no defaults)

`POLICY_AUD`, `TEAM_DOMAIN` — Cloudflare Access JWT verification (`AccessAuthService`). No default; requests fail without them (except `DEMO_MODE`/`DEV_AUTH_EMAIL` bypass).

## Local-only (no default, not in `ConfigurationDefaults.ts`)

`DEV_AUTH_EMAIL` — bypasses Cloudflare Access locally. `DEMO_MODE` — returns `DEMO_USER_EMAIL` without verification.

## Optional vars (defaults in `ConfigurationDefaults.ts`)

| Group     | Vars (default)                                                                                                                                                                                                      |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App       | `DEBUG_MODE` (`false`), `SITE_URL` (`""`)                                                                                                                                                                           |
| Limits    | `MAX_REPOS_PER_USER` (`100`), `MAX_VOLUMES_PER_USER` (`100`), `MAX_TOKENS_PER_USER` (`5`), `MAX_TOKEN_EXPIRY_DAYS` (`90`), `MAX_TOKEN_VOLUME_GRANTS` (`100`, legacy `MAX_TOKEN_REPO_GRANTS` fallback), `DO_DEVICE_BYTES` (`5368709120`) |
| Git       | `MAX_PACK_OBJECTS` (`10000`), `GIT_CACHE_TTL_SECONDS` (`3600`), `MAX_FETCH_WANTS` (`64`), `MAX_FETCH_HAVES` (`512`), `MAX_PUSH_COMMANDS` (`100`), `MAX_PACK_BYTES` (`52428800`), `MAX_FETCH_BODY_BYTES` (`1048576`) |
| Retention | `BACKGROUND_TASK_RUN_RETENTION_DAYS` (`30`), `AUDIT_LOG_RETENTION_DAYS` (`90`)                                                                                                                                      |

Add new env vars in `ConfigurationDefaults.ts` (+ `ConfigurationManager` getter + `AppConfiguration` method), not inline.

## Dependency injection (`packages/backend-runtime/src/di/` + `config/`)

- `AppConfiguration` — injectable instance view over env parsing (thin facade over `RepoLimits`/`GitLimits`/`WebhookLimits`/`RealtimeLimits`/`ContentLimits`/`RetentionLimits`/`AuthConfig` sections, one method per setting, incl. `getMaxFileBytes`); `ConfigurationManager` statics remain as thin facade. Prefer injecting `AppConfiguration` in new services; mock via constructor deps. New settings go in the owning section (+ `ConfigurationDefaults` default + `ConfigurationManager` getter), not inline.
- `Container` — minimal Factory + Singleton DI (`bind`/`bindValue`/`get`/`resolve`/`createChild`). `createRequestScope(env)` in `backend-services/composition` is the standard composition root (table-driven lazy DAO wiring + single `PermissionService` binding; `scope.get(Tokens.X)`); the old `*Factory` shims were removed. `scopeMiddleware` installs a single scope per request (`getScope(c)`; `getRequestScope` fallback creates a fresh scope for helpers/tests).
- `createServiceContext(env, overrides?)` — single request-scoped `{ env, logger, clock }`; prefer extending `ServiceContext` over new `*Env` interfaces; never reintroduce `as` env casts.
- Helpers: `memoizeAsync` (composition-root memoization; rejections are never cached so transient Secrets Store/D1 failures retry), `NullLogger`/`FixedClock` (test doubles), `setRequestScope/getRequestScope/getServiceContext` (request plumbing), `asScopedContext` (single audited Hono→`ScopedContext` adapter — call sites must use it instead of `c as never`).
