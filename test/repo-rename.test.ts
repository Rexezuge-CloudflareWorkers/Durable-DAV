import { describe, expect, it } from 'vitest';
import { OrganizationService } from '@duradav/backend-services/org';
import { cascadeOwnerRepos } from '@duradav/backend-services/repo';
import { UserService } from '@duradav/backend-services/user';

describe('cascadeOwnerRepos', () => {
  it('renames the owner with a single repositories UPDATE and no sidecars', async () => {
    const renamed: Array<{ oldCi: string; next: string; now: number }> = [];
    await cascadeOwnerRepos(
      {
        repositoryDAO: async () =>
          ({
            renameOwner: async (oldCi: string, next: string, now?: number) => {
              renamed.push({ oldCi, next, now: now ?? 0 });
            },
          }) as never,
      },
      { oldOwnerCi: 'alice', newOwner: 'alice-new', now: 42 },
    );
    expect(renamed).toEqual([{ oldCi: 'alice', next: 'alice-new', now: 42 }]);
  });
});

describe('rename services cascade the owner only', () => {
  it('UserService.renameUsername renames the owner without issue sidecars', async () => {
    const renamed: Array<{ oldCi: string; next: string }> = [];
    const svc = new UserService({ DB: {} } as never, {
      userDAO: async () =>
        ({
          getByEmail: async () => ({ email: 'a@x.co', username: 'old' }),
          getByUsernameCi: async () => null,
          setUsername: async () => undefined,
        }) as never,
      namespaceDAO: async () =>
        ({
          isTaken: async () => false,
          claim: async () => undefined,
          release: async () => undefined,
        }) as never,
      organizationDAO: async () => ({ getByUsernameCi: async () => null }) as never,
      repositoryDAO: async () =>
        ({
          listByOwner: async () => [{ id: 'r1', name: 'demo' }],
          renameOwner: async (oldCi: string, next: string) => {
            renamed.push({ oldCi, next });
          },
        }) as never,
    });
    await svc.renameUsername('a@x.co', 'newhandle');
    expect(renamed).toEqual([{ oldCi: 'old', next: 'newhandle' }]);
  });

  it('OrganizationService.rename renames the owner without issue sidecars', async () => {
    const renamed: Array<{ oldCi: string; next: string }> = [];
    const svc = new OrganizationService({ DB: {} } as never, {
      organizationDAO: async () =>
        ({
          getByUsernameCi: async (ci: string) => (ci === 'acme' ? { id: 'o1', username: 'acme', username_ci: 'acme' } : null),
          getById: async () => ({ id: 'o1', username: 'acme-new', username_ci: 'acme-new' }),
          rename: async () => undefined,
        }) as never,
      organizationMemberDAO: async () => ({ get: async () => ({ role: 'owner' }) }) as never,
      namespaceDAO: async () =>
        ({
          isTaken: async () => false,
          release: async () => undefined,
          claim: async () => undefined,
        }) as never,
      userDAO: async () => ({ getByUsernameCi: async () => null }) as never,
      repositoryDAO: async () =>
        ({
          renameOwner: async (oldCi: string, next: string) => {
            renamed.push({ oldCi, next });
          },
        }) as never,
    });
    await svc.rename('acme', 'owner@x.co', 'acme-new');
    expect(renamed).toEqual([{ oldCi: 'acme', next: 'acme-new' }]);
  });
});
