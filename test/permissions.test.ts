import { describe, expect, it } from 'vitest';
import { PermissionService } from '@duradav/backend-services/permission';
import { OrganizationService } from '@duradav/backend-services/org';
import { UserService } from '@duradav/backend-services/user';
import { RepoService } from '@duradav/backend-services/repo';

function userRepo(id = 'r1', overrides: Record<string, unknown> = {}) {
  return {
    id,
    owner_email: 'alice@example.com',
    owner: 'alice',
    owner_ci: 'alice',
    name_ci: 'demo',
    owner_type: 'user',
    owner_user_email: 'alice@example.com',
    org_id: null,
    name: 'demo',
    description: null,
    is_private: 0,
    created_at: 100,
    updated_at: 100,
    ...overrides,
  };
}

function orgRepo(id = 'r2', overrides: Record<string, unknown> = {}) {
  return {
    id,
    owner_email: 'alice@example.com',
    owner: 'acme',
    owner_ci: 'acme',
    name_ci: 'api',
    owner_type: 'org',
    owner_user_email: null,
    org_id: 'org-1',
    name: 'api',
    description: null,
    is_private: 1,
    created_at: 100,
    updated_at: 100,
    ...overrides,
  };
}

describe('PermissionService roles', () => {
  it('grants admin to user owner, read to anon on public, null on private', async () => {
    const svc = new PermissionService({ DB: {} } as never, {
      organizationDAO: async () => ({ getByUsernameCi: async () => null }) as never,
      organizationMemberDAO: async () => ({ get: async () => null }) as never,
      repoCollaboratorDAO: async () => ({ get: async () => null }) as never,
    });
    const pub = userRepo('r1', { is_private: 0 });
    await expect(svc.getRole('alice@example.com', pub as never)).resolves.toBe('admin');
    await expect(svc.getRole('bob@example.com', pub as never)).resolves.toBe('read');
    await expect(svc.getRole(null, pub as never)).resolves.toBe('read');
    const priv = userRepo('r1', { is_private: 1 });
    await expect(svc.getRole(null, priv as never)).resolves.toBeNull();
    await expect(svc.getRole('bob@example.com', priv as never)).resolves.toBeNull();
  });

  it('gives org owners implicit admin and members only via grant', async () => {
    const svc = new PermissionService({ DB: {} } as never, {
      organizationDAO: async () => ({ getById: async () => ({ id: 'org-1', username: 'acme' }) }) as never,
      organizationMemberDAO: async () =>
        ({
          get: async (orgId: string, email: string) => {
            if (email === 'owner@example.com') return { role: 'owner' };
            if (email === 'member@example.com') return { role: 'member' };
            return null;
          },
        }) as never,
      repoCollaboratorDAO: async () =>
        ({
          get: async (repoId: string, email: string) => {
            if (email === 'member@example.com') return { role: 'write' };
            if (email === 'outsider@example.com') return { role: 'read' };
            return null;
          },
        }) as never,
      teamDAO: async () => ({ getById: async () => null }) as never,
      teamMemberDAO: async () => ({ get: async () => null }) as never,
      teamGrantDAO: async () => ({ listByRepo: async () => [] }) as never,
    });
    const repo = orgRepo();
    await expect(svc.getRole('owner@example.com', repo as never)).resolves.toBe('admin');
    await expect(svc.getRole('member@example.com', repo as never)).resolves.toBe('write');
    await expect(svc.getRole('outsider@example.com', repo as never)).resolves.toBe('read');
    await expect(svc.getRole('stranger@example.com', repo as never)).resolves.toBeNull();
    expect(PermissionService.meets('read', 'write')).toBe(false);
    expect(PermissionService.meets('admin', 'write')).toBe(true);
  });
});

