import { EnvParser } from './EnvParser';
import { DEFAULT_DEBUG_MODE, DEFAULT_SITE_URL } from './ConfigurationDefaults';

import { AuthConfig } from './sections/AuthConfig';
import { ContentLimits } from './sections/ContentLimits';
import { GitLimits } from './sections/GitLimits';
import { RetentionLimits } from './sections/RetentionLimits';
import { RealtimeLimits } from './sections/RealtimeLimits';
import { RepoLimits } from './sections/RepoLimits';
import { WebhookLimits } from './sections/WebhookLimits';

/**
 * Injectable instance view over Edge-Git environment configuration.
 *
 * Composed of focused section objects (`RepoLimits`, `GitLimits`,
 * `WebhookLimits`, `RealtimeLimits`, `ContentLimits`, `RetentionLimits`,
 * `AuthConfig`) so the god-file stays a thin facade. `ConfigurationManager`
 * statics delegate here for backward compatibility. New code should accept
 * `AppConfiguration` via constructor injection so env parsing is stubbable.
 *
 * NOTE: the remaining one-line delegates are intentional — they are the
 * injectable seam backing `ConfigurationManager` statics and unit-test
 * doubles. They carry no branching (cognitive complexity ~0); do not
 * re-inline `EnvParser` calls at call sites to "shrink" this file.
 */
class AppConfiguration {
  private readonly repos: RepoLimits;
  private readonly git: GitLimits;
  private readonly webhooks: WebhookLimits;
  private readonly realtime: RealtimeLimits;
  private readonly content: ContentLimits;
  private readonly retention: RetentionLimits;
  private readonly auth: AuthConfig;

  constructor(private readonly env: unknown) {
    this.repos = new RepoLimits(env);
    this.git = new GitLimits(env);
    this.webhooks = new WebhookLimits(env);
    this.realtime = new RealtimeLimits(env);
    this.content = new ContentLimits(env);
    this.retention = new RetentionLimits(env);
    this.auth = new AuthConfig(env);
  }

  public static fromEnv(env: unknown): AppConfiguration {
    return new AppConfiguration(env);
  }

  public get repo(): RepoLimits {
    return this.repos;
  }

  public get gitLimits(): GitLimits {
    return this.git;
  }

  public get webhook(): WebhookLimits {
    return this.webhooks;
  }

  public get realtimeLimits(): RealtimeLimits {
    return this.realtime;
  }

  public get contentLimits(): ContentLimits {
    return this.content;
  }

  public get retentionLimits(): RetentionLimits {
    return this.retention;
  }

  public get authConfig(): AuthConfig {
    return this.auth;
  }

  public getDebugMode(): boolean {
    return EnvParser.boolean(this.env, 'DEBUG_MODE', DEFAULT_DEBUG_MODE);
  }

  public getSiteUrl(): string {
    let url = EnvParser.string(this.env, 'SITE_URL', DEFAULT_SITE_URL);
    while (url.endsWith('/')) url = url.slice(0, -1);
    return url;
  }

  public getMaxReposPerUser(): number {
    return this.repos.getMaxReposPerUser();
  }

  public getMaxVolumesPerUser(): number {
    return this.repos.getMaxVolumesPerUser();
  }

  public getMaxTokensPerUser(): number {
    return this.repos.getMaxTokensPerUser();
  }

  public getMaxTokenExpiryDays(): number {
    return this.repos.getMaxTokenExpiryDays();
  }

  public getMaxPackObjects(): number {
    return this.git.getMaxPackObjects();
  }

  public getGitCacheTtlSeconds(): number {
    return this.git.getGitCacheTtlSeconds();
  }

  public getMaxFetchWants(): number {
    return this.git.getMaxFetchWants();
  }

  public getMaxFetchHaves(): number {
    return this.git.getMaxFetchHaves();
  }

  public getMaxPushCommands(): number {
    return this.git.getMaxPushCommands();
  }

  public getMaxPackBytes(): number {
    return this.git.getMaxPackBytes();
  }

  public getMaxFetchBodyBytes(): number {
    return this.git.getMaxFetchBodyBytes();
  }

  public getMaxMergeDiffFiles(): number {
    return this.git.getMaxMergeDiffFiles();
  }

  public getMaxFileBytes(): number {
    return this.git.getMaxFileBytes();
  }

  public getMaxRulesPerRepo(): number {
    return this.repos.getMaxRulesPerRepo();
  }

  public getTaskRunRetentionDays(): number {
    return this.retention.getTaskRunRetentionDays();
  }

  public getSearchBackfillIntervalSeconds(): number {
    return this.retention.getSearchBackfillIntervalSeconds();
  }

  public getSearchBackfillReposPerTick(): number {
    return this.retention.getSearchBackfillReposPerTick();
  }

  public getSearchBackfillFilesPerRepo(): number {
    return this.retention.getSearchBackfillFilesPerRepo();
  }

  public getAuditLogRetentionDays(): number {
    return this.retention.getAuditLogRetentionDays();
  }

  public getMaxHooksPerRepo(): number {
    return this.webhooks.getMaxHooksPerRepo();
  }

  public getWebhookDeliveryRetentionDays(): number {
    return this.webhooks.getDeliveryRetentionDays();
  }

  public getWebhookMaxAttempts(): number {
    return this.webhooks.getMaxAttempts();
  }

  public getWebhookTimeoutMs(): number {
    return this.webhooks.getTimeoutMs();
  }

  public getWebhookMaxConsecutiveFailures(): number {
    return this.webhooks.getMaxConsecutiveFailures();
  }

  public getWebhookMaxPayloadBytes(): number {
    return this.webhooks.getMaxPayloadBytes();
  }

  public getMaxReleasesPerRepo(): number {
    return this.content.getMaxReleasesPerRepo();
  }

