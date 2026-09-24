import { BaseDAO } from './BaseDAO';
import type { D1Queryable } from '../utils/D1Types';
import { rowsOrEmpty, searchScopedWithTokens, throwUnlessMissingSchema } from './SearchFallback';
import { SearchCodeIndexDAO } from './SearchCodeIndexDAO';
import type { CodeFileInput, CodeHit, CodeOidEntry } from './SearchCodeIndexDAO';
import type { IssueRow } from './IssueDAO';
import type { PullRequestRow } from './PullRequestDAO';
import type { RepositoryRow } from './RepositoryDAO';
import type { DiscussionRow } from './DiscussionDAO';
import type { SnippetRow } from './SnippetDAO';
import {
  CODE_SEARCH_COLUMNS,
  REPO_SEARCH_COLUMNS,
  SNIPPET_SEARCH_COLUMNS,
  TITLE_BODY_SEARCH_COLUMNS,
  buildLikeOrClause,
  likeParamsForTokens,
  prepareSearchQuery,
} from './SearchQueries';

interface SearchOptions {
  limit?: number;
  repoId?: string;
}

type CodeIndexRow = CodeHit;
type CodeOidPair = CodeOidEntry;
type CodeIndexUpsert = CodeFileInput;
type SearchResource = 'repositories' | 'issues' | 'pulls' | 'code' | 'discussions' | 'snippets';

/**
 * Metadata search over repositories + issues.
 *
 * Strategy: try FTS5 (`repo_fts` / `issue_fts`) first; fall back to
 * case-insensitive LIKE when the database (unit fakes, D1 without FTS5)
 * lacks it. Callers (SearchService) filter private rows via
 * PermissionService — this DAO intentionally returns candidates including
 * private repos so visibility stays in one place.
 *
 * Token/FTS/LIKE construction lives in `SearchQueries` (pure builders);
 * methods here only run statements and degrade to `[]` when FTS is absent.
 */
class SearchDAO extends BaseDAO {
  private readonly codeIndex: SearchCodeIndexDAO;

  constructor(database: D1Queryable) {
    super(database);
    // Composition over inheritance: code-index writes live in
    // `SearchCodeIndexDAO` so this file stays under the god-file guard.
    // Delegates below preserve the old API for `SearchService`/tests.
    this.codeIndex = new SearchCodeIndexDAO(database);
  }

  // Scoped FTS-first search lives in `./SearchFallback.ts` (Template Method);
  // domain methods below supply only SQL/params + LIKE specs.
  // Why `searchWithFtsFallback`: the previous `scoped` hid the FTS→LIKE
  // fallback contract; the explicit name keeps call sites self-documenting.
  private searchWithFtsFallback<T>(args: Parameters<typeof searchScopedWithTokens>[1]): Promise<T[]> {
    return searchScopedWithTokens<T>(this.database, args);
  }

  public async searchRepos(query: string, opts: SearchOptions = {}): Promise<RepositoryRow[]> {
    const prepared = prepareSearchQuery(query, opts.limit);
    if (!prepared) return [];
    const { limit, tokens, ftsQuery } = prepared;
    // Unified with siblings via `searchWithFtsFallback` (was hand-rolled
    // FTS+LIKE here while issues/pulls/code/discussions used `scoped()` —
    // drift that hid the shared retry/degrade contract in `SearchFallback`).
    return this.searchWithFtsFallback<RepositoryRow>({
      resource: 'repositories',
      ftsSql: `SELECT r.* FROM repo_fts f JOIN repositories r ON r.id = f.repo_id WHERE repo_fts MATCH ? ORDER BY rank LIMIT ?`,
      ftsParams: [ftsQuery, limit],
      likeSpec: {
        table: 'repositories',
        scopeColumn: 'id',
        scopeValue: undefined,
        columns: REPO_SEARCH_COLUMNS,
        scopedOrderBy: 'updated_at DESC',
        unscopedOrderBy: 'updated_at DESC',
      },
      tokens,
      limit,
    });
  }

