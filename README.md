# Durable-DAV

WebDAV server (RFC 4918 Class 1 + Class 2) over `dofs` (Durable Object filesystem) on Cloudflare Workers.

- Multi-volume from day one: each volume lives at `/:owner/:volume/` backed by one `DavVolumeWorker` DO (`DAV_VOLUME.getByName(owner/volume)`), files in `dofs`, dead properties + locks in DO SQLite.
- Auth: Cloudflare Access for `/user/*` + PAT Basic/Bearer for WebDAV (`dav:read`/`dav:write`/`admin`, `durable-dav-pat:` sha256; legacy `repo:*` accepted as alias). Each user gets up to `MAX_VOLUMES_PER_USER` (100) buckets and `MAX_TOKENS_PER_USER` (5) PATs; PATs are scoped per bucket via `volumeGrants` (unscoped = full access).
- Minimal browser UI: `GET /` and collection `GET` return simple HTML listings (no SPA build).
- Only needed bindings: D1 `DB`, DOs `DAV_VOLUME` + `CRON_TASKS`, cron `*/10 * * * *`.

## Quick Start

```bash
pnpm install --ignore-scripts
pnpm -r typecheck
pnpm run test
pnpm exec wrangler dev --config ./wrangler.jsonc
```

Create a volume (authenticated via Access in browser, or DEV email locally):

```bash
curl -X POST http://localhost:8787/user/volumes \
  -H 'Content-Type: application/json' \
  -d '{"owner":"test","name":"photos"}'
```

WebDAV with litmus:

```bash
litmus -k http://localhost:8787/test/photos/ basic copymove props locks
```

## Layout

- `packages/webdav/` — pure RFC 4918 helpers (paths, XML, live/dead props, locks).
- `packages/dav-store/` — `dofs` factory + DO SQLite schema (`dav_nodes/props/locks`).
- `apps/background/src/DavVolumeWorker.ts` — per-volume DO (all WebDAV methods).
- `apps/api/` — `DurableDavWorker` front (auth, volume CRUD, DO forward, CORS, browser HTML).
- `migrations/0001_init.sql` — `users` + `namespaces`, `user_access_tokens` + `token_scopes`, `dav_volumes` + `dav_collaborators`, `token_volume_grants`.
- `test/dav-webdav.test.ts` + `test/integration/api/DavLifecycle.int.test.ts` — unit + DO integration.
