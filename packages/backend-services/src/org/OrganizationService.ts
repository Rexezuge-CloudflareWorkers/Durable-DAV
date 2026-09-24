import {
  EventDAO,
  IssueDAO,
  NamespaceDAO,
  NotificationDAO,
  OrganizationDAO,
  OrganizationMemberDAO,
  PullRequestDAO,
  RepositoryDAO,
  UserDAO,
  WebhookDAO,
} from '@duradav/backend-data/dao';
import type { OrganizationRow, OrgMemberRole } from '@duradav/backend-data/dao';
import type { D1Queryable } from '@duradav/backend-data/utils';
import { BadRequestError, ForbiddenError, NotFoundError } from '@duradav/backend-errors';
import { isReservedNamespaceName } from '@duradav/shared/constants';
import { SLUG_RE, TimestampUtil, UUIDUtil } from '@duradav/shared/utils';
import { cascadeOwnerRepos } from '../repo/repoRenameCascade';
import { GHOST_USERNAME } from '../identity/IdentityResolver';
import { assertNotLastOrgOwner } from '../policy/MembershipPolicy';

interface OrganizationServiceEnv {
  DB: D1Queryable;
}

interface OrganizationServiceDeps {
  organizationDAO?: () => Promise<OrganizationDAO>;
  organizationMemberDAO?: () => Promise<OrganizationMemberDAO>;
  namespaceDAO?: () => Promise<NamespaceDAO>;
  userDAO?: () => Promise<UserDAO>;
  repositoryDAO?: () => Promise<RepositoryDAO>;
  issueDAO?: () => Promise<IssueDAO>;
  pullRequestDAO?: () => Promise<PullRequestDAO>;
  eventDAO?: () => Promise<EventDAO>;
  notificationDAO?: () => Promise<NotificationDAO>;
  webhookDAO?: () => Promise<WebhookDAO>;
}

// Canonical slug rule: import `SLUG_RE` from `@duradav/shared/utils` (Layer 0).

class OrganizationService {
  private readonly deps: Required<OrganizationServiceDeps>;

  constructor(
    private readonly env: OrganizationServiceEnv,
    deps: OrganizationServiceDeps = {},
  ) {
    this.deps = {
      organizationDAO: () => Promise.resolve(new OrganizationDAO(env.DB)),
      organizationMemberDAO: () => Promise.resolve(new OrganizationMemberDAO(env.DB)),
      namespaceDAO: () => Promise.resolve(new NamespaceDAO(env.DB)),
      userDAO: () => Promise.resolve(new UserDAO(env.DB)),
      repositoryDAO: () => Promise.resolve(new RepositoryDAO(env.DB)),
      issueDAO: () => Promise.resolve(new IssueDAO(env.DB)),
      pullRequestDAO: () => Promise.resolve(new PullRequestDAO(env.DB)),
      eventDAO: () => Promise.resolve(new EventDAO(env.DB)),
      notificationDAO: () => Promise.resolve(new NotificationDAO(env.DB)),
      webhookDAO: () =>
        Promise.reject<WebhookDAO>(new Error('OrganizationService requires an injected webhookDAO outside request scope.')),
      ...deps,
    };
  }

  public static validateOrgName(username: string): void {
    if (!SLUG_RE.test(username)) {
      throw new BadRequestError('Invalid organization name');
    }
    if (isReservedNamespaceName(username)) {
      throw new BadRequestError('Username is reserved');
    }
  }

  public async getByUsername(username: string): Promise<OrganizationRow | null> {
    const dao = await this.deps.organizationDAO();
    return dao.getByUsernameCi(username.toLowerCase());
  }

  public async requireOrg(username: string): Promise<OrganizationRow> {
    const org = await this.getByUsername(username);
    if (!org) throw new NotFoundError('Organization not found');
    return org;
  }

  public async getMemberRole(orgId: string, userEmail: string): Promise<OrgMemberRole | null> {
    const dao = await this.deps.organizationMemberDAO();
    const row = await dao.get(orgId, userEmail.toLowerCase());
    return row?.role ?? null;
  }

  public async requireOwner(orgUsername: string, userEmail: string): Promise<OrganizationRow> {
    const org = await this.requireOrg(orgUsername);
    const role = await this.getMemberRole(org.id, userEmail.toLowerCase());
    if (role !== 'owner') throw new ForbiddenError('Only organization owners can perform this action');
    return org;
  }

