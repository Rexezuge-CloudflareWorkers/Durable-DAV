/// <reference types="@cloudflare/workers-types" />
/// <reference types="@cloudflare/vitest-pool-workers" />

/**
 * Injected by `test/integration/vitest.config.mts` via `define`, containing the
 * concatenation of every `migrations/*.sql`. Declared here so the integration
 * suite type-checks like the rest of the workspace.
 */
declare const __INTEGRATION_MIGRATION_SQL__: string;
