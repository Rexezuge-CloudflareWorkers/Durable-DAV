import type { D1Queryable } from '../utils/D1Types';
import { isMissingSchemaError } from '../utils/D1ErrorClassifier';
import { DatabaseError } from '@duradav/backend-errors';
import { buildScopedLikeStatement, likeParamsForTokens } from './SearchQueries';

function rowsOrEmpty<T>(result: { results?: T[] } | null | undefined): T[] {
  return result?.results ?? [];
}

function throwUnlessMissingSchema(error: unknown, resource: string): void {
  if (!isMissingSchemaError(error)) {
    throw new DatabaseError(
      `Failed to search ${resource}: ${error instanceof Error ? error.message : String(error)}`,
      false,
      { cause: error },
    );
  }
}

async function runScopedFts<T>(database: D1Queryable, sql: string, params: unknown[]): Promise<T[]> {
  const result = await database
    .prepare(sql)
    .bind(...params)
    .all<T>();
  return rowsOrEmpty(result);
}

async function runScopedLike<T>(
  database: D1Queryable,
  sql: string,
  scopeValue: string | undefined,
  patterns: unknown[],
  limit: number,
): Promise<T[]> {
  const result = await (
    scopeValue ? database.prepare(sql).bind(scopeValue, ...patterns, limit) : database.prepare(sql).bind(...patterns, limit)
  ).all<T>();
  return rowsOrEmpty(result);
}

interface ScopedSearchArgs {
  resource: string;
  ftsSql: string;
  ftsParams: unknown[];
  likeSpec: {
    table: string;
    scopeColumn: string;
    scopeValue: string | undefined;
    columns: readonly string[];
    scopedOrderBy: string;
    unscopedOrderBy: string;
  };
  tokens: string[];
  limit: number;
}

/**
 * Template Method for scoped FTS-first search (why: six DAO methods duplicated
 * FTS-try → LIKE-fallback → missing-schema-degrade). Extracted from
 * `SearchDAO` so the god-file stays under the 400 LOC hard guard.
 */
async function searchScopedWithTokens<T>(database: D1Queryable, args: ScopedSearchArgs): Promise<T[]> {
  try {
    return await runScopedFts<T>(database, args.ftsSql, args.ftsParams);
  } catch {
    const like = buildScopedLikeStatement({
      table: args.likeSpec.table,
      scopeColumn: args.likeSpec.scopeColumn,
      scopeValue: args.likeSpec.scopeValue,
      columns: args.likeSpec.columns as string[],
      tokenCount: args.tokens.length,
      scopedOrderBy: args.likeSpec.scopedOrderBy,
      unscopedOrderBy: args.likeSpec.unscopedOrderBy,
    });
    const patterns = likeParamsForTokens(args.tokens, args.likeSpec.columns.length);
    try {
      return await runScopedLike<T>(database, like.text, like.scoped ? args.likeSpec.scopeValue : undefined, patterns, args.limit);
    } catch (error) {
      throwUnlessMissingSchema(error, args.resource);
      return [];
    }
  }
}

export { rowsOrEmpty, throwUnlessMissingSchema, runScopedFts, runScopedLike, searchScopedWithTokens };
export type { ScopedSearchArgs };
