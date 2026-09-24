import { describe, expect, it } from 'vitest';
import { IssueDAO, RepositoryDAO, UserAccessTokenDAO, UserDAO } from '@duradav/backend-data/dao';
import type { D1Queryable } from '@duradav/backend-data/utils';

function createDaoFakeDb(): D1Queryable & {
  repos: Array<Record<string, unknown>>;
  tokens: Array<Record<string, unknown>>;
  issues: Array<Record<string, unknown>>;
  comments: Array<Record<string, unknown>>;
  users: Array<Record<string, unknown>>;
} {
  const state = {
    repos: [] as Array<Record<string, unknown>>,
    tokens: [] as Array<Record<string, unknown>>,
    issues: [] as Array<Record<string, unknown>>,
    comments: [] as Array<Record<string, unknown>>,
    users: [] as Array<Record<string, unknown>>,
  };

  function statement(query: string, params: unknown[]) {
    const q = query.replace(/\s+/g, ' ').trim();
    return {
      first<T>(): Promise<T | null> {
        if (q.includes('FROM repositories WHERE owner_ci = ? AND name_ci = ?')) {
          return Promise.resolve(
            (state.repos.find(
              (r) =>
                String(r.owner_ci ?? r.owner).toLowerCase() === String(params[0]).toLowerCase() &&
                String(r.name_ci ?? r.name).toLowerCase() === String(params[1]).toLowerCase(),
            ) ?? null) as T | null,
          );
        }
        if (q.includes('FROM repositories WHERE id = ?')) {
          return Promise.resolve((state.repos.find((r) => r.id === params[0]) ?? null) as T | null);
        }
        if (q.includes('FROM user_access_tokens WHERE token_hash = ?')) {
          return Promise.resolve(
            (state.tokens.find((t) => t.token_hash === params[0] && (t.expires_at as number) > (params[1] as number)) ?? null) as T | null,
          );
        }
        if (q.includes('FROM users WHERE email = ?') || q.includes('FROM users WHERE lower(email)')) {
          return Promise.resolve(
            (state.users.find((u) => String(u.email).toLowerCase() === String(params[0]).toLowerCase()) ?? null) as T | null,
          );
        }
        if (q.includes('FROM issues WHERE repository_id = ? AND number = ?')) {
          return Promise.resolve((state.issues.find((i) => i.repository_id === params[0] && i.number === params[1]) ?? null) as T | null);
        }
        if (q.includes('COALESCE(MAX(number)')) {
          const max = state.issues.filter((i) => i.repository_id === params[0]).reduce((m, i) => Math.max(m, i.number as number), 0);
          return Promise.resolve({ max_n: max } as unknown as T);
        }
        return Promise.resolve(null);
      },
      all<T>(): Promise<{ results: T[] }> {
        if (q.includes('FROM repositories WHERE owner_ci = ?')) {
          return Promise.resolve({
            results: state.repos.filter((r) => String(r.owner_ci ?? r.owner).toLowerCase() === String(params[0]).toLowerCase()) as T[],
          });
        }
        if (q.includes('FROM repositories WHERE owner_email = ?') || q.includes('FROM repositories WHERE lower(owner_email)')) {
          return Promise.resolve({
            results: state.repos.filter((r) => String(r.owner_email).toLowerCase() === String(params[0]).toLowerCase()) as T[],
          });
        }
        if (q.includes('FROM user_access_tokens WHERE') && q.includes('user_email')) {
          return Promise.resolve({
            results: state.tokens.filter((t) => String(t.user_email).toLowerCase() === String(params[0]).toLowerCase()) as T[],
          });
        }
        if (q.includes('FROM issues WHERE repository_id = ? ORDER BY number DESC')) {
          return Promise.resolve({
            results: state.issues
              .filter((i) => i.repository_id === params[0])
              .sort((a, b) => (b.number as number) - (a.number as number))
              .slice(0, params[1] as number) as T[],
          });
        }
        if (q.includes('FROM comments WHERE issue_id = ?')) {
          return Promise.resolve({ results: state.comments.filter((c) => c.issue_id === params[0]) as T[] });
        }
        return Promise.resolve({ results: [] });
      },
      run(): Promise<{ success: boolean; meta?: { changes?: number } }> {
        if (q.startsWith('INSERT INTO repositories')) {
          const [id, owner_email, owner, name, description, is_private, created_at, updated_at, owner_type, owner_ci, name_ci] = params as Array<
            string | number | null
          >;
          state.repos.push({ id, owner_email, owner, name, description, is_private, created_at, updated_at, owner_type, owner_ci, name_ci });
          return Promise.resolve({ success: true, meta: { changes: 1 } });
        }
        if (q.startsWith('UPDATE repositories SET')) {
          const row = state.repos.find((r) => r.id === params[params.length - 1]);
          if (row) {
            row.updated_at = params[0];
            if (q.includes('description = ?')) row.description = params[1];
          }
          return Promise.resolve({ success: true, meta: { changes: 1 } });
        }
        if (q.startsWith('DELETE FROM repositories WHERE id = ?')) {
          state.repos = state.repos.filter((r) => r.id !== params[0]);
          return Promise.resolve({ success: true, meta: { changes: 1 } });
        }
        if (q.startsWith('INSERT INTO user_access_tokens')) {
          const [token_id, user_email, token_hash, tname, expires_at, created_at] = params as Array<string | number>;
          state.tokens.push({ token_id, user_email, token_hash, name: tname, expires_at, last_used_at: null, created_at });
          return Promise.resolve({ success: true, meta: { changes: 1 } });
        }
        if (q.startsWith('UPDATE user_access_tokens SET last_used_at')) {
          const row = state.tokens.find((t) => t.token_hash === params[1]);
          if (row) row.last_used_at = params[0];
          return Promise.resolve({ success: true, meta: { changes: 1 } });
        }
        if (q.startsWith('DELETE FROM user_access_tokens WHERE token_id = ?')) {
          state.tokens = state.tokens.filter(
            (t) => !(t.token_id === params[0] && String(t.user_email).toLowerCase() === String(params[1]).toLowerCase()),
          );
          return Promise.resolve({ success: true, meta: { changes: 1 } });
        }
        if (q.includes('DELETE FROM user_access_tokens') && q.includes('expires_at < ?')) {
          const before = state.tokens.length;
          state.tokens = state.tokens.filter((t) => !((t.expires_at as number) < (params[0] as number)));
          return Promise.resolve({ success: true, meta: { changes: before - state.tokens.length } });
        }
        if (q.startsWith('INSERT INTO issues')) {
          const [id, repository_id, number, title, body, status, creator_email, created_at, updated_at] = params as Array<
            string | number | null
          >;
          state.issues.push({ id, repository_id, number, title, body, status, creator_email, created_at, updated_at });
          return Promise.resolve({ success: true, meta: { changes: 1 } });
        }
        if (q.startsWith('UPDATE issues SET status')) {
          const row = state.issues.find((i) => i.id === params[2]);
          if (row) {
            row.status = params[0];
            row.updated_at = params[1];
          }
          return Promise.resolve({ success: true, meta: { changes: 1 } });
        }
        if (q.startsWith('INSERT INTO comments')) {
          const [id, issue_id, author_email, body, created_at] = params as Array<string | number>;
          state.comments.push({ id, issue_id, author_email, body, created_at });
          return Promise.resolve({ success: true, meta: { changes: 1 } });
        }
        if (q.startsWith('DELETE FROM comments WHERE issue_id IN')) {
          const repoId = params[0] as string;
          const issueIds = new Set(state.issues.filter((i) => i.repository_id === repoId).map((i) => i.id));
          state.comments = state.comments.filter((c) => !issueIds.has(c.issue_id));
          return Promise.resolve({ success: true, meta: { changes: 1 } });
        }
        if (q.startsWith('DELETE FROM issues WHERE repository_id = ?')) {
          state.issues = state.issues.filter((i) => i.repository_id !== params[0]);
          return Promise.resolve({ success: true, meta: { changes: 1 } });
        }
        if (q.startsWith('INSERT INTO users')) {
          const [email, created_at] = params as Array<string | number>;
          if (!state.users.some((u) => u.email === email)) state.users.push({ email, created_at });
          return Promise.resolve({ success: true, meta: { changes: 1 } });
        }
        return Promise.resolve({ success: true, meta: { changes: 0 } });
      },
    };
  }

  return {
    ...state,
    prepare: (query: string) => ({ bind: (...params: unknown[]) => statement(query, params) }),
  } as unknown as D1Queryable & typeof state;
}

