/**
 * `cloudflare:test` is provided by `@cloudflare/vitest-pool-workers` at
 * runtime. The integration suite only uses `SELF` and `env`, so they are
 * declared here rather than pulling the pool's ambient types into every
 * project that type-checks the tests.
 */
declare module 'cloudflare:test' {
  export const SELF: { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> };
  export const env: Env;
  export const createExecutionContext: () => ExecutionContext;
  export const waitOnExecutionContext: (ctx: ExecutionContext) => Promise<void>;
  export const runInDurableObject: <T>(stub: unknown, fn: (instance: unknown) => Promise<T>) => Promise<T>;
  export const listDurableObjectIds: (namespace: unknown) => Promise<unknown[]>;
}
