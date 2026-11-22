import { describe, expect, it } from 'vitest';
import { VolumeCredentialService } from '@durable-dav/backend-services/dav';
import { DavCredentialUtil, NEVER_EXPIRES_AT } from '@durable-dav/shared/utils/DavCredentialUtil';
import { DavCredentialDAO } from '@durable-dav/backend-data/dao';
import type { D1Queryable } from '@rexezuge/d1';

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
      read_only: number;
      is_server: number;
    }>,
  };
  function statement(query: string, params: unknown[]) {
    const q = query.replaceAll(/\s+/g, ' ').trim();
    return {
      first<T>(): Promise<T | null> {
        // Passwords are salted, so the auth lookup is by the globally unique
        // username and the expiry check; the password is verified in the
        // worker, not in SQL.
        if (q.includes('FROM dav_credentials') && q.includes('WHERE username = ? AND expires_at > ?')) {
          const row = state.rows.find((r) => r.username === params[0]);
          if (!row) return Promise.resolve(null);
          return row.expires_at > (params[1] as number) ? Promise.resolve(row as T) : Promise.resolve(null);
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
          const [
            credential_id,
            volume_id,
            username,
            password_hash,
            name,
            password_prefix,
            password_last_four,
            created_at,
            expires_at,
            read_only,
            is_server,
          ] = params as Array<string | number>;
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
            read_only: (read_only as number | undefined) ?? 0,
            is_server: (is_server as number | undefined) ?? 0,
          });
          return Promise.resolve({ success: true, meta: { changes: 1 } });
        }
        if (q.startsWith('UPDATE dav_credentials SET read_only')) {
          // Bind order is (read_only, credential_id, volume_id): the volume
          // scoping is what stops a credential id from another bucket being
          // flipped, so the fake has to honour it the way the WHERE does.
          const [flag, credentialId, volumeId] = params as Array<string | number>;
          const row = state.rows.find((r) => r.credential_id === credentialId && r.volume_id === volumeId);
          if (row) row.read_only = Number(flag);
          return Promise.resolve({ success: true, meta: { changes: row ? 1 : 0 } });
        }
        if (q.startsWith('UPDATE dav_credentials SET last_used_at')) {
          const row = state.rows.find((r) => r.credential_id === params[1]);
          if (row) row.last_used_at = params[0] as number;
          return Promise.resolve({ success: true, meta: { changes: 1 } });
        }
        if (q.startsWith('UPDATE dav_credentials SET password_hash')) {
          const row = state.rows.find((r) => r.credential_id === params[1]);
          if (row) row.password_hash = params[0] as string;
          return Promise.resolve({ success: true, meta: { changes: row ? 1 : 0 } });
        }
        if (q.startsWith('DELETE FROM dav_credentials')) {
          // The credential-pruning cron deletes by `expires_at < now`. Kept
          // here so a test can prove the far-future sentinel survives it.
          const before = state.rows.length;
          state.rows = state.rows.filter((r) => r.expires_at >= (params[0] as number));
          return Promise.resolve({ success: true, meta: { changes: before - state.rows.length } });
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
  it('salts each hash and still verifies the original password', async () => {
    // Two hashes of the same password must differ — determinism was the
    // security bug, not a feature. Full matrix in
    // `test/credential-hashing.test.ts`.
    const a = await DavCredentialUtil.hashPassword('abc');
    const b = await DavCredentialUtil.hashPassword('abc');
    const c = await DavCredentialUtil.hashPassword('abd');
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^pbkdf2-sha256\$\d+\$/u);
    await expect(DavCredentialUtil.verifyPassword('abc', a)).resolves.toMatchObject({ ok: true });
    await expect(DavCredentialUtil.verifyPassword('abd', a)).resolves.toMatchObject({ ok: false });
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

describe('VolumeCredentialService read-only flag', () => {
  it('defaults to full access when the caller sends no flag', async () => {
    // The backwards-compatibility contract: an existing client posting the old
    // body shape must keep a working write credential, not silently lose it.
    const { db } = createCredentialFakeDb();
    const svc = new VolumeCredentialService({ DB: db });
    expect((await svc.createCredential('vol-1', 'photos', 'laptop')).metadata.readOnly).toBe(false);
  });

  it('persists a read-only flag when one is requested', async () => {
    const { db, state } = createCredentialFakeDb();
    const svc = new VolumeCredentialService({ DB: db });
    const created = await svc.createCredential('vol-1', 'photos', 'backup', undefined, true);
    expect(created.metadata.readOnly).toBe(true);
    expect(state.rows[0]?.read_only).toBe(1);
  });

  it('rejects a non-boolean flag rather than defaulting it', async () => {
    // `"true"`, `1`, and `"false"` all mean the caller tried to set this. Quietly
    // defaulting any of them to full access is the one outcome that must not
    // happen by accident.
    const { db } = createCredentialFakeDb();
    const svc = new VolumeCredentialService({ DB: db });
    for (const bad of ['true', 1, 0, 'yes', {}]) {
      await expect(svc.createCredential('vol-1', 'photos', 'x', undefined, bad)).rejects.toThrow('readOnly must be a boolean');
    }
  });

  it('flips a credential in both directions without touching its secret', async () => {
    const { db, state } = createCredentialFakeDb();
    const svc = new VolumeCredentialService({ DB: db });
    const created = await svc.createCredential('vol-1', 'photos', 'backup');
    const hash = state.rows[0]?.password_hash;
    const username = state.rows[0]?.username;

    expect((await svc.setCredentialReadOnly('vol-1', created.metadata.credentialId, true)).readOnly).toBe(true);
    expect(state.rows[0]?.read_only).toBe(1);
    expect((await svc.setCredentialReadOnly('vol-1', created.metadata.credentialId, false)).readOnly).toBe(false);
    expect(state.rows[0]?.read_only).toBe(0);
    // The toggle is a policy statement, not a credential rotation: a secret
    // must not be able to change underneath a client that already holds it.
    expect(state.rows[0]?.password_hash).toBe(hash);
    expect(state.rows[0]?.username).toBe(username);
  });

  it('refuses to flip a credential that belongs to another bucket', async () => {
    // The UPDATE is scoped by volume id, so a credential id from elsewhere is
    // a silent no-op. Reporting success there would tell the caller the flag
    // was applied when it was not.
    const { db, state } = createCredentialFakeDb();
    const svc = new VolumeCredentialService({ DB: db });
    const created = await svc.createCredential('vol-1', 'photos', 'backup');
    await expect(svc.setCredentialReadOnly('vol-other', created.metadata.credentialId, true)).rejects.toThrow('Credential not found');
    expect(state.rows[0]?.read_only).toBe(0);
  });

  it('reports a missing credential as not found rather than succeeding', async () => {
    const { db } = createCredentialFakeDb();
    const svc = new VolumeCredentialService({ DB: db });
    await expect(svc.setCredentialReadOnly('vol-1', 'cred_missing', true)).rejects.toThrow('Credential not found');
  });

  it('rejects a non-boolean flip', async () => {
    const { db } = createCredentialFakeDb();
    const svc = new VolumeCredentialService({ DB: db });
    const created = await svc.createCredential('vol-1', 'photos', 'backup');
    await expect(svc.setCredentialReadOnly('vol-1', created.metadata.credentialId, 'yes')).rejects.toThrow('readOnly must be a boolean');
  });
});

describe('VolumeCredentialService server credentials', () => {
  it('mints a never-expiring credential flagged as a server credential', async () => {
    const { db, state } = createCredentialFakeDb();
    const svc = new VolumeCredentialService({ DB: db });
    const created = await svc.createCredential('vol-1', 'photos', 'daemon', undefined, false, true);
    expect(created.metadata.isServer).toBe(true);
    expect(created.metadata.expiresAt).toBe(NEVER_EXPIRES_AT);
    expect(state.rows[0]?.is_server).toBe(1);
    expect(state.rows[0]?.expires_at).toBe(NEVER_EXPIRES_AT);
  });

  it('does not resolve an expiry for a server credential', async () => {
    // An absent expiry would otherwise fall back to the 365-day default, and a
    // supplied one would be capped at it — either way defeating the type.
    const { db } = createCredentialFakeDb();
    const svc = new VolumeCredentialService({ DB: db });
    for (const expiresInDays of [undefined, 'nope', 9999, 0]) {
      const created = await svc.createCredential('vol-1', 'photos', 'daemon', expiresInDays, false, true);
      expect(created.metadata.expiresAt).toBe(NEVER_EXPIRES_AT);
    }
  });

  it('honors the read-only toggle on a server credential', async () => {
    const { db, state } = createCredentialFakeDb();
    const svc = new VolumeCredentialService({ DB: db });
    const created = await svc.createCredential('vol-1', 'photos', 'backup-daemon', undefined, true, true);
    expect(created.metadata.readOnly).toBe(true);
    expect(created.metadata.isServer).toBe(true);
    expect(state.rows[0]?.read_only).toBe(1);
    expect(state.rows[0]?.is_server).toBe(1);
  });

  it('rejects a non-boolean server flag rather than defaulting it', async () => {
    const { db } = createCredentialFakeDb();
    const svc = new VolumeCredentialService({ DB: db });
    for (const bad of ['true', 1, 0, 'yes', {}]) {
      await expect(svc.createCredential('vol-1', 'photos', 'x', undefined, false, bad)).rejects.toThrow('server must be a boolean');
    }
  });

  it('allows several server credentials and counts them toward the bucket cap', async () => {
    const { db, state } = createCredentialFakeDb();
    const svc = new VolumeCredentialService({ DB: db, MAX_CREDENTIALS_PER_VOLUME: '2' });
    await svc.createCredential('vol-1', 'photos', 'daemon-a', undefined, false, true);
    await svc.createCredential('vol-1', 'photos', 'daemon-b', undefined, false, true);
    expect(state.rows).toHaveLength(2);
    await expect(svc.createCredential('vol-1', 'photos', 'daemon-c', undefined, false, true)).rejects.toThrow(/Maximum 2 credentials/);
  });

  it('keeps ordinary credentials time-boxed and unflagged', async () => {
    const { db } = createCredentialFakeDb();
    const svc = new VolumeCredentialService({ DB: db });
    const created = await svc.createCredential('vol-1', 'photos', 'laptop', 7);
    expect(created.metadata.isServer).toBe(false);
    const days = (created.metadata.expiresAt - Math.floor(Date.now() / 1000)) / 86_400;
    expect(days).toBeGreaterThan(6);
    expect(days).toBeLessThanOrEqual(7);
  });

  it('keeps a server credential active and unpruned past any normal expiry', async () => {
    const { db, state } = createCredentialFakeDb();
    const svc = new VolumeCredentialService({ DB: db });
    const created = await svc.createCredential('vol-1', 'photos', 'daemon', undefined, false, true);
    const dao = new DavCredentialDAO(db);

    const found = await dao.getActiveByUsername(created.metadata.username);
    expect(found?.isServer).toBe(true);
    expect(found?.passwordHash).toBeTruthy();
    expect(found?.expiresAt).toBe(NEVER_EXPIRES_AT);

    // The cron's prune pass must never touch it, even when asked to cut off at a
    // time far beyond any ordinary credential's expiry.
    await dao.pruneExpired(NEVER_EXPIRES_AT - 1, 500);
    expect(state.rows.some((r) => r.credential_id === created.metadata.credentialId)).toBe(true);
  });

  it('still prunes an ordinary expired credential', async () => {
    const { db, state } = createCredentialFakeDb();
    const svc = new VolumeCredentialService({ DB: db });
    const created = await svc.createCredential('vol-1', 'photos', 'short-lived', 1);
    const dao = new DavCredentialDAO(db);

    await dao.pruneExpired(created.metadata.expiresAt + 1, 500);
    expect(state.rows).toHaveLength(0);
    await expect(dao.getActiveByUsername(created.metadata.username)).resolves.toBeUndefined();
  });
});
