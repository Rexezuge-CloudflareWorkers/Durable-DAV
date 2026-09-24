import {
  OrganizationDAO,
  OrganizationMemberDAO,
  RepoCollaboratorDAO,
  RepositoryDAO,
  TeamDAO,
  TeamMemberDAO,
  TeamRepoGrantDAO,
  UserDAO,
} from '@duradav/backend-data/dao';
import type { OrganizationRow, RepoRole, TeamMemberRole, TeamRow } from '@duradav/backend-data/dao';
import type { D1Queryable } from '@duradav/backend-data/utils';
import { BadRequestError, ForbiddenError, NotFoundError } from '@duradav/backend-errors';
import { AppConfiguration } from '@duradav/backend-runtime/config';
import { EmailAddress, SLUG_RE, TimestampUtil, UUIDUtil } from '@duradav/shared/utils';
import { GHOST_USERNAME } from '../identity/IdentityResolver';
import { assertNotLastTeamAdmin } from '../policy/MembershipPolicy';
import { assertQuotaWithinLimit } from '../policy/QuotaPolicy';

interface TeamServiceEnv {
  DB: D1Queryable;
  MAX_TEAMS_PER_ORG?: string;
  MAX_TEAM_MEMBERS?: string;
  MAX_TEAM_GRANTS?: string;
}

interface TeamServiceDeps {
  teamDAO?: () => Promise<TeamDAO>;
  teamMemberDAO?: () => Promise<TeamMemberDAO>;
  teamGrantDAO?: () => Promise<TeamRepoGrantDAO>;
  organizationDAO?: () => Promise<OrganizationDAO>;
  organizationMemberDAO?: () => Promise<OrganizationMemberDAO>;
  userDAO?: () => Promise<UserDAO>;
  repositoryDAO?: () => Promise<RepositoryDAO>;
  repoCollaboratorDAO?: () => Promise<RepoCollaboratorDAO>;
  config?: AppConfiguration;
}

// Canonical slug rule: import `SLUG_RE` from `@duradav/shared/utils` (Layer 0).

class TeamService {
  private readonly deps: Required<TeamServiceDeps>;

  constructor(
    private readonly env: TeamServiceEnv,
    deps: TeamServiceDeps = {},
  ) {
    this.deps = {
      teamDAO: () => Promise.resolve(new TeamDAO(env.DB)),
      teamMemberDAO: () => Promise.resolve(new TeamMemberDAO(env.DB)),
      teamGrantDAO: () => Promise.resolve(new TeamRepoGrantDAO(env.DB)),
      organizationDAO: () => Promise.resolve(new OrganizationDAO(env.DB)),
      organizationMemberDAO: () => Promise.resolve(new OrganizationMemberDAO(env.DB)),
      userDAO: () => Promise.resolve(new UserDAO(env.DB)),
      repositoryDAO: () => Promise.resolve(new RepositoryDAO(env.DB)),
      repoCollaboratorDAO: () => Promise.resolve(new RepoCollaboratorDAO(env.DB)),
      config: AppConfiguration.fromEnv(env),
      ...deps,
    };
  }

  public static validateTeamSlug(slug: string): void {
    if (!SLUG_RE.test(slug)) {
      throw new BadRequestError('Invalid team name');
    }
  }

  private async requireOrg(username: string): Promise<OrganizationRow> {
    const dao = await this.deps.organizationDAO();
    const org = await dao.getByUsernameCi(EmailAddress.normalize(username));
    if (!org) throw new NotFoundError('Organization not found');
    return org;
  }

  private async orgRole(orgId: string, userEmail: string): Promise<'owner' | 'member' | null> {
    const dao = await this.deps.organizationMemberDAO();
    const row = await dao.get(orgId, EmailAddress.normalize(userEmail));
    return row?.role ?? null;
  }

  private async requireOrgMember(org: OrganizationRow, userEmail: string): Promise<'owner' | 'member'> {
    const role = await this.orgRole(org.id, userEmail);
    if (!role) throw new ForbiddenError('Only organization members can perform this action');
    return role;
  }

  private async requireOrgOwner(org: OrganizationRow, userEmail: string): Promise<void> {
    const role = await this.orgRole(org.id, userEmail);
    if (role !== 'owner') throw new ForbiddenError('Only organization owners can perform this action');
  }

  public async requireTeam(orgUsername: string, teamSlug: string): Promise<{ org: OrganizationRow; team: TeamRow }> {
    const org = await this.requireOrg(orgUsername);
    const dao = await this.deps.teamDAO();
    const team = await dao.getByOrgAndSlug(org.id, teamSlug.toLowerCase());
    if (!team) throw new NotFoundError('Team not found');
    return { org, team };
  }

