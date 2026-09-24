import { describe, expect, it } from 'vitest';
import type { D1Queryable } from '@duradav/backend-data/utils';
import { PullRequestDAO, PullThreadDAO } from '@duradav/backend-data/dao';
import { PullRequestService } from '@duradav/backend-services/pull';
import { PullThreadService } from '@duradav/backend-services/pull/PullThreadService';

const PR = {
  id: 'pr-1',
  repository_id: 'repo-1',
  number: 1,
  title: 'Threaded PR',
  status: 'open',
  creator_email: 'alice@example.com',
};

function createThreadFakes(overrides: { prStatus?: string } = {}) {
  const threads: Array<Record<string, unknown>> = [
    {
      id: 't-1',
      pull_request_id: 'pr-1',
      path: 'src/app.ts',
      line: 10,
      side: 'new',
      commit_oid: null,
      status: 'open',
      author_email: 'alice@example.com',
      created_at: 1,
      resolved_by: null,
      resolved_at: null,
    },
  ];
  const comments: Array<Record<string, unknown>> = [
    { id: 'c-1', thread_id: 't-1', author_email: 'alice@example.com', body: 'first', created_at: 1 },
  ];
  const pullRequestDAO = {
    getById: (id: string) => Promise.resolve(id === 'pr-1' ? { ...PR, status: overrides.prStatus ?? 'open' } : null),
  };
  const pullThreadDAO = {
    openThread: (input: Record<string, unknown>) => {
      threads.push({
        id: input.id,
        pull_request_id: input.pullRequestId,
        path: input.path,
        line: input.line,
        side: input.side,
        commit_oid: input.commitOid,
        status: 'open',
        author_email: input.authorEmail,
        created_at: input.now,
        resolved_by: null,
        resolved_at: null,
      });
      return Promise.resolve();
    },
    listThreads: (pullRequestId: string) => Promise.resolve(threads.filter((t) => t.pull_request_id === pullRequestId)),
    getThread: (pullRequestId: string, threadId: string) =>
      Promise.resolve(threads.find((t) => t.pull_request_id === pullRequestId && t.id === threadId) ?? null),
    addThreadComment: (id: string, threadId: string, authorEmail: string, body: string, now: number) => {
      comments.push({ id, thread_id: threadId, author_email: authorEmail, body, created_at: now });
      return Promise.resolve();
    },
    listThreadComments: (threadId: string) => Promise.resolve(comments.filter((c) => c.thread_id === threadId)),
    resolveThread: (threadId: string, by: string, resolved: boolean, now: number) => {
      const row = threads.find((t) => t.id === threadId);
      if (row)
        Object.assign(row, {
          status: resolved ? 'resolved' : 'open',
          resolved_by: resolved ? by : null,
          resolved_at: resolved ? now : null,
        });
      return Promise.resolve();
    },
  };
  return { threads, comments, pullRequestDAO, pullThreadDAO };
}

function threadService(fakes: ReturnType<typeof createThreadFakes>) {
  return new PullThreadService(
    { DB: {} as D1Queryable },
    {
      pullRequestDAO: () => Promise.resolve(fakes.pullRequestDAO as never),
      pullThreadDAO: () => Promise.resolve(fakes.pullThreadDAO as never),
    },
  );
}

