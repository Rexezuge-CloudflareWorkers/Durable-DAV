import { IssueDAO, RepositoryDAO, SearchDAO } from '@duradav/backend-data/dao';
import type { CodeHit, DiscussionRow, IssueRow, PullRequestRow, RepositoryRow, SnippetRow } from '@duradav/backend-data/dao';
import type { D1Queryable } from '@duradav/backend-data/utils';
import { BadRequestError } from '@duradav/backend-errors';
import { EmailAddress, TimestampUtil, mapWithConcurrency } from '@duradav/shared/utils';
import { PermissionService } from '../permission/PermissionService';

interface SearchServiceEnv {
  DB: D1Queryable;
}

interface SearchServiceDeps {
  searchDAO?: () => Promise<SearchDAO>;
  repositoryDAO?: () => Promise<RepositoryDAO>;
  issueDAO?: () => Promise<IssueDAO>;
  permissionService?: () => Promise<PermissionService>;
}

const MAX_QUERY_LENGTH = 200;
const MAX_LIMIT = 50;
const MAX_INDEX_BYTES = 20_000;

type SearchType = 'repos' | 'issues' | 'pulls' | 'code' | 'discussions' | 'snippets';

class SearchService {
  private readonly deps: Required<SearchServiceDeps>;

  constructor(
    private readonly env: SearchServiceEnv,
    deps: SearchServiceDeps = {},
  ) {
    this.deps = {
      searchDAO: () => Promise.resolve(new SearchDAO(env.DB)),
      repositoryDAO: () => Promise.resolve(new RepositoryDAO(env.DB)),
      issueDAO: () => Promise.resolve(new IssueDAO(env.DB)),
      permissionService: () => Promise.resolve(new PermissionService(env)),
      ...deps,
    };
  }

  public static sanitizeQuery(raw: string): string {
    const trimmed = raw.trim().replaceAll(/\s+/g, ' ');
    if (trimmed.length < 2) throw new BadRequestError('q must be at least 2 characters');
    if (trimmed.length > MAX_QUERY_LENGTH) throw new BadRequestError(`q must be at most ${MAX_QUERY_LENGTH} characters`);
    return trimmed.slice(0, MAX_QUERY_LENGTH);
  }

  public static clampLimit(raw: unknown): number {
    const n = typeof raw === 'string' ? Number(raw) : typeof raw === 'number' ? raw : NaN;
    if (!Number.isSafeInteger(n)) return 20;
    return Math.min(Math.max(n, 1), MAX_LIMIT);
  }

  public static parseType(raw: unknown): SearchType {
    if (raw === 'issues') return 'issues';
    if (raw === 'pulls') return 'pulls';
    if (raw === 'code') return 'code';
    if (raw === 'discussions') return 'discussions';
    if (raw === 'snippets') return 'snippets';
    return 'repos';
  }

  public static isIndexablePath(path: string): boolean {
    const p = path.trim();
    if (!p || p.length > 512) return false;
    if (p.includes('..') || p.startsWith('/') || p.includes(String.fromCodePoint(0))) return false;
    // Skip vendored/minified/lock artifacts to keep the index small.
    if (p.startsWith('node_modules/') || p.includes('/node_modules/')) return false;
    if (p === 'pnpm-lock.yaml' || p === 'package-lock.json' || p.endsWith('.min.js') || p.endsWith('.map')) return false;
    return true;
  }

  public static truncateForIndex(content: string): string {
    return content.length > MAX_INDEX_BYTES ? content.slice(0, MAX_INDEX_BYTES) : content;
  }

  private async resolvePermission(): Promise<PermissionService> {
    try {
      return await this.deps.permissionService();
    } catch {
      // Legacy direct construction fallback; prefer injected thunk via Tokens.
      return new PermissionService(this.env);
    }
  }

  private static normalizeViewer(viewerEmail: string | null): string | null {
    if (!viewerEmail) return null;
    try {
      return EmailAddress.normalize(viewerEmail);
    } catch {
      return viewerEmail;
    }
  }

  /**
   * Template for visibility-filtered search (why: 5 search* methods duplicated
   * sanitize -> over-fetch -> getRole loop; sequential N+1 dominated latency).
   * Resolves roles concurrently (cap 10) and preserves candidate order.
   */
  private async filterVisibleRepos(rows: RepositoryRow[], viewer: string | null, limit: number): Promise<RepositoryRow[]> {
    if (rows.length === 0) return [];
    const permission = await this.resolvePermission();
    const checked = await mapWithConcurrency(rows, 10, async (row) => ({
      row,
      role: await permission.getRole(viewer, row).catch(() => null),
    }));
    const visible: RepositoryRow[] = [];
    for (const { row, role } of checked) {
      if (role) visible.push(row);
      if (visible.length >= limit) break;
    }
    return visible;
  }

