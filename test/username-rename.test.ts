import { describe, expect, it } from 'vitest';
import { DavVolumeDAO } from '@durable-dav/backend-data/dao';
import { UserService } from '@durable-dav/backend-services/user';

function fakeDb() {
  return {
    users: [] as Array<{ email: string; created_at: number; username: string | null; updated_at: number | null }>,
    namespaces: [] as Array<{ username_ci: string; kind: string; user_email: string | null; created_at: number }>,
    volumes: [] as Array<{ id: string; owner_email: string; owner: string; name: string; owner_ci: string }>,
  };
}

type Db = ReturnType<typeof fakeDb>;

function makeD1(db: Db) {
  return {
    prepare: (query: string) => ({
      bind: (...bindings: unknown[]) => ({
        first: async () => {
          if (query.includes('FROM users WHERE lower(email)')) {
            return (db.users.find((u) => u.email.toLowerCase() === String(bindings[0]).toLowerCase()) ?? null) as never;
          }
          if (query.includes('FROM users WHERE lower(username)')) {
            return (db.users.find((u) => (u.username ?? '').toLowerCase() === String(bindings[0]).toLowerCase()) ?? null) as never;
          }
          if (query.includes('FROM namespaces WHERE username_ci')) {
            return (db.namespaces.find((n) => n.username_ci === String(bindings[0])) ?? null) as never;
          }
          return null as never;
        },
        all: async () => ({ results: [] }) as never,
        run: async () => {
          if (query.startsWith('INSERT INTO namespaces ')) {
            const [usernameCi, kind, userEmail, createdAt] = bindings as [string, string, string | null, number];
            if (db.namespaces.some((n) => n.username_ci === usernameCi)) throw new Error('UNIQUE constraint failed: namespaces.username_ci');
            db.namespaces.push({ username_ci: usernameCi, kind, user_email: userEmail, created_at: createdAt });
            return { success: true } as never;
          }
          if (query.startsWith('INSERT OR IGNORE INTO namespaces')) {
            const [usernameCi, kind, userEmail, createdAt] = bindings as [string, string, string | null, number];
            if (!db.namespaces.some((n) => n.username_ci === usernameCi)) {
              db.namespaces.push({ username_ci: usernameCi, kind, user_email: userEmail, created_at: createdAt });
            }
            return { success: true } as never;
          }
          if (query.startsWith('UPDATE users SET username = ?')) {
            const [username, now, email] = bindings as [string, number, string];
            const row = db.users.find((u) => u.email.toLowerCase() === email.toLowerCase());
            if (row) {
              row.username = username;
              row.updated_at = now;
            }
            return { success: true } as never;
          }
          if (query.startsWith('UPDATE dav_volumes SET owner = ?')) {
            const [newOwner, newOwnerCi, now, oldOwnerCi] = bindings as [string, string, number, string];
            for (const volume of db.volumes) {
              if (volume.owner_ci === String(oldOwnerCi).toLowerCase()) {
                volume.owner = newOwner;
                volume.owner_ci = String(newOwnerCi).toLowerCase();
                void now;
              }
            }
            return { success: true } as never;
          }
          return { success: true } as never;
        },
      }),
    }),
  };
}

function seedAlice(db: Db): void {
  db.users.push({ email: 'alice@example.com', created_at: 1, username: 'alice', updated_at: 1 });
  db.namespaces.push({ username_ci: 'alice', kind: 'user', user_email: 'alice@example.com', created_at: 1 });
}

describe('DavVolumeDAO.renameOwner', () => {
  it('updates owner and owner_ci for the old namespace only', async () => {
    const seen: Array<{ sql: string; bindings: unknown[] }> = [];
    const db = {
      prepare: (sql: string) => ({
        bind: (...bindings: unknown[]) => {
          seen.push({ sql, bindings });
          return { run: async () => ({ success: true }) };
        },
      }),
    };
    const dao = new DavVolumeDAO(db as never);
    await dao.renameOwner('Alice', 'Alice2', 42);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.sql).toContain('UPDATE dav_volumes SET owner = ?');
    expect(seen[0]?.bindings).toEqual(['Alice2', 'alice2', 42, 'alice']);
  });
});

