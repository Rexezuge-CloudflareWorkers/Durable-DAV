-- Migration 0021: Squash of migrations 0001–0020
-- Complete schema for a fresh database installation.
-- Existing deployed databases are unaffected; this file is idempotent
-- (all statements use IF NOT EXISTS) and for new installations only.
-- Mirrors the ../Otter 0021 and ../AWS 0030 squashes.
--
-- Folded ALTERs (inline in CREATE TABLE): users.username/display_name/
-- updated_at, repositories.owner_type/owner_ci/name_ci/owner_user_email/
-- org_id/forked_from_*, user_access_tokens.scopes/token_prefix,
-- issues.milestone_id, pull_requests.head_*/milestone_id/is_draft,
-- pull_request_reviews.dismissed*.
-- The 0018 code_fts rebuild (staging table + DROP TRIGGER) is
-- collapsed to the final rowid-linked table + triggers. FTS backfill
-- INSERTs from 0005/0011/0014 are omitted (no-ops on a fresh database).

-- ============================================================
-- Tables (creation order respects foreign-key dependencies)
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  email TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  username TEXT,
  display_name TEXT,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS namespaces (
  username_ci TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('user', 'org')),
  user_email TEXT,
  org_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  username_ci TEXT NOT NULL UNIQUE,
  display_name TEXT,
  creator_email TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS organization_members (
  org_id TEXT NOT NULL,
  user_email TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('owner', 'member')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (org_id, user_email),
  FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS repositories (
  id TEXT PRIMARY KEY,
  owner_email TEXT NOT NULL,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  is_private INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  owner_type TEXT DEFAULT 'user',
  owner_ci TEXT,
  name_ci TEXT,
  owner_user_email TEXT,
  org_id TEXT,
  forked_from_repo_id TEXT REFERENCES repositories(id) ON DELETE SET NULL,
  forked_from_full_name TEXT,
  FOREIGN KEY (owner_email) REFERENCES users(email) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_access_tokens (
  token_id TEXT PRIMARY KEY,
  user_email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  last_used_at INTEGER,
  created_at INTEGER NOT NULL,
  scopes TEXT NOT NULL DEFAULT '["repo:read","repo:write","admin"]',
  token_prefix TEXT,
  FOREIGN KEY (user_email) REFERENCES users(email) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS repo_collaborators (
  repo_id TEXT NOT NULL,
  user_email TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin', 'write', 'read')),
  granted_by TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (repo_id, user_email),
  FOREIGN KEY (repo_id) REFERENCES repositories(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS branch_protection_rules (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL,
  pattern TEXT NOT NULL,
  require_pr INTEGER NOT NULL DEFAULT 0,
  required_approvals INTEGER NOT NULL DEFAULT 0,
  block_force_push INTEGER NOT NULL DEFAULT 1,
  block_deletion INTEGER NOT NULL DEFAULT 1,
  require_status_checks TEXT,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE,
  UNIQUE (repository_id, pattern)
);

CREATE TABLE IF NOT EXISTS milestones (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  due_on INTEGER,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'closed')),
  created_at INTEGER NOT NULL,
  FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS issues (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL,
  full_name TEXT NOT NULL,
  number INTEGER NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  creator_email TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  milestone_id TEXT REFERENCES milestones(id) ON DELETE SET NULL,
  FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE,
  UNIQUE (repository_id, number)
);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  issue_id TEXT,
  author_email TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS labels (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT 'ededed',
  description TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE,
  UNIQUE (repository_id, name)
);

CREATE TABLE IF NOT EXISTS issue_labels (
  issue_id TEXT NOT NULL,
  label_id TEXT NOT NULL,
  PRIMARY KEY (issue_id, label_id),
  FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE,
  FOREIGN KEY (label_id) REFERENCES labels(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS issue_assignees (
  issue_id TEXT NOT NULL,
  user_email TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (issue_id, user_email),
  FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pull_requests (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL,
  full_name TEXT NOT NULL,
  number INTEGER NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'closed', 'merged')),
  base_branch TEXT NOT NULL,
  head_branch TEXT NOT NULL,
  base_oid TEXT,
  head_oid TEXT,
  merge_base_oid TEXT,
  creator_email TEXT NOT NULL,
  merged_by TEXT,
  merged_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  head_repository_id TEXT REFERENCES repositories(id) ON DELETE SET NULL,
  head_full_name TEXT,
  milestone_id TEXT REFERENCES milestones(id) ON DELETE SET NULL,
  is_draft INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE,
  UNIQUE (repository_id, number)
);

CREATE TABLE IF NOT EXISTS pull_request_reviews (
  id TEXT PRIMARY KEY,
  pull_request_id TEXT NOT NULL,
  author_email TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('approved', 'changes_requested', 'commented')),
  body TEXT,
  commit_oid TEXT,
  created_at INTEGER NOT NULL,
  dismissed INTEGER NOT NULL DEFAULT 0,
  dismissed_by TEXT,
  dismissed_at INTEGER,
  dismiss_reason TEXT,
  FOREIGN KEY (pull_request_id) REFERENCES pull_requests(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pull_request_comments (
  id TEXT PRIMARY KEY,
  pull_request_id TEXT NOT NULL,
  author_email TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (pull_request_id) REFERENCES pull_requests(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pull_labels (
  pull_request_id TEXT NOT NULL,
  label_id TEXT NOT NULL,
  PRIMARY KEY (pull_request_id, label_id),
  FOREIGN KEY (pull_request_id) REFERENCES pull_requests(id) ON DELETE CASCADE,
  FOREIGN KEY (label_id) REFERENCES labels(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pull_assignees (
  pull_request_id TEXT NOT NULL,
  user_email TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (pull_request_id, user_email),
  FOREIGN KEY (pull_request_id) REFERENCES pull_requests(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pull_reviewers (
  pull_request_id TEXT NOT NULL,
  user_email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'changes_requested')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (pull_request_id, user_email),
  FOREIGN KEY (pull_request_id) REFERENCES pull_requests(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pull_review_threads (
  id TEXT PRIMARY KEY,
  pull_request_id TEXT NOT NULL,
  path TEXT NOT NULL,
  line INTEGER,
  side TEXT NOT NULL DEFAULT 'new' CHECK(side IN ('old', 'new')),
  commit_oid TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'resolved')),
  author_email TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  resolved_by TEXT,
  resolved_at INTEGER,
  FOREIGN KEY (pull_request_id) REFERENCES pull_requests(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pull_thread_comments (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  author_email TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (thread_id) REFERENCES pull_review_threads(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS code_index (
  repo_id TEXT NOT NULL,
  path TEXT NOT NULL,
  oid TEXT,
  content TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (repo_id, path)
);

CREATE TABLE IF NOT EXISTS repo_stars (
  repo_id TEXT NOT NULL,
  user_email TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (repo_id, user_email),
  FOREIGN KEY (repo_id) REFERENCES repositories(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS repo_watches (
  repo_id TEXT NOT NULL,
  user_email TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (repo_id, user_email),
  FOREIGN KEY (repo_id) REFERENCES repositories(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS repo_events (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL,
  full_name TEXT NOT NULL,
  actor_email TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('repo_created','push','issue_opened','issue_closed','issue_reopened','issue_commented','pr_opened','pr_closed','pr_merged','pr_reviewed','pr_commented','fork_created')),
  subject_type TEXT,
  subject_number INTEGER,
  subject_oid TEXT,
  payload TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_email TEXT NOT NULL,
  repository_id TEXT,
  full_name TEXT NOT NULL,
  actor_email TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  subject_type TEXT,
  subject_number INTEGER,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS repo_webhooks (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL,
  full_name TEXT NOT NULL,
  url TEXT NOT NULL,
  url_prefix TEXT NOT NULL DEFAULT '',
  secret TEXT NOT NULL,
  secret_suffix TEXT NOT NULL DEFAULT '',
  events TEXT NOT NULL DEFAULT '[]',
  is_active INTEGER NOT NULL DEFAULT 1,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_delivery_at INTEGER,
  last_delivery_status TEXT,
  creator_email TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id TEXT PRIMARY KEY,
  hook_id TEXT NOT NULL,
  repository_id TEXT NOT NULL,
  event TEXT NOT NULL,
  event_id TEXT,
  payload TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','success','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_retry_at INTEGER NOT NULL,
  last_http_status INTEGER,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (hook_id) REFERENCES repo_webhooks(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS releases (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL,
  tag_name TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  is_draft INTEGER NOT NULL DEFAULT 1,
  is_prerelease INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  published_at INTEGER,
  FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE,
  UNIQUE (repository_id, tag_name)
);

CREATE TABLE IF NOT EXISTS release_assets (
  id TEXT PRIMARY KEY,
  release_id TEXT NOT NULL,
  repository_id TEXT NOT NULL,
  name TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  sha256 TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (release_id) REFERENCES releases(id) ON DELETE CASCADE,
  UNIQUE (release_id, name)
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL,
  number INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'closed')),
  creator_email TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE,
  UNIQUE (repository_id, number)
);

CREATE TABLE IF NOT EXISTS project_columns (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  position REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  UNIQUE (project_id, title)
);

CREATE TABLE IF NOT EXISTS project_cards (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  column_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'note' CHECK(kind IN ('note', 'issue', 'pull')),
  note_title TEXT,
  note_body TEXT,
  issue_id TEXT,
  pull_request_id TEXT,
  position REAL NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  creator_email TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (column_id) REFERENCES project_columns(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS discussion_categories (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  kind TEXT NOT NULL DEFAULT 'general' CHECK(kind IN ('general', 'qa', 'announcement', 'ideas')),
  created_at INTEGER NOT NULL,
  FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE,
  UNIQUE (repository_id, slug)
);

CREATE TABLE IF NOT EXISTS discussions (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL,
  category_id TEXT,
  number INTEGER NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  author_email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'locked', 'answered')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES discussion_categories(id) ON DELETE SET NULL,
  UNIQUE (repository_id, number)
);

CREATE TABLE IF NOT EXISTS discussion_comments (
  id TEXT PRIMARY KEY,
  discussion_id TEXT NOT NULL,
  author_email TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (discussion_id) REFERENCES discussions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS wiki_pages (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE,
  UNIQUE (repository_id, slug)
);

CREATE TABLE IF NOT EXISTS wiki_revisions (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  author_email TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (page_id) REFERENCES wiki_pages(id) ON DELETE CASCADE,
  UNIQUE (page_id, revision)
);

CREATE TABLE IF NOT EXISTS snippets (
  id TEXT PRIMARY KEY,
  owner_email TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  visibility TEXT NOT NULL DEFAULT 'public' CHECK(visibility IN ('public', 'secret')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (owner_email) REFERENCES users(email) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS snippet_files (
  id TEXT PRIMARY KEY,
  snippet_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (snippet_id) REFERENCES snippets(id) ON DELETE CASCADE,
  UNIQUE (snippet_id, filename)
);

CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  slug_ci TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  UNIQUE (org_id, slug_ci)
);

CREATE TABLE IF NOT EXISTS team_members (
  team_id TEXT NOT NULL,
  user_email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('admin', 'member')),
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (team_id, user_email),
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS team_repo_grants (
  team_id TEXT NOT NULL,
  repo_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin', 'write', 'read')),
  granted_by TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (team_id, repo_id),
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
  FOREIGN KEY (repo_id) REFERENCES repositories(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audit_logs (
  log_id TEXT PRIMARY KEY,
  timestamp INTEGER NOT NULL,
  user_email TEXT NOT NULL,
  action TEXT NOT NULL,
  resource TEXT,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  detail TEXT,
  ip_address TEXT,
  user_agent TEXT,
  org_id TEXT,
  repo_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS repo_imports (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  refs_json TEXT,
  imported_refs INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS repo_mirrors (
  repository_id TEXT PRIMARY KEY,
  source_url TEXT NOT NULL,
  interval_minutes INTEGER NOT NULL DEFAULT 1440,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_run_at INTEGER,
  last_status TEXT,
  last_error TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS deploy_keys (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  token_prefix TEXT,
  permission TEXT NOT NULL DEFAULT 'read',
  expires_at INTEGER NOT NULL,
  last_used_at INTEGER,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS token_repo_grants (
  token_id TEXT NOT NULL,
  repository_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (token_id, repository_id),
  FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS repo_security_settings (
  repository_id TEXT PRIMARY KEY,
  secret_scan_mode TEXT NOT NULL DEFAULT 'warn',
  updated_by TEXT,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS check_runs (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL,
  head_sha TEXT NOT NULL,
  context TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  conclusion TEXT,
  details_url TEXT,
  output_title TEXT,
  output_summary TEXT,
  creator_email TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE,
  UNIQUE (repository_id, head_sha, context)
);

CREATE TABLE IF NOT EXISTS repo_number_counters (
  repository_id TEXT NOT NULL,
  entity TEXT NOT NULL,
  next_number INTEGER NOT NULL,
  PRIMARY KEY (repository_id, entity)
);

CREATE VIRTUAL TABLE IF NOT EXISTS repo_fts USING fts5(repo_id UNINDEXED, full_name, description, tokenize='porter');

CREATE VIRTUAL TABLE IF NOT EXISTS issue_fts USING fts5(issue_id UNINDEXED, repo_id UNINDEXED, full_name, title, body, tokenize='porter');

CREATE VIRTUAL TABLE IF NOT EXISTS code_fts USING fts5(repo_id UNINDEXED, path, content, tokenize='porter');

CREATE VIRTUAL TABLE IF NOT EXISTS pull_fts USING fts5(pull_id UNINDEXED, repo_id UNINDEXED, full_name, title, body, tokenize='porter');

CREATE VIRTUAL TABLE IF NOT EXISTS discussion_fts USING fts5(discussion_id UNINDEXED, repo_id UNINDEXED, title, body, tokenize='porter');

CREATE VIRTUAL TABLE IF NOT EXISTS snippet_fts USING fts5(snippet_id UNINDEXED, title, body, tokenize='porter');

-- ============================================================
-- Indexes
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_repositories_owner_name ON repositories(owner, name);
CREATE INDEX IF NOT EXISTS idx_repositories_owner_email ON repositories(owner_email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_ci ON users(username);
CREATE INDEX IF NOT EXISTS idx_org_members_user ON organization_members(user_email);
CREATE INDEX IF NOT EXISTS idx_org_members_org ON organization_members(org_id);
CREATE INDEX IF NOT EXISTS idx_repo_collab_user ON repo_collaborators(user_email);
CREATE INDEX IF NOT EXISTS idx_repo_collab_repo ON repo_collaborators(repo_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_repositories_owner_ci_name_ci ON repositories(owner_ci, name_ci);
CREATE INDEX IF NOT EXISTS idx_repositories_org ON repositories(org_id);
CREATE INDEX IF NOT EXISTS idx_repositories_forked_from ON repositories(forked_from_repo_id);
CREATE INDEX IF NOT EXISTS idx_tokens_user ON user_access_tokens(user_email);
CREATE INDEX IF NOT EXISTS idx_tokens_hash ON user_access_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_branch_rules_repo ON branch_protection_rules(repository_id);
CREATE INDEX IF NOT EXISTS idx_labels_repo ON labels(repository_id);
CREATE INDEX IF NOT EXISTS idx_milestones_repo ON milestones(repository_id);
CREATE INDEX IF NOT EXISTS idx_issues_repo ON issues(repository_id);
CREATE INDEX IF NOT EXISTS idx_comments_issue ON comments(issue_id);
CREATE INDEX IF NOT EXISTS idx_pull_requests_repo ON pull_requests(repository_id);
CREATE INDEX IF NOT EXISTS idx_pull_requests_status ON pull_requests(repository_id, status);
CREATE INDEX IF NOT EXISTS idx_pull_requests_head_repo ON pull_requests(head_repository_id);
CREATE INDEX IF NOT EXISTS idx_pr_reviews_pr ON pull_request_reviews(pull_request_id);
CREATE INDEX IF NOT EXISTS idx_pr_comments_pr ON pull_request_comments(pull_request_id);
CREATE INDEX IF NOT EXISTS idx_pr_threads_pr ON pull_review_threads(pull_request_id);
CREATE INDEX IF NOT EXISTS idx_pr_threads_status ON pull_review_threads(pull_request_id, status);
CREATE INDEX IF NOT EXISTS idx_pr_thread_comments_thread ON pull_thread_comments(thread_id);
CREATE INDEX IF NOT EXISTS idx_code_index_repo ON code_index(repo_id);
CREATE INDEX IF NOT EXISTS idx_repo_stars_user ON repo_stars(user_email);
CREATE INDEX IF NOT EXISTS idx_repo_stars_repo ON repo_stars(repo_id);
CREATE INDEX IF NOT EXISTS idx_repo_watches_user ON repo_watches(user_email);
CREATE INDEX IF NOT EXISTS idx_repo_watches_repo ON repo_watches(repo_id);
CREATE INDEX IF NOT EXISTS idx_repo_events_repo_time ON repo_events(repository_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_email, is_read, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_repo_webhooks_repo ON repo_webhooks(repository_id);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_due ON webhook_deliveries(status, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_hook_time ON webhook_deliveries(hook_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_repo ON webhook_deliveries(repository_id);
CREATE INDEX IF NOT EXISTS idx_releases_repo ON releases(repository_id);
CREATE INDEX IF NOT EXISTS idx_releases_repo_published ON releases(repository_id, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_release_assets_release ON release_assets(release_id);
CREATE INDEX IF NOT EXISTS idx_release_assets_repo ON release_assets(repository_id);
CREATE INDEX IF NOT EXISTS idx_projects_repo ON projects(repository_id);
CREATE INDEX IF NOT EXISTS idx_project_columns_project ON project_columns(project_id);
CREATE INDEX IF NOT EXISTS idx_project_cards_project ON project_cards(project_id);
CREATE INDEX IF NOT EXISTS idx_project_cards_column ON project_cards(column_id);
CREATE INDEX IF NOT EXISTS idx_discussion_categories_repo ON discussion_categories(repository_id);
CREATE INDEX IF NOT EXISTS idx_discussions_repo ON discussions(repository_id);
CREATE INDEX IF NOT EXISTS idx_discussions_category ON discussions(category_id);
CREATE INDEX IF NOT EXISTS idx_discussion_comments_discussion ON discussion_comments(discussion_id);
CREATE INDEX IF NOT EXISTS idx_wiki_pages_repo ON wiki_pages(repository_id);
CREATE INDEX IF NOT EXISTS idx_wiki_revisions_page ON wiki_revisions(page_id);
CREATE INDEX IF NOT EXISTS idx_snippets_owner ON snippets(owner_email);
CREATE INDEX IF NOT EXISTS idx_snippets_visibility ON snippets(visibility);
CREATE INDEX IF NOT EXISTS idx_snippet_files_snippet ON snippet_files(snippet_id);
CREATE INDEX IF NOT EXISTS idx_teams_org ON teams(org_id);
CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members(user_email);
CREATE INDEX IF NOT EXISTS idx_team_members_team ON team_members(team_id);
CREATE INDEX IF NOT EXISTS idx_team_grants_repo ON team_repo_grants(repo_id);
CREATE INDEX IF NOT EXISTS idx_team_grants_team ON team_repo_grants(team_id);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_email);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_user_timestamp ON audit_logs(user_email, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_org_timestamp ON audit_logs(org_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_repo_timestamp ON audit_logs(repo_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_imports_repo ON repo_imports(repository_id);
CREATE INDEX IF NOT EXISTS idx_imports_status ON repo_imports(status);
CREATE INDEX IF NOT EXISTS idx_deploy_keys_repo ON deploy_keys(repository_id);
CREATE INDEX IF NOT EXISTS idx_deploy_keys_hash ON deploy_keys(token_hash);
CREATE INDEX IF NOT EXISTS idx_token_grants_token ON token_repo_grants(token_id);
CREATE INDEX IF NOT EXISTS idx_check_runs_repo_sha ON check_runs(repository_id, head_sha);
CREATE INDEX IF NOT EXISTS idx_check_runs_status ON check_runs(status, updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_issues_repo_number ON issues(repository_id, number);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pulls_repo_number ON pull_requests(repository_id, number);
CREATE UNIQUE INDEX IF NOT EXISTS idx_discussions_repo_number ON discussions(repository_id, number);
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_repo_number ON projects(repository_id, number);

-- ============================================================
-- FTS sync triggers (final versions; code_fts is rowid-linked)
-- ============================================================

CREATE TRIGGER IF NOT EXISTS trg_repo_fts_ai AFTER INSERT ON repositories BEGIN
  INSERT INTO repo_fts(repo_id, full_name, description)
  VALUES (NEW.id, NEW.owner || '/' || NEW.name, COALESCE(NEW.description, ''));
END;

CREATE TRIGGER IF NOT EXISTS trg_repo_fts_ad AFTER DELETE ON repositories BEGIN
  DELETE FROM repo_fts WHERE repo_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_repo_fts_au AFTER UPDATE ON repositories BEGIN
  DELETE FROM repo_fts WHERE repo_id = OLD.id;
  INSERT INTO repo_fts(repo_id, full_name, description)
  VALUES (NEW.id, NEW.owner || '/' || NEW.name, COALESCE(NEW.description, ''));
END;

CREATE TRIGGER IF NOT EXISTS trg_issue_fts_ai AFTER INSERT ON issues BEGIN
  INSERT INTO issue_fts(issue_id, repo_id, full_name, title, body)
  VALUES (NEW.id, NEW.repository_id, NEW.full_name, NEW.title, COALESCE(NEW.body, ''));
END;

CREATE TRIGGER IF NOT EXISTS trg_issue_fts_ad AFTER DELETE ON issues BEGIN
  DELETE FROM issue_fts WHERE issue_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_issue_fts_au AFTER UPDATE ON issues BEGIN
  DELETE FROM issue_fts WHERE issue_id = OLD.id;
  INSERT INTO issue_fts(issue_id, repo_id, full_name, title, body)
  VALUES (NEW.id, NEW.repository_id, NEW.full_name, NEW.title, COALESCE(NEW.body, ''));
END;

CREATE TRIGGER IF NOT EXISTS trg_code_fts_ai AFTER INSERT ON code_index BEGIN
  INSERT INTO code_fts(rowid, repo_id, path, content) VALUES (NEW.rowid, NEW.repo_id, NEW.path, NEW.content);
END;

CREATE TRIGGER IF NOT EXISTS trg_code_fts_ad AFTER DELETE ON code_index BEGIN
  DELETE FROM code_fts WHERE rowid = OLD.rowid;
END;

CREATE TRIGGER IF NOT EXISTS trg_code_fts_au AFTER UPDATE ON code_index BEGIN
  DELETE FROM code_fts WHERE rowid = OLD.rowid;
  INSERT INTO code_fts(rowid, repo_id, path, content) VALUES (NEW.rowid, NEW.repo_id, NEW.path, NEW.content);
END;

CREATE TRIGGER IF NOT EXISTS trg_pull_fts_ai AFTER INSERT ON pull_requests BEGIN
  INSERT INTO pull_fts(pull_id, repo_id, full_name, title, body)
  VALUES (NEW.id, NEW.repository_id, NEW.full_name, NEW.title, COALESCE(NEW.body, ''));
END;

CREATE TRIGGER IF NOT EXISTS trg_pull_fts_ad AFTER DELETE ON pull_requests BEGIN
  DELETE FROM pull_fts WHERE pull_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_pull_fts_au AFTER UPDATE ON pull_requests BEGIN
  DELETE FROM pull_fts WHERE pull_id = OLD.id;
  INSERT INTO pull_fts(pull_id, repo_id, full_name, title, body)
  VALUES (NEW.id, NEW.repository_id, NEW.full_name, NEW.title, COALESCE(NEW.body, ''));
END;

CREATE TRIGGER IF NOT EXISTS trg_discussion_fts_ai AFTER INSERT ON discussions BEGIN
  INSERT INTO discussion_fts(discussion_id, repo_id, title, body)
  VALUES (NEW.id, NEW.repository_id, NEW.title, COALESCE(NEW.body, ''));
END;

CREATE TRIGGER IF NOT EXISTS trg_discussion_fts_ad AFTER DELETE ON discussions BEGIN
  DELETE FROM discussion_fts WHERE discussion_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_discussion_fts_au AFTER UPDATE ON discussions BEGIN
  DELETE FROM discussion_fts WHERE discussion_id = OLD.id;
  INSERT INTO discussion_fts(discussion_id, repo_id, title, body)
  VALUES (NEW.id, NEW.repository_id, NEW.title, COALESCE(NEW.body, ''));
END;

CREATE TRIGGER IF NOT EXISTS trg_snippet_fts_ai AFTER INSERT ON snippets BEGIN
  INSERT INTO snippet_fts(snippet_id, title, body)
  VALUES (NEW.id, NEW.title, '');
END;

CREATE TRIGGER IF NOT EXISTS trg_snippet_fts_ad AFTER DELETE ON snippets BEGIN
  DELETE FROM snippet_fts WHERE snippet_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_snippet_fts_au AFTER UPDATE ON snippets BEGIN
  DELETE FROM snippet_fts WHERE snippet_id = OLD.id;
  INSERT INTO snippet_fts(snippet_id, title, body)
  VALUES (NEW.id, NEW.title, '');
END;
