-- Migration 0023: backfill 3NF junction tables from legacy JSON columns.
-- Rerunnable (`INSERT OR IGNORE`) so it heals rows written between the 0022
-- deploy and this migration. Invalid JSON is skipped (`json_valid` guard);
-- reads keep a JSON fallback, so skipped rows stay reachable. The legacy
-- JSON columns remain authoritative until a later migration drops them.

-- Token scopes: `user_access_tokens.scopes` JSON array → `token_scopes`.
-- Only the known vocabulary is backfilled; unknown entries stay on the JSON
-- row (fail-closed reads deny them either way).
INSERT OR IGNORE INTO token_scopes (token_id, scope, created_at)
SELECT t.token_id, j.value, t.created_at
FROM user_access_tokens t, json_each(t.scopes) j
WHERE t.scopes IS NOT NULL
  AND json_valid(t.scopes)
  AND json_type(t.scopes) = 'array'
  AND j.value IN ('repo:read', 'repo:write', 'admin');

-- Webhook subscriptions: `repo_webhooks.events` JSON array → `webhook_events`.
INSERT OR IGNORE INTO webhook_events (hook_id, event, created_at)
SELECT h.id, j.value, h.created_at
FROM repo_webhooks h, json_each(h.events) j
WHERE h.events IS NOT NULL
  AND json_valid(h.events)
  AND json_type(h.events) = 'array'
  AND typeof(j.value) = 'text'
  AND length(j.value) > 0;

-- Branch protection checks: `require_status_checks` JSON → rows, capped like
-- the service layer (`MAX_STATUS_CHECKS` = 50, 200 chars per context).
INSERT OR IGNORE INTO branch_protection_required_checks (rule_id, context, created_at)
SELECT r.id, substr(j.value, 1, 200), r.created_at
FROM branch_protection_rules r, json_each(r.require_status_checks) j
WHERE r.require_status_checks IS NOT NULL
  AND json_valid(r.require_status_checks)
  AND json_type(r.require_status_checks) = 'array'
  AND typeof(j.value) = 'text'
  AND length(j.value) > 0;

-- Import refs: `repo_imports.refs_json` array of `{ref, oid}` → rows.
INSERT OR IGNORE INTO repo_import_refs (import_id, ref_name, oid, created_at)
SELECT i.id, j.value ->> 'ref', j.value ->> 'oid', i.updated_at
FROM repo_imports i, json_each(i.refs_json) j
WHERE i.refs_json IS NOT NULL
  AND json_valid(i.refs_json)
  AND json_type(i.refs_json) = 'array'
  AND (j.value ->> 'ref') IS NOT NULL
  AND length(j.value ->> 'ref') > 0;
