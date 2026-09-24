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
import type { D1Queryable } from '@duradav/backend-data/utils';
import type { Token } from '@duradav/backend-runtime/di';
import type { AppConfiguration } from '@duradav/backend-runtime/config';
import type { KvCache } from '@duradav/backend-runtime/kv';
import type { AccessAuthService } from '../auth/AccessAuthService';
import type { TokenService } from '../auth/TokenService';
import type { CheckService } from '../checks/CheckService';
import type { WebhookDeliveryService } from '../webhook/WebhookDeliveryService';
import type { WebhookService } from '../webhook/WebhookService';
import type { BranchProtectionService } from '../protection/BranchProtectionService';
import type { DiscussionService } from '../discussion/DiscussionService';
import type { ForkService } from '../fork/ForkService';
import type { ProjectService } from '../project/ProjectService';
import type { RepoService } from '../repo/RepoService';
import type { SnippetService } from '../snippet/SnippetService';
import type { UserService } from '../user/UserService';
import type { WikiService } from '../wiki/WikiService';
import type { IssueService } from '../issue/IssueService';
import type { PullRequestService } from '../pull/PullRequestService';
import type { PullThreadService } from '../pull/PullThreadService';
import type { OrganizationService } from '../org/OrganizationService';
import type { TeamService } from '../team/TeamService';
import type { DeployKeyService } from '../deploykey/DeployKeyService';
import type { SecuritySettingsService } from '../security/SecuritySettingsService';
import type { AuditService } from '../audit/AuditService';
import type { AuditObserverRegistry } from '../audit/AuditObserver';
import type { DomainEventBus } from '../events/DomainEventBus';
import type { IdentityResolver } from '../identity/IdentityResolver';
import type { PermissionService } from '../permission/PermissionService';
import type { DavPermissionService } from '../dav/DavPermissionService';
import type { VolumeService } from '../dav/VolumeService';
import type { SearchService } from '../search/SearchService';
import type { ActivityService } from '../social/ActivityService';
import type { NotificationService } from '../social/NotificationService';
import type { StarService } from '../social/StarService';
import type { WatchService } from '../social/WatchService';
import type { CollaborationService } from '../collab/CollaborationService';
import type { ReleaseService } from '../release/ReleaseService';
import type { RealtimeService } from '../realtime/RealtimeService';

// Central token registry for the per-request composition root
// (`requestScope.ts`). Call sites resolve services via
// `scope.get(Tokens.RepoService)` instead of `new X(env)`.
//
// Tokens carry their value type (`Token<T>`) so `scope.get(...)` infers the
// service type without an explicit generic at call sites.
interface RequestScopeEnvShape {
  DB: D1Queryable;
  WEBHOOK_ENCRYPTION_KEY_SECRET?: { get(): Promise<string> };
  MIRROR_ENCRYPTION_KEY_SECRET?: { get(): Promise<string> };
  IMPORT_ENCRYPTION_KEY_SECRET?: { get(): Promise<string> };
  WEBHOOK_ENCRYPTION_KEY?: string;
  MIRROR_ENCRYPTION_KEY?: string;
  IMPORT_ENCRYPTION_KEY?: string;
}

interface RequestKeysShape {
  webhookKey: string;
  mirrorKey: string;
  importKey: string;
}

