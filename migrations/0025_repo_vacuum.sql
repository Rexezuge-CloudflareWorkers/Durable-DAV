-- Migration 0025: repo vacuum tombstones.
-- Tracks Durable Object storage that outlives the D1 row after a repo
-- delete/rename so the background `RepoVacuumTask` can reclaim it later.
-- The synchronous delete path keeps a fast targeted purge (`/repo` +
-- `/release-assets`) so same-name recreates work on the warm isolate; the
-- full `storage.deleteAll()` (which drops the dofs schema tables and frees
-- the SQLite pages) happens here, minutes later, only while the canonical
-- DO key still maps to no live repository.
-- All statements are idempotent (`IF NOT EXISTS`).
CREATE TABLE IF NOT EXISTS deleted_repo_dos (
  do_key TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  repo_id TEXT NOT NULL,
  deleted_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_deleted_repo_dos_deleted_at ON deleted_repo_dos(deleted_at);
