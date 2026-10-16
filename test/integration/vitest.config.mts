import { cloudflareTest, cloudflarePool } from '@cloudflare/vitest-pool-workers';
import { defineIntegrationVitestConfig } from '@rexezuge/tooling/vitest-integration';
import { fileURLToPath } from 'node:url';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const migrationsDir = path.resolve(fileURLToPath(new URL('../../migrations', import.meta.url)));
// Explicit numeric sort: `0001`, `0002`, … must apply in order, and a default
// string sort is locale-dependent.
const migrationFiles = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort((a, b) => a.localeCompare(b, 'en'));
const migrationSql = migrationFiles.map((f) => readFileSync(path.resolve(migrationsDir, f), 'utf8')).join('\n\n');
// Per-file entries alongside the flattened string: the identity-upgrade test
// seeds the pre-0004 shape, so it must be able to stop between files.
const migrationFileEntries = migrationFiles.map((name) => ({ name, sql: readFileSync(path.resolve(migrationsDir, name), 'utf8') }));

const wrangler = { configPath: './test/integration/wrangler.test.jsonc' };

// A tool config *is* an executable module: the migrations are read at import
// time, which is the only time there is.
//
// No coverage block on purpose. The v8 provider needs
// `node:inspector/promises`, which does not exist inside workerd, so
// `--coverage` fails with "No such module" — a coverage block here would look
// functional and never be run.
export default defineIntegrationVitestConfig({
  scope: '@durable-dav',
  root: new URL('../../', import.meta.url).href,
  define: {
    __INTEGRATION_MIGRATION_SQL__: JSON.stringify(migrationSql),
    __INTEGRATION_MIGRATION_FILES__: JSON.stringify(migrationFileEntries),
  },
  plugins: [cloudflareTest({ wrangler })],
  pool: cloudflarePool({ wrangler }),
  // The kit must reach the worker through Vite, not workerd's resolver: it ships
  // ESM dist with bundler-style extensionless relative imports, and resolved
  // from `node_modules/.pnpm` the runtime cannot follow them.
  ssrNoExternal: ['hono', 'chanfana', '@durable-dav', '@rexezuge'],
});
