import {
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
} from '@duradav/backend-data/dao';
import { AppConfiguration } from '@duradav/backend-runtime/config';
import { PermissionService } from '../permission/PermissionService';
import type { RepoServiceDeps, RepoServiceEnv } from './RepoService';

/**
 * Default dependency factory for `RepoService` (Factory pattern).
 *
 * Why: the 27-thunk dependency literal was inlined in the constructor
 * (62 LOC), duplicating the composition root and hiding which defaults are
 * real DAOs vs intentional reject-stubs (`importDAO/mirrorDAO/webhookDAO`
 * require request-scope injection with per-feature encryption keys).
 * Centralizing here keeps `RepoService.ts` under the god-file guard and
 * makes the fail-closed stubs discoverable in one place.
 */
function createDefaultRepoServiceDeps(env: RepoServiceEnv, overrides: RepoServiceDeps = {}): Required<RepoServiceDeps> {
  const permissionService =
    overrides.permissionService ??
    ((): Promise<PermissionService> =>
      Promise.resolve(
        new PermissionService(env, {
          organizationDAO: overrides.organizationDAO ?? (() => Promise.resolve(new OrganizationDAO(env.DB))),
          organizationMemberDAO: overrides.organizationMemberDAO ?? (() => Promise.resolve(new OrganizationMemberDAO(env.DB))),
          repoCollaboratorDAO: overrides.repoCollaboratorDAO ?? (() => Promise.resolve(new RepoCollaboratorDAO(env.DB))),
          namespaceDAO: overrides.namespaceDAO ?? (() => Promise.resolve(new NamespaceDAO(env.DB))),
        }),
      ));
  // Lazy `PermissionService` avoids a circular import at module load:
  // `PermissionService` never imports `RepoService`, but both resolve via
  // the same `Tokens` container per request.
  return {
    repositoryDAO: () => Promise.resolve(new RepositoryDAO(env.DB)),
    issueDAO: () => Promise.resolve(new IssueDAO(env.DB)),
    pullRequestDAO: () => Promise.resolve(new PullRequestDAO(env.DB)),
    pullThreadDAO: () => Promise.resolve(new PullThreadDAO(env.DB)),
    branchProtectionDAO: () => Promise.resolve(new BranchProtectionDAO(env.DB)),
    userDAO: () => Promise.resolve(new UserDAO(env.DB)),
    organizationDAO: () => Promise.resolve(new OrganizationDAO(env.DB)),
    organizationMemberDAO: () => Promise.resolve(new OrganizationMemberDAO(env.DB)),
    repoCollaboratorDAO: () => Promise.resolve(new RepoCollaboratorDAO(env.DB)),
    namespaceDAO: () => Promise.resolve(new NamespaceDAO(env.DB)),
    starDAO: () => Promise.resolve(new StarDAO(env.DB)),
    watchDAO: () => Promise.resolve(new WatchDAO(env.DB)),
    eventDAO: () => Promise.resolve(new EventDAO(env.DB)),
    notificationDAO: () => Promise.resolve(new NotificationDAO(env.DB)),
    releaseDAO: () => Promise.resolve(new ReleaseDAO(env.DB)),
    projectDAO: () => Promise.resolve(new ProjectDAO(env.DB)),
    discussionDAO: () => Promise.resolve(new DiscussionDAO(env.DB)),
    wikiDAO: () => Promise.resolve(new WikiDAO(env.DB)),
    importDAO: () => Promise.reject<ImportDAO>(new Error('RepoService requires an injected importDAO outside request scope.')),
    mirrorDAO: () => Promise.reject<MirrorDAO>(new Error('RepoService requires an injected mirrorDAO outside request scope.')),
    deployKeyDAO: () => Promise.resolve(new DeployKeyDAO(env.DB)),
    deletedRepoDoDAO: () => Promise.resolve(new DeletedRepoDoDAO(env.DB)),
    numberingDAO: () => Promise.resolve(new NumberingDAO(env.DB)),
    searchDAO: () => Promise.resolve(new SearchDAO(env.DB)),
    tokenGrantDAO: () => Promise.resolve(new TokenRepoGrantDAO(env.DB)),
    securitySettingsDAO: () => Promise.resolve(new SecuritySettingsDAO(env.DB)),
    collaborationDAO: () => Promise.resolve(new CollaborationDAO(env.DB)),
    webhookDAO: () => Promise.reject<WebhookDAO>(new Error('RepoService requires an injected webhookDAO outside request scope.')),
    webhookDeliveryDAO: () => Promise.resolve(new WebhookDeliveryDAO(env.DB)),
    auditLogDAO: () => Promise.resolve(new AuditLogDAO(env.DB)),
    teamGrantDAO: () => Promise.resolve(new TeamRepoGrantDAO(env.DB)),
    checkRunDAO: () => Promise.resolve(new CheckRunDAO(env.DB)),
    permissionService,
    config: AppConfiguration.fromEnv(env),
    ...overrides,
  };
}

export { createDefaultRepoServiceDeps };
