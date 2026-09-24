import { describe, expect, it } from 'vitest';
import { TokenService, coversScope, normalizeTokenScopes } from '@duradav/backend-services/auth';
import type { D1Queryable } from '@duradav/backend-data/utils';

function createTokenFakeDb(): D1Queryable & { tokens: Array<Record<string, unknown>> } {
  const state = {
    tokens: [] as Array<Record<string, unknown>>,
    scopes: [] as Array<{ token_id: string; scope: string }>,
  };
  function statement(query: string, params: unknown[]) {
    const q = query.replace(/\s+/g, ' ').trim();
    return {
      first<T>(): Promise<T | null> {
        if (q.startsWith('SELECT * FROM user_access_tokens WHERE token_hash = ?')) {
          const row = state.tokens.find((t) => t.token_hash === params[0] && (t.expires_at as number) > (params[1] as number));
          return Promise.resolve((row ?? null) as T | null);
        }
        return Promise.resolve(null);
      },
      all<T>(): Promise<{ results: T[] }> {
        if (q.startsWith('SELECT * FROM user_access_tokens WHERE')) {
          const rows = state.tokens.filter((t) => String(t.user_email).toLowerCase() === String(params[0]).toLowerCase());
          return Promise.resolve({ results: rows as T[] });
        }
        if (q.startsWith('SELECT scope FROM token_scopes WHERE token_id = ?')) {
          const rows = state.scopes.filter((s) => s.token_id === params[0]).map((s) => ({ scope: s.scope }));
          return Promise.resolve({ results: rows as T[] });
        }
        return Promise.resolve({ results: [] });
      },
      run(): Promise<{ success: boolean; meta?: { changes?: number } }> {
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
          state.scopes = state.scopes.filter((s) => s.token_id !== params[0]);
          return Promise.resolve({ success: true, meta: { changes: 1 } });
        }
        if (q.startsWith('INSERT OR IGNORE INTO token_scopes')) {
          const [token_id, scope] = params as [string, string];
          if (!state.scopes.some((s) => s.token_id === token_id && s.scope === scope)) state.scopes.push({ token_id, scope });
          return Promise.resolve({ success: true, meta: { changes: 1 } });
        }
        if (q.startsWith('UPDATE user_access_tokens SET last_used_at')) {
          const row = state.tokens.find((t) => t.token_hash === params[1]);
          if (row) row.last_used_at = params[0];
          return Promise.resolve({ success: true, meta: { changes: 1 } });
        }
        return Promise.resolve({ success: true, meta: { changes: 0 } });
      },
    };
  }
  return {
    prepare: (query: string) => ({ bind: (...params: unknown[]) => statement(query, params) }),
    tokens: state.tokens,
  } as unknown as D1Queryable & {
    tokens: Array<Record<string, unknown>>;
  };
}

