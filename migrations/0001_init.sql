-- Migration 0001: Durable-DAV baseline (WebDAV volumes over DO storage).
--
-- Single squashed baseline — no deployments exist, so no upgrade path from
-- the Edge-Git schema is preserved. Only the tables the WebDAV service
-- actually reads/writes are created:
--
--   users / namespaces          identity + globally-unique usernames
--   user_access_tokens /
--     token_scopes              PATs (sha256 `durable-dav-pat:` hash, no plaintext)
--   dav_volumes /
--     dav_collaborators         user-only buckets + per-bucket roles
--   token_volume_grants         per-bucket PAT scope (unscoped PAT = full access)
--
-- Dead-prop XML + locks live in Durable Object SQLite (`dav_nodes/dav_props/
-- dav_locks` via `ensureDavSchema`), files live in `dofs` — never in D1.

CREATE TABLE IF NOT EXISTS users (
  email TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  username TEXT,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS namespaces (
  username_ci TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('user')),
  user_email TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_access_tokens (
  token_id TEXT PRIMARY KEY,
  user_email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  last_used_at INTEGER,
  created_at INTEGER NOT NULL,
  token_prefix TEXT,
  FOREIGN KEY (user_email) REFERENCES users(email) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_access_tokens_user ON user_access_tokens(user_email);

-- PAT scopes live only in this junction table (fail closed to `[]` when a
-- token has no rows). `repo:*` entries are legacy aliases of `dav:*`.
CREATE TABLE IF NOT EXISTS token_scopes (
  token_id TEXT NOT NULL,
  scope TEXT NOT NULL CHECK(scope IN ('dav:read', 'dav:write', 'admin', 'repo:read', 'repo:write')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (token_id, scope),
  FOREIGN KEY (token_id) REFERENCES user_access_tokens(token_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_token_scopes_token ON token_scopes(token_id);

CREATE TABLE IF NOT EXISTS dav_volumes (
  id TEXT PRIMARY KEY,
  owner_email TEXT NOT NULL,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  is_private INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  owner_ci TEXT NOT NULL,
  name_ci TEXT NOT NULL,
  FOREIGN KEY (owner_email) REFERENCES users(email) ON DELETE CASCADE,
  UNIQUE (owner_ci, name_ci)
);

CREATE INDEX IF NOT EXISTS idx_dav_volumes_owner ON dav_volumes(owner_ci);
CREATE INDEX IF NOT EXISTS idx_dav_volumes_owner_email ON dav_volumes(owner_email);

CREATE TABLE IF NOT EXISTS dav_collaborators (
  volume_id TEXT NOT NULL,
  user_email TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin', 'write', 'read')),
  granted_by TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (volume_id, user_email),
  FOREIGN KEY (volume_id) REFERENCES dav_volumes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_dav_collaborators_user ON dav_collaborators(user_email);

CREATE TABLE IF NOT EXISTS token_volume_grants (
  token_id TEXT NOT NULL,
  volume_id TEXT NOT NULL,
  scope TEXT NOT NULL CHECK(scope IN ('dav:read', 'dav:write', 'admin', 'repo:read', 'repo:write')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (token_id, volume_id),
  FOREIGN KEY (token_id) REFERENCES user_access_tokens(token_id) ON DELETE CASCADE,
  FOREIGN KEY (volume_id) REFERENCES dav_volumes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_token_volume_grants_token ON token_volume_grants(token_id);
CREATE INDEX IF NOT EXISTS idx_token_volume_grants_volume ON token_volume_grants(volume_id);
