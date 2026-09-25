# Durable-DAV — Background Worker

Scope: `apps/background/**`. Parent index: `../../AGENTS.md`.

- `src/index.ts` — re-exports `DavVolumeWorker`, `CronTasksWorker` (also re-exported by `apps/api/src/index.ts` for DO bindings).
- `DavVolumeWorker` (`src/DavVolumeWorker.ts`) — WebDAV filesystem DO (routing + storage): one per bucket (`DAV_VOLUME.getByName(normalizeVolumeKey(owner, volume))` — canonical lowercase key, display case via `setVolumeKey`); files at `/` over `createDofsFs` + metadata in DO SQLite (`dav_nodes/dav_props/dav_locks` via `ensureDavSchema`). Entry: `fetch` dispatches all `SUPPORT_METHODS`; `setVolumeKey/deleteVolume` lifecycle. No `blockConcurrencyWhile` nesting (dofs schedules its own schema bootstrap). Bucket deletion also clears bucket credentials in D1 (best-effort, FK cascades as backstop).
- `DavVolumeWorker` method map (RFC 4918 Class 1+2, ported from `r2-webdav`):
  - `OPTIONS` → `Allow` + `DAV: 1, 2`.
  - `GET`/`HEAD` → file bytes (Range via `dofs.read(offset/length)`, streams via `readFile`) or collection HTML browser; `404` missing, `206` partial.
  - `PUT` → `409` missing parent, `405` on collection, `413` over `MAX_FILE_BYTES`, `201/204`; stores `content-type` + `etag` in `dav_nodes`.
  - `DELETE` → recursive (`rmdir` + SQL cascade), `423` on locked descendants, `403` on volume root.
  - `MKCOL` → `415` with body, `405` exists, `409` missing parent.
  - `PROPFIND` → `207` multistatus (`allprop/propname/prop`, `Depth 0/1/infinity`).
  - `PROPPATCH` → atomic dead-prop upserts in `dav_props` (`403` on protected live props, `424` on partial).
  - `COPY`/`MOVE` → `Destination` same-volume check, `Overwrite`, `400` self/descendant, locks not copied but preserved on move.
  - `LOCK`/`UNLOCK` → exclusive/shared, `Depth`, `Timeout`, empty-body refresh, `423` conflicts.
- `CronTasksWorker` (`src/CronTasksWorker.ts`) — `POST /run` only (else `404`); single-flight (`202 Already running`); awaits `runScheduledTasks`. Triggered by cron `*/10 * * * *`.
- `src/scheduled/TaskRegistry.ts` — `CRON_TASK_FACTORIES` with only `ExpiredCredentialPruningTask` (bucket-credential hygiene); `runScheduledTasks` runs phase 1 then phase 2.
- Composition: DO reads `AppConfiguration.fromEnv(env)` for `DO_DEVICE_BYTES` (`setDofsDeviceSize` best-effort per request); no per-request DI container inside the DO (front resolves D1/auth before forwarding).