  /**
  Team managers: org owners plus team admins.
  */
  public async requireTeamManager(
    orgUsername: string,
    teamSlug: string,
    userEmail: string,
  ): Promise<{ org: OrganizationRow; team: TeamRow }> {
    const { org, team } = await this.requireTeam(orgUsername, teamSlug);
    const orgRole = await this.orgRole(org.id, userEmail);
    if (orgRole === 'owner') return { org, team };
    const memberDAO = await this.deps.teamMemberDAO();
    const membership = await memberDAO.get(team.id, userEmail.toLowerCase());
    if (membership?.role !== 'admin') throw new ForbiddenError('Only organization owners or team admins can perform this action');
    return { org, team };
  }

  public async resolveEmail(usernameOrEmail: string): Promise<string> {
    const raw = usernameOrEmail.trim();
    if (raw.includes('@')) return EmailAddress.normalize(raw);
    const userDAO = await this.deps.userDAO();
    const user = await userDAO.getByUsernameCi(EmailAddress.normalize(raw));
    if (!user) throw new NotFoundError('User not found');
    return EmailAddress.normalize(user.email);
  }

  public async createTeam(
    orgUsername: string,
    actorEmail: string,
    input: { slug: string; name?: string; description?: string | null },
  ): Promise<TeamRow> {
    const org = await this.requireOrg(orgUsername);
    await this.requireOrgOwner(org, actorEmail);
    const slug = input.slug.trim();
    TeamService.validateTeamSlug(slug);
    const dao = await this.deps.teamDAO();
    const existing = await dao.getByOrgAndSlug(org.id, slug.toLowerCase()).catch(() => null);
    if (existing) throw new BadRequestError('Team already exists');
    const count = await dao.countByOrg(org.id).catch(() => 0);
    const max = this.deps.config.getMaxTeamsPerOrg();
    assertQuotaWithinLimit(count, max, 'teams');
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    const id = UUIDUtil.getRandomUUID();
    const name = (input.name ?? slug).trim() || slug;
    await dao.create({ id, orgId: org.id, slug, name, description: input.description ?? null, createdBy: actorEmail.toLowerCase(), now });
    const created = await dao.getById(id);
    if (!created) throw new NotFoundError('Team not found');
    return created;
  }

  public async renameTeam(
    orgUsername: string,
    teamSlug: string,
    actorEmail: string,
    input: { slug?: string; name?: string; description?: string | null },
  ): Promise<TeamRow> {
    const { team } = await this.requireTeam(orgUsername, teamSlug);
    const org = await this.requireOrg(orgUsername);
    await this.requireOrgOwner(org, actorEmail);
    const dao = await this.deps.teamDAO();
    const slug = (input.slug ?? team.slug).trim();
    TeamService.validateTeamSlug(slug);
    if (slug.toLowerCase() !== team.slug_ci) {
      const clash = await dao.getByOrgAndSlug(org.id, slug.toLowerCase()).catch(() => null);
      if (clash) throw new BadRequestError('Team already exists');
    }
    const name = (input.name ?? team.name).trim() || slug;
    await dao.rename(team.id, slug, name, input.description ?? team.description, TimestampUtil.getCurrentUnixTimestampInSeconds());
    const updated = await dao.getById(team.id);
    if (!updated) throw new NotFoundError('Team not found');
    return updated;
  }

  public async deleteTeam(orgUsername: string, teamSlug: string, actorEmail: string): Promise<void> {
    const { org, team } = await this.requireTeam(orgUsername, teamSlug);
    await this.requireOrgOwner(org, actorEmail);
    // Manual cascade (same pattern as AccessBridge TeamsDAO.deleteTeam).
    const grantDAO = await this.deps.teamGrantDAO();
    const memberDAO = await this.deps.teamMemberDAO();
    const dao = await this.deps.teamDAO();
    await grantDAO.deleteByTeam(team.id).catch(() => undefined);
    await memberDAO.deleteByTeam(team.id).catch(() => undefined);
    await dao.deleteById(team.id);
  }

  public async listTeams(orgUsername: string, requesterEmail: string): Promise<TeamRow[]> {
    const org = await this.requireOrg(orgUsername);
    await this.requireOrgMember(org, requesterEmail);
    const dao = await this.deps.teamDAO();
    return dao.listByOrg(org.id);
  }

  public async addMember(
    orgUsername: string,
    teamSlug: string,
    actorEmail: string,
    targetUsernameOrEmail: string,
    role: TeamMemberRole = 'member',
  ): Promise<void> {
    if (role !== 'admin' && role !== 'member') throw new BadRequestError('Invalid role');
    const { team } = await this.requireTeamManager(orgUsername, teamSlug, actorEmail);
    const targetEmail = await this.resolveEmail(targetUsernameOrEmail);
    const memberDAO = await this.deps.teamMemberDAO();
    const existing = await memberDAO.get(team.id, targetEmail).catch(() => null);
    if (!existing) {
      const count = await memberDAO
        .listByTeam(team.id, 10_000)
        .then((rows) => rows.length)
        .catch(() => 0);
      const max = this.deps.config.getMaxTeamMembers();
      assertQuotaWithinLimit(count, max, 'team members');
    }
    await memberDAO.upsert(team.id, targetEmail, role, TimestampUtil.getCurrentUnixTimestampInSeconds());
  }

