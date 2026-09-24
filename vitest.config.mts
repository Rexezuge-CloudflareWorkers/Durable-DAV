import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const apiSrcPath = fileURLToPath(new URL('apps/api/src', import.meta.url));
const backgroundSrcPath = fileURLToPath(new URL('apps/background/src', import.meta.url));
const backendDataSrcPath = fileURLToPath(new URL('packages/backend-data/src', import.meta.url));
const backendErrorsSrcPath = fileURLToPath(new URL('packages/backend-errors/src', import.meta.url));
const backendRuntimeSrcPath = fileURLToPath(new URL('packages/backend-runtime/src', import.meta.url));
const webdavSrcPath = fileURLToPath(new URL('packages/webdav/src', import.meta.url));
const davStoreSrcPath = fileURLToPath(new URL('packages/dav-store/src', import.meta.url));
const sharedSrcPath = fileURLToPath(new URL('packages/shared/src', import.meta.url));
const backendServicesSrcPath = fileURLToPath(new URL('packages/backend-services/src', import.meta.url));
const cloudflareSocketsMockPath = fileURLToPath(new URL('test/mocks/cloudflare-sockets.ts', import.meta.url));
const cloudflareWorkersMockPath = fileURLToPath(new URL('test/mocks/cloudflare-workers.ts', import.meta.url));
const cloudflareWorkflowsMockPath = fileURLToPath(new URL('test/mocks/cloudflare-workflows.ts', import.meta.url));

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.{ts,tsx}'],
    exclude: ['test/integration/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      reportsDirectory: './coverage',
      include: ['apps/api/src/**/*.ts', 'apps/background/src/**/*.ts', 'packages/**/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.d.ts', '**/index.ts', '**/types.d.ts', '**/model/**'],
      thresholds: {
        statements: 50,
        branches: 40,
        functions: 50,
        lines: 50,
      },
    },
  },
  resolve: {
    alias: [
      { find: /^@duradav\/background$/, replacement: `${backgroundSrcPath}/index.ts` },
      { find: /^@duradav\/backend-data$/, replacement: `${backendDataSrcPath}/index.ts` },
      { find: /^@duradav\/backend-errors$/, replacement: `${backendErrorsSrcPath}/index.ts` },
      { find: /^@duradav\/backend-runtime$/, replacement: `${backendRuntimeSrcPath}/index.ts` },
      { find: /^@duradav\/backend-services$/, replacement: `${backendServicesSrcPath}/index.ts` },
      { find: /^@duradav\/webdav$/, replacement: `${webdavSrcPath}/index.ts` },
      { find: /^@duradav\/dav-store$/, replacement: `${davStoreSrcPath}/index.ts` },
      { find: /^@duradav\/shared$/, replacement: `${sharedSrcPath}/index.ts` },
      { find: '@duradav/background', replacement: backgroundSrcPath },
      { find: '@duradav/backend-data', replacement: backendDataSrcPath },
      { find: '@duradav/backend-errors', replacement: backendErrorsSrcPath },
      { find: '@duradav/backend-runtime', replacement: backendRuntimeSrcPath },
      { find: '@duradav/backend-services', replacement: backendServicesSrcPath },
      { find: '@duradav/webdav', replacement: webdavSrcPath },
      { find: '@duradav/dav-store', replacement: davStoreSrcPath },
      { find: '@duradav/shared', replacement: sharedSrcPath },
      { find: 'cloudflare:sockets', replacement: cloudflareSocketsMockPath },
      { find: 'cloudflare:workers', replacement: cloudflareWorkersMockPath },
      { find: 'cloudflare:workflows', replacement: cloudflareWorkflowsMockPath },
      { find: /^@\//, replacement: `${apiSrcPath}/` },
    ],
  },
});
