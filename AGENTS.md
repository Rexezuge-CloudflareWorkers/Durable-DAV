# AGENTS.md

Durable-DAV: Cloudflare Workers WebDAV server (`@durable-dav/monorepo`, `pnpm@11.2.2`).

- **WebDAV core**: `packages/webdav` (pure RFC 4918 Class 1+2: path/XML/prop/lock helpers, zero runtime deps except `@xmldom/xmldom`) + `packages/dav-store` (`dofs` `Fs` factory via `createDofsFs` + SQLite metadata `dav_nodes/dav_props/dav_locks`).
- **Storage**: `apps/background` `DavVolumeWorker` facade (one per bucket `DAV_VOLUME.getByName(owner/volume-lowercase)`, 5GB device, files at `/` in `dofs`, dead props/locks in DO SQLite; lifecycle `setVolumeKey/deleteVolume`) + `CronTasksWorker` (`*/10 * * * *`, token prune only); D1 `migrations/0001_init.sql` baseline (`users`, `namespaces`, `user_access_tokens` + `token_scopes`, `dav_volumes` + `dav_collaborators`, `token_volume_grants`).
- **Auth**: `/user/*` Cloudflare Access (`AccessAuthService`: DEMO→DEV→JWT→`ctx.access` fallback; never trust `Cf-Access-Authenticated-User-Email`); email login, globally-unique mutable username (single `user` namespace; buckets are user-only); WebDAV anon (public buckets) + PAT Basic/Bearer (`TokenService`, sha256 `durable-dav-pat:` prefix, `MAX_TOKENS_PER_USER=5`, `MAX_VOLUMES_PER_USER=100`, `dav:read` for reads, `dav:write` for writes with legacy `repo:*` alias; `volumeGrants` per bucket, unscoped = full access).
- **API**: `apps/api` Hono+Chanfana `DurableDavWorker` (`/:owner/:volume/*` WebDAV via DO `fetch` forward + `/user/volumes` CRUD (quota-enforced, user-only) + `/user/tokens` (volumeGrants) + `/user/me` + `/users/:username` + `/health`, `/docs`); permissions `admin|write|read` via `DavPermissionService` (owner + collaborators, user-only); `apps/api/src/index.ts` re-exports DOs for bindings.
- **Web**: `apps/web` Vite SPA (build embeds `dist/index.html` → `apps/api/src/generated/spa-shell.ts`); `GET /`, `/new`, `/settings`, `/:username` serve the shell, `GET /:owner/:volume` content-negotiates (`Accept: text/html` → SPA `VolumeView` with `?path=` subpaths, else DO forward); WebDAV clients use raw methods.
- **Composition**: single scope per request via `scopeMiddleware` (`getScope(c).get(Tokens.X)`; `createRequestScope(env)` is the composition root, table-driven DAO wiring + single `DavPermissionService` binding); `Container` + `createServiceContext` + `AppConfiguration` in `@durable-dav/backend-runtime/di+config` are the DI foundation.
- **i18n**: backend strings in `packages/shared/src/i18n` (wired via `BaseRoute.toErrorResponse`).

## Commands

```bash
pnpm install --ignore-scripts
pnpm -r typecheck
pnpm run lint
pnpm run test
pnpm run test:integration
pnpm run typegen
pnpm exec wrangler dev --config ./wrangler.jsonc
```

No committed `wrangler.jsonc` secrets. God-file guard 300/400 warn-only.

## Layers

```
shared, backend-errors, webdav → 0 deps (webdav may use xmldom only)
backend-runtime → 0 only
backend-data, dav-store → 0 only (+dofs for dav-store, +webdav for dav-store meta types)
backend-services → 0-2 (not apps)
background → 0-3 + webdav/dav-store (not apps/api)
api → 0-3 + background + webdav (NOT dav-store directly; NOT backend-data/dao except type-only)
```

## Import Direction

```
Layer 0: shared, backend-errors, webdav   — zero @durable-dav/* deps (except xmldom)
Layer 1: backend-runtime                 → layer 0 only
Layer 2: backend-data, dav-store         → layer 0 only (+webdav types for dav-store)
Layer 3: backend-services                → layers 0–2 (not apps)
Layer 5: apps/background                 → layers 0–3 + webdav/dav-store (not apps/api)
         apps/api                        → layers 0–3 + background + webdav (NOT dav-store directly; NOT backend-data/dao except type-only)
```

Enforced by ESLint `no-restricted-imports` in `eslint.config.mjs`: `apps/api` blocks `→ @durable-dav/dav-store` (all imports) and `→ @durable-dav/backend-data/dao` (`allowTypeImports: true`). `apps/api → apps/background` re-export is allowed (`src/index.ts` re-exports `CronTasksWorker`, `DavVolumeWorker` for bindings).

## Index

| Area                              | Guide                          |
| --------------------------------- | ------------------------------ |
| API worker, auth, routes          | `apps/api/AGENTS.md`           |
| Background worker, cron, volumes  | `apps/background/AGENTS.md`    |
| WebDAV RFC 4918 notes             | `packages/webdav/README.md`    |
| D1/DAO layer                      | `packages/backend-data/AGENTS.md` |
| Bindings, wrangler, env vars, DI  | `docs/agents/runtime/AGENTS.md` |
| Tests, thresholds, mock patterns  | `docs/agents/testing/AGENTS.md` |
```

## Commit Policy

Always commit changes after completing work unless explicitly told not to.

## Git Commit Messages

Format: `<TYPE>[optional scope]: <description>`

- Type in UPPERCASE: `FIX`, `FEAT`, `DOCS`, `STYLE`, `REFACTOR`, `TEST`, `BUILD`, `CHORE`, `CI`, `PERF`.
- Scope in lowercase: `FEAT(runtime): Add Scheduled Job State`.
- Description: Title Case words — `DOCS: Latest Agents Context Reflection`.
- When committing from `main`, first create a branch: `type/description` or `type/scope/description` in kebab-case (e.g. `feat/bootstrap/bootstrap-jqanywhere-v0.1-framework`).
- Always include a Markdown body separated from the subject by a blank line.
- Breaking changes: `!` after type/scope, or `BREAKING CHANGE: <description>` footer.

```text
<TYPE>[optional scope]: <description>

[Markdown body]

[optional footers]
```