  public async searchRepos(query: string, viewerEmail: string | null, limit = 20): Promise<RepositoryRow[]> {
    const q = SearchService.sanitizeQuery(query);
    const viewer = SearchService.normalizeViewer(viewerEmail);
    const dao = await this.deps.searchDAO();
    // Over-fetch candidates, then filter private rows via PermissionService.
    const candidates = await dao.searchRepos(q, { limit: Math.min(limit * 3, MAX_LIMIT) });
    return this.filterVisibleRepos(candidates, viewer, SearchService.clampLimit(limit));
  }

  private async loadReposByIds(ids: readonly string[]): Promise<Map<string, RepositoryRow>> {
    const repoById = new Map<string, RepositoryRow>();
    if (ids.length === 0) return repoById;
    const repositoryDAO = await this.deps.repositoryDAO().catch(() => null);
    if (!repositoryDAO) return repoById;
    // Paired results avoid indexed existence checks (lint) and keep order.
    const paired = await mapWithConcurrency(ids, 10, async (id) => ({
      id,
      repo: await repositoryDAO.getById(id).catch(() => null),
    }));
    for (const { id, repo } of paired) {
      if (repo) repoById.set(id, repo);
    }
    return repoById;
  }

  private async checkVisibility<T>(
    items: readonly T[],
    viewer: string | null,
    resolveRepo: (item: T) => RepositoryRow | null,
  ): Promise<Array<{ item: T; visible: boolean }>> {
    const permission = await this.resolvePermission();
    return mapWithConcurrency(items, 10, async (item) => {
      const repo = resolveRepo(item);
      if (!repo) return { item, visible: false };
      const role = await permission.getRole(viewer, repo).catch(() => null);
      return { item, visible: role !== null };
    });
  }

  /**
   * Strategy for repo-scoped visibility search (why: searchIssues/Pulls/Code/
   * Discussions duplicated over-fetch → batch repo load → concurrent
   * visibility → truncate). Callers supply only the DAO fetch and the repo-id
   * extractor; ordering and truncation stay in one place.
   */
  private async runVisibilitySearch<T, R = T>(
    query: string,
    viewerEmail: string | null,
    opts: { limit?: number; repoId?: string },
    fetchCandidates: (q: string, fetchLimit: number, repoId?: string) => Promise<readonly T[]>,
    resolveRepoId: (item: T) => string,
    mapResult?: (item: T) => R,
  ): Promise<R[]> {
    const q = SearchService.sanitizeQuery(query);
    const viewer = SearchService.normalizeViewer(viewerEmail);
    const limit = SearchService.clampLimit(opts.limit ?? 20);
    const candidates = await fetchCandidates(q, Math.min(limit * 3, MAX_LIMIT), opts.repoId);
    if (candidates.length === 0) return [];
    const repoIds = [...new Set(candidates.map(resolveRepoId))];
    const repoById = await this.loadReposByIds(repoIds);
    if (repoById.size === 0) return [];
    const checked = await this.checkVisibility(candidates, viewer, (item) => repoById.get(resolveRepoId(item)) ?? null);
    const visible: R[] = [];
    for (const { item, visible: isVisible } of checked) {
      if (!isVisible) continue;
      visible.push(mapResult ? mapResult(item) : (item as unknown as R));
      if (visible.length >= limit) break;
    }
    return visible;
  }

  public async searchIssues(
    query: string,
    viewerEmail: string | null,
    opts: { limit?: number; repoId?: string } = {},
  ): Promise<IssueRow[]> {
    const dao = await this.deps.searchDAO();
    return this.runVisibilitySearch<IssueRow>(
      query,
      viewerEmail,
      opts,
      (q, fetchLimit, repoId) => dao.searchIssues(q, { limit: fetchLimit, repoId }),
      (issue) => issue.repository_id,
    );
  }

  public async searchPulls(
    query: string,
    viewerEmail: string | null,
    opts: { limit?: number; repoId?: string } = {},
  ): Promise<PullRequestRow[]> {
    const dao = await this.deps.searchDAO();
    return this.runVisibilitySearch<PullRequestRow>(
      query,
      viewerEmail,
      opts,
      (q, fetchLimit, repoId) => dao.searchPulls(q, { limit: fetchLimit, repoId }),
      (pull) => pull.repository_id,
    );
  }

