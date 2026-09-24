/**
 * Pure SQL builders for metadata/code search (Otter `*Queries.ts` pattern).
 * Keeps SQL strings and LIKE/FTS token math out of `SearchDAO` methods so
 * queries are unit-testable without D1 and the DAO shrinks toward the
 * god-file guard.
 *
 * FTS-first, LIKE-fallback strategy is unchanged: callers try the FTS5
 * statement, and on `catch` (unit fakes, old D1 without FTS5) fall back to
 * the case-insensitive LIKE statement with `ESCAPE '!'`.
 */
const SEARCH_DEFAULT_LIMIT = 20;
const SEARCH_MAX_LIMIT = 50;
const SEARCH_MAX_TOKENS = 10;

// Conditional upsert: a row that is already identical is left untouched so
// the AFTER UPDATE FTS trigger never fires. Unconditional rewrites cost
// ~250 D1 rows-read each (FTS delete-scan + re-tokenize); unchanged files
// must not pay that. `IS DISTINCT FROM` is NULL-safe (NULL oid = unknown
// blob, always rewritten when content differs).
const UPSERT_CODE_FILE_SQL = `INSERT INTO code_index (repo_id, path, oid, content, updated_at) VALUES (?, ?, ?, ?, ?)
   ON CONFLICT (repo_id, path) DO UPDATE SET oid = excluded.oid, content = excluded.content, updated_at = excluded.updated_at
   WHERE excluded.oid IS DISTINCT FROM code_index.oid OR excluded.content IS DISTINCT FROM code_index.content`;

function clampSearchLimit(limit: number | undefined): number {
  if (!limit || !Number.isSafeInteger(limit)) return SEARCH_DEFAULT_LIMIT;
  return Math.min(Math.max(limit, 1), SEARCH_MAX_LIMIT);
}

function escapeSearchLike(term: string): string {
  return term.replaceAll('!', '!!').replaceAll('%', '!%').replaceAll('_', '!_');
}

function tokenizeSearchQuery(query: string): string[] {
  return query.trim().split(/\s+/).filter(Boolean).slice(0, SEARCH_MAX_TOKENS);
}

function buildFtsQuery(tokens: string[]): string {
  return tokens.map((t) => `"${t.replaceAll('"', '""')}"*`).join(' AND ');
}

function buildLikePattern(token: string): string {
  return `%${escapeSearchLike(token.toLowerCase())}%`;
}

/**
 * One `(a LIKE ? OR b LIKE ? ...)` group per token, groups joined with AND.
 * `columns` are SQL value expressions (e.g. `lower(title)`); every LIKE uses
 * `ESCAPE '!'` so `%`/`_` in user input match literally.
 */
function buildLikeOrClause(columns: string[], tokenCount: number): string {
  const perToken = `(${columns.map((c) => `${c} LIKE ? ESCAPE '!'`).join(' OR ')})`;
  return Array.from({ length: tokenCount }, () => perToken).join(' AND ');
}

function likeParamsForTokens(tokens: string[], columnsPerToken: number): unknown[] {
  const params: unknown[] = [];
  for (const token of tokens) {
    const pattern = buildLikePattern(token);
    for (let i = 0; i < columnsPerToken; i++) params.push(pattern);
  }
  return params;
}

const REPO_SEARCH_COLUMNS = ['lower(owner)', 'lower(name)', `lower(COALESCE(description, ''))`];
const TITLE_BODY_SEARCH_COLUMNS = ['lower(title)', `lower(COALESCE(body, ''))`];
const CODE_SEARCH_COLUMNS = ['lower(path)', 'lower(content)'];
const SNIPPET_SEARCH_COLUMNS = ['lower(title)'];

interface ScopedLikeSearch {
  table: string;
  scopeColumn: string;
  scopeValue?: string;
  columns: string[];
  tokenCount: number;
  scopedOrderBy: string;
  unscopedOrderBy: string;
}

/**
 * LIKE-fallback statement for the four repo-scoped searches (issues, pulls,
 * code, discussions). Centralizes the `WHERE <scope> = ? AND <likes> ...`
 * vs unscoped template plus the bind-order contract (scope first, LIKE
 * patterns, limit last) so the DAOs no longer juggle `params.push/slice`.
 * Returns `scoped` so the caller binds `scopeValue` only when present.
 */
function buildScopedLikeStatement(search: ScopedLikeSearch): { text: string; scoped: boolean } {
  const likes = buildLikeOrClause(search.columns, search.tokenCount);
  if (search.scopeValue) {
    return {
      scoped: true,
      text: `SELECT * FROM ${search.table} WHERE ${search.scopeColumn} = ? AND ${likes} ORDER BY ${search.scopedOrderBy} LIMIT ?`,
    };
  }
  return {
    scoped: false,
    text: `SELECT * FROM ${search.table} WHERE ${likes} ORDER BY ${search.unscopedOrderBy} LIMIT ?`,
  };
}

// Shared query preamble: tokenize + clamp once so the six search domains
// stay consistent. Returns null when the query is empty.
function prepareSearchQuery(query: string, limitOpt?: number): { limit: number; tokens: string[]; ftsQuery: string } | null {
  const limit = clampSearchLimit(limitOpt);
  const tokens = tokenizeSearchQuery(query);
  if (tokens.length === 0) return null;
  return { limit, tokens, ftsQuery: buildFtsQuery(tokens) };
}

export {
  SEARCH_DEFAULT_LIMIT,
  SEARCH_MAX_LIMIT,
  SEARCH_MAX_TOKENS,
  UPSERT_CODE_FILE_SQL,
  clampSearchLimit,
  escapeSearchLike,
  tokenizeSearchQuery,
  buildFtsQuery,
  buildLikePattern,
  buildLikeOrClause,
  buildScopedLikeStatement,
  likeParamsForTokens,
  prepareSearchQuery,
  REPO_SEARCH_COLUMNS,
  TITLE_BODY_SEARCH_COLUMNS,
  CODE_SEARCH_COLUMNS,
  SNIPPET_SEARCH_COLUMNS,
};
