import { defineConfig } from 'vitest/config';
import { cloudflareTest, cloudflarePool } from '@cloudflare/vitest-pool-workers';
import { fileURLToPath } from 'node:url';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const apiSrcPath = fileURLToPath(new URL('../../apps/api/src', import.meta.url));
const backgroundSrcPath = fileURLToPath(new URL('../../apps/background/src', import.meta.url));
const backendDataSrcPath = fileURLToPath(new URL('../../packages/backend-data/src', import.meta.url));
const backendRuntimeSrcPath = fileURLToPath(new URL('../../packages/backend-runtime/src', import.meta.url));
const webdavSrcPath = fileURLToPath(new URL('../../packages/webdav/src', import.meta.url));
const davStoreSrcPath = fileURLToPath(new URL('../../packages/dav-store/src', import.meta.url));
const sharedSrcPath = fileURLToPath(new URL('../../packages/shared/src', import.meta.url));
const backendServicesSrcPath = fileURLToPath(new URL('../../packages/backend-services/src', import.meta.url));

const migrationsDir = path.resolve(fileURLToPath(new URL('../../migrations', import.meta.url)));
// Explicit numeric sort: `0001`, `0002`, … must apply in order, and a
// default string sort is locale-dependent.
const migrationFiles = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort((a, b) => a.localeCompare(b, 'en'));
const migrationSql = migrationFiles.map((f) => readFileSync(path.resolve(migrationsDir, f), 'utf8')).join('\n\n');
// Per-file entries alongside the flattened string: the identity-upgrade test
// seeds the pre-0004 shape, so it must be able to stop between files.
const migrationFileEntries = migrationFiles.map((name) => ({ name, sql: readFileSync(path.resolve(migrationsDir, name), 'utf8') }));

// A tool config *is* an executable module: the migrations are read and the
// aliases are resolved at import time, which is the only time there is.
// eslint-disable-next-line unicorn/no-top-level-side-effects
export default defineConfig({
  define: {
    __INTEGRATION_MIGRATION_SQL__: JSON.stringify(migrationSql),
    __INTEGRATION_MIGRATION_FILES__: JSON.stringify(migrationFileEntries),
  },
  plugins: [
    cloudflareTest({
      wrangler: {
        configPath: './test/integration/wrangler.test.jsonc',
      },
    }),
  ],
  test: {
    globals: true,
    include: ['test/integration/**/*.int.test.ts'],
    // No coverage here on purpose. The v8 provider needs
    // `node:inspector/promises`, which does not exist inside workerd, so
    // `--coverage` fails with "No such module". The previous config block
    // looked functional but had never been run.
    pool: cloudflarePool({
      wrangler: {
        configPath: './test/integration/wrangler.test.jsonc',
      },
    }),
  },
  ssr: {
    // The kit must reach the worker through Vite, not workerd's resolver: the
    // kit ships ESM dist with bundler-style extensionless relative imports,
    // and resolved from `node_modules/.pnpm` the runtime cannot follow them.
    noExternal: ['hono', 'chanfana', '@durable-dav', '@rexezuge'],
  },
  resolve: {
    // The kit ships ESM dist with bundler-style extensionless relative imports;
    // resolved from `node_modules/.pnpm` the workerd runtime cannot follow them,
    // so the kit runs through Vite's pipeline. The pattern matches the resolved
    // path, so it must not be anchored.
    noExternal: [/(^|[/\\])@rexezuge\//],
    alias: [
      { find: /^@durable-dav\/background$/, replacement: `${backgroundSrcPath}/index.ts` },
      // Subpath exports (`@durable-dav/background/replication`). The bare-prefix
      // alias below cannot serve them: it maps the specifier to the package *root*,
      // so `background/replication` resolves to `src/replication`, which is not a
      // module. These must precede it.
      { find: /^@durable-dav\/background\/(.*)$/, replacement: `${backgroundSrcPath}/$1` },
      { find: /^@durable-dav\/shared\/(.*)$/, replacement: `${sharedSrcPath}/$1` },
      { find: /^@durable-dav\/backend-data$/, replacement: `${backendDataSrcPath}/index.ts` },
      { find: /^@durable-dav\/backend-runtime$/, replacement: `${backendRuntimeSrcPath}/index.ts` },
      { find: /^@durable-dav\/webdav$/, replacement: `${webdavSrcPath}/index.ts` },
      { find: /^@durable-dav\/dav-store$/, replacement: `${davStoreSrcPath}/index.ts` },
      { find: /^@durable-dav\/shared$/, replacement: `${sharedSrcPath}/index.ts` },
      { find: /^@durable-dav\/backend-services$/, replacement: `${backendServicesSrcPath}/index.ts` },
      { find: '@durable-dav/background', replacement: backgroundSrcPath },
      { find: '@durable-dav/backend-data', replacement: backendDataSrcPath },
      { find: '@durable-dav/backend-runtime', replacement: backendRuntimeSrcPath },
      { find: '@durable-dav/webdav', replacement: webdavSrcPath },
      { find: '@durable-dav/dav-store', replacement: davStoreSrcPath },
      { find: '@durable-dav/shared', replacement: sharedSrcPath },
      { find: '@durable-dav/backend-services', replacement: backendServicesSrcPath },
      { find: /^@\//, replacement: `${apiSrcPath}/` },
    ],
  },
});
