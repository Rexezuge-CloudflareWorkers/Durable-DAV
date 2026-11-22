-- Migration 0008: Per-credential server flag.
--
-- A server credential is a bucket credential minted for a long-lived client —
-- a daemon, a scheduled uploader, a NAS mount — that cannot be rotated on a
-- schedule. Such a client must keep working indefinitely, while an ordinary
-- credential is bounded by `expires_at` and reaped by the credential-pruning
-- cron. `is_server = 1` marks the rows that are intentionally unbounded.
--
-- Additive with a constant default, exactly like 0005: D1 honours neither
-- `PRAGMA foreign_keys = off` nor `legacy_alter_table`, so a table rebuild is
-- not an option. `DEFAULT 0` is the whole safety story — every existing
-- credential must keep its current expiry behaviour, or applying this migration
-- would silently turn every time-boxed credential into a permanent one.
--
-- The actual "never expires" value lives in `expires_at` as a far-future
-- sentinel (`NEVER_EXPIRES_AT`), not as NULL: the auth lookup's
-- `expires_at > now` predicate and the pruning task's `expires_at < now` delete
-- keep working unchanged, and a NULL would be treated as expired by both.

ALTER TABLE dav_credentials ADD COLUMN is_server INTEGER NOT NULL DEFAULT 0
  CHECK(is_server IN (0, 1));