  public async searchIssues(query: string, opts: SearchOptions = {}): Promise<IssueRow[]> {
    const prepared = prepareSearchQuery(query, opts.limit);
    if (!prepared) return [];
    const { limit, tokens, ftsQuery } = prepared;
    const base = opts.repoId
      ? `SELECT i.* FROM issue_fts f JOIN issues i ON i.id = f.issue_id WHERE issue_fts MATCH ? AND f.repo_id = ? ORDER BY rank LIMIT ?`
      : `SELECT i.* FROM issue_fts f JOIN issues i ON i.id = f.issue_id WHERE issue_fts MATCH ? ORDER BY rank LIMIT ?`;
    return this.searchWithFtsFallback<IssueRow>({
      resource: 'issues',
      ftsSql: base,
      ftsParams: opts.repoId ? [ftsQuery, opts.repoId, limit] : [ftsQuery, limit],
      likeSpec: {
        table: 'issues',
        scopeColumn: 'repository_id',
        scopeValue: opts.repoId,
        columns: TITLE_BODY_SEARCH_COLUMNS,
        scopedOrderBy: 'number DESC',
        unscopedOrderBy: 'updated_at DESC',
      },
      tokens,
      limit,
    });
  }

  public async searchPulls(query: string, opts: SearchOptions = {}): Promise<PullRequestRow[]> {
    const prepared = prepareSearchQuery(query, opts.limit);
    if (!prepared) return [];
    const { limit, tokens, ftsQuery } = prepared;
    const base = opts.repoId
      ? `SELECT p.* FROM pull_fts f JOIN pull_requests p ON p.id = f.pull_id WHERE pull_fts MATCH ? AND f.repo_id = ? ORDER BY rank LIMIT ?`
      : `SELECT p.* FROM pull_fts f JOIN pull_requests p ON p.id = f.pull_id WHERE pull_fts MATCH ? ORDER BY rank LIMIT ?`;
    return this.searchWithFtsFallback<PullRequestRow>({
      resource: 'pulls',
      ftsSql: base,
      ftsParams: opts.repoId ? [ftsQuery, opts.repoId, limit] : [ftsQuery, limit],
      likeSpec: {
        table: 'pull_requests',
        scopeColumn: 'repository_id',
        scopeValue: opts.repoId,
        columns: TITLE_BODY_SEARCH_COLUMNS,
        scopedOrderBy: 'number DESC',
        unscopedOrderBy: 'updated_at DESC',
      },
      tokens,
      limit,
    });
  }

  public async searchCode(query: string, opts: SearchOptions = {}): Promise<CodeHit[]> {
    const prepared = prepareSearchQuery(query, opts.limit);
    if (!prepared) return [];
    const { limit, tokens, ftsQuery } = prepared;
    const base = opts.repoId
      ? `SELECT c.* FROM code_fts f JOIN code_index c ON c.repo_id = f.repo_id AND c.path = f.path WHERE code_fts MATCH ? AND f.repo_id = ? ORDER BY rank LIMIT ?`
      : `SELECT c.* FROM code_fts f JOIN code_index c ON c.repo_id = f.repo_id AND c.path = f.path WHERE code_fts MATCH ? ORDER BY rank LIMIT ?`;
    return this.searchWithFtsFallback<CodeHit>({
      resource: 'code',
      ftsSql: base,
      ftsParams: opts.repoId ? [ftsQuery, opts.repoId, limit] : [ftsQuery, limit],
      likeSpec: {
        table: 'code_index',
        scopeColumn: 'repo_id',
        scopeValue: opts.repoId,
        columns: CODE_SEARCH_COLUMNS,
        scopedOrderBy: 'path ASC',
        unscopedOrderBy: 'updated_at DESC',
      },
      tokens,
      limit,
    });
  }

  public async upsertCodeFile(input: CodeFileInput): Promise<number> {
    return this.codeIndex.upsertCodeFile(input);
  }

  // Batched variant for the backfill cron: one D1 batch per repo instead of
  // one roundtrip per file. See `SearchCodeIndexDAO.upsertCodeFiles`.
  public async upsertCodeFiles(inputs: CodeFileInput[]): Promise<number> {
    return this.codeIndex.upsertCodeFiles(inputs);
  }

  // Dirty-check support for the backfill cron: see `SearchCodeIndexDAO`.
  public async getOidsByRepo(repoId: string): Promise<CodeOidEntry[]> {
    return this.codeIndex.getOidsByRepo(repoId);
  }

