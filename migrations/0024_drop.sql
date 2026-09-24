-- Migration 0024: 3NF drops (step 2 of 2; dual-write shipped earlier).
-- Drops the legacy JSON columns (now shadowed by the 0022 junction tables,
-- backfilled by 0023) and the denormalized `full_name` copies (now computed
-- via `repositories` joins / `full_name` SELECT aliases in the DAOs).
-- Fresh installs are unaffected (0023 backfills empty tables into no-ops).
-- All statements are idempotent (`IF EXISTS`); SQLite `DROP COLUMN` keeps
-- remaining data, indexes, and unrelated triggers intact.

-- FTS triggers that read the dropped `full_name` columns recompute the name
-- from `repositories` instead. Rename cascades are gone (no more
-- `UPDATE issues SET full_name`), so a repositories rename trigger refreshes
-- the dependent FTS rows (renames are rare; correctness over cost).
-- NOTE: the old triggers are dropped BEFORE the columns below — SQLite
-- rejects `DROP COLUMN` while a trigger body references the column.
DROP TRIGGER IF EXISTS trg_issue_fts_ai;
DROP TRIGGER IF EXISTS trg_issue_fts_au;
DROP TRIGGER IF EXISTS trg_pull_fts_ai;
DROP TRIGGER IF EXISTS trg_pull_fts_au;

-- 1NF JSON columns → junction tables only.
ALTER TABLE user_access_tokens DROP COLUMN scopes;
ALTER TABLE repo_webhooks DROP COLUMN events;
ALTER TABLE branch_protection_rules DROP COLUMN require_status_checks;
ALTER TABLE repo_imports DROP COLUMN refs_json;

-- Transitive `full_name` copies → computed from `repositories`.
ALTER TABLE issues DROP COLUMN full_name;
ALTER TABLE pull_requests DROP COLUMN full_name;
ALTER TABLE pull_requests DROP COLUMN head_full_name;
ALTER TABLE repo_events DROP COLUMN full_name;
ALTER TABLE notifications DROP COLUMN full_name;
ALTER TABLE repo_webhooks DROP COLUMN full_name;
ALTER TABLE repositories DROP COLUMN forked_from_full_name;

CREATE TRIGGER trg_issue_fts_ai AFTER INSERT ON issues BEGIN
  INSERT INTO issue_fts(issue_id, repo_id, full_name, title, body)
  VALUES (NEW.id, NEW.repository_id, (SELECT owner || '/' || name FROM repositories WHERE id = NEW.repository_id), NEW.title, COALESCE(NEW.body, ''));
END;

CREATE TRIGGER trg_issue_fts_au AFTER UPDATE ON issues BEGIN
  DELETE FROM issue_fts WHERE issue_id = OLD.id;
  INSERT INTO issue_fts(issue_id, repo_id, full_name, title, body)
  VALUES (NEW.id, NEW.repository_id, (SELECT owner || '/' || name FROM repositories WHERE id = NEW.repository_id), NEW.title, COALESCE(NEW.body, ''));
END;

CREATE TRIGGER trg_pull_fts_ai AFTER INSERT ON pull_requests BEGIN
  INSERT INTO pull_fts(pull_id, repo_id, full_name, title, body)
  VALUES (NEW.id, NEW.repository_id, (SELECT owner || '/' || name FROM repositories WHERE id = NEW.repository_id), NEW.title, COALESCE(NEW.body, ''));
END;

CREATE TRIGGER trg_pull_fts_au AFTER UPDATE ON pull_requests BEGIN
  DELETE FROM pull_fts WHERE pull_id = OLD.id;
  INSERT INTO pull_fts(pull_id, repo_id, full_name, title, body)
  VALUES (NEW.id, NEW.repository_id, (SELECT owner || '/' || name FROM repositories WHERE id = NEW.repository_id), NEW.title, COALESCE(NEW.body, ''));
END;

CREATE TRIGGER IF NOT EXISTS trg_repo_rename_fts_au AFTER UPDATE OF owner, name ON repositories BEGIN
  DELETE FROM issue_fts WHERE repo_id = OLD.id;
  INSERT INTO issue_fts(issue_id, repo_id, full_name, title, body)
  SELECT i.id, i.repository_id, NEW.owner || '/' || NEW.name, i.title, COALESCE(i.body, '')
  FROM issues i WHERE i.repository_id = NEW.id;
  DELETE FROM pull_fts WHERE repo_id = OLD.id;
  INSERT INTO pull_fts(pull_id, repo_id, full_name, title, body)
  SELECT p.id, p.repository_id, NEW.owner || '/' || NEW.name, p.title, COALESCE(p.body, '')
  FROM pull_requests p WHERE p.repository_id = NEW.id;
END;
