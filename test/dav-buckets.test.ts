import { describe, expect, it } from 'vitest';
import { DavPermissionService, VolumeService, checkVolumeQuota } from '@durable-dav/backend-services/dav';
import { TokenService } from '@durable-dav/backend-services/auth';
import { coversScope } from '@durable-dav/backend-services/auth';

function fakeVolumeDb(opts: { ownedCount?: number; username?: string | null; existing?: unknown } = {}) {
  const calls = { volumeGrantsDeleted: 0, collaboratorsDeleted: 0 };
  const volumeDAO = {
    getByOwnerName: async () => (opts.existing as never) ?? null,
    getById: async () => (opts.existing as never) ?? null,
    listByOwnerEmail: async () => Array.from({ length: opts.ownedCount ?? 0 }, (_, i) => ({ id: `v${i}` })),
    create: async () => undefined,
    deleteById: async () => undefined,
  };
  const userDAO = {
    getByEmail: async () =>
      opts.username === undefined ? { email: 'a@x.co', username: 'alice' } : opts.username ? { email: 'a@x.co', username: opts.username } : null,
  };
  return {
    calls,
    deps: {
      volumeDAO: () => Promise.resolve(volumeDAO as never),
      userDAO: () => Promise.resolve(userDAO as never),
      davCollaboratorDAO: () =>
        Promise.resolve({
          deleteByVolume: async () => {
            calls.collaboratorsDeleted += 1;
          },
        } as never),
      tokenVolumeGrantDAO: () =>
        Promise.resolve({
          deleteByToken: async () => undefined,
          deleteByVolume: async () => {
            calls.volumeGrantsDeleted += 1;
          },
          listByToken: async () => [],
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
    await expect(
      svc.createVolume({ owner: 'alice', name: 'b1', creatorEmail: 'a@x.co' }),
    ).rejects.toThrow(/Maximum 2 volumes/);
  });

  it('rejects owner mismatch (no org volumes)', async () => {
    const { deps } = fakeVolumeDb({ ownedCount: 0, username: 'alice' });
    const svc = new VolumeService({ DB: {} as never }, deps);
    await expect(svc.createVolume({ owner: 'bob', name: 'b1', creatorEmail: 'a@x.co' })).rejects.toThrow(/owner/);
  });

  it('creates user buckets and cleans per-bucket grants on delete', async () => {
    const created = {
      id: 'vol-1',
      owner_email: 'a@x.co',
      owner: 'alice',
      name: 'photos',
      is_private: 0,
    };
    const { deps, calls } = fakeVolumeDb({ ownedCount: 0, username: 'alice', existing: null });
    const svc = new VolumeService({ DB: {} as never }, {
      ...deps,
      volumeDAO: () =>
        Promise.resolve({
          getByOwnerName: async (owner: string, name: string) =>
            owner === 'alice' && name === 'photos' ? null : null,
          getById: async () => created as never,
          listByOwnerEmail: async () => [],
          create: async () => undefined,
          deleteById: async () => undefined,
        } as never),
    });
    const row = await svc.createVolume({ owner: 'alice', name: 'photos', creatorEmail: 'A@X.co' });
    expect(row.owner_email).toBe('a@x.co');

    const deleter = new VolumeService({ DB: {} as never }, {
      ...deps,
      volumeDAO: () =>
        Promise.resolve({
          getByOwnerName: async () => created as never,
          getById: async () => created as never,
          listByOwnerEmail: async () => [],
          create: async () => undefined,
          deleteById: async () => undefined,
        } as never),
    });
    await deleter.deleteVolume('alice', 'photos');
    expect(calls.volumeGrantsDeleted).toBe(1);
    expect(calls.collaboratorsDeleted).toBe(1);
  });
});

describe('DavPermissionService user-only', () => {
  const volume = { id: 'v1', owner_email: 'owner@x.co', is_private: 0 } as never;

  it('owner is admin, collaborator role wins, public read, private hidden', async () => {
    const svc = new VolumeService({ DB: {} as never });
    void svc;
    const perm = new DavPermissionService({ DB: {} as never }, {
      davCollaboratorDAO: () => Promise.resolve({ get: async () => ({ role: 'write' }) } as never),
    });
    await expect(perm.getRole('owner@x.co', volume)).resolves.toBe('admin');
    await expect(perm.getRole('friend@x.co', volume)).resolves.toBe('write');

    const anonPublic = new DavPermissionService({ DB: {} as never }, {
      davCollaboratorDAO: () => Promise.resolve({ get: async () => null } as never),
    });
    await expect(anonPublic.getRole(null, volume)).resolves.toBe('read');
    await expect(anonPublic.getRole(null, { ...volume, is_private: 1 } as never)).resolves.toBeNull();
  });
});

describe('TokenService per-bucket grants', () => {
  it('coversVolumeGrant: empty grants mean full access', () => {
    expect(TokenService.coversVolumeGrant([], 'v1', 'dav:read')).toBe(true);
    expect(TokenService.coversVolumeGrant([{ volumeId: 'v1', scope: 'dav:read' }], 'v1', 'dav:read')).toBe(true);
    expect(TokenService.coversVolumeGrant([{ volumeId: 'v1', scope: 'dav:read' }], 'v1', 'dav:write')).toBe(false);
    expect(TokenService.coversVolumeGrant([{ volumeId: 'v2', scope: 'dav:write' }], 'v1', 'dav:read')).toBe(false);
    expect(TokenService.coversVolumeGrant([{ volumeId: 'v1', scope: 'dav:write' }], 'v1', 'dav:read')).toBe(true);
  });

  it('mints volume-scoped tokens and enforces grant caps', async () => {
    const db = {} as never;
    const svc = new TokenService(
      { DB: db, MAX_TOKEN_VOLUME_GRANTS: '1' },
      {
        tokenDAO: () => Promise.resolve({ getByUserEmail: async () => [], create: async () => undefined } as never),
        volumeDAO: () => Promise.resolve({ getByOwnerName: async () => ({ id: 'v1' }) } as never),
        tokenVolumeGrantDAO: () => Promise.resolve({ setGrants: async () => undefined } as never),
      },
    );
    await expect(
      svc.createToken('a@x.co', 't', 30, ['dav:read'], [
        { owner: 'alice', name: 'b1', scope: 'dav:read' },
        { owner: 'alice', name: 'b2', scope: 'dav:read' },
      ]),
    ).rejects.toThrow(/At most 1 volume grants/);
  });

  it('dav scopes cover legacy repo aliases', () => {
    expect(coversScope(['dav:write'], 'repo:read')).toBe(true);
    expect(coversScope(['repo:write'], 'dav:read')).toBe(true);
  });
});
