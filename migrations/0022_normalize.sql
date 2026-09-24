-- Migration 0022: 3NF normalization (additive step 1 of 2).
-- Splits multi-valued JSON columns from 0021 into first-class junction
-- tables so each fact has one home. Additive only: the legacy JSON columns
-- (`user_access_tokens.scopes`, `repo_webhooks.events`,
-- `branch_protection_rules.require_status_checks`, `repo_imports.refs_json`)
-- remain the source of truth until dual-write + backfill land in step 2
-- (which then drops the JSON columns). Safe for existing databases
-- (all statements use IF NOT EXISTS) and for fresh installs.

-- Token scopes: one row per granted scope instead of a JSON array in
-- `user_access_tokens.scopes`. Scope vocabulary mirrors
-- `TokenScopes.ts` (`repo:read|repo:write|admin`).
CREATE TABLE IF NOT EXISTS token_scopes (
  token_id TEXT NOT NULL,
  scope TEXT NOT NULL CHECK(scope IN ('repo:read', 'repo:write', 'admin')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (token_id, scope),
  FOREIGN KEY (token_id) REFERENCES user_access_tokens(token_id) ON DELETE CASCADE
);

-- Webhook subscriptions: one row per subscribed event instead of the JSON
-- array in `repo_webhooks.events`. Event vocabulary mirrors `WEBHOOK_EVENTS`.
CREATE TABLE IF NOT EXISTS webhook_events (
  hook_id TEXT NOT NULL,
  event TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (hook_id, event),
  FOREIGN KEY (hook_id) REFERENCES repo_webhooks(id) ON DELETE CASCADE
);

-- Branch protection required status checks: one row per required context
-- instead of the JSON list in
-- `branch_protection_rules.require_status_checks`.
CREATE TABLE IF NOT EXISTS branch_protection_required_checks (
  rule_id TEXT NOT NULL,
  context TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (rule_id, context),
  FOREIGN KEY (rule_id) REFERENCES branch_protection_rules(id) ON DELETE CASCADE
);

-- Import refs: one row per imported ref instead of the JSON document in
-- `repo_imports.refs_json`.
CREATE TABLE IF NOT EXISTS repo_import_refs (
  import_id TEXT NOT NULL,
  ref_name TEXT NOT NULL,
  oid TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (import_id, ref_name),
  FOREIGN KEY (import_id) REFERENCES repo_imports(id) ON DELETE CASCADE
);

-- ============================================================
-- Indexes
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_token_scopes_token ON token_scopes(token_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_hook ON webhook_events(hook_id);
CREATE INDEX IF NOT EXISTS idx_branch_checks_rule ON branch_protection_required_checks(rule_id);
CREATE INDEX IF NOT EXISTS idx_import_refs_import ON repo_import_refs(import_id);
