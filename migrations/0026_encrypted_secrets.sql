-- Migration 0026: encrypted secrets at rest (3 per-feature AES-GCM keys).
-- Adds encrypted columns + IVs alongside the plaintext columns (dual-write).
-- Plaintext stays the read fallback until the backfill/drop lands, so
-- this migration is safe for existing databases and fresh installs.
-- Key mapping (Secrets Store, see apps/api/wrangler.template.jsonc):
--   repo_webhooks.secret    <- WEBHOOK_ENCRYPTION_KEY_SECRET
--   repo_mirrors.source_url <- MIRROR_ENCRYPTION_KEY_SECRET
--   repo_imports.source_url <- IMPORT_ENCRYPTION_KEY_SECRET
-- DAOs dual-write both copies and read encrypted-first with plaintext
-- fallback (see WebhookDAO/MirrorDAO/ImportDAO).

ALTER TABLE repo_webhooks ADD COLUMN encrypted_secret TEXT;
ALTER TABLE repo_webhooks ADD COLUMN secret_iv TEXT;

ALTER TABLE repo_mirrors ADD COLUMN encrypted_source_url TEXT;
ALTER TABLE repo_mirrors ADD COLUMN source_url_iv TEXT;

ALTER TABLE repo_imports ADD COLUMN encrypted_source_url TEXT;
ALTER TABLE repo_imports ADD COLUMN source_url_iv TEXT;
