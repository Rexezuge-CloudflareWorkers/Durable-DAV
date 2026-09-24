import type {
  AuditLogDAO,
  BranchProtectionDAO,
  CheckRunDAO,
  CollaborationDAO,
  DeployKeyDAO,
  DiscussionDAO,
  EventDAO,
  ImportDAO,
  IssueDAO,
  MirrorDAO,
  NotificationDAO,
  NumberingDAO,
  ProjectDAO,
  PullRequestDAO,
  PullThreadDAO,
  ReleaseDAO,
  RepoCollaboratorDAO,
  SearchDAO,
  SecuritySettingsDAO,
  StarDAO,
  TeamRepoGrantDAO,
  TokenRepoGrantDAO,
  WatchDAO,
  WebhookDAO,
  WebhookDeliveryDAO,
  WikiDAO,
} from '@duradav/backend-data/dao';

// Best-effort sidecar cleanup for `RepoService.deleteRepo`, split out of
// `RepoService.ts` to stay under the god-file guard. Each step tolerates
// legacy DBs missing the table (matched by `isMissingTableError`). Issues
// are hard-required (v1 tables); the rest degrade silently by design so a
// legacy DB never blocks repo deletion — but unexpected failures are logged
// so partial deletes stay debuggable (Observer pattern: caller owns retry).
function isMissingTableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /no such table|does not exist|not found|prepare is not a function/i.test(message);
}
interface RepoCleanupDeps {
  issueDAO: () => Promise<IssueDAO>;
  pullRequestDAO: () => Promise<PullRequestDAO>;
  pullThreadDAO: () => Promise<PullThreadDAO>;
  branchProtectionDAO: () => Promise<BranchProtectionDAO>;
  repoCollaboratorDAO: () => Promise<RepoCollaboratorDAO>;
  starDAO: () => Promise<StarDAO>;
  watchDAO: () => Promise<WatchDAO>;
  eventDAO: () => Promise<EventDAO>;
  notificationDAO: () => Promise<NotificationDAO>;
  releaseDAO: () => Promise<ReleaseDAO>;
  projectDAO: () => Promise<ProjectDAO>;
  discussionDAO: () => Promise<DiscussionDAO>;
  wikiDAO: () => Promise<WikiDAO>;
  importDAO: () => Promise<ImportDAO>;
  mirrorDAO: () => Promise<MirrorDAO>;
  deployKeyDAO: () => Promise<DeployKeyDAO>;
  tokenGrantDAO: () => Promise<TokenRepoGrantDAO>;
  securitySettingsDAO: () => Promise<SecuritySettingsDAO>;
  collaborationDAO: () => Promise<CollaborationDAO>;
  webhookDAO: () => Promise<WebhookDAO>;
  webhookDeliveryDAO: () => Promise<WebhookDeliveryDAO>;
  auditLogDAO: () => Promise<AuditLogDAO>;
  teamGrantDAO: () => Promise<TeamRepoGrantDAO>;
  checkRunDAO: () => Promise<CheckRunDAO>;
  numberingDAO: () => Promise<NumberingDAO>;
  searchDAO: () => Promise<SearchDAO>;
}

async function cleanupRepoSidecars(deps: RepoCleanupDeps, repoId: string): Promise<void> {
  const issueDAO = await deps.issueDAO();
  await issueDAO.deleteByRepo(repoId);
  const factories: Array<() => Promise<{ deleteByRepo(repoId: string): Promise<unknown> }>> = [
    deps.pullRequestDAO,
    deps.pullThreadDAO,
    deps.branchProtectionDAO,
    deps.repoCollaboratorDAO,
    deps.starDAO,
    deps.watchDAO,
    deps.eventDAO,
    deps.notificationDAO,
    deps.releaseDAO,
    deps.projectDAO,
    deps.discussionDAO,
    deps.wikiDAO,
    deps.importDAO,
    deps.mirrorDAO,
    deps.deployKeyDAO,
    deps.tokenGrantDAO,
    deps.securitySettingsDAO,
    deps.collaborationDAO,
    deps.webhookDAO,
    deps.webhookDeliveryDAO,
    deps.auditLogDAO,
    deps.teamGrantDAO,
    deps.checkRunDAO,
    deps.numberingDAO,
    deps.searchDAO,
  ];
  for (const [index, factory] of factories.entries()) {
    try {
      const dao = await factory();
      await dao.deleteByRepo(repoId);
    } catch (error) {
      // Legacy DBs without the table are expected; anything else is a real
      // partial-delete risk — log it while still continuing best-effort.
      if (!isMissingTableError(error)) console.warn(`[WARN] [repoCleanup] sidecar[${index}] deleteByRepo failed: ${String(error)}`);
    }
  }
}

export { cleanupRepoSidecars };
export type { RepoCleanupDeps };
