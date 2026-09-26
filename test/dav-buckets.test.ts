import { describe, expect, it } from 'vitest';
import { DavPermissionService, VolumeService, VolumeCredentialService, checkVolumeQuota } from '@durable-dav/backend-services/dav';
import { DavCredentialUtil } from '@durable-dav/shared/utils';
import type { DavVolumeRow } from '@durable-dav/backend-data/dao';

function fakeVolumeDb(opts: { ownedCount?: number; username?: string | null; existing?: unknown } = {}) {
  const calls = { credentialsDeleted: 0 };
  const volumeDAO = {
    getByOwnerName: async () => (opts.existing as never) ?? null,
    getById: async () => (opts.existing as never) ?? null,
    listByOwnerEmail: async () => Array.from({ length: opts.ownedCount ?? 0 }, (_, i) => ({ id: `v${i}` })),
    create: async () => undefined,
    update: async () => undefined,
    deleteById: async () => undefined,
  };
  const userDAO = {
    getByEmail: async () =>
      opts.username === undefined
        ? { email: 'a@x.co', username: 'alice' }
        : opts.username
          ? { email: 'a@x.co', username: opts.username }
          : null,
  };
  return {
    calls,
    deps: {
      volumeDAO: () => Promise.resolve(volumeDAO as never),
      userDAO: () => Promise.resolve(userDAO as never),
      credentialDAO: () =>
        Promise.resolve({
          deleteByVolume: async () => {
            calls.credentialsDeleted += 1;
          },
        } as never),
    },
  };
}

describe('VolumeCreatePolicy quota', () => {
  it('rejects at the cap', () => {
    expect(() => checkVolumeQuota(100, 100)).toThrow(/Maximum 100 volumes/);
    expect(() => checkVolumeQuota(99, 100)).not.toThrow();
  });
});

describe('VolumeService user-only buckets', () => {
  it('enforces per-user quota from MAX_VOLUMES_PER_USER', async () => {
    const { deps } = fakeVolumeDb({ ownedCount: 2, username: 'alice' });
    const svc = new VolumeService({ DB: {} as never, MAX_VOLUMES_PER_USER: '2' }, deps);
    await expect(svc.createVolume({ owner: 'alice', name: 'b1', creatorEmail: 'a@x.co' })).rejects.toThrow(/Maximum 2 volumes/);
  });

  it('rejects owner mismatch (no org volumes)', async () => {
    const { deps } = fakeVolumeDb({ ownedCount: 0, username: 'alice' });
    const svc = new VolumeService({ DB: {} as never }, deps);
    await expect(svc.createVolume({ owner: 'bob', name: 'b1', creatorEmail: 'a@x.co' })).rejects.toThrow(/owner/);
  });

  it('creates private-by-default buckets and cleans credentials on delete', async () => {
    const created = {
      id: 'vol-1',
      owner_email: 'a@x.co',
      owner: 'alice',
      name: 'photos',
      is_private: 1,
    };
    const seen: Array<{ isPrivate: boolean }> = [];
    const { deps, calls } = fakeVolumeDb({ ownedCount: 0, username: 'alice', existing: null });
    const svc = new VolumeService(
      { DB: {} as never },
      {
        ...deps,
        volumeDAO: () =>
          Promise.resolve({
            getByOwnerName: async () => null,
            getById: async () => created as never,
            listByOwnerEmail: async () => [],
            create: async (input: { isPrivate: boolean }) => {
              seen.push({ isPrivate: input.isPrivate });
            },
            update: async () => undefined,
            deleteById: async () => undefined,
          } as never),
      },
    );
    const row = await svc.createVolume({ owner: 'alice', name: 'photos', creatorEmail: 'A@X.co' });
    expect(row.owner_email).toBe('a@x.co');
    expect(seen[0]?.isPrivate).toBe(true);

    const deleter = new VolumeService(
      { DB: {} as never },
      {
        ...deps,
        volumeDAO: () =>
          Promise.resolve({
            getByOwnerName: async () => created as never,
            getById: async () => created as never,
            listByOwnerEmail: async () => [],
            create: async () => undefined,
            update: async () => undefined,
            deleteById: async () => undefined,
          } as never),
      },
    );
    await deleter.deleteVolume('alice', 'photos');
    expect(calls.credentialsDeleted).toBe(1);
  });

  it('updates description and visibility owner-only', async () => {
    const stored = {
      id: 'vol-1',
      owner_email: 'a@x.co',
      owner: 'alice',
      name: 'photos',
      description: null,
      is_private: 1,
    };
    const { deps } = fakeVolumeDb({ ownedCount: 0, username: 'alice' });
    const svc = new VolumeService(
      { DB: {} as never },
      {
        ...deps,
        volumeDAO: () =>
          Promise.resolve({
            getByOwnerName: async () => stored as never,
            getById: async () => ({ ...stored, description: 'hi', is_private: 0 }) as never,
            listByOwnerEmail: async () => [],
            create: async () => undefined,
            update: async () => undefined,
            deleteById: async () => undefined,
          } as never),
      },
    );
    const updated = await svc.updateVolume('alice', 'photos', 'a@x.co', { description: 'hi', isPrivate: false });
    expect(updated.description).toBe('hi');
    await expect(svc.updateVolume('alice', 'photos', 'other@x.co', { isPrivate: true })).rejects.toThrow(/owner/);
  });
});

describe('DavPermissionService owner-only', () => {
  // `getRole` only reads `owner_email` and `is_private`, so a minimal
  // projection is enough and keeps the fixture readable.
  const volume = { id: 'v1', owner_email: 'owner@x.co', is_private: 1 } as DavVolumeRow;

  it('owner is admin, others hidden on private, public read', async () => {
    const perm = new DavPermissionService();
    await expect(perm.getRole('owner@x.co', volume)).resolves.toBe('admin');
    await expect(perm.getRole('friend@x.co', volume)).resolves.toBeNull();
    await expect(perm.getRole(null, volume)).resolves.toBeNull();
    const publicVolume: DavVolumeRow = { ...volume, is_private: 0 };
    await expect(perm.getRole(null, publicVolume)).resolves.toBe('read');
    await expect(perm.getRole('friend@x.co', publicVolume)).resolves.toBe('read');
  });
});

describe('DavCredentialUtil username pattern', () => {
  it('generates volume-adjective-animal usernames', () => {
    const username = DavCredentialUtil.generateUsername('Photos');
    expect(username.startsWith('photos-')).toBe(true);
    expect(username).toMatch(/^[a-z0-9-]{1,64}$/);
    expect(username).not.toContain(':');
    const parts = username.split('-');
    expect(parts.length).toBeGreaterThanOrEqual(4);
  });

  it('hashes passwords deterministically', async () => {
    const a = await DavCredentialUtil.hashPassword('secret');
    const b = await DavCredentialUtil.hashPassword('secret');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('VolumeCredentialService per-bucket quota', () => {
  it('enforces MAX_CREDENTIALS_PER_VOLUME', async () => {
    const svc = new VolumeCredentialService(
      { DB: {} as never, MAX_CREDENTIALS_PER_VOLUME: '1' },
      {
        credentialDAO: () =>
          Promise.resolve({
            countByVolume: async () => 1,
          } as never),
      },
    );
    await expect(svc.createCredential('v1', 'photos', 'laptop')).rejects.toThrow(/Maximum 1 credentials/);
  });
});
