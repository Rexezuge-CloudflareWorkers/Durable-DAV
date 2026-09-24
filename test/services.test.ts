import { describe, expect, it } from 'vitest';
import type { D1Queryable } from '@duradav/backend-data/utils';
import { CursorUtil } from '@duradav/backend-data/utils/CursorUtil';
import { isD1ErrorRetryable } from '@duradav/backend-data/utils/D1ErrorClassifier';
import { executeD1WithRetry } from '@duradav/backend-data/utils/D1Utils';
import { ConfigurationManager } from '@duradav/backend-runtime/config';
import { AppConfiguration } from '@duradav/backend-runtime/config/AppConfiguration';
import { EnvParser } from '@duradav/backend-runtime/config/EnvParser';
import { IssueService } from '@duradav/backend-services/issue';
import { RepoService } from '@duradav/backend-services/repo';
import { TokenService } from '@duradav/backend-services/auth';
import { UserService } from '@duradav/backend-services/user';
import { DatabaseError } from '@duradav/backend-errors';

// Minimal in-memory D1 fake covering the queries used by DAOs under test.
function createFakeDb(seed: { now?: number } = {}): D1Queryable & {
  repos: Array<Record<string, unknown>>;
  tokens: Array<Record<string, unknown>>;
  tokenScopes: Array<{ token_id: string; scope: string }>;
  issues: Array<Record<string, unknown>>;
  users: Array<Record<string, unknown>>;
  comments: Array<Record<string, unknown>>;
} {
  const now = seed.now ?? 1_700_000_000;
  const state = {
    repos: [] as Array<Record<string, unknown>>,
    tokens: [] as Array<Record<string, unknown>>,
    tokenScopes: [] as Array<{ token_id: string; scope: string }>,
    issues: [] as Array<Record<string, unknown>>,
    users: [] as Array<Record<string, unknown>>,
    comments: [] as Array<Record<string, unknown>>,
  };
  void now;

  function statement(query: string, params: unknown[]) {
    const q = query.replace(/\s+/g, ' ').trim();
    return {
      first<T>(): Promise<T | null> {
        if (q.includes('FROM repositories WHERE owner_ci = ? AND name_ci = ?')) {
          const row = state.repos.find(
            (r) =>
              String(r.owner_ci ?? r.owner).toLowerCase() === String(params[0]).toLowerCase() &&
              String(r.name_ci ?? r.name).toLowerCase() === String(params[1]).toLowerCase(),
          );
          return Promise.resolve((row ?? null) as T | null);
        }
        if (q.includes('FROM repositories WHERE id = ?')) {
          const row = state.repos.find((r) => r.id === params[0]);
          return Promise.resolve((row ?? null) as T | null);
        }
        if (q.startsWith('SELECT COALESCE(MAX(number)')) {
          const max = state.issues.filter((i) => i.repository_id === params[0]).reduce((m, i) => Math.max(m, i.number as number), 0);
          return Promise.resolve({ max_n: max } as unknown as T);
        }
        if (q.startsWith('SELECT * FROM user_access_tokens WHERE token_hash = ?')) {
          const row = state.tokens.find((t) => t.token_hash === params[0] && (t.expires_at as number) > (params[1] as number));
          return Promise.resolve((row ?? null) as T | null);
        }
        if (q.startsWith('SELECT email, created_at FROM users WHERE email = ?') || q.includes('FROM users WHERE lower(email)')) {
          const row = state.users.find((u) => String(u.email).toLowerCase() === String(params[0]).toLowerCase());
          return Promise.resolve((row ?? null) as T | null);
        }
        if (q.includes('FROM issues WHERE repository_id = ? AND number = ?')) {
          const row = state.issues.find((i) => i.repository_id === params[0] && i.number === params[1]);
          return Promise.resolve((row ?? null) as T | null);
        }
        return Promise.resolve(null);
      },
      all<T>(): Promise<{ results: T[] }> {
        if (q.includes('FROM repositories WHERE owner_email = ?') || q.includes('FROM repositories WHERE lower(owner_email)')) {
          const rows = state.repos
            .filter((r) => String(r.owner_email).toLowerCase() === String(params[0]).toLowerCase())
            .slice(0, params[1] as number);
          return Promise.resolve({ results: rows as T[] });
        }
        if (q.includes('FROM repositories WHERE owner_ci = ?')) {
          const rows = state.repos.filter((r) => String(r.owner_ci ?? r.owner).toLowerCase() === String(params[0]).toLowerCase());
          return Promise.resolve({ results: rows as T[] });
        }
        if (q.startsWith('SELECT * FROM user_access_tokens WHERE') && q.includes('user_email')) {
          const rows = state.tokens.filter((t) => String(t.user_email).toLowerCase() === String(params[0]).toLowerCase());
          return Promise.resolve({ results: rows as T[] });
        }
        if (q.startsWith('SELECT scope FROM token_scopes WHERE token_id = ?')) {
          const rows = state.tokenScopes.filter((s) => s.token_id === params[0]).map((s) => ({ scope: s.scope }));
          return Promise.resolve({ results: rows as T[] });
        }
        if (q.includes('FROM issues WHERE repository_id = ?')) {
          const rows = state.issues
            .filter((i) => i.repository_id === params[0])
            .sort((a, b) => (b.number as number) - (a.number as number))
            .slice(0, params[1] as number);
          return Promise.resolve({ results: rows as T[] });
        }
        if (q.startsWith('SELECT * FROM comments WHERE issue_id = ?')) {
          const rows = state.comments
            .filter((cmt) => cmt.issue_id === params[0])
            .sort((a, b) => (a.created_at as number) - (b.created_at as number));
          return Promise.resolve({ results: rows as T[] });
        }
        return Promise.resolve({ results: [] });
      },
      run(): Promise<{ success: boolean; meta?: { changes?: number } }> {
        if (q.startsWith('INSERT INTO repositories')) {
          const [id, owner_email, owner, name, description, is_private, created_at, updated_at] = params as Array<string | number | null>;
          state.repos.push({ id, owner_email, owner, name, description, is_private, created_at, updated_at });
          return Promise.resolve({ success: true, meta: { changes: 1 } });
        }
        if (q.startsWith('INSERT INTO user_access_tokens')) {
          const [token_id, user_email, token_hash, tname, expires_at, created_at, token_prefix] = params as Array<string | number>;
          state.tokens.push({
            token_id,
            user_email,
            token_hash,
            name: tname,
            expires_at,
            last_used_at: null,
            created_at,
            token_prefix: typeof token_prefix === 'string' ? token_prefix : null,
          });
          return Promise.resolve({ success: true, meta: { changes: 1 } });
        }
        if (q.startsWith('DELETE FROM token_scopes WHERE token_id = ?')) {
          state.tokenScopes = state.tokenScopes.filter((s) => s.token_id !== params[0]);
          return Promise.resolve({ success: true, meta: { changes: 1 } });
        }
        if (q.startsWith('INSERT OR IGNORE INTO token_scopes')) {
          const [token_id, scope] = params as [string, string];
          if (!state.tokenScopes.some((s) => s.token_id === token_id && s.scope === scope)) state.tokenScopes.push({ token_id, scope });
          return Promise.resolve({ success: true, meta: { changes: 1 } });
        }
        if (q.startsWith('UPDATE user_access_tokens SET last_used_at')) {
          const row = state.tokens.find((t) => t.token_hash === params[1]);
          if (row) row.last_used_at = params[0];
          return Promise.resolve({ success: true, meta: { changes: 1 } });
        }
        if (q.startsWith('DELETE FROM user_access_tokens WHERE token_id = ?')) {
          const before = state.tokens.length;
          state.tokens = state.tokens.filter(
            (t) => !(t.token_id === params[0] && String(t.user_email).toLowerCase() === String(params[1]).toLowerCase()),
          );
          return Promise.resolve({ success: true, meta: { changes: before - state.tokens.length } });
        }
        if (q.startsWith('INSERT INTO issues')) {
          const [id, repository_id, number, title, body, status, creator_email, created_at, updated_at] = params as Array<
            string | number | null
          >;
          state.issues.push({ id, repository_id, number, title, body, status, creator_email, created_at, updated_at });
          return Promise.resolve({ success: true, meta: { changes: 1 } });
        }
        if (q.startsWith('UPDATE issues SET status = ?')) {
          const [status, updated_at, id] = params as Array<string | number>;
          const row = state.issues.find((i) => i.id === id);
          if (row) {
            row.status = status;
            row.updated_at = updated_at;
          }
          return Promise.resolve({ success: true, meta: { changes: 1 } });
        }
        if (q.startsWith('INSERT INTO comments')) {
          const [id, issue_id, author_email, body, created_at] = params as Array<string | number>;
          state.comments.push({ id, issue_id, author_email, body, created_at });
          return Promise.resolve({ success: true, meta: { changes: 1 } });
        }
        if (q.startsWith('INSERT INTO users')) {
          const [email, created_at] = params as Array<string | number>;
          if (!state.users.some((u) => u.email === email)) state.users.push({ email, created_at });
          return Promise.resolve({ success: true, meta: { changes: 1 } });
        }
        if (q.startsWith('UPDATE repositories SET')) {
          const id = params[params.length - 1] as string;
          const row = state.repos.find((r) => r.id === id);
          if (row) {
            let idx = 1;
            row.updated_at = params[0];
            if (q.includes('description = ?')) row.description = params[idx++] as string | null;
            if (q.includes('is_private = ?')) row.is_private = params[idx++] as number;
          }
          return Promise.resolve({ success: true, meta: { changes: 1 } });
        }
        if (q.startsWith('DELETE FROM comments WHERE issue_id IN')) {
          return Promise.resolve({ success: true, meta: { changes: 0 } });
        }
        if (q.startsWith('DELETE FROM issues WHERE repository_id = ?')) {
          const kept = state.issues.filter((i) => i.repository_id !== params[0]);
          state.issues.splice(0, state.issues.length, ...kept);
          return Promise.resolve({ success: true, meta: { changes: 1 } });
        }
        if (q.startsWith('DELETE FROM repositories WHERE id = ?')) {
          const kept = state.repos.filter((r) => r.id !== params[0]);
          state.repos.splice(0, state.repos.length, ...kept);
          return Promise.resolve({ success: true, meta: { changes: 1 } });
        }
        return Promise.resolve({ success: true, meta: { changes: 0 } });
      },
    };
  }

  const db = {
    ...state,
    prepare(query: string) {
      return { bind: (...params: unknown[]) => statement(query, params) };
    },
  };
  return db as unknown as D1Queryable & typeof state;
}