  public async requireMember(orgUsername: string, userEmail: string): Promise<OrganizationRow> {
    const org = await this.requireOrg(orgUsername);
    const role = await this.getMemberRole(org.id, userEmail.toLowerCase());
    if (!role) throw new ForbiddenError('Only organization members can perform this action');
    return org;
  }

  public async createOrganization(creatorEmail: string, username: string): Promise<OrganizationRow> {
    const handle = username.trim();
    OrganizationService.validateOrgName(handle);
    const handleCi = handle.toLowerCase();
    const normalizedCreator = creatorEmail.toLowerCase();
    const namespaceDAO = await this.deps.namespaceDAO();
    const orgDAO = await this.deps.organizationDAO();
    const memberDAO = await this.deps.organizationMemberDAO();
    const userDAO = await this.deps.userDAO();

    // Global namespace: must be free in namespaces registry, users, and orgs.
    let taken = false;
    try {
      taken = await namespaceDAO.isTaken(handleCi);
    } catch {
      taken = false;
    }
    if (!taken) {
      try {
        const [userMatch, orgMatch] = await Promise.all([userDAO.getByUsernameCi(handleCi), orgDAO.getByUsernameCi(handleCi)]);
        taken = Boolean(userMatch ?? orgMatch);
      } catch {
        // legacy DB without username columns — registry check above is authoritative
      }
    }
    if (taken) throw new BadRequestError('Username is already taken');

    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    const id = UUIDUtil.getRandomUUID();
    await orgDAO.create({ id, username: handle, creatorEmail: normalizedCreator, now });
    try {
      await namespaceDAO.claim({ usernameCi: handleCi, kind: 'org', orgId: id, now });
    } catch {
      // Best-effort: org row is source of truth if namespaces table is unavailable.
    }
    await memberDAO.upsert(id, normalizedCreator, 'owner', now);
    const created = await orgDAO.getById(id);
    if (!created) throw new NotFoundError('Organization not found');
    return created;
  }

  public async resolveEmail(usernameOrEmail: string): Promise<string> {
    const raw = usernameOrEmail.trim();
    if (raw.includes('@')) return raw.toLowerCase();
    const userDAO = await this.deps.userDAO();
    const user = await userDAO.getByUsernameCi(raw.toLowerCase());
    if (!user) throw new NotFoundError('User not found');
    return user.email.toLowerCase();
  }

  public async addMember(
    orgUsername: string,
    actorEmail: string,
    targetUsernameOrEmail: string,
    role: OrgMemberRole = 'member',
  ): Promise<void> {
    const org = await this.requireOwner(orgUsername, actorEmail);
    if (role !== 'owner' && role !== 'member') throw new BadRequestError('Invalid role');
    const targetEmail = await this.resolveEmail(targetUsernameOrEmail);
    const memberDAO = await this.deps.organizationMemberDAO();
    await memberDAO.upsert(org.id, targetEmail, role, TimestampUtil.getCurrentUnixTimestampInSeconds());
  }

  public async setMemberRole(orgUsername: string, actorEmail: string, targetUsernameOrEmail: string, role: OrgMemberRole): Promise<void> {
    const org = await this.requireOwner(orgUsername, actorEmail);
    if (role !== 'owner' && role !== 'member') throw new BadRequestError('Invalid role');
    const targetEmail = await this.resolveEmail(targetUsernameOrEmail);
    const memberDAO = await this.deps.organizationMemberDAO();
    const existing = await memberDAO.get(org.id, targetEmail);
    if (!existing) throw new NotFoundError('Member not found');
    if (role !== 'owner' && existing.role === 'owner') {
      const owners = await memberDAO.countOwners(org.id);
      assertNotLastOrgOwner(existing.role, owners, 'demote');
    }
    await memberDAO.upsert(org.id, targetEmail, role, TimestampUtil.getCurrentUnixTimestampInSeconds());
  }

  public async removeMember(orgUsername: string, actorEmail: string, targetUsernameOrEmail: string): Promise<void> {
    const org = await this.requireOwner(orgUsername, actorEmail);
    const targetEmail = await this.resolveEmail(targetUsernameOrEmail);
    const memberDAO = await this.deps.organizationMemberDAO();
    const existing = await memberDAO.get(org.id, targetEmail);
    if (!existing) throw new NotFoundError('Member not found');
    if (existing.role === 'owner') {
      const owners = await memberDAO.countOwners(org.id);
      assertNotLastOrgOwner(existing.role, owners, 'remove');
    }
    await memberDAO.remove(org.id, targetEmail);
  }