describe('OrganizationService namespace and members', () => {
  it('rejects org create when username taken by a user', async () => {
    const svc = new OrganizationService({ DB: {} } as never, {
      namespaceDAO: async () => ({ isTaken: async () => true }) as never,
      organizationDAO: async () => ({ getByUsernameCi: async () => null }) as never,
      userDAO: async () => ({ getByUsernameCi: async () => null }) as never,
    });
    await expect(svc.createOrganization('a@x.co', 'alice')).rejects.toThrow('taken');
  });

  it('prevents demoting or removing the last owner', async () => {
    const svc = new OrganizationService({ DB: {} } as never, {
      organizationDAO: async () => ({ getByUsernameCi: async () => ({ id: 'o1', username: 'acme', username_ci: 'acme' }) }) as never,
      organizationMemberDAO: async () =>
        ({
          get: async () => ({ role: 'owner' }),
          countOwners: async () => 1,
          upsert: async () => undefined,
          remove: async () => undefined,
        }) as never,
      userDAO: async () => ({ getByUsernameCi: async () => ({ email: 'a@x.co' }) }) as never,
    });
    await expect(svc.setMemberRole('acme', 'a@x.co', 'a@x.co', 'member')).rejects.toThrow('last owner');
    await expect(svc.removeMember('acme', 'a@x.co', 'a@x.co')).rejects.toThrow('last owner');
  });

  it('requires owner for member management', async () => {
    const svc = new OrganizationService({ DB: {} } as never, {
      organizationDAO: async () => ({ getByUsernameCi: async () => ({ id: 'o1', username: 'acme', username_ci: 'acme' }) }) as never,
      organizationMemberDAO: async () => ({ get: async () => ({ role: 'member' }) }) as never,
      userDAO: async () => ({ getByUsernameCi: async () => null }) as never,
    });
    await expect(svc.addMember('acme', 'member@x.co', 'new@x.co', 'member')).rejects.toThrow();
  });
});

describe('UserService usernames', () => {
  it('derives a handle on upsert and renames with cascade', async () => {
    const users = new Map<string, { email: string; username: string | null }>([
      ['alice@example.com', { email: 'alice@example.com', username: null }],
    ]);
    const namespaces = new Set<string>();
    const renamedOwners: Array<{ oldCi: string; next: string }> = [];
    const svc = new UserService({ DB: {} } as never, {
      userDAO: async () =>
        ({
          upsertUser: async () => undefined,
          getByEmail: async (email: string) => users.get(email) ?? null,
          getByUsernameCi: async (ci: string) => [...users.values()].find((u) => u.username?.toLowerCase() === ci) ?? null,
          ensureUsername: async (email: string, handle: string) => {
            users.get(email)!.username = handle;
          },
          setUsername: async (email: string, handle: string) => {
            users.get(email)!.username = handle;
          },
        }) as never,
      namespaceDAO: async () =>
        ({
          get: async (ci: string) => (namespaces.has(ci) ? { username_ci: ci, user_email: 'alice@example.com' } : null),
          isTaken: async (ci: string) => namespaces.has(ci),
          claimIgnore: async (input: { usernameCi: string }) => {
            namespaces.add(input.usernameCi);
          },
          claim: async (input: { usernameCi: string }) => {
            if (namespaces.has(input.usernameCi)) throw new Error('taken');
            namespaces.add(input.usernameCi);
          },
          release: async (ci: string) => {
            namespaces.delete(ci);
          },
        }) as never,
      organizationDAO: async () => ({ getByUsernameCi: async () => null }) as never,
      repositoryDAO: async () =>
        ({
          renameOwner: async (oldCi: string, next: string) => {
            renamedOwners.push({ oldCi, next });
          },
        }) as never,
    });
    await svc.upsertUser('Alice@Example.com'.toLowerCase());
    expect(users.get('alice@example.com')?.username).toBe('alice');
    const renamed = await svc.renameUsername('alice@example.com', 'alice-new');
    expect(renamed.username).toBe('alice-new');
    expect(renamedOwners).toEqual([{ oldCi: 'alice', next: 'alice-new' }]);
    // Hardening: old handles stay reserved to block hijack (breaking).
    expect(namespaces.has('alice')).toBe(true);
    expect(namespaces.has('alice-new')).toBe(true);
    await expect(svc.renameUsername('alice@example.com', 'bad name!')).rejects.toThrow('Invalid');
  });

  it('rejects rename when the namespace is taken', async () => {
    const svc = new UserService({ DB: {} } as never, {
      userDAO: async () =>
        ({
          getByEmail: async () => ({ email: 'a@x.co', username: 'old' }),
          getByUsernameCi: async () => null,
        }) as never,
      namespaceDAO: async () => ({ isTaken: async () => true }) as never,
      organizationDAO: async () => ({ getByUsernameCi: async () => null }) as never,
    });
    await expect(svc.renameUsername('a@x.co', 'taken')).rejects.toThrow('taken');
  });
});

