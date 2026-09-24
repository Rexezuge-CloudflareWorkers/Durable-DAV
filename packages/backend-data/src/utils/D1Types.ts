// Minimal structural D1 types so backend-data (Layer 2) typechecks without
// Cloudflare workers-types. Real D1Database satisfies these structurally.
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[] }>;
  run(): Promise<D1Result>;
}

interface D1Result {
  success: boolean;
  error?: string;
  meta?: { changes?: number; [key: string]: unknown };
}

interface D1Queryable {
  prepare(query: string): D1PreparedStatement;
  batch?(statements: D1PreparedStatement[]): Promise<D1Result[]>;
}

export type { D1PreparedStatement, D1Queryable, D1Result };
