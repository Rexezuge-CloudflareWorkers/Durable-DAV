import type {
  AuditLogDAO,
  BranchProtectionDAO,
  CheckRunDAO,
  CollaborationDAO,
  DeletedRepoDoDAO,
  DiscussionDAO,
  EventDAO,
  ImportDAO,
  IssueDAO,
  MirrorDAO,
  NamespaceDAO,
  NotificationDAO,
  NumberingDAO,
  OrganizationDAO,
  OrganizationMemberDAO,
  ProjectDAO,
  PullRequestDAO,
  PullThreadDAO,
  ReleaseDAO,
  DeployKeyDAO,
  RepoCollaboratorDAO,
  RepositoryDAO,
  SearchDAO,
  SecuritySettingsDAO,
  StarDAO,
  TeamRepoGrantDAO,
  TokenRepoGrantDAO,
  UserDAO,
  WatchDAO,
  WebhookDAO,
  WebhookDeliveryDAO,
  WikiDAO,
  RepositoryRow,
  RepoRole,
} from '@duradav/backend-data/dao';
import type { D1Queryable } from '@duradav/backend-data/utils';
import { BadRequestError, NotFoundError } from '@duradav/backend-errors';
import type { AppConfiguration } from '@duradav/backend-runtime/config';
import { isReservedNamespaceName } from '@duradav/shared/constants';
import { EmailAddress, RepoFullName, TimestampUtil, UUIDUtil } from '@duradav/shared/utils';
import type { PermissionService } from '../permission/PermissionService';
import { cleanupRepoSidecars } from './repoCleanup';
import { RepoVisibilityService } from './RepoVisibilityService';
import { checkRepoQuota, classifyCreatePath, throwIfForbidden, validateRepoPatch } from './RepoCreatePolicy';
import { createDefaultRepoServiceDeps } from './RepoServiceDefaults';
import { enqueueVacuumTombstone, resolveCallerUsernameLowercased, resolveCreationContext } from './RepoCreateContext';

interface RepoServiceEnv {
  DB: D1Queryable;
  MAX_REPOS_PER_USER?: string;
}

interface RepoServiceDeps {
  repositoryDAO?: () => Promise<RepositoryDAO>;
  issueDAO?: () => Promise<IssueDAO>;
  pullRequestDAO?: () => Promise<PullRequestDAO>;
  pullThreadDAO?: () => Promise<PullThreadDAO>;
  branchProtectionDAO?: () => Promise<BranchProtectionDAO>;
  userDAO?: () => Promise<UserDAO>;
  organizationDAO?: () => Promise<OrganizationDAO>;
  organizationMemberDAO?: () => Promise<OrganizationMemberDAO>;
  repoCollaboratorDAO?: () => Promise<RepoCollaboratorDAO>;
  namespaceDAO?: () => Promise<NamespaceDAO>;
  starDAO?: () => Promise<StarDAO>;
  watchDAO?: () => Promise<WatchDAO>;
  eventDAO?: () => Promise<EventDAO>;
  notificationDAO?: () => Promise<NotificationDAO>;
  releaseDAO?: () => Promise<ReleaseDAO>;
  projectDAO?: () => Promise<ProjectDAO>;
  discussionDAO?: () => Promise<DiscussionDAO>;
  wikiDAO?: () => Promise<WikiDAO>;
  importDAO?: () => Promise<ImportDAO>;
  mirrorDAO?: () => Promise<MirrorDAO>;
  deployKeyDAO?: () => Promise<DeployKeyDAO>;
  deletedRepoDoDAO?: () => Promise<DeletedRepoDoDAO>;
  numberingDAO?: () => Promise<NumberingDAO>;
  searchDAO?: () => Promise<SearchDAO>;
  tokenGrantDAO?: () => Promise<TokenRepoGrantDAO>;
  securitySettingsDAO?: () => Promise<SecuritySettingsDAO>;
  collaborationDAO?: () => Promise<CollaborationDAO>;
  webhookDAO?: () => Promise<WebhookDAO>;
  webhookDeliveryDAO?: () => Promise<WebhookDeliveryDAO>;
  auditLogDAO?: () => Promise<AuditLogDAO>;
  teamGrantDAO?: () => Promise<TeamRepoGrantDAO>;
  checkRunDAO?: () => Promise<CheckRunDAO>;
  permissionService?: () => Promise<PermissionService>;
  config?: AppConfiguration;
}

class RepoService {
  private readonly deps: Required<RepoServiceDeps>;
  private readonly visibility: RepoVisibilityService;

  constructor(
    private readonly env: RepoServiceEnv,
    deps: RepoServiceDeps = {},
  ) {
    // Defaults live in `RepoServiceDefaults` (Factory): the constructor stays
    // a thin composition root so this file remains under the god-file guard.
    this.deps = createDefaultRepoServiceDeps(env, deps);
    this.visibility = new RepoVisibilityService({
      repositoryDAO: this.deps.repositoryDAO,
      organizationDAO: this.deps.organizationDAO,
      organizationMemberDAO: this.deps.organizationMemberDAO,
      repoCollaboratorDAO: this.deps.repoCollaboratorDAO,
      permissionService: this.deps.permissionService,
    });
  }

  public static validateNames(owner: string, name: string): void {
    try {
      RepoFullName.parse(owner, name);
    } catch {
      throw new BadRequestError('Invalid owner or repository name');
    }
    if (isReservedNamespaceName(owner.trim())) {
      throw new BadRequestError('Username is reserved');
    }
  }

  public async getRole(viewerEmail: string | null, repo: RepositoryRow | null): Promise<RepoRole | null> {
    return this.visibility.getRole(viewerEmail, repo);
  }

