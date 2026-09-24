import type { RepositoryRow, RepoRole } from '@duradav/backend-data/dao';
import type { RepositoryDAO } from '@duradav/backend-data/dao';
import type { OrganizationDAO } from '@duradav/backend-data/dao';
import type { OrganizationMemberDAO } from '@duradav/backend-data/dao';
import type { RepoCollaboratorDAO } from '@duradav/backend-data/dao';
import { NotFoundError, ForbiddenError } from '@duradav/backend-errors';
import { EmailAddress } from '@duradav/shared/utils';
import { PermissionService } from '../permission/PermissionService';

interface RepoVisibilityDeps {
  repositoryDAO: () => Promise<RepositoryDAO>;
  organizationDAO: () => Promise<OrganizationDAO>;
  organizationMemberDAO: () => Promise<OrganizationMemberDAO>;
  repoCollaboratorDAO: () => Promise<RepoCollaboratorDAO>;
  permissionService: () => Promise<PermissionService>;
}

interface CallerResolver {
  (userEmail: string): Promise<string | null>;
}

/**
 * Read-model visibility for repositories (Otter Facade pattern).
 * Extracted from `RepoService.listVisibleForUser/requireRole` so the god
 * service shrinks and visibility logic is reusable from search, realtime,
 * and route guards without instantiating the full write path.
 */
class RepoVisibilityService {
  constructor(private readonly deps: RepoVisibilityDeps) {}

  public async getRole(viewerEmail: string | null, repo: RepositoryRow | null): Promise<RepoRole | null> {
    const permission = await this.deps.permissionService();
    return permission.getRole(viewerEmail, repo);
  }

  public async requireRole(
    owner: string,
    name: string,
    viewerEmail: string | null,
    minimum: RepoRole,
  ): Promise<{ repo: RepositoryRow; role: RepoRole }> {
    const dao = await this.deps.repositoryDAO();
    const repo = await dao.getByOwnerAndName(owner, name);
    if (!repo) throw new NotFoundError('Repository not found');
    const role = await this.getRole(viewerEmail, repo);
    if (!role) {
      if (repo.is_private === 1) throw new NotFoundError('Repository not found');
      throw new ForbiddenError('Only the repository owner can perform this action');
    }
    if (!PermissionService.meets(role, minimum)) {
      throw new ForbiddenError('Only the repository owner can perform this action');
    }
    return { repo, role };
  }

  public async listVisibleForUser(userEmail: string, resolveCallerUsername: CallerResolver, limit = 100): Promise<RepositoryRow[]> {
    const dao = await this.deps.repositoryDAO();
    const normalizedEmail = EmailAddress.normalize(userEmail);
    const seen = new Map<string, RepositoryRow>();
    const pushAll = (rows: RepositoryRow[]): void => {
      for (const row of rows) {
        if (!seen.has(row.id)) seen.set(row.id, row);
      }
    };
    pushAll(await dao.listByOwnerEmail(normalizedEmail, limit).catch(() => []));
    try {
      const usernameLowercased = await resolveCallerUsername(normalizedEmail);
      if (usernameLowercased) {
        pushAll(await dao.listByOwner(usernameLowercased, limit).catch(() => []));
      }
    } catch {
      // ignore — username index is best-effort
    }
    try {
      const memberDAO = await this.deps.organizationMemberDAO();
      const orgDao = await this.deps.organizationDAO();
      const memberships = await memberDAO.listOrgsByUser(normalizedEmail).catch(() => []);
      for (const m of memberships.slice(0, 50)) {
        pushAll(await dao.listByOrgId(m.org_id, limit).catch(() => []));
        try {
          const org = await orgDao.getById(m.org_id);
          if (org) pushAll(await dao.listByOwner(org.username, limit).catch(() => []));
        } catch {
          // ignore legacy rows without org_id backfill
        }
      }
    } catch {
      // ignore — org visibility is best-effort
    }
    try {
      const collabDAO = await this.deps.repoCollaboratorDAO();
      const grants = await collabDAO.listByUser(normalizedEmail, 500).catch(() => []);
      for (const g of grants.slice(0, 200)) {
        const repo = await dao.getById(g.repo_id).catch(() => null);
        if (repo) pushAll([repo]);
      }
    } catch {
      // ignore — collaborator grants are best-effort
    }
    const visible: RepositoryRow[] = [];
    for (const repo of seen.values()) {
      const role = await this.getRole(normalizedEmail, repo).catch(() => null);
      if (role) visible.push(repo);
    }
    visible.sort((a, b) => b.updated_at - a.updated_at);
    return visible.slice(0, limit);
  }
}

export { RepoVisibilityService };
export type { RepoVisibilityDeps };