describe('UserService rename with volume cascade', () => {
  it('renames, reserves the old name for others, cascades volumes, and allows self reclaim', async () => {
    const db = fakeDb();
    seedAlice(db);
    db.volumes.push({ id: 'vol-1', owner_email: 'alice@example.com', owner: 'alice', name: 'photos', owner_ci: 'alice' });
    const svc = new UserService({ DB: makeD1(db) as never });

    const renamed = await svc.renameUsername('alice@example.com', 'Alice2');
    expect(renamed).toEqual({ email: 'alice@example.com', username: 'Alice2' });
    expect(db.namespaces.some((n) => n.username_ci === 'alice')).toBe(true);
    expect(db.volumes[0]?.owner).toBe('Alice2');
    expect(db.volumes[0]?.owner_ci).toBe('alice2');

    db.users.push({ email: 'bob@x.co', created_at: 1, username: 'bob', updated_at: 1 });
    const bobSvc = new UserService({ DB: makeD1(db) as never });
    await expect(bobSvc.renameUsername('bob@x.co', 'alice')).rejects.toThrow('already taken');

    await expect(svc.renameUsername('alice@example.com', 'alice')).resolves.toEqual({
      email: 'alice@example.com',
      username: 'alice',
    });
    await expect(svc.renameUsername('alice@example.com', 'ALICE')).resolves.toMatchObject({ username: 'alice' });
  });

  it('reclaims a self-owned namespace when the claim races', async () => {
    let released = 0;
    const svc = new UserService({ DB: {} } as never, {
      userDAO: () =>
        Promise.resolve({
          getByEmail: async () => ({ email: 'alice@example.com', username: 'alice' }),
          getByUsernameCi: async () => null,
          setUsername: async () => undefined,
        }) as never,
      namespaceDAO: () =>
        Promise.resolve({
          isTaken: async () => false,
          claim: async () => {
            throw new Error('UNIQUE constraint failed: namespaces.username_ci');
          },
          get: async () => ({ username_ci: 'alice2', kind: 'user', user_email: 'alice@example.com', created_at: 1 }),
          release: async () => {
            released += 1;
          },
        }) as never,
      volumeDAO: () => Promise.resolve({ renameOwner: async () => undefined }) as never,
    });
    await expect(svc.renameUsername('alice@example.com', 'alice2')).resolves.toEqual({
      email: 'alice@example.com',
      username: 'alice2',
    });
    expect(released).toBe(0);
  });

  it('rolls back a fresh namespace claim when setUsername fails', async () => {
    let released: string | null = null;
    const svc = new UserService({ DB: {} } as never, {
      userDAO: () =>
        Promise.resolve({
          getByEmail: async () => ({ email: 'alice@example.com', username: 'alice' }),
          getByUsernameCi: async () => null,
          setUsername: async () => {
            throw new Error('D1 busy');
          },
        }) as never,
      namespaceDAO: () =>
        Promise.resolve({
          isTaken: async () => false,
          claim: async () => undefined,
          get: async () => null,
          release: async (ci: string) => {
            released = ci;
          },
        }) as never,
      volumeDAO: () => Promise.resolve({ renameOwner: async () => undefined }) as never,
    });
    await expect(svc.renameUsername('alice@example.com', 'alice2')).rejects.toThrow('D1 busy');
    expect(released).toBe('alice2');
  });

  it('rejects taken, invalid, reserved, and missing renames', async () => {
    const db = fakeDb();
    seedAlice(db);
    db.users.push({ email: 'bob@x.co', created_at: 1, username: 'taken2', updated_at: 1 });
    db.namespaces.push({ username_ci: 'taken2', kind: 'user', user_email: 'bob@x.co', created_at: 1 });
    const svc = new UserService({ DB: makeD1(db) as never });
    await expect(svc.renameUsername('alice@example.com', 'taken2')).rejects.toThrow('already taken');
    await expect(svc.renameUsername('alice@example.com', 'bad name!')).rejects.toThrow('Invalid username');
    await expect(svc.renameUsername('alice@example.com', 'admin')).rejects.toThrow('reserved');
    await expect(svc.renameUsername('ghost@x.co', 'fresh')).rejects.toThrow('User not found');
  });

  it('falls back to legacy usernames when the namespace table is missing', async () => {
    const db = fakeDb();
    db.users.push({ email: 'legacy@x.co', created_at: 1, username: 'legacy', updated_at: 1 });
    const throwing = {
      prepare: (query: string) => {
        if (query.includes('namespaces')) {
          return {
            bind: () => ({
              first: () => Promise.reject(new Error('no such table: namespaces')),
              all: () => Promise.reject(new Error('no such table: namespaces')),
              run: () => Promise.reject(new Error('no such table: namespaces')),
            }),
          };
        }
        return (makeD1(db) as unknown as Record<string, (q: string) => unknown>).prepare(query) as never;
      },
    };
    const svc = new UserService({ DB: throwing as never });
    await expect(svc.renameUsername('legacy@x.co', 'legacy2')).resolves.toEqual({ email: 'legacy@x.co', username: 'legacy2' });
  });
});