  public async listMembers(orgUsername: string, requesterEmail: string): Promise<Array<{ username: string; role: OrgMemberRole }>> {
    const org = await this.requireMember(orgUsername, requesterEmail);
    const memberDAO = await this.deps.organizationMemberDAO();
    const userDAO = await this.deps.userDAO();
    const rows = await memberDAO.listByOrg(org.id);
    const out: Array<{ username: string; role: OrgMemberRole }> = [];
    for (const row of rows) {
      let username: string = GHOST_USERNAME;
      try {
        const user = await userDAO.getByEmail(row.user_email);
        username = user?.username ?? GHOST_USERNAME;
      } catch {
        username = GHOST_USERNAME;
      }
      out.push({ username, role: row.role });
    }
    return out;
  }

  public async listOrgsForUser(userEmail: string): Promise<OrganizationRow[]> {
    const memberDAO = await this.deps.organizationMemberDAO();
    const orgDAO = await this.deps.organizationDAO();
    const memberships = await memberDAO.listOrgsByUser(userEmail.toLowerCase());
    const orgs: OrganizationRow[] = [];
    for (const m of memberships) {
      const org = await orgDAO.getById(m.org_id);
      if (org) orgs.push(org);
    }
    return orgs;
  }

  public async rename(orgUsername: string, actorEmail: string, newUsername: string): Promise<OrganizationRow> {
    const org = await this.requireOwner(orgUsername, actorEmail);
    const handle = newUsername.trim();
    OrganizationService.validateOrgName(handle);
    const handleCi = handle.toLowerCase();
    if (handleCi === org.username_ci) return org;
    const namespaceDAO = await this.deps.namespaceDAO();
    const orgDAO = await this.deps.organizationDAO();
    const userDAO = await this.deps.userDAO();
    let taken = false;
    try {
      taken = await namespaceDAO.isTaken(handleCi);
    } catch {
      taken = false;
    }
    if (!taken) {
      try {
        const [userMatch, orgMatch] = await Promise.all([userDAO.getByUsernameCi(handleCi), orgDAO.getByUsernameCi(handleCi)]);
        taken = Boolean(userMatch ?? orgMatch);
      } catch {
        // ignore
      }
    }
    if (taken) throw new BadRequestError('Username is already taken');
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    await orgDAO.rename(org.id, handle, now);
    try {
      await namespaceDAO.release(org.username_ci);
    } catch {
      // ignore
    }
    try {
      await namespaceDAO.claim({ usernameCi: handleCi, kind: 'org', orgId: org.id, now });
    } catch {
      // ignore
    }
    // Simple rename: cascade owner on org repos. Display names are computed
    // from `repositories`, so no sidecar updates are needed. Legacy
    // owner-named rows without `org_id` are covered by the owner rename;
    // `org_id`-keyed rows are refreshed by the same UPDATE.
    try {
      await cascadeOwnerRepos({ repositoryDAO: this.deps.repositoryDAO }, { oldOwnerCi: org.username_ci, newOwner: handle, now });
    } catch {
      // ignore — repos remain addressable by id
    }
    const updated = await orgDAO.getById(org.id);
    if (!updated) throw new NotFoundError('Organization not found');
    return updated;
  }

  public async disband(orgUsername: string, actorEmail: string): Promise<void> {
    const org = await this.requireOwner(orgUsername, actorEmail);
    const repoDAO = await this.deps.repositoryDAO();
    const repos = await repoDAO.listByOrgId(org.id, 1).catch(() => []);
    // Also check legacy owner-named repos when org_id was never backfilled.
    let legacyCount = 0;
    try {
      const legacy = await repoDAO.listByOwner(org.username, 1);
      legacyCount = legacy.length;
    } catch {
      legacyCount = 0;
    }
    if (repos.length > 0 || legacyCount > 0) {
      throw new BadRequestError('Delete or transfer repositories before deleting the organization');
    }
    const memberDAO = await this.deps.organizationMemberDAO();
    const namespaceDAO = await this.deps.namespaceDAO();
    await memberDAO.deleteByOrg(org.id);
    const orgDAO = await this.deps.organizationDAO();
    await orgDAO.deleteById(org.id);
    try {
      await namespaceDAO.release(org.username_ci);
    } catch {
      // ignore
    }
  }
}

export { OrganizationService };
export type { OrganizationServiceDeps, OrganizationServiceEnv };
