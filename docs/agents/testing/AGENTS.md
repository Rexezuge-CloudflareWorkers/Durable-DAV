# Durable-DAV — Testing

Scope: unit + integration tests. Parent index: `../../../AGENTS.md`.

Current thresholds (`vitest.config.mts`): **statements 50 / branches 40 / functions 50 / lines 50**. Exclusions: `**/*.test.{ts,tsx}`, `**/*.d.ts`, `**/index.ts`, `**/types.d.ts`, `**/model/**`. Integration in `test/integration/` uses `@cloudflare/vitest-pool-workers` (no V8 coverage — no thresholds there). God-file guard: `scripts/check-god-files.mjs` (soft 300 / hard 400 LOC, warn-only; wired into `pnpm run checks`).
Never lower thresholds to make CI pass.

**Covered**: WebDAV helpers (`test/dav-webdav.test.ts`: path/XML/prop/lock; `test/web-davxml.test.ts`: browser XML parser) + buckets (`test/dav-buckets.test.ts`: `VolumeService` quota/owner rules, `DavPermissionService` roles, `coversVolumeGrant`, grant caps) + PATs (`test/token.test.ts`: hashing/scopes/lifecycle; `test/token-expiry-strict.test.ts`: expiry parsing; `test/token-grant-failclosed.test.ts`: grant rollback + fail-closed reads) + `AccessAuthService` (`test/auth.test.ts`: DEMO/DEV/JWT fallbacks, spoofed-header rejection) + request-scope composition (`test/composition.test.ts`: `Tokens` registry + `createRequestScope` memoization/lazy DAOs, `vi.mock`/`vi.hoisted` pattern) + shared i18n (`test/i18n.test.ts`: `getBackendStrings` locales + fallback + `formatBackendString`; web bundles via `validate_locales`), integration `DavLifecycle` (`test/integration/api/DavLifecycle.int.test.ts`: volumes + WebDAV Class 1/2 over real D1/DO via `SELF.fetch`).

**Mock patterns**:

- DAOs/services: in-memory fake D1 implementing `prepare().bind().first/all/run` with per-table arrays; assert via state, not `vi.mock` (composition test is the exception — it mocks the DAO module with `vi.hoisted` fns).
- PAT hashing: real `TokenService.hashToken` (`sha256 durable-dav-pat:`) with ephemeral random tokens; expiry via `TimestampUtil` arithmetic.
- Access auth: stub env (`DEV_AUTH_EMAIL`/`DEMO_MODE`); never trust `Cf-Access-Authenticated-User-Email`.
- Integration: `test/integration/vitest.config.mts` + `wrangler.test.jsonc` pool, shared `__INTEGRATION_MIGRATION_SQL__` seeding; `helpers/setup.ts` (`setupIntegrationTest`/`ensureUser`/`seedVolume`/`mintPatForEmail`) + `helpers/migrations.ts` (`splitSql`). Upstream fix: `dofs@0.1.0` ships an uncompiled decorator example in `dist/index.js` that the pool workerd rejects with a bare `SyntaxError`; stripped via `patches/dofs@0.1.0.patch` (`pnpm-workspace.yaml` `patchedDependencies`) — re-check on every `dofs` bump, drop the patch once upstream ships compiled dist.