describe('RepositoryDAO', () => {
  it('creates, reads, updates, and deletes', async () => {
    const db = createDaoFakeDb();
    const dao = new RepositoryDAO(db);
    await dao.create({ id: 'r1', ownerEmail: 'a@x.co', owner: 'alice', name: 'demo', description: null, isPrivate: false, now: 100 });
    await expect(dao.getByOwnerAndName('alice', 'demo')).resolves.toMatchObject({ id: 'r1' });
    await expect(dao.getById('r1')).resolves.toMatchObject({ name: 'demo' });
    await expect(dao.listByOwner('alice')).resolves.toHaveLength(1);
    await expect(dao.listByOwnerEmail('a@x.co')).resolves.toHaveLength(1);
    await dao.update('r1', { description: 'new', isPrivate: true, now: 200 });
    await expect(dao.getById('r1')).resolves.toMatchObject({ description: 'new' });
    await dao.deleteById('r1');
    await expect(dao.getById('r1')).resolves.toBeNull();
  });
});

describe('UserAccessTokenDAO', () => {
  it('creates, looks up, touches, deletes, and prunes', async () => {
    const db = createDaoFakeDb();
    const dao = new UserAccessTokenDAO(db);
    await dao.create('t1', 'a@x.co', 'hash1', 'laptop', 200, 100);
    await dao.create('t2', 'a@x.co', 'hash2', 'old', 50, 100);
    await expect(dao.getByTokenHash('hash1', 150)).resolves.toMatchObject({ tokenId: 't1' });
    await expect(dao.getByTokenHash('hash2', 150)).resolves.toBeUndefined();
    await dao.updateLastUsedByHash('hash1', 160);
    await expect(dao.getByUserEmail('a@x.co')).resolves.toHaveLength(2);
    expect(await dao.pruneExpired(150, 10)).toBe(1);
    await dao.delete('t1', 'a@x.co');
    await expect(dao.getByUserEmail('a@x.co')).resolves.toHaveLength(0);
  });
});

