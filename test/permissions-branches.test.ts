import { describe, expect, it } from 'vitest';
import { PermissionService } from '@duradav/backend-services/permission';
import { RepoService } from '@duradav/backend-services/repo';
import { UserService } from '@duradav/backend-services/user';

describe('PermissionService edge branches', () => {
  it('returns null for missing repo and handles org rows without registry', async () => {
    const svc = new PermissionService({ DB: {} } as never, {
      organizationDAO: async () => ({ getByUsernameCi: async () => null, getById: async () => null }) as never,
      organizationMemberDAO: async () => ({ get: async () => null }) as never,
      repoCollaboratorDAO: async () => ({ get: async () => null }) as never,
    });
    await expect(svc.getRole('a@x.co', null)).resolves.toBeNull();
    // owner_type org but org row gone (deleted org): hide existence for
    // everyone (public and private) so deleted-org repos never leak.
    const ghostPub = { id: 'g1', owner: 'ghost', owner_ci: 'ghost', name: 'r', owner_type: 'org', org_id: null, is_private: 0 } as never;
    const ghostPriv = { ...ghostPub, is_private: 1 } as never;
    await expect(svc.getRole('a@x.co', ghostPub)).resolves.toBeNull();
    await expect(svc.getRole('a@x.co', ghostPriv)).resolves.toBeNull();
    // org_id direct path with owner member.
    const withOrg = new PermissionService({ DB: {} } as never, {
      organizationDAO: async () => ({ getById: async () => ({ id: 'o1' }) }) as never,
      organizationMemberDAO: async () => ({ get: async () => ({ role: 'owner' }) }) as never,
      repoCollaboratorDAO: async () => ({ get: async () => null }) as never,
    });
    const orgRepo = { id: 'r1', owner: 'acme', owner_ci: 'acme', name: 'r', owner_type: 'org', org_id: 'o1', is_private: 1 } as never;
    await expect(withOrg.getRole('owner@x.co', orgRepo)).resolves.toBe('admin');
    expect(PermissionService.meets(null, 'read')).toBe(false);
  });

  it('survives missing tables (legacy DB fakes that throw)', async () => {
    const throwing = () => {
      throw new Error('no such table');
    };
    const svc = new PermissionService({ DB: {} } as never, {
      organizationDAO: async () => ({ getByUsernameCi: throwing, getById: throwing }) as never,
      organizationMemberDAO: async () => ({ get: throwing }) as never,
      repoCollaboratorDAO: async () => ({ get: throwing }) as never,
    });
    const pub = { id: 'r1', owner: 'alice', owner_email: 'a@x.co', owner_type: null, org_id: null, is_private: 0 } as never;
    const priv = { ...pub, is_private: 1 } as never;
    await expect(svc.getRole('a@x.co', pub)).resolves.toBe('admin');
    await expect(svc.getRole('b@x.co', pub)).resolves.toBe('read');
    await expect(svc.getRole('b@x.co', priv)).resolves.toBeNull();
  });
});

describe('RepoService visibility branches', () => {
  it('lists owned, org, and collaborated repos and enforces roles', async () => {
    const owned = {
      id: 'r1',
      owner: 'alice',
      owner_email: 'alice@x.co',
      owner_type: 'user',
      owner_user_email: 'alice@x.co',
      org_id: null,
      name: 'one',
      is_private: 0,
      updated_at: 3,
    };
    const orgRepo = {
      id: 'r2',
      owner: 'acme',
      owner_email: 'alice@x.co',
      owner_type: 'org',
      org_id: 'o1',
      name: 'two',
      is_private: 1,
      updated_at: 2,
    };
    const collabRepo = {
      id: 'r3',
      owner: 'bob',
      owner_email: 'bob@x.co',
      owner_type: 'user',
      owner_user_email: 'bob@x.co',
      org_id: null,
      name: 'three',
      is_private: 1,
      updated_at: 1,
    };
    const svc = new RepoService({ DB: {} } as never, {
      repositoryDAO: async () =>
        ({
          listByOwnerEmail: async () => [owned],
          listByOwner: async () => [],
          listByOrgId: async () => [orgRepo],
          getById: async (id: string) => (id === 'r3' ? collabRepo : null),
          getByOwnerAndName: async (o: string, n: string) => {
            if (o === 'alice' && n === 'one') return owned;
            if (o === 'acme' && n === 'two') return orgRepo;
            return null;
          },
        }) as never,
      userDAO: async () => ({ getByEmail: async () => ({ email: 'alice@x.co', username: 'alice' }) }) as never,
      organizationDAO: async () => ({ getById: async () => ({ id: 'o1', username: 'acme' }), getByUsernameCi: async () => null }) as never,
      organizationMemberDAO: async () =>
        ({ listOrgsByUser: async () => [{ org_id: 'o1' }], get: async () => ({ role: 'owner' }) }) as never,
      repoCollaboratorDAO: async () => ({ listByUser: async () => [{ repo_id: 'r3' }], get: async () => ({ role: 'read' }) }) as never,
      namespaceDAO: async () => ({ get: async () => null }) as never,
    });
    const visible = await svc.listVisibleForUser('alice@x.co', 10);
    expect(visible.map((r) => r.id).sort()).toEqual(['r1', 'r2', 'r3']);
    await expect(svc.requireRole('alice', 'one', 'alice@x.co', 'admin')).resolves.toMatchObject({ role: 'admin' });
    await expect(svc.requireRole('alice', 'one', null, 'read')).resolves.toMatchObject({ role: 'read' });
    await expect(svc.requireRole('acme', 'two', 'alice@x.co', 'admin')).resolves.toMatchObject({ role: 'admin' });
    await expect(svc.requireRole('missing', 'nope', 'alice@x.co', 'read')).rejects.toThrow('not found');
    await expect(svc.requireRole('alice', 'one', 'bob@x.co', 'admin')).rejects.toThrow();
  });
});

describe('UserService profile branches', () => {
  it('validates and handles missing users', async () => {
    const store = new Map<string, { email: string; username: string | null }>([['a@x.co', { email: 'a@x.co', username: 'alice' }]]);
    const svc = new UserService({ DB: {} } as never, {
      userDAO: async () =>
        ({
          upsertUser: async () => undefined,
          getByEmail: async (e: string) => store.get(e) ?? null,
          getByUsernameCi: async () => null,
          ensureUsername: async () => undefined,
        }) as never,
      namespaceDAO: async () => ({ isTaken: async () => false, claimIgnore: async () => undefined }) as never,
      organizationDAO: async () => ({ getByUsernameCi: async () => null }) as never,
    });
    expect(() => UserService.validateUsername('bad name!')).toThrow('Invalid');
    await expect(svc.getProfileByEmail('missing@x.co')).rejects.toThrow('not found');
    await expect(svc.getByUsername('alice')).resolves.toBeNull();
    await expect(svc.getProfileByEmail('a@x.co')).resolves.toMatchObject({ email: 'a@x.co', username: 'alice' });
    await svc.upsertUser('new@x.co');
  });
});
