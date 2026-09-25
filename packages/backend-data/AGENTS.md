# Durable-DAV — Backend Data (D1/DAO Layer)

Scope: `packages/backend-data/**`. Parent index: `../../AGENTS.md`.

- All D1 access via DAOs over `D1Queryable`: `BaseDAO` (`withRetry` + `deleteRowsOlderThan`), `UserDAO` (`upsertUser`/`getByEmail` + `username`, `getByUsernameCi/setUsername`), `NamespaceDAO` (global `user` registry: `claim/claimIgnore/release/isTaken`), `UserAccessTokenDAO` (hash lookup, expiry prune, per-user list, scopes via `token_scopes` only), `DavVolumeDAO` (`getByOwnerName/getById/listVisibleForUser/listByOwnerEmail/countByOwnerEmail`, case-insensitive `owner_ci/name_ci`), `DavCollaboratorDAO` (`admin|write|read` grants, `deleteByVolume`), `TokenVolumeGrantDAO` (`setGrants/deleteByToken/deleteByVolume`).
- Utils: `D1Types` (`D1Queryable`), `D1Utils` (`executeD1WithRetry`), `D1ErrorClassifier` (retryable detection + `isMissingSchemaError` fail-closed helper), `UpdateClause` (`buildSetClause`).
- Migrations in `migrations/0001_init.sql` (single squashed baseline: `users`/`namespaces`, `user_access_tokens` + `token_scopes`, `dav_volumes` + `dav_collaborators`, `token_volume_grants`); integration embeds all `*.sql` via `__INTEGRATION_MIGRATION_SQL__`.
- Token prune path: `UserAccessTokenDAO.pruneExpired(now, limit)` called from `TaskRegistry.pruneExpiredTokens`; retention constants come from `ConfigurationManager`, never hardcoded in DAOs.
- Layer 2 (L0-only): import only `@durable-dav/shared` + `@durable-dav/backend-errors`; never `backend-runtime`, `backend-services`, or `apps/*` (enforced by `no-restricted-imports`).