describe('TokenService hashing', () => {
  it('hashes deterministically and differs per token', async () => {
    const a = await TokenService.hashToken('abc');
    const b = await TokenService.hashToken('abc');
    const c = await TokenService.hashToken('abd');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('token scope helpers', () => {
  it('coversScope applies the admin > write > read hierarchy', () => {
    expect(coversScope(['dav:read'], 'dav:read')).toBe(true);
    expect(coversScope(['dav:read'], 'dav:write')).toBe(false);
    expect(coversScope(['dav:write'], 'dav:read')).toBe(true);
    expect(coversScope(['dav:write'], 'dav:write')).toBe(true);
    expect(coversScope(['dav:write'], 'admin')).toBe(false);
    expect(coversScope(['admin'], 'dav:read')).toBe(true);
    expect(coversScope(['admin'], 'dav:write')).toBe(true);
    expect(coversScope(['admin'], 'admin')).toBe(true);
    expect(coversScope([], 'dav:read')).toBe(false);
  });

  it('coversScope accepts legacy repo:* aliases', () => {
    expect(coversScope(['repo:read'], 'dav:read')).toBe(true);
    expect(coversScope(['dav:write'], 'repo:read')).toBe(true);
    expect(coversScope(['repo:write'], 'dav:write')).toBe(true);
    expect(coversScope(['admin'], 'repo:read')).toBe(true);
  });

  it('normalizeTokenScopes defaults omitted input and rejects bad input', () => {
    expect(normalizeTokenScopes(undefined)).toEqual(['dav:read', 'dav:write']);
    expect(normalizeTokenScopes(null)).toEqual(['dav:read', 'dav:write']);
    expect(normalizeTokenScopes(['dav:read'])).toEqual(['dav:read']);
    expect(normalizeTokenScopes(['repo:read'])).toEqual(['dav:read']);
    expect(normalizeTokenScopes(['repo:read', 'repo:write'])).toEqual(['dav:read', 'dav:write']);
    expect(() => normalizeTokenScopes([])).toThrow('scopes must be');
    expect(() => normalizeTokenScopes(['nope'])).toThrow('scopes must be');
    expect(() => normalizeTokenScopes(['dav:read', 'nope'])).toThrow('scopes must be');
    expect(() => normalizeTokenScopes('dav:read')).toThrow('scopes must be');
  });
});

describe('TokenService scoped lifecycle', () => {
  it('mints scoped tokens and returns scopes on authenticate', async () => {
    const db = createTokenFakeDb();
    const svc = new TokenService({ DB: db });
    const created = await svc.createToken('alice@example.com', 'reader', undefined, ['dav:read']);
    expect(created.scopes).toEqual(['dav:read']);
    const identity = await svc.authenticateWithPAT(created.token);
    expect(identity).toMatchObject({ email: 'alice@example.com', scopes: ['dav:read'] });
    expect(identity.volumeGrants).toEqual([]);
    expect(TokenService.coversScope(identity.scopes, 'dav:read')).toBe(true);
    expect(TokenService.coversScope(identity.scopes, 'dav:write')).toBe(false);
  });

  it('rejects invalid scopes at mint time', async () => {
    const db = createTokenFakeDb();
    const svc = new TokenService({ DB: db });
    await expect(svc.createToken('alice@example.com', 'bad', undefined, ['nope'])).rejects.toThrow('scopes must be');
  });

  it('denies rows without junction scopes (fail-closed)', async () => {
    const db = createTokenFakeDb();
    db.tokens.push({
      token_id: 'legacy',
      user_email: 'legacy@example.com',
      token_hash: await TokenService.hashToken('legacy-token'),
      name: 'legacy',
      expires_at: 9_999_999_999,
      last_used_at: null,
      created_at: 1,
    });
    const svc = new TokenService({ DB: db });
    const identity = await svc.authenticateWithPAT('legacy-token');
    expect(identity.scopes).toEqual([]);
    expect(TokenService.coversScope(identity.scopes, 'dav:read')).toBe(false);
  });

  it('fails closed when volume grants cannot be read', async () => {
    const db = createTokenFakeDb();
    const svc = new TokenService({ DB: db });
    const created = await svc.createToken('alice@example.com', 'scoped', undefined, ['dav:read']);
    const failing = new TokenService(
      { DB: db },
      {
        tokenVolumeGrantDAO: () =>
          Promise.resolve({
            listByToken: () => Promise.reject(new Error('D1 unavailable')),
          } as never),
      },
    );
    await expect(failing.authenticateWithPAT(created.token)).rejects.toThrow('temporarily unavailable');
  });

  it('fails closed when repo grants cannot be read', async () => {
    const db = createTokenFakeDb();
    const svc = new TokenService({ DB: db });
    const created = await svc.createToken('alice@example.com', 'scoped', undefined, ['dav:read']);
    const failing = new TokenService(
      { DB: db },
      {
        tokenGrantDAO: () =>
          Promise.resolve({
            listByToken: () => Promise.reject(new Error('D1 unavailable')),
          } as never),
      },
    );
    await expect(failing.authenticateWithPAT(created.token)).rejects.toThrow('temporarily unavailable');
  });
});
