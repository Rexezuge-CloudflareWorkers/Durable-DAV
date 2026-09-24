import type { RepositoryRow } from '@duradav/backend-data/dao';
import {
  NamespaceDAO,
  OrganizationDAO,
  OrganizationMemberDAO,
  RepoCollaboratorDAO,
  TeamDAO,
  TeamMemberDAO,
  TeamRepoGrantDAO,
} from '@duradav/backend-data/dao';
import type { D1Queryable } from '@duradav/backend-data/utils';
import { isMissingSchemaError } from '@duradav/backend-data/utils';
import { DatabaseError } from '@duradav/backend-errors';
import { maxTeamGrantRole } from './TeamGrantPolicy';
import type { RepoRole } from '@duradav/backend-data/dao';

type RepoPermission = RepoRole;

interface PermissionServiceEnv {
  DB: D1Queryable;
}

interface PermissionServiceDeps {
  organizationDAO?: () => Promise<OrganizationDAO>;
  organizationMemberDAO?: () => Promise<OrganizationMemberDAO>;
  repoCollaboratorDAO?: () => Promise<RepoCollaboratorDAO>;
  namespaceDAO?: () => Promise<NamespaceDAO>;
  teamDAO?: () => Promise<TeamDAO>;
  teamMemberDAO?: () => Promise<TeamMemberDAO>;
  teamGrantDAO?: () => Promise<TeamRepoGrantDAO>;
  // Fail-closed schema mode: when true, missing-table/column errors throw
  // DatabaseError instead of degrading to public-read/collaborator fallbacks.
  // Wired to true in production (all migrations applied; a missing table is
  // deploy skew, not a legacy DB). Non-prod keeps the legacy degrade for
  // old D1 databases and unit fakes.
  strictSchema?: boolean;
}

const ROLE_RANK: Record<RepoPermission, number> = { read: 1, write: 2, admin: 3 };

class PermissionService {
  private readonly deps: Required<PermissionServiceDeps>;

  constructor(
    private readonly env: PermissionServiceEnv,
    deps: PermissionServiceDeps = {},
  ) {
    this.deps = {
      organizationDAO: () => Promise.resolve(new OrganizationDAO(env.DB)),
      organizationMemberDAO: () => Promise.resolve(new OrganizationMemberDAO(env.DB)),
      repoCollaboratorDAO: () => Promise.resolve(new RepoCollaboratorDAO(env.DB)),
      namespaceDAO: () => Promise.resolve(new NamespaceDAO(env.DB)),
      teamDAO: () => Promise.resolve(new TeamDAO(env.DB)),
      teamMemberDAO: () => Promise.resolve(new TeamMemberDAO(env.DB)),
      teamGrantDAO: () => Promise.resolve(new TeamRepoGrantDAO(env.DB)),
      strictSchema: false,
      ...deps,
    };
  }

  /**
   * Whether a missing-table/column error may degrade to a fallback.
   * Centralizes the fail-open guard: every `catch` in `getRole`/`getTeamRole`
   * routes through here so strict mode (production) fails closed with
   * DatabaseError instead of silently treating outage/skew as public-read.
   */
  private isTolerableSchemaError(error: unknown): boolean {
    if (this.deps.strictSchema) return false;
    return isMissingSchemaError(error);
  }

  public static rank(role: RepoPermission): number {
    return ROLE_RANK[role];
  }

  public static meets(actual: RepoPermission | null, minimum: RepoPermission): boolean {
    if (!actual) return false;
    return ROLE_RANK[actual] >= ROLE_RANK[minimum];
  }

  private static isPrivateRepo(repo: RepositoryRow): boolean {
    return repo.is_private === 1;
  }

  private static ownerCiOf(repo: RepositoryRow): string {
    return (repo.owner_ci ?? repo.owner).toLowerCase();
  }

  private static ownerTypeOf(repo: RepositoryRow): string {
    if (repo.owner_type) return repo.owner_type;
    if (repo.org_id) return 'org';
    return 'user';
  }

