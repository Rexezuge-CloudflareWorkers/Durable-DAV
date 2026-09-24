// Service bindings for the per-request composition root.
//
// Domain-grouped (Otter/AWS pattern): DAO thunks resolve once here, then
// `core` (identity/governance), `repo` (repo-domain + authz), and `content`
// (collaboration surfaces) bind their slice. Keeps each file under the
// god-file guard while preserving the single-PermissionService invariant.
import type {
  AuditLogDAO,
  BranchProtectionDAO,
  CheckRunDAO,
  CollaborationDAO,
  DavCollaboratorDAO,
  DavVolumeDAO,
  DeletedRepoDoDAO,
  DeployKeyDAO,
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
  RepoCollaboratorDAO,
  RepositoryDAO,
  SearchDAO,
  SecuritySettingsDAO,
  SnippetDAO,
  StarDAO,
  TeamDAO,
  TeamMemberDAO,
  TeamRepoGrantDAO,
  TokenRepoGrantDAO,
  TokenVolumeGrantDAO,
  UserAccessTokenDAO,
  UserDAO,
  WatchDAO,
  WebhookDAO,
  WebhookDeliveryDAO,
  WikiDAO,
} from '@duradav/backend-data/dao';
import type { Container, Token } from '@duradav/backend-runtime/di';
import { Tokens } from './tokens';
import type { RequestScopeEnv } from './serviceFactory';
import type { DaoThunks } from './serviceBindings/daoThunks';
import { bindContentServices } from './serviceBindings/contentServices';
import { bindCoreServices } from './serviceBindings/coreServices';
import { bindRepoServices } from './serviceBindings/repoServices';

function bindServiceBindings(scope: Container, env: RequestScopeEnv): void {
  const getDao = <T>(token: Token<() => Promise<T>>): (() => Promise<T>) => scope.get(token);

  const daos: DaoThunks = {
    repositoryDAO: getDao<RepositoryDAO>(Tokens.RepositoryDAO),
    issueDAO: getDao<IssueDAO>(Tokens.IssueDAO),
    pullRequestDAO: getDao<PullRequestDAO>(Tokens.PullRequestDAO),
    pullThreadDAO: getDao<PullThreadDAO>(Tokens.PullThreadDAO),
    branchProtectionDAO: getDao<BranchProtectionDAO>(Tokens.BranchProtectionDAO),
    userDAO: getDao<UserDAO>(Tokens.UserDAO),
    organizationDAO: getDao<OrganizationDAO>(Tokens.OrganizationDAO),
    organizationMemberDAO: getDao<OrganizationMemberDAO>(Tokens.OrganizationMemberDAO),
    repoCollaboratorDAO: getDao<RepoCollaboratorDAO>(Tokens.RepoCollaboratorDAO),
    namespaceDAO: getDao<NamespaceDAO>(Tokens.NamespaceDAO),
    numberingDAO: getDao<NumberingDAO>(Tokens.NumberingDAO),
    starDAO: getDao<StarDAO>(Tokens.StarDAO),
    watchDAO: getDao<WatchDAO>(Tokens.WatchDAO),
    eventDAO: getDao<EventDAO>(Tokens.EventDAO),
    notificationDAO: getDao<NotificationDAO>(Tokens.NotificationDAO),
    webhookDAO: getDao<WebhookDAO>(Tokens.WebhookDAO),
    webhookDeliveryDAO: getDao<WebhookDeliveryDAO>(Tokens.WebhookDeliveryDAO),
    releaseDAO: getDao<ReleaseDAO>(Tokens.ReleaseDAO),
    projectDAO: getDao<ProjectDAO>(Tokens.ProjectDAO),
    discussionDAO: getDao<DiscussionDAO>(Tokens.DiscussionDAO),
    wikiDAO: getDao<WikiDAO>(Tokens.WikiDAO),
    snippetDAO: getDao<SnippetDAO>(Tokens.SnippetDAO),
    teamDAO: getDao<TeamDAO>(Tokens.TeamDAO),
    teamMemberDAO: getDao<TeamMemberDAO>(Tokens.TeamMemberDAO),
    teamGrantDAO: getDao<TeamRepoGrantDAO>(Tokens.TeamRepoGrantDAO),
    auditLogDAO: getDao<AuditLogDAO>(Tokens.AuditLogDAO),
    importDAO: getDao<ImportDAO>(Tokens.ImportDAO),
    mirrorDAO: getDao<MirrorDAO>(Tokens.MirrorDAO),
    deployKeyDAO: getDao<DeployKeyDAO>(Tokens.DeployKeyDAO),
    deletedRepoDoDAO: getDao<DeletedRepoDoDAO>(Tokens.DeletedRepoDoDAO),
    tokenDAO: getDao<UserAccessTokenDAO>(Tokens.UserAccessTokenDAO),
    checkRunDAO: getDao<CheckRunDAO>(Tokens.CheckRunDAO),
    collaborationDAO: getDao<CollaborationDAO>(Tokens.CollaborationDAO),
    searchDAO: getDao<SearchDAO>(Tokens.SearchDAO),
    tokenGrantDAO: getDao<TokenRepoGrantDAO>(Tokens.TokenRepoGrantDAO),
    tokenVolumeGrantDAO: getDao<TokenVolumeGrantDAO>(Tokens.TokenVolumeGrantDAO),
    securitySettingsDAO: getDao<SecuritySettingsDAO>(Tokens.SecuritySettingsDAO),
    davVolumeDAO: getDao<DavVolumeDAO>(Tokens.DavVolumeDAO),
    davCollaboratorDAO: getDao<DavCollaboratorDAO>(Tokens.DavCollaboratorDAO),
  };

  bindCoreServices(scope, { env, daos });
  bindRepoServices(scope, { env, daos });
  bindContentServices(scope, { env, daos });
}

export { bindServiceBindings };
