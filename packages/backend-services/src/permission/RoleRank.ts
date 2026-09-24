import type { RepoPermission } from './PermissionService';
import { PermissionService } from './PermissionService';

/**
 * `admin|write|read` rank value object. Single home for the `3/2/1`
 * mapping previously triplicated in `MiddlewareHandlers`,
 * `PublicViewerResolver`, and merge guards.
 */
const RoleRank: {
  rank(role: RepoPermission): number;
  meets(actual: RepoPermission | null, minimum: RepoPermission): boolean;
} = {
  rank(role: RepoPermission): number {
    return PermissionService.rank(role);
  },
  meets(actual: RepoPermission | null, minimum: RepoPermission): boolean {
    return PermissionService.meets(actual, minimum);
  },
};

export { RoleRank };
