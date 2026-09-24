// Shared DAO thunk bundle for domain service-binding groups.
//
// Keeps `serviceBindings/*` signatures small: each group receives the
// pre-resolved DAO thunks + env instead of re-resolving ~30 tokens.
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
  UserAccessTokenDAO,
  UserDAO,
  WatchDAO,
  WebhookDAO,
  WebhookDeliveryDAO,
  WikiDAO,
} from '@duradav/backend-data/dao';
import type { RequestScopeEnv } from '../serviceFactory';

interface DaoThunks {
  repositoryDAO: () => Promise<RepositoryDAO>;
  issueDAO: () => Promise<IssueDAO>;
  pullRequestDAO: () => Promise<PullRequestDAO>;
  pullThreadDAO: () => Promise<PullThreadDAO>;
  branchProtectionDAO: () => Promise<BranchProtectionDAO>;
  userDAO: () => Promise<UserDAO>;
  organizationDAO: () => Promise<OrganizationDAO>;
  organizationMemberDAO: () => Promise<OrganizationMemberDAO>;
  repoCollaboratorDAO: () => Promise<RepoCollaboratorDAO>;
  namespaceDAO: () => Promise<NamespaceDAO>;
  numberingDAO: () => Promise<NumberingDAO>;
  starDAO: () => Promise<StarDAO>;
  watchDAO: () => Promise<WatchDAO>;
  eventDAO: () => Promise<EventDAO>;
  notificationDAO: () => Promise<NotificationDAO>;
  webhookDAO: () => Promise<WebhookDAO>;
  webhookDeliveryDAO: () => Promise<WebhookDeliveryDAO>;
  releaseDAO: () => Promise<ReleaseDAO>;
  projectDAO: () => Promise<ProjectDAO>;
  discussionDAO: () => Promise<DiscussionDAO>;
  wikiDAO: () => Promise<WikiDAO>;
  snippetDAO: () => Promise<SnippetDAO>;
  teamDAO: () => Promise<TeamDAO>;
  teamMemberDAO: () => Promise<TeamMemberDAO>;
  teamGrantDAO: () => Promise<TeamRepoGrantDAO>;
  auditLogDAO: () => Promise<AuditLogDAO>;
  importDAO: () => Promise<ImportDAO>;
  mirrorDAO: () => Promise<MirrorDAO>;
  deployKeyDAO: () => Promise<DeployKeyDAO>;
  deletedRepoDoDAO: () => Promise<DeletedRepoDoDAO>;
  tokenDAO: () => Promise<UserAccessTokenDAO>;
  checkRunDAO: () => Promise<CheckRunDAO>;
  collaborationDAO: () => Promise<CollaborationDAO>;
  searchDAO: () => Promise<SearchDAO>;
  tokenGrantDAO: () => Promise<TokenRepoGrantDAO>;
  securitySettingsDAO: () => Promise<SecuritySettingsDAO>;
  davVolumeDAO: () => Promise<DavVolumeDAO>;
  davCollaboratorDAO: () => Promise<DavCollaboratorDAO>;
}

interface ServiceGroupContext {
  env: RequestScopeEnv;
  daos: DaoThunks;
}

export type { DaoThunks, ServiceGroupContext };
