# DuraDAV

WebDAV server (RFC 4918 Class 1 + Class 2) over `dofs` (Durable Object filesystem) on Cloudflare Workers. No R2.

- Multi-volume from day one: each volume lives at `/:owner/:volume/` backed by one `DavVolumeWorker` DO (`DAV_VOLUME.getByName(owner/volume)`), files in `dofs`, dead properties + locks in DO SQLite.
- Auth keeps Edge-Git style: Cloudflare Access for `/user/*` + PAT Basic/Bearer for WebDAV (`dav:read`/`dav:write`/`admin`, `duradav-pat:` sha256; legacy `repo:*` accepted as alias). Each user gets up to `MAX_VOLUMES_PER_USER` (100) buckets and `MAX_TOKENS_PER_USER` (5) PATs; PATs are scoped per bucket via `volumeGrants` (unscoped = full access).
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

WebDAV with litmus (reference: `../r2-webdav`):

```bash
litmus -k http://localhost:8787/test/photos/ basic copymove props locks
```

## Layout

- `packages/webdav/` — pure RFC 4918 helpers (paths, XML, live/dead props, locks).
- `packages/dav-store/` — `dofs` factory + DO SQLite schema (`dav_nodes/props/locks`).
- `apps/background/src/DavVolumeWorker.ts` — per-volume DO (all WebDAV methods).
- `apps/api/` — `DuraDavWorker` front (auth, volume CRUD, DO forward, CORS, browser HTML).
- `migrations/0028_dav_volumes.sql` — `dav_volumes` + `dav_collaborators` (user-only buckets, no org volumes).
- `migrations/0029_dav_volume_grants.sql` — `token_volume_grants` per-bucket PAT scope + widened `token_scopes` to `dav:*`.
- `test/dav-webdav.test.ts` + `test/integration/api/DavLifecycle.int.test.ts` — unit + DO integration.

## Reference

Ported from `../r2-webdav/src/index.ts` (R2 WebDAV Class 1+2): same status codes, `DAV: 1, 2`, `If`/`Lock-Token` semantics, `Destination`/`Overwrite` handling, PROPPATCH atomicity. Storage replaced: `R2Bucket` → `dofs` + SQLite (no `customMetadata` in `dofs`).
