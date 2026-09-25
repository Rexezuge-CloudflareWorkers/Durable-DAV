import { describe, expect, it } from 'vitest';
import { VolumeService } from '../packages/backend-services/src/dav/VolumeService';
import { VolumeCredentialService } from '../packages/backend-services/src/dav/VolumeCredentialService';
import { DavLockGuard } from '../apps/background/src/dav/DavLockGuard';

function lockSql(rowsByPath: Record<string, Array<Record<string, unknown>>>) {
  return {
    exec: (_query: string, path?: unknown) => ({
      toArray: () => (typeof path === 'string' ? (rowsByPath[path] ?? []) : []),
    }),
  };
}

describe('VolumeService quota hardening', () => {
  it('prefers COUNT(*) over listing rows', async () => {
    let listed = false;
    const svc = new VolumeService({ DB: {} as never, MAX_VOLUMES_PER_USER: '1' }, {
      volumeDAO: () =>
        Promise.resolve({
          countByOwnerEmail: async () => 1,
          listByOwnerEmail: async () => {
            listed = true;
            return [];
          },
          getByOwnerName: async () => null,
        } as never),
      userDAO: () => Promise.resolve({ getByEmail: async () => ({ username: 'alice' }) } as never),
      credentialDAO: () => Promise.resolve({} as never),
    });
    await expect(svc.createVolume({ owner: 'alice', name: 'b1', creatorEmail: 'a@x.co' })).rejects.toThrow(
      /Maximum 1 volumes/,
    );
    expect(listed).toBe(false);
  });

  it('falls back to list length when COUNT is unavailable (fake-DB compat)', async () => {
    const svc = new VolumeService({ DB: {} as never, MAX_VOLUMES_PER_USER: '1' }, {
      volumeDAO: () =>
        Promise.resolve({
          countByOwnerEmail: async () => {
            throw new Error('no such function: count');
          },
          listByOwnerEmail: async () => [{ id: 'v1' }],
          getByOwnerName: async () => null,
        } as never),
      userDAO: () => Promise.resolve({ getByEmail: async () => ({ username: 'alice' }) } as never),
      credentialDAO: () => Promise.resolve({} as never),
    });
    await expect(svc.createVolume({ owner: 'alice', name: 'b1', creatorEmail: 'a@x.co' })).rejects.toThrow(
      /Maximum 1 volumes/,
    );
  });
});

describe('VolumeCredentialService config injection hardening', () => {
  it('honors injected AppConfiguration over env strings', async () => {
    const svc = new VolumeCredentialService(
      { DB: {} as never, MAX_CREDENTIALS_PER_VOLUME: '100' },
      {
        credentialDAO: () => Promise.resolve({ countByVolume: async () => 5 } as never),
        config: { getMaxCredentialsPerVolume: () => 5 } as never,
      },
    );
    await expect(svc.createCredential('v1', 'photos', 'laptop')).rejects.toThrow(/Maximum 5 credentials/);
  });
});

describe('DavLockGuard hardening', () => {
  it('returns 423 when a lock token is missing and null when supplied', () => {
    const sql = lockSql({
      'a/b': [{ token: 'opaquelocktoken:1', scope: 'exclusive', depth: '0', expires_at: Date.now() + 60_000 }],
    });
    const guard = new DavLockGuard(sql as never);
    const locked = guard.assertLock(new Request('https://x/'), 'a/b');
    expect(locked?.status).toBe(423);
    const unlocked = guard.assertLock(
      new Request('https://x/', { headers: { If: '(<opaquelocktoken:1>)' } }),
      'a/b',
    );
    expect(unlocked).toBeNull();
  });

  it('treats Depth:infinity ancestor locks as covering descendants', () => {
    const sql = lockSql({
      a: [{ token: 'opaquelocktoken:root', scope: 'exclusive', depth: 'infinity', expires_at: Date.now() + 60_000 }],
    });
    const guard = new DavLockGuard(sql as never);
    expect(guard.assertLock(new Request('https://x/'), 'a/b/c')?.status).toBe(423);
  });
});
