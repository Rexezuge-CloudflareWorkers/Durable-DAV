import { describe, expect, it } from 'vitest';
import { PermissionService } from '@duradav/backend-services/permission';

function repo(overrides: Record<string, unknown> = {}) {
  return {
    id: 'r1',
    owner: 'acme',
    owner_ci: 'acme',
    name: 'api',
    name_ci: 'api',
    owner_type: 'org',
    owner_user_email: null,
    org_id: 'org-1',
    is_private: 1,
    created_at: 100,
    updated_at: 100,
    ...overrides,
  } as never;
}

function service(opts: {
  memberRole?: 'owner' | 'member' | null;
  collabGrant?: 'admin' | 'write' | 'read' | null;
  teamGrants?: Array<'admin' | 'write' | 'read'>;
}) {
  return new PermissionService({ DB: {} } as never, {
    organizationDAO: async () => ({ getByUsernameCi: async () => ({ id: 'org-1' }) }) as never,
    organizationMemberDAO: async () => ({ get: async () => (opts.memberRole ? { role: opts.memberRole } : null) }) as never,
    repoCollaboratorDAO: async () => ({ get: async () => (opts.collabGrant ? { role: opts.collabGrant } : null) }) as never,
    teamDAO: async () => ({ getById: async (id: string) => ({ id, org_id: 'org-1' }) }) as never,
    teamGrantDAO: async () =>
      ({
        listByRepo: async () => (opts.teamGrants ?? []).map((role, i) => ({ team_id: `t${i}`, role })),
      }) as never,
    teamMemberDAO: async () =>
      ({
        // Member of the first team only — team grants for other teams do not apply.
        get: async (teamId: string) => (teamId === 't0' ? { team_id: teamId } : null),
      }) as never,
  });
}

describe('PermissionService matrix edges', () => {
  it('org owner is implicit admin on private org repos', async () => {
    const svc = service({ memberRole: 'owner' });
    await expect(svc.getRole('o@example.com', repo())).resolves.toBe('admin');
  });

  it('org member without grants gets null on private repos (no implicit read)', async () => {
    const svc = service({ memberRole: 'member' });
    await expect(svc.getRole('m@example.com', repo())).resolves.toBeNull();
  });

  it('collaborator grant elevates member to granted level', async () => {
    const svc = service({ memberRole: 'member', collabGrant: 'write' });
    await expect(svc.getRole('m@example.com', repo())).resolves.toBe('write');
  });

  it('team grant applies only via same-org team membership', async () => {
    const svc = service({ memberRole: 'member', teamGrants: ['write'] });
    await expect(svc.getRole('m@example.com', repo())).resolves.toBe('write');
  });

  it('outsider with no grants gets null even as org non-member', async () => {
    const svc = service({ memberRole: null });
    await expect(svc.getRole('x@example.com', repo())).resolves.toBeNull();
  });

  it('anon gets read on public, null on private', async () => {
    const svc = service({ memberRole: null });
    await expect(svc.getRole(null, repo({ is_private: 0, owner_type: 'user' }))).resolves.toBe('read');
    await expect(svc.getRole(null, repo())).resolves.toBeNull();
  });
});