describe('RepoService org creation', () => {
  it('allows owners and members to create org repos, forbids outsiders', async () => {
    const created: Array<Record<string, unknown>> = [];
    const svc = new RepoService({ DB: {} } as never, {
      repositoryDAO: async () =>
        ({
          getByOwnerAndName: async () => null,
          listByOwnerEmail: async () => [],
          create: async (input: Record<string, unknown>) => {
            created.push(input);
          },
        }) as never,
      userDAO: async () =>
        ({
          getByEmail: async (email: string) => ({ email, username: email.split('@', 1)[0] }),
        }) as never,
      organizationDAO: async () =>
        ({
          getByUsernameCi: async (ci: string) => (ci === 'acme' ? { id: 'org-1', username: 'acme' } : null),
        }) as never,
      organizationMemberDAO: async () =>
        ({
          get: async (_org: string, email: string) => {
            if (email === 'owner@x.co') return { role: 'owner' };
            if (email === 'member@x.co') return { role: 'member' };
            return null;
          },
          listOrgsByUser: async () => [],
        }) as never,
      repoCollaboratorDAO: async () =>
        ({
          get: async () => null,
          listByUser: async () => [],
        }) as never,
      namespaceDAO: async () => ({ get: async () => null }) as never,
    });
    await svc.createRepo('owner@x.co', 'acme', 'api', null, false);
    await svc.createRepo('member@x.co', 'acme', 'web', null, true);
    expect(created).toHaveLength(2);
    expect(created[0]).toMatchObject({ ownerType: 'org', orgId: 'org-1' });
    await expect(svc.createRepo('stranger@x.co', 'acme', 'evil', null, false)).rejects.toThrow();
  });
});

