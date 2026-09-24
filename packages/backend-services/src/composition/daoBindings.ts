import {
  BranchProtectionDAO,
  CollaborationDAO,
  DiscussionDAO,
  IssueDAO,
  NamespaceDAO,
  OrganizationDAO,
  OrganizationMemberDAO,
  ProjectDAO,
  PullRequestDAO,
  PullThreadDAO,
  ReleaseDAO,
  RepoCollaboratorDAO,
  RepositoryDAO,
  SearchDAO,
  SnippetDAO,
  UserAccessTokenDAO,
  UserDAO,
  WikiDAO,
} from '@duradav/backend-data/dao';
import {
  AuditLogDAO,
  CheckRunDAO,
  DavCollaboratorDAO,
  DavVolumeDAO,
  DeletedRepoDoDAO,
  DeployKeyDAO,
  EventDAO,
  ImportDAO,
  MirrorDAO,
  NotificationDAO,
  NumberingDAO,
  SecuritySettingsDAO,
  StarDAO,
  TeamDAO,
  TeamMemberDAO,
  TeamRepoGrantDAO,
  TokenRepoGrantDAO,
  WatchDAO,
  WebhookDAO,
  WebhookDeliveryDAO,
} from '@duradav/backend-data/dao';
import { Container, memoizeAsync } from '@duradav/backend-runtime/di';
import type { Token } from '@duradav/backend-runtime/di';
import { Tokens } from './tokens';
import type { RequestScopeEnv } from './serviceFactory';

// Table-driven DAO wiring (Otter pattern). Each entry is keyed by its typed
// `Tokens.X` symbol directly — no stringly-typed lookup table and no
// `(Tokens as Record<...>)` cast. Each factory thunk is lazy + memoized via
// `memoizeAsync` so `createRequestScope` never touches a DAO constructor
// eagerly: unit tests with partial `vi.mock('@duradav/backend-data/dao')`
// modules keep working; only the DAOs a test actually resolves are built.
// D1 objects are cheap, but Secrets Store round-trips (via the per-feature
// key thunks) are not: each encrypted DAO resolves only its own key, so a
// webhook-only request never fetches the mirror/import keys.
function bindDaoBindings(scope: Container, env: RequestScopeEnv): void {
  const webhookKey = scope.get(Tokens.WebhookKey);
  const mirrorKey = scope.get(Tokens.MirrorKey);
  const importKey = scope.get(Tokens.ImportKey);
  // Encrypted DAOs fail closed: a missing binding throws from the key thunk
  // (no plaintext fallback since 0027 dropped the plaintext columns).
  const webhookDAO = async (): Promise<unknown> => new WebhookDAO(env.DB, await webhookKey());
  const mirrorDAO = async (): Promise<unknown> => new MirrorDAO(env.DB, await mirrorKey());
  const importDAO = async (): Promise<unknown> => new ImportDAO(env.DB, await importKey());
  const daoDefs: Array<[Token<() => Promise<unknown>>, () => Promise<unknown>]> = [
    [Tokens.UserDAO, () => Promise.resolve(new UserDAO(env.DB))],
    [Tokens.RepositoryDAO, () => Promise.resolve(new RepositoryDAO(env.DB))],
    [Tokens.UserAccessTokenDAO, () => Promise.resolve(new UserAccessTokenDAO(env.DB))],
    [Tokens.IssueDAO, () => Promise.resolve(new IssueDAO(env.DB))],
    [Tokens.PullRequestDAO, () => Promise.resolve(new PullRequestDAO(env.DB))],
    [Tokens.PullThreadDAO, () => Promise.resolve(new PullThreadDAO(env.DB))],
    [Tokens.NamespaceDAO, () => Promise.resolve(new NamespaceDAO(env.DB))],
    [Tokens.NumberingDAO, () => Promise.resolve(new NumberingDAO(env.DB))],
    [Tokens.OrganizationDAO, () => Promise.resolve(new OrganizationDAO(env.DB))],
    [Tokens.OrganizationMemberDAO, () => Promise.resolve(new OrganizationMemberDAO(env.DB))],
    [Tokens.RepoCollaboratorDAO, () => Promise.resolve(new RepoCollaboratorDAO(env.DB))],
    [Tokens.BranchProtectionDAO, () => Promise.resolve(new BranchProtectionDAO(env.DB))],
    [Tokens.CheckRunDAO, () => Promise.resolve(new CheckRunDAO(env.DB))],
    [Tokens.CollaborationDAO, () => Promise.resolve(new CollaborationDAO(env.DB))],
    [Tokens.SearchDAO, () => Promise.resolve(new SearchDAO(env.DB))],
    [Tokens.StarDAO, () => Promise.resolve(new StarDAO(env.DB))],
    [Tokens.WatchDAO, () => Promise.resolve(new WatchDAO(env.DB))],
    [Tokens.EventDAO, () => Promise.resolve(new EventDAO(env.DB))],
    [Tokens.NotificationDAO, () => Promise.resolve(new NotificationDAO(env.DB))],
    [Tokens.WebhookDAO, webhookDAO],
    [Tokens.WebhookDeliveryDAO, () => Promise.resolve(new WebhookDeliveryDAO(env.DB))],
    [Tokens.ReleaseDAO, () => Promise.resolve(new ReleaseDAO(env.DB))],
    [Tokens.ProjectDAO, () => Promise.resolve(new ProjectDAO(env.DB))],
    [Tokens.DiscussionDAO, () => Promise.resolve(new DiscussionDAO(env.DB))],
    [Tokens.WikiDAO, () => Promise.resolve(new WikiDAO(env.DB))],
    [Tokens.SnippetDAO, () => Promise.resolve(new SnippetDAO(env.DB))],
    [Tokens.TeamDAO, () => Promise.resolve(new TeamDAO(env.DB))],
    [Tokens.TeamMemberDAO, () => Promise.resolve(new TeamMemberDAO(env.DB))],
    [Tokens.TeamRepoGrantDAO, () => Promise.resolve(new TeamRepoGrantDAO(env.DB))],
    [Tokens.AuditLogDAO, () => Promise.resolve(new AuditLogDAO(env.DB))],
    [Tokens.ImportDAO, importDAO],
    [Tokens.MirrorDAO, mirrorDAO],
    [Tokens.DeployKeyDAO, () => Promise.resolve(new DeployKeyDAO(env.DB))],
    [Tokens.DeletedRepoDoDAO, () => Promise.resolve(new DeletedRepoDoDAO(env.DB))],
    [Tokens.TokenRepoGrantDAO, () => Promise.resolve(new TokenRepoGrantDAO(env.DB))],
    [Tokens.DavVolumeDAO, () => Promise.resolve(new DavVolumeDAO(env.DB))],
    [Tokens.DavCollaboratorDAO, () => Promise.resolve(new DavCollaboratorDAO(env.DB))],
    [Tokens.SecuritySettingsDAO, () => Promise.resolve(new SecuritySettingsDAO(env.DB))],
  ];
  for (const [token, create] of daoDefs) {
    scope.bindValue(token, memoizeAsync(create));
  }
}

export { bindDaoBindings };
