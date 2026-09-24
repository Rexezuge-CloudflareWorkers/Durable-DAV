import {
  NamespaceDAO,
  OrganizationDAO,
  OrganizationMemberDAO,
  RepoCollaboratorDAO,
  RepositoryDAO,
  UserDAO,
} from '@duradav/backend-data/dao';
import type { RepositoryRow } from '@duradav/backend-data/dao';
import type { D1Queryable } from '@duradav/backend-data/utils';
import { BadRequestError, ForbiddenError, NotFoundError } from '@duradav/backend-errors';
import { EmailAddress, RepoFullName } from '@duradav/shared/utils';
import { PermissionService } from '../permission/PermissionService';
import { RepoService } from '../repo/RepoService';

interface ForkServiceEnv {
  DB: D1Queryable;
  MAX_REPOS_PER_USER?: string;
}

interface ForkServiceDeps {
  repositoryDAO?: () => Promise<RepositoryDAO>;
  userDAO?: () => Promise<UserDAO>;
  organizationDAO?: () => Promise<OrganizationDAO>;
  organizationMemberDAO?: () => Promise<OrganizationMemberDAO>;
  repoCollaboratorDAO?: () => Promise<RepoCollaboratorDAO>;
  namespaceDAO?: () => Promise<NamespaceDAO>;
  permissionService?: () => Promise<PermissionService>;
}

/**
 * Forks: destination-allowlisted (`self + member orgs`, mirroring new-repo
 * creation) copies of a visible source repo. D1 lineage (`forked_from_*`) is
 * recorded at creation; git object copying is orchestrated by the API layer
 * via DO RPC (`exportPack`/`importPack`) and rolled back on failure.
 */
class ForkService {
  private readonly deps: Required<ForkServiceDeps>;

  constructor(
    private readonly env: ForkServiceEnv,
    deps: ForkServiceDeps = {},
  ) {
    const permissionService =
      deps.permissionService ??
      ((): Promise<PermissionService> =>
        Promise.resolve(
          new PermissionService(this.env, {
            organizationDAO: deps.organizationDAO ?? (() => Promise.resolve(new OrganizationDAO(env.DB))),
            organizationMemberDAO: deps.organizationMemberDAO ?? (() => Promise.resolve(new OrganizationMemberDAO(env.DB))),
            repoCollaboratorDAO: deps.repoCollaboratorDAO ?? (() => Promise.resolve(new RepoCollaboratorDAO(env.DB))),
            namespaceDAO: deps.namespaceDAO ?? (() => Promise.resolve(new NamespaceDAO(env.DB))),
          }),
        ));
    this.deps = {
      repositoryDAO: () => Promise.resolve(new RepositoryDAO(env.DB)),
      userDAO: () => Promise.resolve(new UserDAO(env.DB)),
      organizationDAO: () => Promise.resolve(new OrganizationDAO(env.DB)),
      organizationMemberDAO: () => Promise.resolve(new OrganizationMemberDAO(env.DB)),
      repoCollaboratorDAO: () => Promise.resolve(new RepoCollaboratorDAO(env.DB)),
      namespaceDAO: () => Promise.resolve(new NamespaceDAO(env.DB)),
      permissionService,
      ...deps,
    };
  }

  private repoService(): RepoService {
    return new RepoService(this.env, {
      repositoryDAO: this.deps.repositoryDAO,
      userDAO: this.deps.userDAO,
      organizationDAO: this.deps.organizationDAO,
      organizationMemberDAO: this.deps.organizationMemberDAO,
      repoCollaboratorDAO: this.deps.repoCollaboratorDAO,
      namespaceDAO: this.deps.namespaceDAO,
      permissionService: this.deps.permissionService,
    });
  }

  private getPermissionService(): Promise<PermissionService> {
    return this.deps.permissionService();
  }

  private async resolveDefaultOwner(userEmail: string): Promise<string> {
    const normalized = EmailAddress.normalize(userEmail);
    try {
      const userDao = await this.deps.userDAO();
      const user = await userDao.getByEmail(normalized);
      if (user?.username) return user.username;
    } catch {
      // ignore — fall back to email prefix below
    }
    return normalized.split('@', 1)[0] ?? normalized;
  }

  private async resolveCallerUsernameLowercased(userEmail: string): Promise<string | null> {
    const normalized = EmailAddress.normalize(userEmail);
    try {
      const userDao = await this.deps.userDAO();
      const user = await userDao.getByEmail(normalized);
      if (user?.username) return user.username.toLowerCase();
    } catch {
      // ignore — fall back to email prefix below
    }
    const prefix = normalized.split('@', 1)[0]?.toLowerCase() ?? '';
    return prefix || null;
  }