describe('RepoService', () => {
  it('creates, reads, and lists repos', async () => {
    const db = createFakeDb();
    const svc = new RepoService({ DB: db });
    const { id } = await svc.createRepo('alice@example.com', 'alice', 'demo', 'hi', false);
    expect(id).toBeTruthy();
    await expect(svc.getByOwnerAndName('alice', 'demo')).resolves.toMatchObject({ owner: 'alice', name: 'demo' });
    await expect(svc.listByOwnerEmail('alice@example.com')).resolves.toHaveLength(1);
    await expect(svc.requireOwner('alice', 'demo', 'alice@example.com')).resolves.toMatchObject({ id });
  });

  it('rejects duplicates, invalid names, and over-limit owners', async () => {
    const db = createFakeDb();
    const svc = new RepoService({ DB: db, MAX_REPOS_PER_USER: '1' });
    await svc.createRepo('alice@example.com', 'alice', 'one', null, false);
    await expect(svc.createRepo('alice@example.com', 'alice', 'one', null, false)).rejects.toThrow('already exists');
    await expect(svc.createRepo('alice@example.com', 'alice', 'two', null, false)).rejects.toThrow('Maximum 1');
    await expect(svc.createRepo('alice@example.com', 'bad owner!', 'x', null, false)).rejects.toThrow('Invalid');
    await expect(svc.requireOwner('alice', 'missing', 'alice@example.com')).rejects.toThrow('not found');
    await expect(svc.requireOwner('alice', 'one', 'mallory@example.com')).rejects.toThrow('owner');
  });

  it('updates description/visibility as owner only and deletes with issues', async () => {
    const db = createFakeDb();
    const svc = new RepoService({ DB: db });
    await svc.createRepo('alice@example.com', 'alice', 'demo', 'old', false);
    const issueSvc = new IssueService({ DB: db });
    await issueSvc.createIssue({ repositoryId: db.repos[0].id as string, fullName: 'alice/demo', title: 'T', creatorEmail: 'a@x.co' });

    // Public repo: non-owner without grant is forbidden (still reveals existence).
    await expect(svc.updateRepo('alice', 'demo', 'mallory@example.com', { description: 'x' })).rejects.toThrow('owner');

    const updated = await svc.updateRepo('alice', 'demo', 'alice@example.com', { description: 'new', isPrivate: true });
    expect(updated.description).toBe('new');
    expect(updated.is_private).toBe(1);

    // Private repo: non-owner without grant hides existence.
    await expect(svc.updateRepo('alice', 'demo', 'mallory@example.com', { description: 'x' })).rejects.toThrow('not found');
    await expect(svc.updateRepo('alice', 'demo', 'alice@example.com', { description: 'x'.repeat(501) })).rejects.toThrow('500');
    await expect(svc.updateRepo('alice', 'missing', 'alice@example.com', { description: 'x' })).rejects.toThrow('not found');

    await expect(svc.deleteRepo('alice', 'demo', 'mallory@example.com')).rejects.toThrow('not found');
    await svc.deleteRepo('alice', 'demo', 'alice@example.com');
    expect(db.repos).toHaveLength(0);
    expect(db.issues).toHaveLength(0);
  });
});

