import { describe, expect, it } from 'vitest';
import type { D1Queryable } from '@duradav/backend-data/utils';
import { CheckRunDAO } from '@duradav/backend-data/dao';
import {
  BUILT_IN_CHECK_CONTEXTS,
  CheckService,
  isBuiltInCheckContext,
  normalizeContext,
  normalizeHeadSha,
  parseRequiredGlobs,
  runCodeownersStep,
  runDiffLimitStep,
  runRequiredFilesStep,
  runSecretScanStep,
} from '@duradav/backend-services/checks';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

interface CheckRow extends Record<string, unknown> {
  id: string;
  repository_id: string;
  head_sha: string;
  context: string;
  status: string;
  conclusion: string | null;
  details_url: string | null;
  output_title: string | null;
  output_summary: string | null;
  creator_email: string;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
}

function createChecksFakeDb(seed: CheckRow[] = []): D1Queryable & { rows: CheckRow[] } {
  const state = { rows: seed.map((r) => ({ ...r })) };
  function statement(query: string, params: unknown[]) {
    const q = query.replace(/\s+/g, ' ').trim();
    return {
      first<T>(): Promise<T | null> {
        if (q.startsWith('SELECT * FROM check_runs WHERE id = ? AND repository_id = ?')) {
          const row = state.rows.find((r) => r.id === params[0] && r.repository_id === params[1]);
          return Promise.resolve((row ?? null) as T | null);
        }
        if (q.startsWith('SELECT * FROM check_runs WHERE repository_id = ? AND head_sha = ? AND context = ?')) {
          const row = state.rows.find((r) => r.repository_id === params[0] && r.head_sha === params[1] && r.context === params[2]);
          return Promise.resolve((row ?? null) as T | null);
        }
        if (q.startsWith('SELECT COUNT(*) AS n FROM check_runs WHERE repository_id = ? AND head_sha = ?')) {
          const n = state.rows.filter((r) => r.repository_id === params[0] && r.head_sha === params[1]).length;
          return Promise.resolve({ n } as unknown as T);
        }
        return Promise.resolve(null);
      },
      all<T>(): Promise<{ results: T[] }> {
        if (q.startsWith('SELECT * FROM check_runs WHERE repository_id = ? AND head_sha = ?')) {
          const rows = state.rows
            .filter((r) => r.repository_id === params[0] && r.head_sha === params[1])
            .sort((a, b) => String(a.context).localeCompare(String(b.context)));
          return Promise.resolve({ results: rows as T[] });
        }
        if (q.includes('FROM check_runs WHERE status IN (')) {
          const statuses = params.slice(0, -2) as string[];
          const olderThan = params[params.length - 2] as number;
          const limit = params[params.length - 1] as number;
          const rows = state.rows
            .filter((r) => statuses.includes(r.status) && (r.updated_at as number) < olderThan)
            .sort((a, b) => (a.updated_at as number) - (b.updated_at as number))
            .slice(0, limit);
          return Promise.resolve({ results: rows as T[] });
        }
        return Promise.resolve({ results: [] });
      },
      run(): Promise<{ success: boolean; meta?: { changes?: number } }> {
        if (q.startsWith('INSERT INTO check_runs')) {
          const [
            id,
            repository_id,
            head_sha,
            context,
            status,
            conclusion,
            details_url,
            output_title,
            output_summary,
            creator_email,
            created_at,
            updated_at,
            completed_at,
          ] = params as Array<string | number | null>;
          if (state.rows.some((r) => r.repository_id === repository_id && r.head_sha === head_sha && r.context === context)) {
            return Promise.resolve({ success: false, error: 'UNIQUE constraint failed' });
          }
          state.rows.push({
            id,
            repository_id,
            head_sha,
            context,
            status,
            conclusion,
            details_url,
            output_title,
            output_summary,
            creator_email,
            created_at,
            updated_at,
            completed_at,
          } as unknown as CheckRow);
          return Promise.resolve({ success: true, meta: { changes: 1 } });
        }
        if (q.startsWith('UPDATE check_runs SET status = ?')) {
          const [status, conclusion, details_url, output_title, output_summary, updated_at, completed_at, id, repository_id] =
            params as Array<string | number | null>;
          const row = state.rows.find((r) => r.id === id && r.repository_id === repository_id);
          if (row) {
            row.status = status as string;
            row.conclusion = conclusion as string | null;
            row.details_url = details_url as string | null;
            row.output_title = output_title as string | null;
            row.output_summary = output_summary as string | null;
            row.updated_at = updated_at as number;
            row.completed_at = completed_at as number | null;
            return Promise.resolve({ success: true, meta: { changes: 1 } });
          }
          return Promise.resolve({ success: true, meta: { changes: 0 } });
        }
        if (q.startsWith('DELETE FROM check_runs')) {
          const [cutoff, limit] = params as [number, number];
          const victims = state.rows
            .filter((r) => (r.created_at as number) < cutoff)
            .slice(0, limit)
            .map((r) => r.id);
          for (const id of victims) {
            const index = state.rows.findIndex((r) => r.id === id);
            if (index >= 0) state.rows.splice(index, 1);
          }
          return Promise.resolve({ success: true, meta: { changes: victims.length } });
        }
        return Promise.resolve({ success: true, meta: { changes: 0 } });
      },
    };
  }
  return {
    prepare: (query: string) => ({ bind: (...params: unknown[]) => statement(query, params) }),
    rows: state.rows,
  } as unknown as D1Queryable & {
    rows: CheckRow[];
  };
}

