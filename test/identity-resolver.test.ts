import { describe, expect, it } from 'vitest';
import { IdentityResolver, GHOST_USERNAME } from '@duradav/backend-services/identity';

function fakeDb(users: Array<{ email: string; username: string | null }>): never {
  return {
    prepare(query: string) {
      return {
        bind(...params: unknown[]) {
          return {
            first: async <T>(): Promise<T | null> => {
              if (query.includes('FROM users WHERE lower(email)')) {
                const row = users.find((u) => u.email.toLowerCase() === String(params[0]).toLowerCase());
                return (row ?? null) as T | null;
              }
              if (query.includes('FROM users WHERE lower(username) = ?')) {
                const row = users.find((u) => u.username?.toLowerCase() === String(params[0]).toLowerCase());
                return (row ?? null) as T | null;
              }
              return null;
            },
            all: async <T>(): Promise<{ results: T[] }> => {
              if (query.includes('IN (')) {
                const wanted = new Set((params as string[]).map((p) => String(p).toLowerCase()));
                if (query.includes('lower(email)')) {
                  return { results: users.filter((u) => wanted.has(u.email.toLowerCase())) as T[] };
                }
                return { results: users.filter((u) => u.username && wanted.has(u.username.toLowerCase())) as T[] };
              }
              return { results: [] };
            },
            run: async () => ({}),
          };
        },
      };
    },
  } as never;
}

describe('IdentityResolver (email stable ID, username display)', () => {
  it('maps stored emails to current usernames at read time', async () => {
    const r = new IdentityResolver({ DB: fakeDb([{ email: 'a@x.co', username: 'alice' }]) });
    const map = await r.resolveUsernames(['A@X.CO', 'missing@x.co']);
    expect(map.get('a@x.co')).toBe('alice');
    expect(map.get('missing@x.co')).toBe(GHOST_USERNAME);
  });

  it('renames reflect immediately without history rewrite', async () => {
    const users = [{ email: 'a@x.co', username: 'alice' }];
    const r = new IdentityResolver({ DB: fakeDb(users) });
    expect(await r.resolveUsername('a@x.co')).toBe('alice');
    users[0].username = 'alice2';
    expect(await r.resolveUsername('a@x.co')).toBe('alice2');
  });

  it('resolves username-or-email filters to stored email', async () => {
    const r = new IdentityResolver({ DB: fakeDb([{ email: 'a@x.co', username: 'alice' }]) });
    expect(await r.resolveEmail('alice')).toBe('a@x.co');
    expect(await r.resolveEmail('ALICE@X.CO')).toBe('alice@x.co');
    expect(await r.resolveEmail('unknown')).toBeNull();
  });

  it('fails closed (throws) instead of ghosting on DB errors', async () => {
    const r = new IdentityResolver({ DB: fakeDb([]) }, { userDAO: () => Promise.reject(new Error('no table')) });
    await expect(r.resolveUsername('a@x.co')).rejects.toThrow();
    const r2 = new IdentityResolver({ DB: fakeDb([]) }, { userDAO: () => Promise.reject(new Error('no table')) });
    expect(await r2.resolveEmail('alice')).toBeNull();
  });
});