  /**
   * Lowercased caller username for self-vs-org precedence.
   * Why lowercased: `owner_ci` comparisons are case-insensitive; D1 stores
   * the canonical case, but routing must not depend on it.
   */
  private async resolveCallerUsernameLowercased(userEmail: string): Promise<string | null> {
    return resolveCallerUsernameLowercased(this.deps.userDAO, userEmail);
  }

  public async createRepo(
    userEmail: string,
    owner: string,
    name: string,
    description: string | null,
    isPrivate: boolean,
    opts: { forkedFromRepoId?: string | null } = {},
  ): Promise<{ id: string }> {
    const normalizedOwner = RepoFullName.normalizeOwner(owner);
    const dao = await this.deps.repositoryDAO();
    RepoService.validateNames(normalizedOwner, name);
    const existing = await dao.getByOwnerAndName(normalizedOwner, name);
    if (existing) {
      throw new BadRequestError('Repository already exists');
    }
    const owned = await dao.listByOwnerEmail(userEmail, 1000).catch(() => []);
    // Why fail-open here: quota is a soft limit; a transient D1 outage must
    // not block creation with 500 when the pure `checkRepoQuota` below still
    // enforces the cap on the rows we did read. Auth/visibility stays fail-closed.
    checkRepoQuota(owned.length, this.deps.config.getMaxReposPerUser());

    const ownerCi = normalizedOwner.toLowerCase();
    const callerCi = await this.resolveCallerUsernameLowercased(userEmail);
    const callerEmail = EmailAddress.normalize(userEmail);
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    const id = UUIDUtil.getRandomUUID();

    // Resolve the org/namespace lookups up front; the precedence decision
    // itself is the pure `classifyCreatePath` policy below.
    const { org, isOrgMember, namespaceOwnerEmail } = await resolveCreationContext(
      {
        organizationDAO: this.deps.organizationDAO,
        organizationMemberDAO: this.deps.organizationMemberDAO,
        namespaceDAO: this.deps.namespaceDAO,
      },
      { ownerCi, callerCi, callerEmail },
    );

    const path = classifyCreatePath({ ownerCi, callerCi, org, isOrgMember, namespaceOwnerEmail, callerEmail });
    throwIfForbidden(path);

    // Self-owned fast path (covers legacy fakes with no users/orgs tables).
    if (path.kind === 'self' || path.kind === 'legacy') {
      await dao.create({
        id,
        ownerEmail: callerEmail,
        owner: normalizedOwner,
        name,
        description,
        isPrivate,
        now,
        ownerType: 'user',
        ownerUserEmail: callerEmail,
        forkedFromRepoId: opts.forkedFromRepoId ?? null,
      });
      return { id };
    }

    // Org-owned path: caller is owner or member (both may create).
    await dao.create({
      id,
      ownerEmail: callerEmail,
      owner: path.owner,
      name,
      description,
      isPrivate,
      now,
      ownerType: 'org',
      orgId: path.orgId,
      forkedFromRepoId: opts.forkedFromRepoId ?? null,
    });
    return { id };
  }

  public async getRepo(owner: string, name: string): Promise<RepositoryRow | null> {
    const dao = await this.deps.repositoryDAO();
    return dao.getByOwnerAndName(owner, name);
  }

  public async getByOwnerAndName(owner: string, name: string): Promise<RepositoryRow | null> {
    return this.getRepo(owner, name);
  }

  public async getById(id: string): Promise<RepositoryRow | null> {
    const dao = await this.deps.repositoryDAO();
    return dao.getById(id);
  }

  public async listByOwnerEmail(ownerEmail: string, limit = 100): Promise<RepositoryRow[]> {
    const dao = await this.deps.repositoryDAO();
    return dao.listByOwnerEmail(ownerEmail, limit);
  }

  public async listVisibleForUser(userEmail: string, limit = 100): Promise<RepositoryRow[]> {
    return this.visibility.listVisibleForUser(userEmail, (email) => this.resolveCallerUsernameLowercased(email), limit);
  }

  public async requireRole(
    owner: string,
    name: string,
    viewerEmail: string | null,
    minimum: RepoRole,
  ): Promise<{ repo: RepositoryRow; role: RepoRole }> {
    return this.visibility.requireRole(owner, name, viewerEmail, minimum);
  }

  public async requireOwner(owner: string, name: string, userEmail: string): Promise<RepositoryRow> {
    const { repo } = await this.requireRole(owner, name, userEmail, 'admin');
    return repo;
  }

  public async updateRepo(
    owner: string,
    name: string,
    userEmail: string,
    patch: { description?: string | null; isPrivate?: boolean },
  ): Promise<RepositoryRow> {
    const repo = await this.requireOwner(owner, name, userEmail);
    validateRepoPatch(patch);
    const dao = await this.deps.repositoryDAO();
    await dao.update(repo.id, {
      description: patch.description,
      isPrivate: patch.isPrivate,
      now: TimestampUtil.getCurrentUnixTimestampInSeconds(),
    });
    const updated = await dao.getById(repo.id);
    if (!updated) {
      throw new NotFoundError('Repository not found');
    }
    return updated;
  }

  public async deleteRepo(owner: string, name: string, userEmail: string): Promise<{ id: string }> {
    const repo = await this.requireOwner(owner, name, userEmail);
    await cleanupRepoSidecars(this.deps, repo.id);
    const repositoryDAO = await this.deps.repositoryDAO();
    await repositoryDAO.deleteById(repo.id);
    await enqueueVacuumTombstone(this.deps, repo);
    return { id: repo.id };
  }
}

export { RepoService };
export type { RepoServiceDeps, RepoServiceEnv };