describe('PullThreadService threads', () => {
  it('opens a thread with an initial comment', async () => {
    const svc = threadService(createThreadFakes());
    const thread = await svc.openThread({
      pullRequestId: 'pr-1',
      authorEmail: 'bob@example.com',
      path: 'src/app.ts',
      line: 42,
      side: 'new',
      body: 'nit?',
    });
    expect(thread.path).toBe('src/app.ts');
    expect(thread.line).toBe(42);
    expect(thread.status).toBe('open');
    expect(thread.comments).toHaveLength(1);
    expect(thread.comments[0].body).toBe('nit?');
  });

  it('validates thread input', async () => {
    const svc = threadService(createThreadFakes());
    await expect(svc.openThread({ pullRequestId: 'pr-1', authorEmail: 'a@b.c', path: '', body: 'x' })).rejects.toThrow();
    await expect(svc.openThread({ pullRequestId: 'pr-1', authorEmail: 'a@b.c', path: '../evil', body: 'x' })).rejects.toThrow();
    await expect(svc.openThread({ pullRequestId: 'pr-1', authorEmail: 'a@b.c', path: 'a.ts', line: 0, body: 'x' })).rejects.toThrow();
    await expect(
      svc.openThread({ pullRequestId: 'pr-1', authorEmail: 'a@b.c', path: 'a.ts', side: 'middle', body: 'x' }),
    ).rejects.toThrow();
    await expect(svc.openThread({ pullRequestId: 'pr-1', authorEmail: 'a@b.c', path: 'a.ts', body: '   ' })).rejects.toThrow();
    await expect(svc.openThread({ pullRequestId: 'missing', authorEmail: 'a@b.c', path: 'a.ts', body: 'x' })).rejects.toThrow(
      'Pull request not found',
    );
  });

  it('refuses new comments on merged pull requests', async () => {
    const svc = threadService(createThreadFakes({ prStatus: 'merged' }));
    await expect(svc.openThread({ pullRequestId: 'pr-1', authorEmail: 'a@b.c', path: 'a.ts', body: 'x' })).rejects.toThrow('merged');
    await expect(svc.replyThread({ pullRequestId: 'pr-1', threadId: 't-1', authorEmail: 'a@b.c', body: 'x' })).rejects.toThrow('merged');
  });

  it('lists threads with embedded comments and resolves them', async () => {
    const svc = threadService(createThreadFakes());
    const listed = await svc.listThreads('pr-1');
    expect(listed).toHaveLength(1);
    expect(listed[0].comments.map((c) => c.body)).toEqual(['first']);
    expect((await svc.getThread('pr-1', 't-1')).id).toBe('t-1');
    await expect(svc.getThread('pr-1', 'missing')).rejects.toThrow('Thread not found');

    const reply = await svc.replyThread({ pullRequestId: 'pr-1', threadId: 't-1', authorEmail: 'bob@example.com', body: 'ack' });
    expect(reply.thread_id).toBe('t-1');
    await expect(svc.replyThread({ pullRequestId: 'pr-1', threadId: 'missing', authorEmail: 'b@c.d', body: 'x' })).rejects.toThrow(
      'Thread not found',
    );

    const resolved = await svc.resolveThread({ pullRequestId: 'pr-1', threadId: 't-1', resolvedBy: 'alice@example.com', resolved: true });
    expect(resolved.status).toBe('resolved');
    const reopened = await svc.resolveThread({ pullRequestId: 'pr-1', threadId: 't-1', resolvedBy: 'alice@example.com', resolved: false });
    expect(reopened.status).toBe('open');
    await expect(svc.resolveThread({ pullRequestId: 'pr-1', threadId: 'missing', resolvedBy: 'a@b.c', resolved: true })).rejects.toThrow(
      'Thread not found',
    );
  });
});

function createDismissFakeDao() {
  const reviews: Array<Record<string, unknown>> = [
    {
      id: 'r-1',
      pull_request_id: 'pr-1',
      author_email: 'bob@example.com',
      state: 'changes_requested',
      body: null,
      commit_oid: null,
      created_at: 1,
      dismissed: 0,
    },
  ];
  return {
    reviews,
    getByNumber: () => Promise.resolve({ ...PR }),
    listReviews: () => Promise.resolve(reviews),
    getReviewById: (pullRequestId: string, reviewId: string) =>
      Promise.resolve(reviews.find((r) => r.pull_request_id === pullRequestId && r.id === reviewId) ?? null),
    dismissReview: (reviewId: string, by: string, reason: string | null, now: number) => {
      const row = reviews.find((r) => r.id === reviewId);
      if (row) Object.assign(row, { dismissed: 1, dismissed_by: by, dismissed_at: now, dismiss_reason: reason });
      return Promise.resolve();
    },
  };
}

