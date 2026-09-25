-- Migration 0002: Bucket-level WebDAV credentials (CalDAV-style).
--
-- Replaces user-level PATs (`user_access_tokens` + `token_scopes` +
-- `token_volume_grants`) and `dav_collaborators` with per-bucket credentials
-- bound to `dav_volumes(id)`:
--
--   dav_credentials           username + password_hash login, one bucket each
--
-- Buckets stay owner-only (no orgs, no collaborators). `is_private` defaults
-- to 1 (private by default); public (`is_private = 0`) remains opt-in for
-- anonymous reads. Email -> username identity (`users`/`namespaces`) is kept.
-- App layer also defaults `isPrivate` to true on create.

CREATE TABLE IF NOT EXISTS dav_credentials (
  credential_id TEXT PRIMARY KEY,
  volume_id TEXT NOT NULL,
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  password_prefix TEXT NOT NULL,
  password_last_four TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_used_at INTEGER,
  FOREIGN KEY (volume_id) REFERENCES dav_volumes(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dav_credentials_username ON dav_credentials(username);
CREATE UNIQUE INDEX IF NOT EXISTS idx_dav_credentials_password_hash ON dav_credentials(password_hash);
CREATE INDEX IF NOT EXISTS idx_dav_credentials_volume ON dav_credentials(volume_id);
CREATE INDEX IF NOT EXISTS idx_dav_credentials_expires ON dav_credentials(expires_at);

-- Private by default: rebuild dav_volumes with DEFAULT 1 (SQLite has no
-- ALTER COLUMN). Existing rows keep their flag; 0001 is left untouched.
CREATE TABLE IF NOT EXISTS dav_volumes_new (
  id TEXT PRIMARY KEY,
  owner_email TEXT NOT NULL,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  is_private INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  owner_ci TEXT NOT NULL,
  name_ci TEXT NOT NULL,
  FOREIGN KEY (owner_email) REFERENCES users(email) ON DELETE CASCADE,
  UNIQUE (owner_ci, name_ci)
);

INSERT OR IGNORE INTO dav_volumes_new
  (id, owner_email, owner, name, description, is_private, created_at, updated_at, owner_ci, name_ci)
  SELECT id, owner_email, owner, name, description, is_private, created_at, updated_at, owner_ci, name_ci
  FROM dav_volumes;

DROP TABLE IF EXISTS dav_volumes;
ALTER TABLE dav_volumes_new RENAME TO dav_volumes;

CREATE INDEX IF NOT EXISTS idx_dav_volumes_owner ON dav_volumes(owner_ci);
CREATE INDEX IF NOT EXISTS idx_dav_volumes_owner_email ON dav_volumes(owner_email);

DROP TABLE IF EXISTS token_volume_grants;
DROP TABLE IF EXISTS token_scopes;
DROP TABLE IF EXISTS dav_collaborators;
DROP TABLE IF EXISTS user_access_tokens;
