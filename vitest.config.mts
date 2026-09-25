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
        statements: 0,
        branches: 0,
        functions: 0,
        lines: 0,
      },
    },
  },
  resolve: {
    alias: [
      { find: /^@durable-dav\/background$/, replacement: `${backgroundSrcPath}/index.ts` },
      { find: /^@durable-dav\/backend-data$/, replacement: `${backendDataSrcPath}/index.ts` },
      { find: /^@durable-dav\/backend-errors$/, replacement: `${backendErrorsSrcPath}/index.ts` },
      { find: /^@durable-dav\/backend-runtime$/, replacement: `${backendRuntimeSrcPath}/index.ts` },
      { find: /^@durable-dav\/backend-services$/, replacement: `${backendServicesSrcPath}/index.ts` },
      { find: /^@durable-dav\/webdav$/, replacement: `${webdavSrcPath}/index.ts` },
      { find: /^@durable-dav\/dav-store$/, replacement: `${davStoreSrcPath}/index.ts` },
      { find: /^@durable-dav\/shared$/, replacement: `${sharedSrcPath}/index.ts` },
      { find: '@durable-dav/background', replacement: backgroundSrcPath },
      { find: '@durable-dav/backend-data', replacement: backendDataSrcPath },
      { find: '@durable-dav/backend-errors', replacement: backendErrorsSrcPath },
      { find: '@durable-dav/backend-runtime', replacement: backendRuntimeSrcPath },
      { find: '@durable-dav/backend-services', replacement: backendServicesSrcPath },
      { find: '@durable-dav/webdav', replacement: webdavSrcPath },
      { find: '@durable-dav/dav-store', replacement: davStoreSrcPath },
      { find: '@durable-dav/shared', replacement: sharedSrcPath },
      { find: 'cloudflare:sockets', replacement: cloudflareSocketsMockPath },
      { find: 'cloudflare:workers', replacement: cloudflareWorkersMockPath },
      { find: 'cloudflare:workflows', replacement: cloudflareWorkflowsMockPath },
      { find: /^@\//, replacement: `${apiSrcPath}/` },
    ],
  },
});
