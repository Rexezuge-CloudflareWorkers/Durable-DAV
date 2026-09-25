import { describe, expect, it } from 'vitest';
import { TokenService } from '@durable-dav/backend-services/auth';
import type { D1Queryable } from '@durable-dav/backend-data/utils';

function fakeDb() {
  const tokens: Array<Record<string, unknown>> = [];
  const statement = (query: string, params: unknown[]) => {
    const q = query.replace(/\s+/g, ' ').trim();
    return {
      first: () => Promise.resolve(null),
      all: () => Promise.resolve({ results: tokens as never[] }),
      run: () => {
        if (q.startsWith('INSERT INTO user_access_tokens')) {
          const [token_id, user_email, token_hash, tname, expires_at, created_at, scopes] = params as Array<string | number>;
          tokens.push({ token_id, user_email, token_hash, name: tname, expires_at, created_at, scopes });
          return Promise.resolve({ success: true, meta: { changes: 1 } });
        }
        return Promise.resolve({ success: true, meta: { changes: 0 } });
      },
    };
  };
  return { prepare: (q: string) => ({ bind: (...p: unknown[]) => statement(q, p) }) } as unknown as D1Queryable;
}

describe('TokenService expiresInDays strictness', () => {
  it('accepts clean integer strings', async () => {
    const svc = new TokenService({ DB: fakeDb() });
    const created = await svc.createToken('alice@example.com', 't1', '30');
    expect(created.expiresAt).toBeGreaterThan(0);
  });

  it('rejects dirty numeric strings (floats, hex, alnum)', async () => {
    const svc = new TokenService({ DB: fakeDb() });
    for (const bad of ['30.5', '0x1e', '30 days', '30abc', '', '  ', '-5', '0']) {
      await expect(svc.createToken('alice@example.com', 't', bad)).rejects.toThrow();
    }
  });

  it('rejects non-integers and over-max', async () => {
    const svc = new TokenService({ DB: fakeDb(), MAX_TOKEN_EXPIRY_DAYS: '90' });
    await expect(svc.createToken('a@example.com', 't', 0)).rejects.toThrow();
    await expect(svc.createToken('a@example.com', 't', 91)).rejects.toThrow();
    await expect(svc.createToken('a@example.com', 't', Number.NaN)).rejects.toThrow();
  });

  it('enforces MAX_TOKENS_PER_USER', async () => {
    const db = fakeDb();
    const svc = new TokenService({ DB: db, MAX_TOKENS_PER_USER: '1' });
    await svc.createToken('bob@example.com', 'first');
    await expect(svc.createToken('bob@example.com', 'second')).rejects.toThrow(/Maximum 1 tokens/);
  });
});