  public getMaxAssetsPerRelease(): number {
    return this.content.getMaxAssetsPerRelease();
  }

  public getMaxAssetBytes(): number {
    return this.content.getMaxAssetBytes();
  }

  public getMaxProjectsPerRepo(): number {
    return this.content.getMaxProjectsPerRepo();
  }

  public getMaxColumnsPerProject(): number {
    return this.content.getMaxColumnsPerProject();
  }

  public getMaxCardsPerColumn(): number {
    return this.content.getMaxCardsPerColumn();
  }

  public getMaxDiscussionsPerRepo(): number {
    return this.content.getMaxDiscussionsPerRepo();
  }

  public getMaxWikiPagesPerRepo(): number {
    return this.content.getMaxWikiPagesPerRepo();
  }

  public getMaxWikiBodyBytes(): number {
    return this.content.getMaxWikiBodyBytes();
  }

  public getMaxSnippetsPerUser(): number {
    return this.repos.getMaxSnippetsPerUser();
  }

  public getMaxFilesPerSnippet(): number {
    return this.repos.getMaxFilesPerSnippet();
  }

  public getMaxSnippetBytes(): number {
    return this.repos.getMaxSnippetBytes();
  }

  public getMaxTeamsPerOrg(): number {
    return this.repos.getMaxTeamsPerOrg();
  }

  public getMaxTeamMembers(): number {
    return this.repos.getMaxTeamMembers();
  }

  public getMaxTeamGrants(): number {
    return this.repos.getMaxTeamGrants();
  }

  public getMaxImportBytes(): number {
    return this.content.getMaxImportBytes();
  }

  public getMaxImportRefs(): number {
    return this.content.getMaxImportRefs();
  }

  public getMaxExportBytes(): number {
    return this.content.getMaxExportBytes();
  }

  public getMaxDeployKeysPerRepo(): number {
    return this.content.getMaxDeployKeysPerRepo();
  }

  public getMaxTokenVolumeGrants(): number {
    return this.repos.getMaxTokenVolumeGrants();
  }

  public getMaxTokenRepoGrants(): number {
    return this.repos.getMaxTokenRepoGrants();
  }

  public getDoDeviceBytes(): number {
    return this.repos.getDoDeviceBytes();
  }

  public getMaxMirrorFailures(): number {
    return this.content.getMaxMirrorFailures();
  }

  public getImportClaimStaleSeconds(): number {
    return this.content.getImportClaimStaleSeconds();
  }

  public getMaxChecksPerSha(): number {
    return this.content.getMaxChecksPerSha();
  }

  public getCheckTimeoutSeconds(): number {
    return this.content.getCheckTimeoutSeconds();
  }

  public getCheckRetentionDays(): number {
    return this.content.getCheckRetentionDays();
  }

  public isCheckCustomJsEnabled(): boolean {
    return this.content.isCheckCustomJsEnabled();
  }

  public getCheckCustomJsMaxCpuMs(): number {
    return this.content.getCheckCustomJsMaxCpuMs();
  }

  public getCheckCustomJsMaxScriptBytes(): number {
    return this.content.getCheckCustomJsMaxScriptBytes();
  }

  public getCheckCustomJsMaxFetches(): number {
    return this.content.getCheckCustomJsMaxFetches();
  }

  public getCheckCustomJsMemoryMb(): number {
    return this.content.getCheckCustomJsMemoryMb();
  }

  public isDemoMode(): boolean {
    return this.auth.isDemoMode();
  }

  public getEnvironment(): string {
    return this.auth.getEnvironment();
  }

  public isBypassAllowed(): boolean {
    return this.auth.isBypassAllowed();
  }

  public getDevAuthEmail(): string | null {
    return this.auth.getDevAuthEmail();
  }

  public getDemoUserEmail(): string | null {
    return this.auth.getDemoUserEmail();
  }

  public getTeamDomain(): string | null {
    return this.auth.getTeamDomain();
  }

  public getPolicyAud(): string | null {
    return this.auth.getPolicyAud();
  }

  public isRealtimeEnabled(): boolean {
    return this.realtime.isEnabled();
  }

  public getRealtimeTicketTtlSeconds(): number {
    return this.realtime.getTicketTtlSeconds();
  }

  public getRealtimeMaxConnPerRepoShard(): number {
    return this.realtime.getMaxConnPerRepoShard();
  }

  public getRealtimeMaxConnPerInboxShard(): number {
    return this.realtime.getMaxConnPerInboxShard();
  }

  /**
   * Fail-fast misconfiguration report (why: `EnvParser` silent fallback hid
   * typos like `MAX_PACK_OBJECTS=banana`). Returns human-readable warnings
   * for explicitly-set but malformed numeric vars; empty means clean.
   * Call at worker startup or in tests — never per-request (allocation-free
   * hot path stays untouched).
   */
  public validate(): string[] {
    const warnings: string[] = [];
    const numericKeys = [
      'MAX_REPOS_PER_USER',
      'MAX_VOLUMES_PER_USER',
      'MAX_TOKENS_PER_USER',
      'MAX_TOKEN_EXPIRY_DAYS',
      'MAX_PACK_OBJECTS',
      'GIT_CACHE_TTL_SECONDS',
      'MAX_FETCH_WANTS',
      'MAX_FETCH_HAVES',
      'MAX_PUSH_COMMANDS',
      'MAX_PACK_BYTES',
      'MAX_FETCH_BODY_BYTES',
      'DO_DEVICE_BYTES',
    ];
    for (const key of numericKeys) {
      if (!EnvParser.isValidPositiveInt(this.env, key)) {
        warnings.push(`Invalid configuration: ${key} must be a positive integer`);
      }
    }
    return warnings;
  }
}

export { AppConfiguration };