describe('PullRequestService dismissReview', () => {
  it('dismisses a blocking review so the gate clears', async () => {
    const fake = createDismissFakeDao();
    const svc = new PullRequestService({ DB: {} as D1Queryable }, { pullRequestDAO: () => Promise.resolve(fake as never) });
    expect(PullRequestService.isBlockedByReviews(await fake.listReviews())).toBe(true);
    const dismissed = await svc.dismissReview({
      repositoryId: 'repo-1',
      number: 1,
      reviewId: 'r-1',
      dismissedBy: 'alice@example.com',
      reason: 'outdated',
    });
    expect(dismissed.dismissed).toBe(1);
    expect(PullRequestService.isBlockedByReviews(await fake.listReviews())).toBe(false);
    await expect(
      svc.dismissReview({ repositoryId: 'repo-1', number: 1, reviewId: 'r-1', dismissedBy: 'alice@example.com' }),
    ).rejects.toThrow('already dismissed');
    await expect(
      svc.dismissReview({ repositoryId: 'repo-1', number: 1, reviewId: 'missing', dismissedBy: 'alice@example.com' }),
    ).rejects.toThrow('Review not found');
  });

  it('refuses dismissal on merged pull requests', async () => {
    const fake = { ...createDismissFakeDao(), getByNumber: () => Promise.resolve({ ...PR, status: 'merged' }) };
    const svc = new PullRequestService({ DB: {} as D1Queryable }, { pullRequestDAO: () => Promise.resolve(fake as never) });
    await expect(svc.dismissReview({ repositoryId: 'repo-1', number: 1, reviewId: 'r-1', dismissedBy: 'a@b.c' })).rejects.toThrow('merged');
  });
});

