import { describe, expect, it, vi } from 'vitest';
import { TeamService } from '@duradav/backend-services/team';
import { AuditService } from '@duradav/backend-services/audit';
import { AuditEventBuilder, buildRequestEvent, resolveAction } from '@duradav/backend-services/audit';
import { PermissionService } from '@duradav/backend-services/permission';
import { parseCodeownerTeam } from '@duradav/backend-services/collab';

function orgRepo(id = 'r1') {
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
  };
}

describe('resolveAction', () => {
  it('maps team/audit prefixes and push paths', () => {
    expect(resolveAction('POST', '/user/orgs/acme/teams')).toBe('CREATE_ORG');
    expect(resolveAction('GET', '/user/orgs/acme/audit')).toBe('GET /user/orgs/acme/audit');
    expect(resolveAction('POST', '/acme/api/git-receive-pack')).toBe('PUSH');
    expect(resolveAction('GET', '/user/repos')).toBe('GET /user/repos');
  });
});

describe('AuditEventBuilder', () => {
  it('stamps ids and throws on missing fields', () => {
    const event = new AuditEventBuilder()
      .userEmail('Alice@Example.COM')
      .action('PUSH')
      .request('POST', '/acme/api/git-receive-pack')
      .status(200)
      .build();
    expect(event.userEmail).toBe('Alice@Example.COM');
    expect(event.logId).toBeTruthy();
    expect(event.timestamp).toBeGreaterThan(0);
    expect(() => new AuditEventBuilder().action('X').build()).toThrow();
  });

  it('buildRequestEvent infers resource and lowercases unknown', () => {
    const req = new Request('https://git.example.com/user/orgs/acme/teams', { method: 'POST', headers: { 'user-agent': 'vitest' } });
    const event = buildRequestEvent(req, '', 201);
    expect(event.userEmail).toBe('unknown');
    expect(event.resource).toBe('org/acme');
    expect(event.action).toBe('CREATE_ORG');
  });
});

describe('parseCodeownerTeam', () => {
  it('parses org/team tokens and rejects user handles', () => {
    expect(parseCodeownerTeam('@acme/frontend')).toEqual({ org: 'acme', team: 'frontend' });
    expect(parseCodeownerTeam('acme/frontend')).toEqual({ org: 'acme', team: 'frontend' });
    expect(parseCodeownerTeam('@alice')).toBeNull();
    expect(parseCodeownerTeam('a/b/c')).toBeNull();
  });
});

describe('TeamService guards', () => {
  function teamDeps(overrides: Record<string, unknown> = {}) {
    return {
      teamDAO: async () =>
        ({
          getByOrgAndSlug: async () => null,
          countByOrg: async () => 0,
          create: async () => undefined,
          getById: async () => ({
            id: 't1',
            org_id: 'org-1',
            slug: 'frontend',
            slug_ci: 'frontend',
            name: 'frontend',
            description: null,
            created_by: 'a@x.com',
            created_at: 1,
            updated_at: 1,
          }),
        }) as never,
      teamMemberDAO: async () => ({ get: async () => null, listByTeam: async () => [], upsert: async () => undefined }) as never,
      teamGrantDAO: async () => ({ get: async () => null, countByTeam: async () => 0, upsert: async () => undefined }) as never,
      organizationDAO: async () => ({ getByUsernameCi: async () => ({ id: 'org-1', username: 'acme', username_ci: 'acme' }) }) as never,
      organizationMemberDAO: async () =>
        ({
          get: async (_org: string, email: string) =>
            email === 'owner@x.com' ? { role: 'owner' } : email === 'member@x.com' ? { role: 'member' } : null,
        }) as never,
      userDAO: async () => ({ getByUsernameCi: async () => ({ email: 'bob@x.com', username: 'bob' }) }) as never,
      repositoryDAO: async () => ({ getById: async () => null }) as never,
      ...overrides,
    };
  }

  it('rejects non-owner team creation and invalid slugs', async () => {
    const svc = new TeamService({ DB: {} } as never, teamDeps());
    await expect(svc.createTeam('acme', 'member@x.com', { slug: 'frontend' })).rejects.toThrow();
    await expect(svc.createTeam('acme', 'owner@x.com', { slug: 'bad slug!' })).rejects.toThrow();
    const team = await svc.createTeam('acme', 'owner@x.com', { slug: 'frontend' });
    expect(team.slug).toBe('frontend');
  });

  it('enforces the last-admin guard on demote/remove', async () => {
    const svc = new TeamService(
      { DB: {} } as never,
      teamDeps({
        teamDAO: async () =>
          ({
            getByOrgAndSlug: async () => ({
              id: 't1',
              org_id: 'org-1',
              slug: 'frontend',
              slug_ci: 'frontend',
              name: 'frontend',
              description: null,
              created_by: 'a@x.com',
              created_at: 1,
              updated_at: 1,
            }),
          }) as never,
        teamMemberDAO: async () =>
          ({
            get: async (_t: string, email: string) =>
              email === 'solo@x.com' ? { role: 'admin', team_id: 't1', user_email: email, joined_at: 1 } : null,
            countAdmins: async () => 1,
            upsert: async () => undefined,
            remove: async () => undefined,
          }) as never,
      }),
    );
    await expect(svc.setMemberRole('acme', 'frontend', 'owner@x.com', 'solo@x.com', 'member')).rejects.toThrow('last team admin');
    await expect(svc.removeMember('acme', 'frontend', 'owner@x.com', 'solo@x.com')).rejects.toThrow('last team admin');
  });

  it('team admins (non-owners) can manage members but not create teams', async () => {
    const svc = new TeamService(
      { DB: {} } as never,
      teamDeps({
        teamDAO: async () =>
          ({
            getByOrgAndSlug: async () => ({
              id: 't1',
              org_id: 'org-1',
              slug: 'frontend',
              slug_ci: 'frontend',
              name: 'frontend',
              description: null,
              created_by: 'a@x.com',
              created_at: 1,
              updated_at: 1,
            }),
            countByOrg: async () => 0,
            create: async () => undefined,
            getById: async () => ({
              id: 't1',
              org_id: 'org-1',
              slug: 'frontend',
              slug_ci: 'frontend',
              name: 'frontend',
              description: null,
              created_by: 'a@x.com',
              created_at: 1,
              updated_at: 1,
            }),
          }) as never,
        teamMemberDAO: async () =>
          ({
            get: async (_t: string, email: string) =>
              email === 'tadmin@x.com' ? { role: 'admin', team_id: 't1', user_email: email, joined_at: 1 } : null,
            listByTeam: async () => [],
            upsert: vi.fn(async () => undefined),
          }) as never,
      }),
    );
    await expect(svc.createTeam('acme', 'tadmin@x.com', { slug: 'other' })).rejects.toThrow();
    await svc.addMember('acme', 'frontend', 'tadmin@x.com', 'bob', 'member');
  });
});