describe('OrganizationService happy paths', () => {
  function orgHarness() {
    const orgs = new Map<string, { id: string; username: string; username_ci: string }>();
    const members = new Map<string, Map<string, string>>();
    const namespaces = new Set<string>(['alice']);
    return {
      orgs,
      members,
      namespaces,
      service: new OrganizationService({ DB: {} } as never, {
        namespaceDAO: async () =>
          ({
            isTaken: async (ci: string) => namespaces.has(ci),
            claim: async (input: { usernameCi: string }) => {
              namespaces.add(input.usernameCi);
            },
            release: async (ci: string) => {
              namespaces.delete(ci);
            },
          }) as never,
        organizationDAO: async () =>
          ({
            create: async (input: { id: string; username: string }) => {
              orgs.set(input.id, { id: input.id, username: input.username, username_ci: input.username.toLowerCase() });
            },
            getById: async (id: string) => orgs.get(id) ?? null,
            getByUsernameCi: async (ci: string) => [...orgs.values()].find((o) => o.username_ci === ci) ?? null,
            rename: async (id: string, username: string) => {
              const o = orgs.get(id)!;
              o.username = username;
              o.username_ci = username.toLowerCase();
            },
            deleteById: async (id: string) => {
              orgs.delete(id);
            },
          }) as never,
        organizationMemberDAO: async () =>
          ({
            upsert: async (orgId: string, email: string, role: string) => {
              if (!members.has(orgId)) members.set(orgId, new Map());
              members.get(orgId)!.set(email, role);
            },
            get: async (orgId: string, email: string) => {
              const role = members.get(orgId)?.get(email);
              return role ? { role } : null;
            },
            listByOrg: async (orgId: string) =>
              [...(members.get(orgId)?.entries() ?? [])].map(([user_email, role]) => ({ org_id: orgId, user_email, role })),
            listOrgsByUser: async (email: string) =>
              [...members]
                .filter(([, m]) => m.has(email))
                .map(([org_id]) => ({ org_id, user_email: email, role: members.get(org_id)!.get(email)! })),
            countOwners: async (orgId: string) => [...(members.get(orgId)?.values() ?? [])].filter((r) => r === 'owner').length,
            remove: async (orgId: string, email: string) => {
              members.get(orgId)?.delete(email);
            },
            deleteByOrg: async (orgId: string) => {
              members.delete(orgId);
            },
          }) as never,
        userDAO: async () =>
          ({
            getByUsernameCi: async (ci: string) => (ci === 'alice' ? { email: 'alice@x.co', username: 'alice' } : null),
            getByEmail: async (email: string) => ({ email, username: email.split('@', 1)[0] }),
          }) as never,
        repositoryDAO: async () =>
          ({
            renameOwner: async () => undefined,
            listByOrgId: async () => [],
            listByOwner: async () => [],
          }) as never,
      }),
    };
  }

  it('creates, lists, renames, manages members, and disbands', async () => {
    const h = orgHarness();
    const created = await h.service.createOrganization('alice@x.co', 'acme');
    expect(created.username).toBe('acme');
    await expect(h.service.createOrganization('b@x.co', 'alice')).rejects.toThrow('taken');
    await expect(h.service.createOrganization('b@x.co', 'bad name!')).rejects.toThrow('Invalid');
    const orgs = await h.service.listOrgsForUser('alice@x.co');
    expect(orgs).toHaveLength(1);
    await h.service.addMember('acme', 'alice@x.co', 'bob@x.co', 'member');
    await h.service.setMemberRole('acme', 'alice@x.co', 'bob@x.co', 'owner');
    const listed = await h.service.listMembers('acme', 'alice@x.co');
    expect(listed).toHaveLength(2);
    const renamed = await h.service.rename('acme', 'alice@x.co', 'acme-new');
    expect(renamed.username).toBe('acme-new');
    expect(await h.service.resolveEmail('alice')).toBe('alice@x.co');
    expect(await h.service.resolveEmail('Bob@X.Co')).toBe('bob@x.co');
    await h.service.removeMember('acme-new', 'alice@x.co', 'bob@x.co');
    await h.service.disband('acme-new', 'alice@x.co');
    await expect(h.service.getByUsername('acme-new')).resolves.toBeNull();
  });

  it('blocks disband while repos exist', async () => {
    const h = orgHarness();
    await h.service.createOrganization('alice@x.co', 'acme');
    const withRepos = new OrganizationService({ DB: {} } as never, {
      organizationDAO: async () => ({ getByUsernameCi: async () => ({ id: 'o1', username: 'acme', username_ci: 'acme' }) }) as never,
      organizationMemberDAO: async () => ({ get: async () => ({ role: 'owner' }), deleteByOrg: async () => undefined }) as never,
      namespaceDAO: async () => ({ release: async () => undefined }) as never,
      userDAO: async () => ({ getByUsernameCi: async () => null }) as never,
      repositoryDAO: async () => ({ listByOrgId: async () => [{ id: 'r1' }], listByOwner: async () => [] }) as never,
    });
    await expect(withRepos.disband('acme', 'alice@x.co')).rejects.toThrow('repositories');
  });
});