describe('IssueService', () => {
  it('numbers issues per repo and lists newest first', async () => {
    const db = createFakeDb();
    const svc = new IssueService({ DB: db });
    const first = await svc.createIssue({ repositoryId: 'r1', fullName: 'alice/demo', title: 'First', creatorEmail: 'a@x.co' });
    const second = await svc.createIssue({
      repositoryId: 'r1',
      fullName: 'alice/demo',
      title: 'Second',
      body: 'b',
      creatorEmail: 'a@x.co',
    });
    expect(first.number).toBe(1);
    expect(second.number).toBe(2);
    const listed = await svc.listByRepo('r1');
    expect(listed.map((i) => i.number)).toEqual([2, 1]);
  });

  it('closes and reopens issues round-trip', async () => {
    const db = createFakeDb();
    const svc = new IssueService({ DB: db });
    await svc.createIssue({ repositoryId: 'r1', fullName: 'alice/demo', title: 'Bug', creatorEmail: 'a@x.co' });
    const closed = await svc.updateStatus({ repositoryId: 'r1', number: 1, status: 'closed' });
    expect(closed.status).toBe('closed');
    await expect(svc.getByNumber('r1', 1)).resolves.toMatchObject({ status: 'closed' });
    const reopened = await svc.updateStatus({ repositoryId: 'r1', number: 1, status: 'open' });
    expect(reopened.status).toBe('open');
    await expect(svc.updateStatus({ repositoryId: 'r1', number: 1, status: 'invalid' })).rejects.toThrow();
  });

  it('adds and lists comments in ASC order', async () => {
    const db = createFakeDb();
    const svc = new IssueService({ DB: db });
    await svc.createIssue({ repositoryId: 'r1', fullName: 'alice/demo', title: 'Bug', creatorEmail: 'a@x.co' });
    const first = await svc.addComment({ repositoryId: 'r1', number: 1, authorEmail: 'a@x.co', body: '  first  ' });
    expect(first.body).toBe('first');
    expect(first.issue_id).toBeTruthy();
    const second = await svc.addComment({ repositoryId: 'r1', number: 1, authorEmail: 'b@x.co', body: 'second' });
    expect(second.body).toBe('second');
    const listed = await svc.listComments('r1', 1);
    expect(listed.map((c) => c.body)).toEqual(['first', 'second']);
  });

  it('rejects missing issues and empty comment bodies', async () => {
    const db = createFakeDb();
    const svc = new IssueService({ DB: db });
    await expect(svc.getByNumber('r1', 99)).rejects.toThrow('not found');
    await expect(svc.updateStatus({ repositoryId: 'r1', number: 99, status: 'closed' })).rejects.toThrow('not found');
    await expect(svc.listComments('r1', 99)).rejects.toThrow('not found');
    await svc.createIssue({ repositoryId: 'r1', fullName: 'alice/demo', title: 'Bug', creatorEmail: 'a@x.co' });
    await expect(svc.addComment({ repositoryId: 'r1', number: 1, authorEmail: 'a@x.co', body: '   ' })).rejects.toThrow();
    await expect(svc.addComment({ repositoryId: 'r1', number: 99, authorEmail: 'a@x.co', body: 'hi' })).rejects.toThrow('not found');
  });
});

