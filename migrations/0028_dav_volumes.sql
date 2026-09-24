-- Migration 0028: DuraDAV volumes (multi-volume WebDAV over dofs).
-- Keeps Edge-Git auth tables (users, namespaces, organizations, user_access_tokens,
-- token_scopes) untouched. Volumes reuse the owner/org namespace model.

CREATE TABLE IF NOT EXISTS dav_volumes (
  id TEXT PRIMARY KEY,
  owner_email TEXT NOT NULL,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  is_private INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  owner_type TEXT NOT NULL DEFAULT 'user',
  owner_ci TEXT,
  name_ci TEXT,
  owner_user_email TEXT,
  org_id TEXT REFERENCES organizations(id) ON DELETE SET NULL,
  FOREIGN KEY (owner_email) REFERENCES users(email) ON DELETE CASCADE,
  UNIQUE (owner_ci, name_ci)
);

CREATE INDEX IF NOT EXISTS idx_dav_volumes_owner ON dav_volumes(owner_ci);
CREATE INDEX IF NOT EXISTS idx_dav_volumes_org ON dav_volumes(org_id);

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
