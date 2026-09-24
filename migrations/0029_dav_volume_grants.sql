-- Migration 0029: DuraDAV per-bucket PAT grants + dav:* scopes.
-- Each user bucket is a DO instance (dav_volumes row); PATs are scoped per
-- bucket via token_volume_grants. Unscoped PATs keep full access (legacy).
-- token_scopes CHECK is widened to accept dav:read/dav:write alongside the
-- legacy repo:read/repo:write/admin vocabulary.

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

-- Widen token_scopes CHECK from repo:* to dav:* (SQLite has no ALTER CHECK:
-- recreate via copy when the legacy CHECK is present).
-- Fresh installs already get the widened table; existing DBs migrate below.
CREATE TABLE IF NOT EXISTS token_scopes_new (
  token_id TEXT NOT NULL,
  scope TEXT NOT NULL CHECK(scope IN ('dav:read', 'dav:write', 'admin', 'repo:read', 'repo:write')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (token_id, scope),
  FOREIGN KEY (token_id) REFERENCES user_access_tokens(token_id) ON DELETE CASCADE
);

INSERT OR IGNORE INTO token_scopes_new (token_id, scope, created_at)
  SELECT token_id, scope, created_at FROM token_scopes;

DROP TABLE IF EXISTS token_scopes;
ALTER TABLE token_scopes_new RENAME TO token_scopes;
CREATE INDEX IF NOT EXISTS idx_token_scopes_token ON token_scopes(token_id);