describe('PermissionService team grants', () => {
  function svcWithTeams() {
    return new PermissionService({ DB: {} } as never, {
      organizationDAO: async () => ({ getById: async () => ({ id: 'org-1', username: 'acme' }) }) as never,
      organizationMemberDAO: async () =>
        ({
          get: async (_o: string, email: string) =>
            email === 'owner@x.com' ? { role: 'owner' } : email === 'member@x.com' ? { role: 'member' } : null,
        }) as never,
      repoCollaboratorDAO: async () => ({ get: async () => null }) as never,
      teamDAO: async () =>
        ({
          getById: async (id: string) =>
            id === 't1' ? { id: 't1', org_id: 'org-1' } : id === 't2' ? { id: 't2', org_id: 'other-org' } : null,
        }) as never,
      teamMemberDAO: async () =>
        ({
          get: async (teamId: string, email: string) => {
            if (teamId === 't1' && email === 'member@x.com') return { role: 'member' };
            if (teamId === 't2' && email === 'member@x.com') return { role: 'member' };
            return null;
          },
        }) as never,
      teamGrantDAO: async () =>
        ({
          listByRepo: async () => [
            { team_id: 't1', repo_id: 'r1', role: 'write' },
            { team_id: 't2', repo_id: 'r1', role: 'admin' },
          ],
        }) as never,
    });
  }

  it('takes max of direct + team grants, scoped to the same org', async () => {
    const svc = svcWithTeams();
    // member@x.com is in t1 (same org, write) and t2 (other org, admin → ignored).
    await expect(svc.getRole('member@x.com', orgRepo() as never)).resolves.toBe('write');
    await expect(svc.getRole('outsider@x.com', orgRepo() as never)).resolves.toBeNull();
    await expect(svc.getRole('owner@x.com', orgRepo() as never)).resolves.toBe('admin');
  });
});

describe('AuditService scoping', () => {
  it('queryByOrg requires ownership and delegates org scoping to the DAO', async () => {
    const queryOrgAudit = vi.fn(async () => ({ logs: [], nextCursor: null }));
    const svc = new AuditService({ DB: {} } as never, {
      auditLogDAO: async () => ({ query: async () => ({ logs: [], nextCursor: null }), queryOrgAudit }) as never,
      organizationDAO: async () =>
        ({ getByUsernameCi: async (ci: string) => (ci === 'acme' ? { id: 'org-1', username: 'acme' } : null) }) as never,
      organizationMemberDAO: async () =>
        ({
          get: async (_o: string, email: string) => (email === 'owner@x.com' ? { role: 'owner' } : { role: 'member' }),
        }) as never,
    });
    await expect(svc.queryByOrg('acme', 'member@x.com', {})).rejects.toThrow();
    await expect(svc.queryByOrg('ghost', 'owner@x.com', {})).rejects.toThrow();
    await svc.queryByOrg('acme', 'owner@x.com', { action: 'PUSH' });
    expect(queryOrgAudit).toHaveBeenCalledWith('org-1', 'acme', { action: 'PUSH' }, 50, undefined);
  });

  it('queryMine pins the caller and record() never throws', async () => {
    const query = vi.fn(async () => ({ logs: [], nextCursor: null }));
    const svc = new AuditService({ DB: {} } as never, {
      auditLogDAO: async () => ({ query, queryOrgAudit: async () => ({ logs: [], nextCursor: null }) }) as never,
      observers: {
        notifyAll: async () => {
          throw new Error('sink down');
        },
      } as never,
    });
    await svc.queryMine('Bob@X.com', { action: 'PUSH' }, 10, 'c');
    expect(query).toHaveBeenCalledWith({ action: 'PUSH', userEmail: 'bob@x.com' }, 10, 'c');
    await expect(
      svc.record({
        logId: 'l',
        timestamp: 1,
        userEmail: 'u',
        action: 'a',
        method: 'GET',
        path: '/p',
        statusCode: 200,
        resource: null,
        detail: null,
        ipAddress: null,
        userAgent: null,
        orgId: null,
        repoId: null,
      }),
    ).resolves.toBeUndefined();
  });
});
