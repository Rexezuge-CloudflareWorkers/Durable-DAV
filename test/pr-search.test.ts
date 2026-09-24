import { describe, expect, it } from 'vitest';
import { SearchDAO } from '@duradav/backend-data/dao';
import type { D1Queryable } from '@duradav/backend-data/utils';
import { PermissionService } from '@duradav/backend-services/permission';
import { SearchService } from '@duradav/backend-services/search';

function createPullSearchFakeDb(opts: {
  pulls?: Array<Record<string, unknown>>;
  repos?: Array<Record<string, unknown>>;
  ftsAvailable?: boolean;
}) {
  const pulls = opts.pulls ?? [];
  const repos = opts.repos ?? [];
  const ftsAvailable = opts.ftsAvailable ?? false;

  function statement(query: string, params: unknown[]) {
    const q = query.replace(/\s+/g, ' ').trim();
    return {
      first<T>(): Promise<T | null> {
        if (q.includes('FROM repositories WHERE id = ?')) {
          return Promise.resolve((repos.find((r) => r.id === params[0]) ?? null) as T | null);
        }
        return Promise.resolve(null);
      },
      all<T>(): Promise<{ results: T[] }> {
        if (q.includes('MATCH')) {
          if (!ftsAvailable) throw new Error('no such table: pull_fts');
          const fts = String(params[0]).toLowerCase();
          const tokens = fts
            .replaceAll('"', '')
            .replaceAll('*', '')
            .split(/\s*(?:and|or)\s*/)
            .map((t) => t.trim())
            .filter(Boolean);
          const hits = pulls.filter((p) => {
            const hay = `${p.title} ${p.body ?? ''}`.toLowerCase();
            return tokens.every((t) => hay.includes(t));
          });
          const scoped = params.length === 3 ? hits.filter((p) => p.repository_id === params[1]) : hits;
          return Promise.resolve({ results: scoped.slice(0, params[params.length - 1] as number) as T[] });
        }
        if (q.includes('FROM pull_requests WHERE')) {
          const limit = params[params.length - 1] as number;
          const hasRepoScope = q.includes('repository_id = ?');
          const likeParams = (hasRepoScope ? params.slice(1, -1) : params.slice(0, -1)) as string[];
          const patterns = likeParams.map((p) => String(p).replaceAll('%', '').replaceAll('!', '').toLowerCase());
          let hay = pulls;
          if (hasRepoScope) hay = hay.filter((p) => p.repository_id === params[0]);
          const hits = hay.filter((p) => {
            const text = `${p.title} ${p.body ?? ''}`.toLowerCase();
            return patterns.every((pat) => !pat || text.includes(pat));
          });
          return Promise.resolve({ results: hits.slice(0, limit) as T[] });
        }
        return Promise.resolve({ results: [] as T[] });
      },
      run(): Promise<{ success: boolean }> {
        return Promise.resolve({ success: true });
      },
    };
  }
  return { prepare: (query: string) => ({ bind: (...params: unknown[]) => statement(query, params) }) } as unknown as D1Queryable;
}

const PULLS = [
  { id: 'p1', repository_id: 'r1', full_name: 'alice/demo', number: 1, title: 'Add threaded reviews', body: 'inline comments please' },
  { id: 'p2', repository_id: 'r1', full_name: 'alice/demo', number: 2, title: 'Fix login redirect', body: 'unrelated' },
];

const REPOS = [{ id: 'r1', owner: 'alice', name: 'demo', is_private: 0, owner_email: 'alice@example.com' }];

describe('SearchDAO.searchPulls', () => {
  it('falls back to LIKE without FTS5 and scopes by repo', async () => {
    const dao = new SearchDAO(createPullSearchFakeDb({ pulls: PULLS }));
    expect((await dao.searchPulls('threaded', {})).map((p) => p.number)).toEqual([1]);
    expect(await dao.searchPulls('threaded', { repoId: 'other' })).toEqual([]);
    expect(await dao.searchPulls('   ', {})).toEqual([]);
  });

  it('uses FTS5 when available', async () => {
    const dao = new SearchDAO(createPullSearchFakeDb({ pulls: PULLS, ftsAvailable: true }));
    expect((await dao.searchPulls('threaded reviews', { repoId: 'r1' })).map((p) => p.number)).toEqual([1]);
  });
});

describe('SearchService.searchPulls', () => {
  function service(pulls: Array<Record<string, unknown>>, repos: Array<Record<string, unknown>>) {
    const db = createPullSearchFakeDb({ pulls, repos });
    const permission = new PermissionService({ DB: db } as never);
    return new SearchService({ DB: db }, { permissionService: () => Promise.resolve(permission) });
  }

  it('parses the pulls type and filters private repos', async () => {
    expect(SearchService.parseType('pulls')).toBe('pulls');
    expect(SearchService.parseType('nope')).toBe('repos');
    const svc = service(PULLS, REPOS);
    const hits = await svc.searchPulls('threaded', null, {});
    expect(hits.map((p) => p.number)).toEqual([1]);

    const privateSvc = service(PULLS, [{ id: 'r1', owner: 'alice', name: 'demo', is_private: 1, owner_email: 'alice@example.com' }]);
    await expect(privateSvc.searchPulls('threaded', null, {})).resolves.toEqual([]);
    const authed = await privateSvc.searchPulls('threaded', 'alice@example.com', {});
    expect(authed.map((p) => p.number)).toEqual([1]);
  });
});