const Tokens = {
  Env: Symbol('Env') as Token<RequestScopeEnvShape>,
  Db: Symbol('Db') as Token<D1Queryable>,
  KvCache: Symbol('KvCache') as Token<KvCache>,
  Keys: Symbol('Keys') as Token<() => Promise<RequestKeysShape>>,
  WebhookKey: Symbol('WebhookKey') as Token<() => Promise<string>>,
  MirrorKey: Symbol('MirrorKey') as Token<() => Promise<string>>,
  ImportKey: Symbol('ImportKey') as Token<() => Promise<string>>,
  AppConfig: Symbol('AppConfig') as Token<AppConfiguration>,
  UserDAO: Symbol('UserDAO') as Token<() => Promise<UserDAO>>,
  RepositoryDAO: Symbol('RepositoryDAO') as Token<() => Promise<RepositoryDAO>>,
  UserAccessTokenDAO: Symbol('UserAccessTokenDAO') as Token<() => Promise<UserAccessTokenDAO>>,
  IssueDAO: Symbol('IssueDAO') as Token<() => Promise<IssueDAO>>,
  PullRequestDAO: Symbol('PullRequestDAO') as Token<() => Promise<PullRequestDAO>>,
  PullThreadDAO: Symbol('PullThreadDAO') as Token<() => Promise<PullThreadDAO>>,
  NamespaceDAO: Symbol('NamespaceDAO') as Token<() => Promise<NamespaceDAO>>,
  NumberingDAO: Symbol('NumberingDAO') as Token<() => Promise<NumberingDAO>>,
  OrganizationDAO: Symbol('OrganizationDAO') as Token<() => Promise<OrganizationDAO>>,
  OrganizationMemberDAO: Symbol('OrganizationMemberDAO') as Token<() => Promise<OrganizationMemberDAO>>,
  RepoCollaboratorDAO: Symbol('RepoCollaboratorDAO') as Token<() => Promise<RepoCollaboratorDAO>>,
  BranchProtectionDAO: Symbol('BranchProtectionDAO') as Token<() => Promise<BranchProtectionDAO>>,
  CheckRunDAO: Symbol('CheckRunDAO') as Token<() => Promise<CheckRunDAO>>,
  CollaborationDAO: Symbol('CollaborationDAO') as Token<() => Promise<CollaborationDAO>>,
  SearchDAO: Symbol('SearchDAO') as Token<() => Promise<SearchDAO>>,
  StarDAO: Symbol('StarDAO') as Token<() => Promise<StarDAO>>,
  WatchDAO: Symbol('WatchDAO') as Token<() => Promise<WatchDAO>>,
  EventDAO: Symbol('EventDAO') as Token<() => Promise<EventDAO>>,
  NotificationDAO: Symbol('NotificationDAO') as Token<() => Promise<NotificationDAO>>,
  WebhookDAO: Symbol('WebhookDAO') as Token<() => Promise<WebhookDAO>>,
  WebhookDeliveryDAO: Symbol('WebhookDeliveryDAO') as Token<() => Promise<WebhookDeliveryDAO>>,
  ReleaseDAO: Symbol('ReleaseDAO') as Token<() => Promise<ReleaseDAO>>,
  ProjectDAO: Symbol('ProjectDAO') as Token<() => Promise<ProjectDAO>>,
  DiscussionDAO: Symbol('DiscussionDAO') as Token<() => Promise<DiscussionDAO>>,
  WikiDAO: Symbol('WikiDAO') as Token<() => Promise<WikiDAO>>,
  SnippetDAO: Symbol('SnippetDAO') as Token<() => Promise<SnippetDAO>>,
  TeamDAO: Symbol('TeamDAO') as Token<() => Promise<TeamDAO>>,
  TeamMemberDAO: Symbol('TeamMemberDAO') as Token<() => Promise<TeamMemberDAO>>,
  TeamRepoGrantDAO: Symbol('TeamRepoGrantDAO') as Token<() => Promise<TeamRepoGrantDAO>>,
  AuditLogDAO: Symbol('AuditLogDAO') as Token<() => Promise<AuditLogDAO>>,
  ImportDAO: Symbol('ImportDAO') as Token<() => Promise<ImportDAO>>,
  MirrorDAO: Symbol('MirrorDAO') as Token<() => Promise<MirrorDAO>>,
  DeployKeyDAO: Symbol('DeployKeyDAO') as Token<() => Promise<DeployKeyDAO>>,
  DeletedRepoDoDAO: Symbol('DeletedRepoDoDAO') as Token<() => Promise<DeletedRepoDoDAO>>,
  TokenRepoGrantDAO: Symbol('TokenRepoGrantDAO') as Token<() => Promise<TokenRepoGrantDAO>>,
  SecuritySettingsDAO: Symbol('SecuritySettingsDAO') as Token<() => Promise<SecuritySettingsDAO>>,
  AccessAuthService: Symbol('AccessAuthService') as Token<AccessAuthService>,
  TokenService: Symbol('TokenService') as Token<TokenService>,
  CheckService: Symbol('CheckService') as Token<CheckService>,
  BranchProtectionService: Symbol('BranchProtectionService') as Token<BranchProtectionService>,
  ForkService: Symbol('ForkService') as Token<ForkService>,
  RepoService: Symbol('RepoService') as Token<RepoService>,
  UserService: Symbol('UserService') as Token<UserService>,
  IssueService: Symbol('IssueService') as Token<IssueService>,
  PullRequestService: Symbol('PullRequestService') as Token<PullRequestService>,
  PullThreadService: Symbol('PullThreadService') as Token<PullThreadService>,
  OrganizationService: Symbol('OrganizationService') as Token<OrganizationService>,
  TeamService: Symbol('TeamService') as Token<TeamService>,
  AuditService: Symbol('AuditService') as Token<AuditService>,
  AuditObserverRegistry: Symbol('AuditObserverRegistry') as Token<AuditObserverRegistry>,
  DomainEventBus: Symbol('DomainEventBus') as Token<DomainEventBus>,
  IdentityResolver: Symbol('IdentityResolver') as Token<IdentityResolver>,
  PermissionService: Symbol('PermissionService') as Token<PermissionService>,
  DavPermissionService: Symbol('DavPermissionService') as Token<DavPermissionService>,
  VolumeService: Symbol('VolumeService') as Token<VolumeService>,
  DavVolumeDAO: Symbol('DavVolumeDAO') as Token<() => Promise<DavVolumeDAO>>,
  DavCollaboratorDAO: Symbol('DavCollaboratorDAO') as Token<() => Promise<DavCollaboratorDAO>>,
  SearchService: Symbol('SearchService') as Token<SearchService>,
  StarService: Symbol('StarService') as Token<StarService>,
  WatchService: Symbol('WatchService') as Token<WatchService>,
  ActivityService: Symbol('ActivityService') as Token<ActivityService>,
  NotificationService: Symbol('NotificationService') as Token<NotificationService>,
  WebhookService: Symbol('WebhookService') as Token<WebhookService>,
  WebhookDeliveryService: Symbol('WebhookDeliveryService') as Token<WebhookDeliveryService>,
  CollaborationService: Symbol('CollaborationService') as Token<CollaborationService>,
  ReleaseService: Symbol('ReleaseService') as Token<ReleaseService>,
  RealtimeService: Symbol('RealtimeService') as Token<RealtimeService>,
  ProjectService: Symbol('ProjectService') as Token<ProjectService>,
  DiscussionService: Symbol('DiscussionService') as Token<DiscussionService>,
  WikiService: Symbol('WikiService') as Token<WikiService>,
  SnippetService: Symbol('SnippetService') as Token<SnippetService>,
  DeployKeyService: Symbol('DeployKeyService') as Token<DeployKeyService>,
  SecuritySettingsService: Symbol('SecuritySettingsService') as Token<SecuritySettingsService>,
} satisfies Record<string, Token<unknown>>;

export { Tokens };
