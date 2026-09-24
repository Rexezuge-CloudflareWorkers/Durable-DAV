# DuraDAV — API Worker

Scope: `apps/api/**`. Parent index: `../../AGENTS.md`.

- `src/index.ts` — `fetch`/`scheduled` via `DuraDavWorker`; re-exports `CronTasksWorker`, `DavVolumeWorker` from `@duradav/background` for DO bindings.
- `src/workers/DuraDavWorker.ts` — Hono routes (no file-routing). `src/types.d.ts` — global `Env`.
- `src/workers/doStubs.ts` — `getVolumeStub(env, owner, volume)` (`DAV_VOLUME.getByName(normalizeVolumeKey)`) + `ensureVolume`.
- `src/middleware/` — `MiddlewareHandlers.userAuthentication()` (`/user/*` via `AccessAuthService` + `UserService.upsertUser`) + `DavAuth.davAuthForVolume()` (PAT Basic/Bearer via `TokenService.authenticateWithPAT` → `coversScope` → `DavPermissionService.getRole`; private volumes hide existence as 404 for authed-no-access, 401 for anon; `DatabaseError` fails closed to 503).
- `src/workers/routes/` — `DavRoutes` (`/:owner/:volume` + `/:owner/:volume/*` for all `SUPPORT_METHODS`, auth then `stub.fetch` forward with `X-Dav-Base/X-Dav-Path/X-Dav-User` + CORS) + `VolumeRoutes` (`GET|POST /user/volumes`, `DELETE /user/volumes/:owner/:volume` admin-only, DO cleanup best-effort) + `TokenRoutes` (PAT CRUD) + `UserRoutes` (`GET /user/me`, `GET /users/:username`).

## Auth

- `/user/*` — Cloudflare Access (`DEMO_MODE` → `DEV_AUTH_EMAIL` → JWT → `ctx.access` fallback).
- WebDAV `/:owner/:volume/*` — anon `read` only for public volumes; private needs `read`, all writes need `write` via PAT (Basic password or Bearer). PAT scope gate: reads need `repo:read`, writes need `repo:write` (`coversScope` hierarchy; 403 on insufficiency).

## Routes

- WebDAV: `OPTIONS` (`Allow` + `DAV: 1, 2`) · `PROPFIND` · `PROPPATCH` · `MKCOL` · `GET`/`HEAD` (Range, HTML browser for collections) · `PUT` · `DELETE` · `COPY`/`MOVE` (`Destination` same-origin, `Overwrite`) · `LOCK`/`UNLOCK` (all in `DavVolumeWorker`, front only auth + forward + CORS).
- Volumes: `GET|POST /user/volumes` · `DELETE /user/volumes/:owner/:volume`.
- Users/Tokens: `GET /user/me` · `GET /users/:username` · `GET|POST /user/tokens` (+ rotate/delete).
- Public: `GET /` (minimal HTML volume browser) · `GET /health` · `/docs`.

## Composition

- Single scope per request: `scopeMiddleware` installs one `Container` + `ServiceContext`; handlers resolve via `BaseRoute.getScope(c).get(Tokens.X)`.
- `src/endpoints/IBaseRoute.ts` — `BaseRoute` template (`handle()` → `handleRequest()` + `toErrorResponse()` mapping `ServiceError`; AWS envelope `{Exception:{Type,Message}}`).
- Never import `@duradav/backend-data/dao` values in routes (type-only allowed); never import `@duradav/dav-store` directly — use `@duradav/webdav` constants + DO `fetch`.