  /**
   * Destination allowlist (mirrors new-repo creation): a fork may only land
   * in the forker's own namespace or an org where the forker is a member.
   * Anything else — another user, a non-member org, an unclaimed name — is
   * a permission escalation and is rejected before any row is created.
   */
  private async assertForkDestinationAllowed(forkerEmail: string, normalizedOwner: string): Promise<void> {
    const ownerCi = normalizedOwner.toLowerCase();
    const callerLowercased = await this.resolveCallerUsernameLowercased(forkerEmail);
    if (callerLowercased && ownerCi === callerLowercased) return;

    const callerEmail = EmailAddress.normalize(forkerEmail);
    let org: { id: string; username: string } | null = null;
    try {
      const orgDao = await this.deps.organizationDAO();
      org = await orgDao.getByUsernameCi(ownerCi);
    } catch {
      org = null;
    }
    if (org) {
      let membership: { role: string } | null = null;
      try {
        const memberDao = await this.deps.organizationMemberDAO();
        membership = await memberDao.get(org.id, callerEmail);
      } catch {
        membership = null;
      }
      if (!membership) {
        throw new ForbiddenError('Only organization members can create repositories for this organization');
      }
      return;
    }

    throw new ForbiddenError('Only the repository owner can perform this action');
  }

  /**
   * Validate the fork request and create the destination D1 row (with
   * lineage). The caller must copy git objects afterwards and roll back via
   * `rollbackFork` when the copy fails.
   */
  public async createForkRow(
    forkerEmail: string,
    sourceOwner: string,
    sourceName: string,
    dest: { owner?: string; name?: string; description?: string | null; isPrivate?: boolean },
  ): Promise<{ id: string; owner: string; name: string; fullName: string; source: RepositoryRow; isPrivate: boolean }> {
    const dao = await this.deps.repositoryDAO();
    const source = await dao.getByOwnerAndName(sourceOwner, sourceName);
    if (!source) throw new NotFoundError('Repository not found');
    const permission = await this.getPermissionService();
    const role = await permission.getRole(forkerEmail, source);
    if (!role) throw new NotFoundError('Repository not found');

    const destOwner = (dest.owner ?? '').trim() || (await this.resolveDefaultOwner(forkerEmail));
    const destName = (dest.name ?? '').trim() || source.name;
    const normalizedOwner = RepoFullName.normalizeOwner(destOwner);
    const normalizedName = RepoFullName.normalizeRepo(destName);
    RepoService.validateNames(normalizedOwner, normalizedName);
    await this.assertForkDestinationAllowed(forkerEmail, normalizedOwner);

    const sourceFullName = `${source.owner}/${source.name}`;
    const destFullName = `${normalizedOwner}/${normalizedName}`;
    if (destFullName.toLowerCase() === sourceFullName.toLowerCase()) {
      throw new BadRequestError('Cannot fork a repository into itself');
    }

    // A private source must stay private: forks cannot leak it publicly.
    const sourcePrivate = source.is_private === 1;
    const isPrivate = sourcePrivate ? true : (dest.isPrivate ?? false);
    const description = dest.description === undefined ? (source.description ?? null) : dest.description;

    const { id } = await this.repoService().createRepo(forkerEmail, normalizedOwner, normalizedName, description, isPrivate, {
      forkedFromRepoId: source.id,
    });
    const created = await dao.getById(id);
    const canonicalOwner = created?.owner ?? normalizedOwner;
    return { id, owner: canonicalOwner, name: normalizedName, fullName: `${canonicalOwner}/${normalizedName}`, source, isPrivate };
  }

  // Best-effort rollback of a fork whose git copy failed (D1 row only).
  public async rollbackFork(id: string): Promise<void> {
    try {
      const dao = await this.deps.repositoryDAO();
      await dao.deleteById(id);
    } catch {
      // best-effort — D1 is reconciled on retry (destination already exists)
    }
  }

  public async listForks(sourceRepoId: string, limit = 100): Promise<RepositoryRow[]> {
    const dao = await this.deps.repositoryDAO();
    return dao.listForks(sourceRepoId, limit);
  }

  public async countForks(sourceRepoId: string): Promise<number> {
    const dao = await this.deps.repositoryDAO();
    return dao.countForks(sourceRepoId);
  }
}

export { ForkService };
export type { ForkServiceDeps, ForkServiceEnv };