describe('PullThreadDAO SQL', () => {
  function createDaoFakeDb() {
    const state = {
      threads: [] as Array<Record<string, unknown>>,
      comments: [] as Array<Record<string, unknown>>,
      reviews: [] as Array<Record<string, unknown>>,
    };
    state.reviews.push({
      id: 'r-1',
      pull_request_id: 'pr-1',
      author_email: 'b@c.d',
      state: 'approved',
      body: null,
      commit_oid: null,
      created_at: 1,
      dismissed: 0,
    });
    function statement(query: string, params: unknown[]) {
      const q = query.replace(/\s+/g, ' ').trim();
      return {
        first<T>(): Promise<T | null> {
          if (q.includes('FROM pull_review_threads WHERE pull_request_id = ? AND id = ?')) {
            return Promise.resolve((state.threads.find((t) => t.pull_request_id === params[0] && t.id === params[1]) ?? null) as T | null);
          }
          if (q.includes('FROM pull_request_reviews WHERE pull_request_id = ? AND id = ?')) {
            return Promise.resolve((state.reviews.find((r) => r.pull_request_id === params[0] && r.id === params[1]) ?? null) as T | null);
          }
          return Promise.resolve(null);
        },
        all<T>(): Promise<{ results: T[] }> {
          if (q.includes('FROM pull_review_threads WHERE pull_request_id = ?')) {
            return Promise.resolve({ results: state.threads.filter((t) => t.pull_request_id === params[0]) as T[] });
          }
          if (q.includes('FROM pull_thread_comments WHERE thread_id = ?')) {
            return Promise.resolve({ results: state.comments.filter((c) => c.thread_id === params[0]) as T[] });
          }
          return Promise.resolve({ results: [] as T[] });
        },
        run(): Promise<{ success: boolean }> {
          if (q.startsWith('INSERT INTO pull_review_threads')) {
            const [id, pull_request_id, path, line, side, commit_oid, status, author_email, created_at] = params as Array<
              string | number | null
            >;
            state.threads.push({
              id,
              pull_request_id,
              path,
              line,
              side,
              commit_oid,
              status,
              author_email,
              created_at,
              resolved_by: null,
              resolved_at: null,
            });
            return Promise.resolve({ success: true });
          }
          if (q.startsWith('INSERT INTO pull_thread_comments')) {
            const [id, thread_id, author_email, body, created_at] = params as Array<string | number>;
            state.comments.push({ id, thread_id, author_email, body, created_at });
            return Promise.resolve({ success: true });
          }
          if (q.startsWith('UPDATE pull_review_threads SET status')) {
            const [status, resolved_by, resolved_at, id] = params as Array<string | number | null>;
            const row = state.threads.find((t) => t.id === id);
            if (row) Object.assign(row, { status, resolved_by, resolved_at });
            return Promise.resolve({ success: true });
          }
          if (q.startsWith('UPDATE pull_request_reviews SET dismissed')) {
            const [by, at, reason, id] = params as Array<string | number | null>;
            const row = state.reviews.find((r) => r.id === id);
            if (row) Object.assign(row, { dismissed: 1, dismissed_by: by, dismissed_at: at, dismiss_reason: reason });
            return Promise.resolve({ success: true });
          }
          return Promise.resolve({ success: true });
        },
      };
    }
    return {
      db: { prepare: (query: string) => ({ bind: (...params: unknown[]) => statement(query, params) }) } as unknown as D1Queryable,
      state,
    };
  }

  it('round-trips threads through SQL', async () => {
    const { db, state } = createDaoFakeDb();
    const dao = new PullThreadDAO(db);
    await dao.openThread({
      id: 't-9',
      pullRequestId: 'pr-1',
      path: 'a.ts',
      line: 3,
      side: 'old',
      commitOid: null,
      authorEmail: 'a@b.c',
      now: 7,
    });
    await dao.addThreadComment('c-9', 't-9', 'b@c.d', 'hello', 8);
    expect((await dao.listThreads('pr-1')).map((t) => t.id)).toContain('t-9');
    expect((await dao.listThreadComments('t-9')).map((c) => c.body)).toEqual(['hello']);
    expect((await dao.getThread('pr-1', 't-9'))?.status).toBe('open');
    await dao.resolveThread('t-9', 'a@b.c', true, 9);
    expect(state.threads.find((t) => t.id === 't-9')?.status).toBe('resolved');
    expect(await dao.getThread('pr-1', 'nope')).toBeNull();
  });

  it('throws on missing thread tables instead of degrading', async () => {
    const db = {
      prepare: () => ({
        bind: () => ({
          first: () => Promise.resolve(null),
          all: () => Promise.reject(new Error('no such table: pull_review_threads')),
          run: () => Promise.resolve({ success: true }),
        }),
      }),
    } as unknown as D1Queryable;
    const dao = new PullThreadDAO(db);
    // Post-0021 the thread tables are part of the baseline schema: a missing
    // table is deploy skew, not a legacy DB — fail closed instead of [].
    // (`getThread` resolves null only because the fake's `first()` does;
    // a real missing table rejects there too.)
    await expect(dao.listThreads('pr-1')).rejects.toThrow('no such table');
    await expect(dao.listThreadComments('t-1')).rejects.toThrow('no such table');
    await expect(dao.getThread('pr-1', 't-1')).resolves.toBeNull();
  });

  it('dismisses reviews through SQL', async () => {
    const reviews: Array<Record<string, unknown>> = [
      {
        id: 'r-1',
        pull_request_id: 'pr-1',
        author_email: 'b@c.d',
        state: 'approved',
        body: null,
        commit_oid: null,
        created_at: 1,
        dismissed: 0,
      },
    ];
    const db = {
      prepare: (query: string) => ({
        bind: (...params: unknown[]) => {
          const q = query.replace(/\s+/g, ' ').trim();
          if (q.startsWith('SELECT')) {
            return {
              first: () => Promise.resolve((reviews.find((r) => r.pull_request_id === params[0] && r.id === params[1]) ?? null) as unknown),
            };
          }
          const [by, at, reason, id] = params as Array<string | number | null>;
          const row = reviews.find((r) => r.id === id);
          if (row) Object.assign(row, { dismissed: 1, dismissed_by: by, dismissed_at: at, dismiss_reason: reason });
          return { run: () => Promise.resolve({ success: true }) };
        },
      }),
    } as unknown as D1Queryable;
    const dao = new PullRequestDAO(db);
    expect((await dao.getReviewById('pr-1', 'r-1'))?.dismissed).toBe(0);
    await dao.dismissReview('r-1', 'a@b.c', 'stale', 10);
    expect(reviews[0]).toMatchObject({ dismissed: 1, dismissed_by: 'a@b.c' });
    expect(await dao.getReviewById('pr-1', 'nope')).toBeNull();
  });
});
