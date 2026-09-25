# Durable-DAV — Backend Data (D1/DAO Layer)

Scope: `packages/backend-data/**`. Parent index: `../../AGENTS.md`.

- All D1 access via DAOs over `D1Queryable`: `BaseDAO` (`withRetry` + `deleteRowsOlderThan`), `UserDAO` (`upsertUser`/`getByEmail` + `username`, `getByUsernameCi/setUsername`), `NamespaceDAO` (global `user` registry: `claim/claimIgnore/release/isTaken`), `DavVolumeDAO` (`getByOwnerName/getById/listVisibleForUser/listByOwnerEmail/listPublicByOwner/countByOwnerEmail/update`, case-insensitive `owner_ci/name_ci`), `DavCredentialDAO` (`getByUsernameAndHash/listByVolume/countByVolume/usernameExists/updateLastUsed/deleteForVolume/deleteByVolume/pruneExpired`).
- Utils: `D1Types` (`D1Queryable`), `D1Utils` (`executeD1WithRetry`), `D1ErrorClassifier` (retryable detection + `isMissingSchemaError` fail-closed helper), `UpdateClause` (`buildSetClause`).
- Migrations in `migrations/0001_init.sql` (baseline: `users`/`namespaces`, `dav_volumes` + legacy token tables) + `migrations/0002_bucket_credentials.sql` (`dav_credentials`, `dav_volumes` rebuilt with `DEFAULT 1` private-by-default, drops `user_access_tokens`/`token_scopes`/`token_volume_grants`/`dav_collaborators`); integration embeds all `*.sql` via `__INTEGRATION_MIGRATION_SQL__`.
- Credential prune path: `DavCredentialDAO.pruneExpired(now, limit)` called from `TaskRegistry.ExpiredCredentialPruningTask`; retention constants come from `ConfigurationManager`, never hardcoded in DAOs.
- Layer 2 (L0-only): import only `@durable-dav/shared` + `@durable-dav/backend-errors`; never `backend-runtime`, `backend-services`, or `apps/*` (enforced by `no-restricted-imports`).