  public async setMemberRole(
    orgUsername: string,
    teamSlug: string,
    actorEmail: string,
    targetUsernameOrEmail: string,
    role: TeamMemberRole,
  ): Promise<void> {
    if (role !== 'admin' && role !== 'member') throw new BadRequestError('Invalid role');
    const { team } = await this.requireTeamManager(orgUsername, teamSlug, actorEmail);
    const targetEmail = await this.resolveEmail(targetUsernameOrEmail);
    const memberDAO = await this.deps.teamMemberDAO();
    const existing = await memberDAO.get(team.id, targetEmail);
    if (!existing) throw new NotFoundError('Member not found');
    if (role !== 'admin' && existing.role === 'admin') {
      const admins = await memberDAO.countAdmins(team.id);
      assertNotLastTeamAdmin(existing.role, admins, 'demote');
    }
    await memberDAO.upsert(team.id, targetEmail, role, TimestampUtil.getCurrentUnixTimestampInSeconds());
  }

  public async removeMember(orgUsername: string, teamSlug: string, actorEmail: string, targetUsernameOrEmail: string): Promise<void> {
    const { team } = await this.requireTeamManager(orgUsername, teamSlug, actorEmail);
    const targetEmail = await this.resolveEmail(targetUsernameOrEmail);
    const memberDAO = await this.deps.teamMemberDAO();
    const existing = await memberDAO.get(team.id, targetEmail);
    if (!existing) throw new NotFoundError('Member not found');
    if (existing.role === 'admin') {
      const admins = await memberDAO.countAdmins(team.id);
      assertNotLastTeamAdmin(existing.role, admins, 'remove');
    }
    await memberDAO.remove(team.id, targetEmail);
  }

  public async listMembers(
    orgUsername: string,
    teamSlug: string,
    requesterEmail: string,
  ): Promise<Array<{ username: string; role: TeamMemberRole }>> {
    const { org, team } = await this.requireTeam(orgUsername, teamSlug);
    await this.requireOrgMember(org, requesterEmail);
    const memberDAO = await this.deps.teamMemberDAO();
    const userDAO = await this.deps.userDAO();
    const rows = await memberDAO.listByTeam(team.id);
    const out: Array<{ username: string; role: TeamMemberRole }> = [];
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

  public async listMemberEmails(orgUsername: string, teamSlug: string): Promise<string[]> {
    const { team } = await this.requireTeam(orgUsername, teamSlug);
    const memberDAO = await this.deps.teamMemberDAO();
    const rows = await memberDAO.listByTeam(team.id).catch(() => []);
    return rows.map((r) => r.user_email.toLowerCase());
  }

  public async grantRepo(orgUsername: string, teamSlug: string, actorEmail: string, repoId: string, role: RepoRole): Promise<void> {
    if (role !== 'admin' && role !== 'write' && role !== 'read') throw new BadRequestError('Invalid role');
    const { org, team } = await this.requireTeam(orgUsername, teamSlug);
    await this.requireOrgOwner(org, actorEmail);
    const repoDAO = await this.deps.repositoryDAO();
    const repo = await repoDAO.getById(repoId).catch(() => null);
    if (!repo) throw new NotFoundError('Repository not found');
    const grantDAO = await this.deps.teamGrantDAO();
    const existing = await grantDAO.get(team.id, repoId).catch(() => null);
    if (!existing) {
      const count = await grantDAO.countByTeam(team.id).catch(() => 0);
      const max = this.deps.config.getMaxTeamGrants();
      assertQuotaWithinLimit(count, max, 'repository grants');
    }
    await grantDAO.upsert(team.id, repoId, role, actorEmail.toLowerCase(), TimestampUtil.getCurrentUnixTimestampInSeconds());
  }

  public async revokeGrant(orgUsername: string, teamSlug: string, actorEmail: string, repoId: string): Promise<void> {
    const { org, team } = await this.requireTeam(orgUsername, teamSlug);
    await this.requireOrgOwner(org, actorEmail);
    const grantDAO = await this.deps.teamGrantDAO();
    await grantDAO.remove(team.id, repoId);
  }

  public async listGrants(
    orgUsername: string,
    teamSlug: string,
    requesterEmail: string,
  ): Promise<Array<{ repoId: string; role: RepoRole }>> {
    const { org, team } = await this.requireTeam(orgUsername, teamSlug);
    await this.requireOrgMember(org, requesterEmail);
    const grantDAO = await this.deps.teamGrantDAO();
    const rows = await grantDAO.listByTeam(team.id).catch(() => []);
    return rows.map((r) => ({ repoId: r.repo_id, role: r.role }));
  }
}

export { TeamService };
export type { TeamServiceDeps, TeamServiceEnv };
