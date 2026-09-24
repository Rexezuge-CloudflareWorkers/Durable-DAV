import { describe, expect, it } from 'vitest';
import type { D1Queryable } from '@duradav/backend-data/utils';
import { CollaborationDAO } from '@duradav/backend-data/dao';
import { CollaborationService } from '@duradav/backend-services/collab';
import { matchCodeowners, parseCodeowners } from '@duradav/backend-services/collab';
import { PullRequestService } from '@duradav/backend-services/pull';

function createCollabFakeDb(): D1Queryable & { labels: Array<Record<string, unknown>>; milestones: Array<Record<string, unknown>> } {
  const state = {
    labels: [] as Array<Record<string, unknown>>,
    milestones: [] as Array<Record<string, unknown>>,
    issueLabels: [] as Array<{ issue_id: string; label_id: string }>,
    reviewers: [] as Array<Record<string, unknown>>,
  };
  function statement(query: string, params: unknown[]) {
    const q = query.replace(/\s+/g, ' ').trim();
    return {
      first<T>(): Promise<T | null> {
        if (q.includes('FROM labels WHERE repository_id = ? AND name = ?')) {
          return Promise.resolve((state.labels.find((l) => l.repository_id === params[0] && l.name === params[1]) ?? null) as T | null);
        }
        if (q.includes('FROM labels WHERE id = ?')) {
          return Promise.resolve((state.labels.find((l) => l.id === params[0]) ?? null) as T | null);
        }
        if (q.includes('FROM milestones WHERE id = ?')) {
          return Promise.resolve((state.milestones.find((m) => m.id === params[0]) ?? null) as T | null);
        }
        return Promise.resolve(null);
      },
      all<T>(): Promise<{ results: T[] }> {
        if (q.includes('FROM labels WHERE repository_id = ?')) {
          return Promise.resolve({ results: state.labels.filter((l) => l.repository_id === params[0]) as T[] });
        }
        if (q.includes('FROM milestones WHERE repository_id = ?')) {
          return Promise.resolve({ results: state.milestones.filter((m) => m.repository_id === params[0]) as T[] });
        }
        if (q.includes('FROM pull_reviewers WHERE pull_request_id = ?')) {
          return Promise.resolve({ results: state.reviewers.filter((r) => r.pull_request_id === params[0]) as T[] });
        }
        if (q.includes('FROM labels l INNER JOIN')) {
          return Promise.resolve({ results: [] as T[] });
        }
        if (q.includes('FROM issue_assignees') || q.includes('FROM pull_assignees')) {
          return Promise.resolve({ results: [] as T[] });
        }
        return Promise.resolve({ results: [] as T[] });
      },
      run(): Promise<{ success: boolean; meta?: { changes?: number } }> {
        if (q.startsWith('INSERT INTO labels')) {
          const [id, repository_id, name, color, description, created_at] = params as Array<string | number | null>;
          state.labels.push({ id, repository_id, name, color, description, created_at });
          return Promise.resolve({ success: true });
        }
        if (q.startsWith('INSERT INTO milestones')) {
          const [id, repository_id, title, description, due_on, created_at] = params as Array<string | number | null>;
          state.milestones.push({ id, repository_id, title, description, due_on, status: 'open', created_at });
          return Promise.resolve({ success: true });
        }
        if (q.startsWith('INSERT OR IGNORE INTO pull_reviewers')) {
          const [pull_request_id, user_email, created_at] = params as Array<string | number>;
          if (!state.reviewers.some((r) => r.pull_request_id === pull_request_id && r.user_email === user_email)) {
            state.reviewers.push({ pull_request_id, user_email, status: 'pending', created_at });
          }
          return Promise.resolve({ success: true });
        }
        return Promise.resolve({ success: true });
      },
    };
  }
  return {
    prepare: (query: string) => ({ bind: (...params: unknown[]) => statement(query, params) }),
    labels: state.labels,
    milestones: state.milestones,
  } as unknown as D1Queryable & {
    labels: Array<Record<string, unknown>>;
    milestones: Array<Record<string, unknown>>;
  };
}

describe('CollaborationService labels', () => {
  it('creates and rejects duplicate labels', async () => {
    const db = createCollabFakeDb();
    const svc = new CollaborationService({ DB: db });
    await svc.createLabel('repo-1', { name: 'bug', color: 'ff0000' });
    await expect(svc.createLabel('repo-1', { name: 'bug' })).rejects.toThrow('already exists');
    await expect(svc.createLabel('repo-1', { name: 'bad name!' })).rejects.toThrow();
    await expect(svc.createLabel('repo-1', { name: 'ok', color: 'zzz' })).rejects.toThrow();
  });

  it('validates reviewers and assignees', async () => {
    const db = createCollabFakeDb();
    const svc = new CollaborationService({ DB: db });
    await expect(svc.requestReviewers('pr-1', [])).rejects.toThrow();
    await expect(svc.requestReviewers('pr-1', 'not-array' as unknown as string[])).rejects.toThrow();
    await svc.requestReviewers('pr-1', ['alice@example.com']);
    const reviewers = await svc.listReviewers('pr-1');
    expect(reviewers.length).toBe(1);
  });
});

describe('CODEOWNERS parser', () => {
  it('parses owners and matches last pattern wins', () => {
    const rules = parseCodeowners('# comment\n*.js @js-team\n/docs/ @docs-team alice@example.com\n');
    expect(rules.length).toBe(2);
    expect(matchCodeowners(rules, 'docs/guide.md')).toContain('@docs-team');
    expect(matchCodeowners(rules, 'src/app.js')).toContain('@js-team');
    expect(matchCodeowners([], 'anything')).toEqual([]);
  });
});

describe('PullRequest draft gate', () => {
  it('blocks merge of draft pull requests', async () => {
    const fake = {
      getByNumber: () => Promise.resolve({ id: 'pr-1', repository_id: 'r', number: 1, status: 'open', is_draft: 1 }),
      listReviews: () => Promise.resolve([]),
    };
    const svc = new PullRequestService({ DB: {} as D1Queryable }, { pullRequestDAO: () => Promise.resolve(fake as never) });
    await expect(svc.markMerged({ repositoryId: 'r', number: 1, mergedBy: 'a@b.c' })).rejects.toThrow('draft');
  });

  it('blocks reviews veto shared with merge gate', () => {
    expect(PullRequestService.isBlockedByReviews([{ author_email: 'a@b.c', state: 'changes_requested' }])).toBe(true);
    expect(PullRequestService.isBlockedByReviews([{ author_email: 'a@b.c', state: 'approved' }])).toBe(false);
  });
});

describe('CollaborationDAO SQL', () => {
  it('creates labels and milestones tables queries', async () => {
    const db = createCollabFakeDb();
    const dao = new CollaborationDAO(db);
    await dao.createLabel({ id: 'l1', repositoryId: 'r1', name: 'bug', color: 'ff0000', description: null, now: 1 });
    expect((await dao.listLabels('r1')).length).toBe(1);
    await dao.createMilestone({ id: 'm1', repositoryId: 'r1', title: 'v1', description: null, dueOn: null, now: 1 });
    expect((await dao.listMilestones('r1')).length).toBe(1);
  });
});