describe('TokenService lifecycle', () => {
  it('mints, authenticates, lists, and revokes', async () => {
    const db = createFakeDb();
    const svc = new TokenService({ DB: db });
    const created = await svc.createToken('alice@example.com', 'laptop');
    expect(created.token).toBeTruthy();
    expect(created.scopes).toEqual(['repo:read', 'repo:write']);
    await expect(svc.authenticateWithPAT(created.token)).resolves.toMatchObject({ email: 'alice@example.com' });
    await expect(svc.listTokens('alice@example.com')).resolves.toHaveLength(1);
    await svc.deleteToken(created.tokenId, 'alice@example.com');
    await expect(svc.listTokens('alice@example.com')).resolves.toHaveLength(0);
    await expect(svc.authenticateWithPAT('bogus')).rejects.toThrow();
  });

  it('enforces expiry and per-user limits', async () => {
    const db = createFakeDb();
    const svc = new TokenService({ DB: db, MAX_TOKENS_PER_USER: '1', MAX_TOKEN_EXPIRY_DAYS: '7' });
    await svc.createToken('alice@example.com', 'one');
    await expect(svc.createToken('alice@example.com', 'two')).rejects.toThrow('Maximum 1');
    await expect(svc.createToken('bob@example.com', 'long', 30)).rejects.toThrow('exceed');
  });
});