describe('IssueDAO', () => {
  it('numbers, creates, reads, closes, and comments', async () => {
    const db = createDaoFakeDb();
    const dao = new IssueDAO(db);
    expect(await dao.nextNumber('r1')).toBe(1);
    await dao.create({
      id: 'i1',
      repositoryId: 'r1',
      fullName: 'a/d',
      number: 1,
      title: 'Bug',
      body: null,
      creatorEmail: 'a@x.co',
      now: 100,
    });
    expect(await dao.nextNumber('r1')).toBe(2);
    await expect(dao.getByNumber('r1', 1)).resolves.toMatchObject({ title: 'Bug' });
    await expect(dao.listByRepo('r1')).resolves.toHaveLength(1);
    await dao.setStatus('i1', 'closed', 200);
    await expect(dao.getByNumber('r1', 1)).resolves.toMatchObject({ status: 'closed' });
    await dao.addComment('c1', 'i1', 'a@x.co', 'fixing', 210);
    await expect(dao.listComments('i1')).resolves.toHaveLength(1);
    await dao.deleteByRepo('r1');
    await expect(dao.listByRepo('r1')).resolves.toHaveLength(0);
    await expect(dao.listComments('i1')).resolves.toHaveLength(0);
  });
});

describe('UserDAO', () => {
  it('upserts and reads', async () => {
    const db = createDaoFakeDb();
    const dao = new UserDAO(db);
    await dao.upsertUser('a@x.co', 100);
    await dao.upsertUser('a@x.co', 100);
    await expect(dao.getByEmail('a@x.co')).resolves.toMatchObject({ email: 'a@x.co' });
    await expect(dao.getByEmail('missing@x.co')).resolves.toBeNull();
  });
});
