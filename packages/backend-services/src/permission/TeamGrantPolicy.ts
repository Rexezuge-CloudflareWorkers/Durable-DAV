import type { RepoRole } from '@duradav/backend-data/dao';

type RepoPermission = RepoRole;

const ROLE_RANK: Record<RepoPermission, number> = { read: 1, write: 2, admin: 3 };

/**
 * Pure team-grant resolution policy (why: `PermissionService.getTeamRole`
 * mixed D1 fan-out with max-role reduction, untestable without fakes).
 * Given grants plus membership/team scoping, returns the max applicable role.
 */
function maxTeamGrantRole(
  grants: ReadonlyArray<{ team_id: string; role: RepoPermission }>,
  isMemberOf: (teamId: string) => boolean,
  isSameOrg: (teamId: string) => boolean,
): RepoPermission | null {
  let best: RepoPermission | null = null;
  for (const grant of grants) {
    if (!isSameOrg(grant.team_id)) continue;
    if (!isMemberOf(grant.team_id)) continue;
    if (!best || ROLE_RANK[grant.role] > ROLE_RANK[best]) {
      best = grant.role;
      if (best === 'admin') break;
    }
  }
  return best;
}

function rankRole(role: RepoPermission): number {
  return ROLE_RANK[role];
}

export { maxTeamGrantRole, rankRole };
