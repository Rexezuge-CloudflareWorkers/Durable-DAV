-- Migration 0027: drop plaintext secret columns (step 2 of 2; 0026 added
-- the AES-GCM envelopes and DAOs dual-wrote both copies).
-- No backfill was needed: there are no legacy rows (fresh databases only),
-- so every row already carries an envelope written by the 0026 code path.
-- After this migration the envelope columns are the sole source; DAOs read
-- encrypted-only and fail closed without a key.
-- All statements are idempotent (`IF EXISTS` guards where SQLite allows);
-- SQLite `DROP COLUMN` keeps remaining data, indexes, and unrelated
-- triggers intact. No trigger body references the dropped columns (verified:
-- FTS triggers only read owner/name/title/body).

ALTER TABLE repo_webhooks DROP COLUMN secret;
ALTER TABLE repo_mirrors DROP COLUMN source_url;
ALTER TABLE repo_imports DROP COLUMN source_url;
