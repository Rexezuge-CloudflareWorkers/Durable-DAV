import type { RepositoryRow } from '@duradav/backend-data/dao';
import { PermissionService } from './PermissionService';
import type { RepoPermission } from './PermissionService';
import type { IAuthorizationGuard } from './AuthorizationGuard';

/**
 * Single application-service guard for repo visibility. Routes should call
 * this instead of hand-rolling `getRole(...).catch(()=>null)` + rank checks.
 * Private repos hide existence (returns null, caller maps to 404/401).
 */
class AuthorizationGuard implements IAuthorizationGuard {
  constructor(private readonly permissions: PermissionService) {}

  public async requireVisible(viewerEmail: string | null, repo: RepositoryRow | null): Promise<RepositoryRow | null> {
    if (!repo) return null;
    const role = await this.permissions.getRole(viewerEmail, repo).catch(() => null);
    if (!role) return null;
    return repo;
  }

  public async requireRole(
    viewerEmail: string | null,
    repo: RepositoryRow | null,
    minimum: RepoPermission,
  ): Promise<{ row: RepositoryRow; role: RepoPermission } | null> {
    if (!repo) return null;
    const role = await this.permissions.getRole(viewerEmail, repo).catch(() => null);
    if (!role) return null;
    if (!PermissionService.meets(role, minimum)) return null;
    return { row: repo, role };
  }
}

export { AuthorizationGuard };