  public async getRole(viewerEmail: string | null, repo: RepositoryRow | null): Promise<RepoPermission | null> {
    if (!repo) return null;
    const isPrivate = PermissionService.isPrivateRepo(repo);
    if (!viewerEmail) return isPrivate ? null : 'read';
    const viewer = viewerEmail.toLowerCase();

    // Resolve org (0002 path with graceful fallback for legacy DBs/fakes).
    // Fail closed: only missing-table errors degrade — and only when
    // `strictSchema` is off (non-prod). Genuine D1 failures throw
    // DatabaseError instead of falling through to public-read.
    let orgId: string | null = null;
    try {
      const ownerType = PermissionService.ownerTypeOf(repo);
      if (ownerType === 'org') {
        if (repo.org_id) {
          orgId = repo.org_id;
        } else {
          const orgDAO = await this.deps.organizationDAO();
          const org = await orgDAO.getByUsernameCi(PermissionService.ownerCiOf(repo));
          if (org) orgId = org.id;
          // owner_type says org but row missing (deleted org): hide existence
          // for everyone (private and public) so deleted-org repos never leak.
          if (!orgId) return null;
        }
      } else {
        // User-owned fast path may still be an org repo on legacy rows: check registry once.
        try {
          const orgDAO = await this.deps.organizationDAO();
          const maybeOrg = await orgDAO.getByUsernameCi(PermissionService.ownerCiOf(repo));
          if (maybeOrg && (repo.org_id === maybeOrg.id || repo.owner_type === 'org')) orgId = maybeOrg.id;
        } catch (error) {
          if (!this.isTolerableSchemaError(error))
            throw new DatabaseError(`Failed to resolve organization: ${error instanceof Error ? error.message : String(error)}`, false, { cause: error });
          // ignore — legacy DB without organizations table
        }
      }
    } catch (error) {
      if (!this.isTolerableSchemaError(error))
        throw error instanceof DatabaseError
          ? error
          : new DatabaseError(`Failed to resolve permission: ${error instanceof Error ? error.message : String(error)}`, false, { cause: error });
      orgId = null;
    }

    if (orgId) {
      try {
        const memberDAO = await this.deps.organizationMemberDAO();
        const membership = await memberDAO.get(orgId, viewer);
        if (membership?.role === 'owner') return 'admin';
      } catch (error) {
        if (!this.isTolerableSchemaError(error))
          throw new DatabaseError(`Failed to check org membership: ${error instanceof Error ? error.message : String(error)}`, false, { cause: error });
        // missing table → fall through to collaborator/public checks
      }
      let best: RepoPermission | null = null;
      try {
        const collabDAO = await this.deps.repoCollaboratorDAO();
        const grant = await collabDAO.get(repo.id, viewer);
        if (grant) best = grant.role;
      } catch (error) {
        if (!this.isTolerableSchemaError(error))
          throw new DatabaseError(`Failed to check collaborator grant: ${error instanceof Error ? error.message : String(error)}`, false, { cause: error });
      }
      // Team-derived grants (org repos only): max of direct + team grants.
      // Missing team tables (legacy DBs/fakes) fall through silently.
      try {
        const teamBest = await this.getTeamRole(orgId, repo.id, viewer);
        if (teamBest && (!best || ROLE_RANK[teamBest] > ROLE_RANK[best])) best = teamBest;
      } catch (error) {
        if (!this.isTolerableSchemaError(error))
          throw error instanceof DatabaseError
            ? error
            : new DatabaseError(`Failed to check team grants: ${error instanceof Error ? error.message : String(error)}`, false, { cause: error });
      }
      if (best) return best;
      return isPrivate ? null : 'read';
    }

    // User-owned repo.
    const ownerEmail = repo.owner_user_email ?? repo.owner_email;
    if (ownerEmail?.toLowerCase() === viewer) return 'admin';
    try {
      const collabDAO = await this.deps.repoCollaboratorDAO();
      const grant = await collabDAO.get(repo.id, viewer);
      if (grant) return grant.role;
    } catch (error) {
      if (!this.isTolerableSchemaError(error))
        throw new DatabaseError(`Failed to check collaborator grant: ${error instanceof Error ? error.message : String(error)}`, false, { cause: error });
    }
    return isPrivate ? null : 'read';
  }

  /**
   * Best team-derived role for a viewer on an org repo: for every grant on
   * this repo, checks membership in the granting team (scoped to the same
   * org) and returns the max role. Teams never apply to user-owned repos.
   *
   * Batched (Otter `RepositoryHelper` pattern): team rows + membership rows
   * load concurrently with per-request dedup so the git-auth hot path is
   * `1 grant list + 1 fan-out` instead of sequential N+1 round-trips.
   */
  private async getTeamRole(orgId: string, repoId: string, viewer: string): Promise<RepoPermission | null> {
    const grantDAO = await this.deps.teamGrantDAO();
    let grants: Array<{ team_id: string; role: RepoPermission }>;
    try {
      grants = await grantDAO.listByRepo(repoId);
    } catch (error) {
      if (!this.isTolerableSchemaError(error))
        throw new DatabaseError(`Failed to list team grants: ${error instanceof Error ? error.message : String(error)}`, false, { cause: error });
      return null;
    }
    if (grants.length === 0) return null;
    const memberDAO = await this.deps.teamMemberDAO();
    const teamDAO = await this.deps.teamDAO();
    const uniqueTeamIds = [...new Set(grants.map((g) => g.team_id))];
    const swallowMissing = async <T>(op: Promise<T>): Promise<T | null> => {
      try {
        return await op;
      } catch (error) {
        if (!this.isTolerableSchemaError(error))
          throw new DatabaseError(`Failed to resolve team role: ${error instanceof Error ? error.message : String(error)}`, false, { cause: error });
        return null;
      }
    };
    const [teams, memberships] = await Promise.all([
      Promise.all(uniqueTeamIds.map((id) => swallowMissing(teamDAO.getById(id)))),
      Promise.all(uniqueTeamIds.map((id) => swallowMissing(memberDAO.get(id, viewer)))),
    ]);
    const teamById = new Map(teams.filter((t): t is NonNullable<typeof t> => t !== null).map((t) => [t.id, t] as const));
    // Positional membership: `memberships[i]` answers `uniqueTeamIds[i]`.
    // (Do not rely on the row's `team_id` field — fakes/legacy rows may omit it.)
    const memberTeamIds = new Set(uniqueTeamIds.filter((_, i) => memberships[i] !== null));
    // Pure policy (why: max-role reduction is unit-testable without D1).
    return maxTeamGrantRole(
      grants,
      (teamId) => memberTeamIds.has(teamId),
      (teamId) => teamById.get(teamId)?.org_id === orgId,
    );
  }
}

export { PermissionService };
export type { PermissionServiceDeps, PermissionServiceEnv, RepoPermission };