function row(overrides: Partial<CheckRow> = {}): CheckRow {
  return {
    id: 'run-1',
    repository_id: 'repo-1',
    head_sha: SHA_A,
    context: 'secret-scan',
    status: 'queued',
    conclusion: null,
    details_url: null,
    output_title: null,
    output_summary: null,
    creator_email: 'alice@example.com',
    created_at: 1000,
    updated_at: 1000,
    completed_at: null,
    ...overrides,
  };
}

describe('CheckSteps built-ins', () => {
  it('exposes exactly four built-in contexts', () => {
    expect([...BUILT_IN_CHECK_CONTEXTS].sort()).toEqual(['codeowners-exists', 'diff-limit', 'required-files', 'secret-scan']);
    expect(isBuiltInCheckContext('secret-scan')).toBe(true);
    expect(isBuiltInCheckContext('ci/external')).toBe(false);
  });

  it('secret-scan fails on findings, passes when clean', () => {
    expect(runSecretScanStep([]).conclusion).toBe('success');
    const failed = runSecretScanStep([{ ruleId: 'aws-access-key', hint: 'Possible AWS access key' }]);
    expect(failed.conclusion).toBe('failure');
    expect(failed.summary).toContain('aws-access-key');
  });

  it('diff-limit enforces the merge-preview cap', () => {
    expect(runDiffLimitStep(10, 500).conclusion).toBe('success');
    expect(runDiffLimitStep(500, 500).conclusion).toBe('success');
    expect(runDiffLimitStep(501, 500).conclusion).toBe('failure');
  });

  it('codeowners-exists is neutral when missing, success when parsed', () => {
    expect(runCodeownersStep({ content: null, ruleCount: 0 }).conclusion).toBe('neutral');
    expect(runCodeownersStep({ content: '* @owner', ruleCount: 0 }).conclusion).toBe('action_required');
    expect(runCodeownersStep({ content: '* @owner', ruleCount: 1 }).conclusion).toBe('success');
  });

  it('required-files matches globs against tree paths', () => {
    expect(runRequiredFilesStep(['README.md', 'src/a.ts'], ['README.md']).conclusion).toBe('success');
    expect(runRequiredFilesStep(['src/a.ts'], ['README.md']).conclusion).toBe('failure');
    expect(runRequiredFilesStep(['docs/guide.md'], ['*.md']).conclusion).toBe('success');
  });

  it('parses required globs from context args', () => {
    expect(parseRequiredGlobs(null)).toEqual([]);
    expect(parseRequiredGlobs('README.md, LICENSE')).toEqual(['README.md', 'LICENSE']);
    expect(parseRequiredGlobs('  ')).toEqual([]);
  });
});

describe('CheckService validation', () => {
  it('normalizes SHAs and contexts', () => {
    expect(normalizeHeadSha(SHA_A.toUpperCase())).toBe(SHA_A);
    expect(() => normalizeHeadSha('short')).toThrow();
    expect(() => normalizeHeadSha('g'.repeat(40))).toThrow();
    expect(normalizeContext('secret-scan')).toBe('secret-scan');
    expect(() => normalizeContext('')).toThrow();
    expect(() => normalizeContext('has space')).toThrow();
  });

  it('treats success/neutral/skipped as passing', () => {
    expect(CheckService.isPassingConclusion('success')).toBe(true);
    expect(CheckService.isPassingConclusion('neutral')).toBe(true);
    expect(CheckService.isPassingConclusion('skipped')).toBe(true);
    expect(CheckService.isPassingConclusion('failure')).toBe(false);
    expect(CheckService.isPassingConclusion('timed_out')).toBe(false);
    expect(CheckService.isPassingConclusion(null)).toBe(false);
  });

  it('checkRequiredContexts blocks on missing/pending/failing, passes when green', () => {
    expect(CheckService.checkRequiredContexts({ requiredContexts: [], runs: [] }).blocked).toBe(false);
    const missing = CheckService.checkRequiredContexts({ requiredContexts: ['secret-scan'], runs: [] });
    expect(missing).toMatchObject({ blocked: true, state: 'pending', pending: ['secret-scan'] });
    const queued = CheckService.checkRequiredContexts({
      requiredContexts: ['secret-scan'],
      runs: [{ context: 'secret-scan', status: 'queued', conclusion: null }],
    });
    expect(queued.blocked).toBe(true);
    expect(queued.state).toBe('pending');
    const failing = CheckService.checkRequiredContexts({
      requiredContexts: ['secret-scan'],
      runs: [{ context: 'secret-scan', status: 'completed', conclusion: 'failure' }],
    });
    expect(failing).toMatchObject({ blocked: true, state: 'failure', failing: ['secret-scan'] });
    const passing = CheckService.checkRequiredContexts({
      requiredContexts: ['secret-scan', 'diff-limit'],
      runs: [
        { context: 'secret-scan', status: 'completed', conclusion: 'success' },
        { context: 'diff-limit', status: 'completed', conclusion: 'skipped' },
      ],
    });
    expect(passing).toMatchObject({ blocked: false, state: 'success' });
  });

  it('matches contexts case-insensitively', () => {
    const result = CheckService.checkRequiredContexts({
      requiredContexts: ['Secret-Scan'],
      runs: [{ context: 'secret-scan', status: 'completed', conclusion: 'success' }],
    });
    expect(result.blocked).toBe(false);
  });
});