describe('UserService', () => {
  it('upserts idempotently', async () => {
    const db = createFakeDb();
    const svc = new UserService({ DB: db });
    await svc.upsertUser('Alice@Example.com');
    await svc.upsertUser('alice@example.com');
    expect(db.users).toHaveLength(1);
  });
});

describe('Config', () => {
  it('parses env values with defaults', () => {
    expect(EnvParser.positiveInt({}, 'MISSING', '5')).toBe(5);
    expect(EnvParser.positiveInt({ K: '3' }, 'K', '5')).toBe(3);
    expect(EnvParser.boolean({ B: 'true' }, 'B', 'false')).toBe(true);
    expect(ConfigurationManager.token.getMaxPerUser({})).toBe(5);
    expect(ConfigurationManager.repo.getMaxPerUser({ MAX_REPOS_PER_USER: '7' })).toBe(7);
    const app = AppConfiguration.fromEnv({ SITE_URL: 'https://git.example.com/' });
    expect(app.getSiteUrl()).toBe('https://git.example.com');
    expect(app.isDemoMode()).toBe(false);
  });
});

describe('D1 utils', () => {
  it('retries retryable failures then succeeds', async () => {
    let attempts = 0;
    const result = await executeD1WithRetry(
      () => {
        attempts += 1;
        if (attempts < 3) throw new Error('database is locked');
        return Promise.resolve({ success: true });
      },
      'flaky op',
      { baseDelayMs: 1 },
    );
    expect(result.success).toBe(true);
    expect(attempts).toBe(3);
  });

  it('throws DatabaseError for non-retryable failures', async () => {
    await expect(
      executeD1WithRetry(() => Promise.resolve({ success: false, error: 'UNIQUE constraint failed' }), 'dup'),
    ).rejects.toBeInstanceOf(DatabaseError);
    expect(isD1ErrorRetryable('database is locked')).toBe(true);
    expect(isD1ErrorRetryable('UNIQUE constraint failed')).toBe(false);
    expect(isD1ErrorRetryable('')).toBe(false);
  });

  it('round-trips cursors', () => {
    expect(CursorUtil.decode(CursorUtil.encode({ a: 1 }))).toEqual({ a: 1 });
    expect(CursorUtil.decode('!!!')).toBeUndefined();
    expect(CursorUtil.decode(undefined)).toBeUndefined();
  });
});
