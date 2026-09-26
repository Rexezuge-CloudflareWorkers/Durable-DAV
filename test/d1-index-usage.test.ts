import { describe, expect, it } from 'vitest';
import { UserDAO } from '@durable-dav/backend-data/dao';
import { DavVolumeDAO } from '@durable-dav/backend-data/dao';

/**
 * Email predicates must be index-usable.
 *
 * `WHERE lower(owner_email) = lower(?)` puts a function call on the column, so
 * SQLite cannot use `idx_dav_volumes_owner_email` and falls back to a full
 * table scan on what is the single hottest query in the product (the
 * dashboard's volume list, plus the quota check behind every create).
 */
describe('D1 predicates do not wrap an indexed column in lower()', () => {
  function recordingDatabase(): { db: D1Database; queries: string[]; bindings: unknown[] } {
    const queries: string[] = [];
    const bindings: unknown[] = [];
    const prepare = (sql: string) => {
      queries.push(sql);
      return {
        bind: (...values: unknown[]) => {
          bindings.push(...values);
          return {
            first: () => Promise.resolve(null),
            run: () => Promise.resolve({ success: true, meta: {} }),
            all: () => Promise.resolve({ results: [] }),
          };
        },
        first: () => Promise.resolve(null),
        run: () => Promise.resolve({ success: true, meta: {} }),
        all: () => Promise.resolve({ results: [] }),
      };
    };
    return { db: { prepare } as unknown as D1Database, queries, bindings };
  }

  it('UserDAO looks the user up by email directly', async () => {
    const { db, queries } = recordingDatabase();
    await new UserDAO(db).getByEmail('Alice@Example.com');
    expect(queries[0]).not.toMatch(/lower\(\s*email\s*\)/u);
    expect(queries[0]).toMatch(/WHERE email = \?/u);
  });

  it('UserDAO looks the handle up by username directly', async () => {
    const { db, queries } = recordingDatabase();
    await new UserDAO(db).getByUsernameCi('Alice');
    expect(queries[0]).not.toMatch(/lower\(\s*username\s*\)/u);
    expect(queries[0]).toMatch(/WHERE username = \?/u);
  });

  it('DavVolumeDAO lists by owner_email directly', async () => {
    const { db, queries } = recordingDatabase();
    await new DavVolumeDAO(db).listByOwnerEmail('Alice@Example.com', 100);
    expect(queries[0]).not.toMatch(/lower\(\s*owner_email\s*\)/u);
    expect(queries[0]).toMatch(/WHERE owner_email = \?/u);
  });

  it('DavVolumeDAO counts by owner_email directly', async () => {
    const { db, queries } = recordingDatabase();
    await new DavVolumeDAO(db).countByOwnerEmail('Alice@Example.com');
    expect(queries[0]).not.toMatch(/lower\(\s*owner_email\s*\)/u);
    expect(queries[0]).toMatch(/WHERE owner_email = \?/u);
  });

  it('lowercases the binding instead, so case-insensitivity is preserved', async () => {
    // The column is stored lowercased by every writer, so lowercasing the
    // *parameter* gives the same matching semantics while keeping the index.
    const { db, bindings } = recordingDatabase();
    await new DavVolumeDAO(db).listByOwnerEmail('Alice@Example.COM', 100);
    expect(bindings[0]).toBe('alice@example.com');
  });

  it('lowercases the email binding on the user lookup', async () => {
    const { db, bindings } = recordingDatabase();
    await new UserDAO(db).getByEmail('Alice@Example.com');
    expect(bindings[0]).toBe('alice@example.com');
  });
});

describe('credential lookup is by username, not by hash', () => {
  function credentialDatabase(): { db: D1Database; queries: string[] } {
    const queries: string[] = [];
    const prepare = (sql: string) => {
      queries.push(sql);
      return {
        bind: () => ({ first: () => Promise.resolve(null) }),
        first: () => Promise.resolve(null),
      };
    };
    return { db: { prepare } as unknown as D1Database, queries };
  }

  it('does not search on password_hash', async () => {
    // Passwords are salted, so no hash can be searched on: two users with the
    // same password have different hashes. The auth path loads by the globally
    // unique username and verifies the password in the worker.
    const { db, queries } = credentialDatabase();
    const { DavCredentialDAO } = await import('@durable-dav/backend-data/dao');
    await new DavCredentialDAO(db).getActiveByUsername('alice');
    expect(queries[0]).not.toMatch(/password_hash\s*=/u);
    expect(queries[0]).toMatch(/WHERE username = \? AND expires_at > \?/u);
  });
});
