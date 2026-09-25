# Durable-DAV — Runtime And Configuration

Scope: Wrangler bindings, build output, env vars. Parent index: `../../../AGENTS.md`.

- Root `@durable-dav/monorepo`, pnpm workspaces (`apps/*`, `packages/*`).
- `apps/web/vite.config.ts` proxies `/user` → `http://localhost:8787` in dev; `closeBundle` embeds `dist/index.html` into `apps/api/src/generated/spa-shell.ts` (`SPA_HTML`) on build.
- `apps/api/wrangler.template.jsonc` is the config template — copy to `wrangler.jsonc` per deployer; no committed `wrangler.jsonc`. Local `wrangler.jsonc` uses `DEV_AUTH_EMAIL=test@example.com`.
- The Worker serves the SPA from `/`, `/new`, `/settings`, `/:username` plus `/:owner/:volume` (content-negotiated: `Accept: text/html` → shell, else WebDAV DO forward) in `DurableDavWorker`.
- Bindings: D1 `DB`, KV `CACHE` (single namespace, fail-soft via `KvCache`; DAV read paths in `apps/api/src/workers/routes/DavReadCache.ts`: `davProp` PROPFIND 120s + `davFile` small GET 300s + `davMeta` volume list/detail 60s, invalidated on write), DOs `DAV_VOLUME` (`DavVolumeWorker`, `getByName(normalizeVolumeKey)` lowercased `owner/volume`, device size from `DO_DEVICE_BYTES`) / `CRON_TASKS` (`CronTasksWorker`, `idFromName('global')`), cron `*/10 * * * *`; no R2/Queues/AI bindings.

## Required vars (no defaults)

`POLICY_AUD`, `TEAM_DOMAIN` — Cloudflare Access JWT verification (`AccessAuthService`). No default; requests fail without them (except `DEMO_MODE`/`DEV_AUTH_EMAIL` bypass).

## Local-only (no default, not in `ConfigurationDefaults.ts`)

`DEV_AUTH_EMAIL` — bypasses Cloudflare Access locally. `DEMO_MODE` — returns `DEMO_USER_EMAIL` without verification.

## Optional vars (defaults in `ConfigurationDefaults.ts`)

| Group  | Vars (default)                                                                                                                                                     |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| App    | `DEBUG_MODE` (`false`), `SITE_URL` (`""`)                                                                                                                          |
| Limits | `MAX_VOLUMES_PER_USER` (`100`), `MAX_CREDENTIALS_PER_VOLUME` (`10`), `DEFAULT_CREDENTIAL_EXPIRY_DAYS` (`365`), `MAX_CREDENTIAL_EXPIRY_DAYS` (`365`), `MAX_FILE_BYTES` (`52428800`), `DO_DEVICE_BYTES` (`5368709120`), `DAV_CACHE_TTL_SECONDS` (`300`, front read-cache tuning; legacy `GIT_CACHE_TTL_SECONDS` still honored as fallback) |

Add new env vars in `ConfigurationDefaults.ts` (+ `ConfigurationManager` getter + `AppConfiguration` method), not inline.

## Dependency injection (`packages/backend-runtime/src/di/` + `config/`)

- `AppConfiguration` — injectable instance view over env parsing (thin facade over limit sections, one method per setting, incl. `getMaxFileBytes`/`getDoDeviceBytes`); `ConfigurationManager` statics remain as thin facade. Prefer injecting `AppConfiguration` in new services; mock via constructor deps.
- `Container` — minimal Factory + Singleton DI (`bind`/`bindValue`/`get`/`resolve`/`createChild`). `createRequestScope(env)` in `backend-services/composition` is the standard composition root (table-driven lazy DAO wiring + single `DavPermissionService` binding; `scope.get(Tokens.X)`). `scopeMiddleware` installs a single scope per request (`getScope(c)`; `getRequestScope` fallback creates a fresh scope for helpers/tests).
- `createServiceContext(env, overrides?)` — single request-scoped `{ env, logger, clock }`; prefer extending `ServiceContext` over new `*Env` interfaces; never reintroduce `as` env casts.
- Helpers: `memoizeAsync` (composition-root memoization; rejections are never cached so transient D1 failures retry), `NullLogger`/`FixedClock` (test doubles), `setRequestScope/getRequestScope/getServiceContext` (request plumbing), `asScopedContext` (single audited Hono→`ScopedContext` adapter — call sites must use it instead of `c as never`).
