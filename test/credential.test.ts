import { describe, expect, it } from 'vitest';
import { VolumeCredentialService } from '@durable-dav/backend-services/dav';
import { DavCredentialUtil } from '@durable-dav/shared/utils';
import type { D1Queryable } from '@durable-dav/backend-data/utils';

function createCredentialFakeDb() {
  const state = {
    rows: [] as Array<{
      credential_id: string;
      volume_id: string;
      username: string;
      password_hash: string;
      name: string;
      password_prefix: string;
      password_last_four: string;
      created_at: number;
      expires_at: number;
      last_used_at: number | null;
    }>,
  };
  function statement(query: string, params: unknown[]) {
    const q = query.replace(/\s+/g, ' ').trim();
    return {
      first<T>(): Promise<T | null> {
        if (q.includes('FROM dav_credentials WHERE username = ? AND password_hash = ?')) {
          const row = state.rows.find((r) => r.username === params[0] && r.password_hash === params[1]);
          if (!row) return Promise.resolve(null);
          if (q.includes('expires_at > ?') && !(row.expires_at > (params[2] as number))) {
            return Promise.resolve(null);
          }
          return Promise.resolve(row as T);
        }
        if (q.startsWith('SELECT 1 AS found FROM dav_credentials WHERE username = ?')) {
          const found = state.rows.some((r) => r.username === params[0]);
          return Promise.resolve((found ? { found: 1 } : null) as T | null);
        }
        if (q.startsWith('SELECT COUNT(*) AS count FROM dav_credentials WHERE volume_id = ?')) {
          const count = state.rows.filter((r) => r.volume_id === params[0]).length;
          return Promise.resolve({ count } as T);
        }
        if (q.includes('FROM dav_credentials WHERE credential_id = ?')) {
          const row = state.rows.find((r) => r.credential_id === params[0]);
          return Promise.resolve((row ?? null) as T | null);
        }
        return Promise.resolve(null);
      },
      all<T>(): Promise<{ results: T[] }> {
        if (q.includes('FROM dav_credentials WHERE volume_id = ?')) {
          const rows = state.rows.filter((r) => r.volume_id === params[0]);
          return Promise.resolve({ results: rows as T[] });
        }
        return Promise.resolve({ results: [] });
      },
      run(): Promise<{ success: boolean; meta?: { changes?: number } }> {
        if (q.startsWith('INSERT INTO dav_credentials')) {
          const [credential_id, volume_id, username, password_hash, name, password_prefix, password_last_four, created_at, expires_at] =
            params as Array<string | number>;
          if (state.rows.some((r) => r.username === username)) {
            throw new Error('UNIQUE constraint failed: dav_credentials.username');
          }
          state.rows.push({
            credential_id: credential_id as string,
            volume_id: volume_id as string,
            username: username as string,
            password_hash: password_hash as string,
            name: name as string,
            password_prefix: password_prefix as string,
            password_last_four: password_last_four as string,
            created_at: created_at as number,
            expires_at: expires_at as number,
            last_used_at: null,
          });
          return Promise.resolve({ success: true, meta: { changes: 1 } });
        }
        if (q.startsWith('UPDATE dav_credentials SET last_used_at')) {
          const row = state.rows.find((r) => r.credential_id === params[1]);
          if (row) row.last_used_at = params[0] as number;
          return Promise.resolve({ success: true, meta: { changes: 1 } });
        }
        return Promise.resolve({ success: true, meta: { changes: 0 } });
      },
    };
  }
  const db = {
    prepare: (query: string) => ({ bind: (...params: unknown[]) => statement(query, params) }),
  } as unknown as D1Queryable;
  return { db, state };
}

describe('DavCredentialUtil', () => {
  it('hashes deterministically and differs per password', async () => {
    const a = await DavCredentialUtil.hashPassword('abc');
    const b = await DavCredentialUtil.hashPassword('abc');
    const c = await DavCredentialUtil.hashPassword('abd');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('generates volume-adjective-animal usernames without colons', () => {
    for (const volume of ['photos', 'My Files!', 'a']) {
      const username = DavCredentialUtil.generateUsername(volume);
      expect(username).toMatch(/^[a-z0-9-]{1,64}$/);
      expect(username).not.toContain(':');
    }
    expect(DavCredentialUtil.generateUsername('photos').startsWith('photos-')).toBe(true);
  });
});

describe('VolumeCredentialService lifecycle', () => {
  it('mints bucket credentials with generated username and password', async () => {
    const { db } = createCredentialFakeDb();
    const svc = new VolumeCredentialService({ DB: db });
    const created = await svc.createCredential('vol-1', 'photos', 'laptop');
    expect(created.metadata.username.startsWith('photos-')).toBe(true);
    expect(created.password.startsWith('ddav_')).toBe(true);
    expect(created.metadata.name).toBe('laptop');
  });

  it('rejects bad names and expiry at mint time', async () => {
    const { db } = createCredentialFakeDb();
    const svc = new VolumeCredentialService({ DB: db });
    await expect(svc.createCredential('vol-1', 'photos', '')).rejects.toThrow('name is required');
    await expect(svc.createCredential('vol-1', 'photos', 'x', 'nope')).rejects.toThrow('positive integer');
    await expect(svc.createCredential('vol-1', 'photos', 'x', 9999)).rejects.toThrow(/cannot exceed/);
  });

  it('enforces per-bucket quota', async () => {
    const { db } = createCredentialFakeDb();
    const svc = new VolumeCredentialService({ DB: db, MAX_CREDENTIALS_PER_VOLUME: '1' });
    await svc.createCredential('vol-1', 'photos', 'first');
    await expect(svc.createCredential('vol-1', 'photos', 'second')).rejects.toThrow(/Maximum 1 credentials/);
  });
});