describe('CheckService D1 flows', () => {
  it('reports, refreshes, and lists runs with combined state', async () => {
    const db = createChecksFakeDb();
    const svc = new CheckService({ DB: db, MAX_CHECKS_PER_SHA: '50' }, { checkRunDAO: () => Promise.resolve(new CheckRunDAO(db)) });
    const created = await svc.reportStatus({
      repositoryId: 'repo-1',
      headSha: SHA_A,
      context: 'secret-scan',
      creatorEmail: 'Alice@Example.com',
    });
    expect(created.status).toBe('queued');
    expect(created.creatorEmail).toBe('alice@example.com');
    // Re-report while queued refreshes instead of throwing.
    const refreshed = await svc.reportStatus({
      repositoryId: 'repo-1',
      headSha: SHA_A,
      context: 'secret-scan',
      creatorEmail: 'alice@example.com',
    });
    expect(refreshed.id).toBe(created.id);
    const listed = await svc.listForSha('repo-1', SHA_A);
    expect(listed.runs).toHaveLength(1);
    expect(listed.state).toBe('pending');
  });

  it('transitions runs and rejects completed re-reports', async () => {
    const db = createChecksFakeDb([row({ id: 'r1' })]);
    const svc = new CheckService({ DB: db }, { checkRunDAO: () => Promise.resolve(new CheckRunDAO(db)) });
    await expect(svc.updateRun({ repositoryId: 'repo-1', id: 'missing', status: 'completed', conclusion: 'success' })).rejects.toThrow();
    await expect(svc.updateRun({ repositoryId: 'repo-1', id: 'r1', status: 'completed' })).rejects.toThrow('conclusion is required');
    const done = await svc.updateRun({
      repositoryId: 'repo-1',
      id: 'r1',
      status: 'completed',
      conclusion: 'success',
      outputTitle: 'All Good',
    });
    expect(done.status).toBe('completed');
    expect(done.conclusion).toBe('success');
    expect(done.completedAt).not.toBeNull();
    await expect(
      svc.reportStatus({ repositoryId: 'repo-1', headSha: SHA_A, context: 'secret-scan', creatorEmail: 'a@x.com' }),
    ).rejects.toThrow('already completed');
  });

  it('enforces the per-SHA cap', async () => {
    const db = createChecksFakeDb([row({ id: 'r1', context: 'a' })]);
    const svc = new CheckService({ DB: db, MAX_CHECKS_PER_SHA: '1' }, { checkRunDAO: () => Promise.resolve(new CheckRunDAO(db)) });
    await expect(svc.reportStatus({ repositoryId: 'repo-1', headSha: SHA_A, context: 'b', creatorEmail: 'a@x.com' })).rejects.toThrow(
      'Maximum 1',
    );
  });

  it('marks stale runs timed_out and prunes old rows', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const old = row({ id: 'old', status: 'in_progress', updated_at: nowSec - 7200, created_at: 10 });
    const fresh = row({ id: 'fresh', context: 'diff-limit', head_sha: SHA_B, updated_at: nowSec, created_at: nowSec });
    const db = createChecksFakeDb([old, fresh]);
    const svc = new CheckService({ DB: db, CHECK_TIMEOUT_SECONDS: '3600' }, { checkRunDAO: () => Promise.resolve(new CheckRunDAO(db)) });
    const marked = await svc.markStale(undefined, 100);
    expect(marked).toBe(1);
    expect(db.rows.find((r) => r.id === 'old')?.conclusion).toBe('timed_out');
    const pruned = await svc.pruneOlderThan(500, 500);
    expect(pruned).toBe(1);
    expect(db.rows.some((r) => r.id === 'old')).toBe(false);
  });

  it('degrades listStale errors to zero marked', async () => {
    const broken = {
      prepare: () => {
        throw new Error('down');
      },
    } as unknown as D1Queryable;
    const svc = new CheckService({ DB: broken }, { checkRunDAO: () => Promise.resolve(new CheckRunDAO(broken)) });
    await expect(svc.markStale(undefined, 10)).resolves.toBe(0);
  });
});