  public async searchCode(
    query: string,
    viewerEmail: string | null,
    opts: { limit?: number; repoId?: string } = {},
  ): Promise<Array<CodeHit & { snippet: string }>> {
    const dao = await this.deps.searchDAO();
    // Snippet token is derived from the sanitized query so mapping stays pure.
    const q = SearchService.sanitizeQuery(query);
    const firstToken = q.split(' ', 1)[0]?.toLowerCase() ?? '';
    return this.runVisibilitySearch<CodeHit, CodeHit & { snippet: string }>(
      query,
      viewerEmail,
      opts,
      (sanitized, fetchLimit, repoId) => dao.searchCode(sanitized, { limit: fetchLimit, repoId }),
      (hit) => hit.repo_id,
      (hit) => ({ ...hit, snippet: SearchService.buildSnippet(hit.content, firstToken) }),
    );
  }

  private static buildSnippet(content: string, token: string): string {
    const idx = content.toLowerCase().indexOf(token);
    if (idx === -1) return content.slice(0, 200);
    const start = Math.max(0, idx - 80);
    return content.slice(start, start + 200);
  }

  public async indexFile(input: { repoId: string; path: string; oid: string | null; content: string }): Promise<boolean> {
    if (!SearchService.isIndexablePath(input.path)) return false;
    if (input.content.includes(String.fromCodePoint(0))) return false;
    const dao = await this.deps.searchDAO();
    await dao.upsertCodeFile({
      repoId: input.repoId,
      path: input.path,
      oid: input.oid,
      content: SearchService.truncateForIndex(input.content),
      now: TimestampUtil.getCurrentUnixTimestampInSeconds(),
    });
    return true;
  }

  public async removeFile(repoId: string, path: string): Promise<void> {
    const dao = await this.deps.searchDAO();
    await dao.deleteCodeFile(repoId, path);
  }

  // Backfill dirty-check: indexed (path, oid) pairs for one repo so unchanged
  // HEAD files skip their blob fetch and upsert entirely.
  public async getIndexedOids(repoId: string): Promise<Map<string, string | null>> {
    const dao = await this.deps.searchDAO();
    const rows = await dao.getOidsByRepo(repoId);
    const map = new Map<string, string | null>();
    for (const row of rows) map.set(row.path, row.oid);
    return map;
  }

  // Batched backfill write: indexable filtering + truncation mirror
  // indexFile, then a single D1 batch per repo. Returns rows changed.
  public async indexFiles(entries: Array<{ repoId: string; path: string; oid: string | null; content: string }>): Promise<number> {
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    const rows: Array<{ repoId: string; path: string; oid: string | null; content: string; now: number }> = [];
    for (const entry of entries) {
      if (!SearchService.isIndexablePath(entry.path)) continue;
      if (entry.content.includes(String.fromCodePoint(0))) continue;
      rows.push({ repoId: entry.repoId, path: entry.path, oid: entry.oid, content: SearchService.truncateForIndex(entry.content), now });
    }
    if (rows.length === 0) return 0;
    const dao = await this.deps.searchDAO();
    return dao.upsertCodeFiles(rows);
  }

  // Remove index rows for paths no longer at HEAD. Only call after a
  // successful HEAD listing (see `SearchDAO.pruneStaleCodePaths`).
  public async purgeStalePaths(repoId: string, keepPaths: string[]): Promise<number> {
    const dao = await this.deps.searchDAO();
    return dao.pruneStaleCodePaths(repoId, keepPaths);
  }

  public async searchDiscussions(
    query: string,
    viewerEmail: string | null,
    opts: { limit?: number; repoId?: string } = {},
  ): Promise<DiscussionRow[]> {
    const dao = await this.deps.searchDAO();
    return this.runVisibilitySearch<DiscussionRow>(
      query,
      viewerEmail,
      opts,
      (q, fetchLimit, repoId) => dao.searchDiscussions(q, { limit: fetchLimit, repoId }),
      (d) => d.repository_id,
    );
  }

  public async searchSnippets(query: string, opts: { limit?: number } = {}): Promise<SnippetRow[]> {
    const q = SearchService.sanitizeQuery(query);
    const limit = SearchService.clampLimit(opts.limit ?? 20);
    const dao = await this.deps.searchDAO();
    // SnippetDAO.searchSnippets already restricts to public rows.
    return dao.searchSnippets(q, { limit });
  }

  public async clearRepo(repoId: string): Promise<void> {
    const dao = await this.deps.searchDAO();
    await dao.deleteCodeByRepo(repoId);
  }
}

export { SearchService };
export type { SearchServiceDeps, SearchServiceEnv, SearchType };