  // Delete index rows for paths no longer present at HEAD. Only call after a
  // successful HEAD listing — never on listing failure, or a DO outage would
  // wipe the index. Returns the number of rows removed.
  // Why `pruneStaleCodePaths`: the old `deleteCodePathsNotIn` double-negative
  // hid the retain-vs-prune intent; the new name states the effect.
  public async pruneStaleCodePaths(repoId: string, keepPaths: string[]): Promise<number> {
    return this.codeIndex.pruneStaleCodePaths(repoId, keepPaths);
  }

  /**
   * @deprecated Use `pruneStaleCodePaths` — kept so `SearchService` and
   * existing tests keep working; will be removed next major.
   */
  public async deleteCodePathsNotIn(repoId: string, keepPaths: string[]): Promise<number> {
    return this.codeIndex.deleteCodePathsNotIn(repoId, keepPaths);
  }

  public async deleteCodeFile(repoId: string, path: string): Promise<void> {
    return this.codeIndex.deleteCodeFile(repoId, path);
  }

  public async deleteCodeByRepo(repoId: string): Promise<void> {
    return this.codeIndex.deleteCodeByRepo(repoId);
  }

  // Repo-delete alias: FTS rows for issues/pulls/discussions/repos are
  // trigger-maintained off their base-table deletes, so only the code index
  // (keyed by repo with no base row) needs an explicit purge here.
  public async deleteByRepo(repoId: string): Promise<void> {
    return this.codeIndex.deleteByRepo(repoId);
  }

  public async searchDiscussions(query: string, opts: SearchOptions = {}): Promise<DiscussionRow[]> {
    const prepared = prepareSearchQuery(query, opts.limit);
    if (!prepared) return [];
    const { limit, tokens, ftsQuery } = prepared;
    const base = opts.repoId
      ? `SELECT d.* FROM discussion_fts f JOIN discussions d ON d.id = f.discussion_id WHERE discussion_fts MATCH ? AND f.repo_id = ? ORDER BY rank LIMIT ?`
      : `SELECT d.* FROM discussion_fts f JOIN discussions d ON d.id = f.discussion_id WHERE discussion_fts MATCH ? ORDER BY rank LIMIT ?`;
    return this.searchWithFtsFallback<DiscussionRow>({
      resource: 'discussions',
      ftsSql: base,
      ftsParams: opts.repoId ? [ftsQuery, opts.repoId, limit] : [ftsQuery, limit],
      likeSpec: {
        table: 'discussions',
        scopeColumn: 'repository_id',
        scopeValue: opts.repoId,
        columns: TITLE_BODY_SEARCH_COLUMNS,
        scopedOrderBy: 'number DESC',
        unscopedOrderBy: 'updated_at DESC',
      },
      tokens,
      limit,
    });
  }

  public async searchSnippets(query: string, opts: { limit?: number } = {}): Promise<SnippetRow[]> {
    const prepared = prepareSearchQuery(query, opts.limit);
    if (!prepared) return [];
    const { limit, tokens, ftsQuery } = prepared;
    try {
      const result = await this.database
        .prepare(
          `SELECT s.* FROM snippet_fts f JOIN snippets s ON s.id = f.snippet_id WHERE snippet_fts MATCH ? AND s.visibility = 'public' ORDER BY rank LIMIT ?`,
        )
        .bind(ftsQuery, limit)
        .all<SnippetRow>();
      return rowsOrEmpty(result);
    } catch {
      const likes = buildLikeOrClause(SNIPPET_SEARCH_COLUMNS, tokens.length);
      const params: unknown[] = likeParamsForTokens(tokens, SNIPPET_SEARCH_COLUMNS.length);
      try {
        params.push(limit);
        const result = await this.database
          .prepare(`SELECT * FROM snippets WHERE visibility = 'public' AND ${likes} ORDER BY updated_at DESC LIMIT ?`)
          .bind(...params)
          .all<SnippetRow>();
        return rowsOrEmpty(result);
      } catch (error) {
        throwUnlessMissingSchema(error, 'snippets');
        return [];
      }
    }
  }
}

export { SearchDAO };
export type { SearchOptions, CodeIndexRow, CodeOidPair, CodeIndexUpsert, SearchResource };
export type { CodeFileInput, CodeHit, CodeOidEntry } from './SearchCodeIndexDAO';
export { SearchCodeIndexDAO } from './SearchCodeIndexDAO';
