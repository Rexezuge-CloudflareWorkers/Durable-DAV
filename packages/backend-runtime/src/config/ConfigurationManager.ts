import { AppConfiguration } from './AppConfiguration';

/**
 * Thin backward-compatible facade over `AppConfiguration`.
 * New code should inject `AppConfiguration` directly; statics remain so
 * existing call sites keep working while they migrate.
 */
class ConfigurationManager {
  public static readonly auth = {
    isDemoMode: (env: unknown): boolean => AppConfiguration.fromEnv(env).isDemoMode(),
    getEnvironment: (env: unknown): string => AppConfiguration.fromEnv(env).getEnvironment(),
    isBypassAllowed: (env: unknown): boolean => AppConfiguration.fromEnv(env).isBypassAllowed(),
  };

  public static readonly token = {
    getMaxPerUser: (env: unknown): number => AppConfiguration.fromEnv(env).getMaxTokensPerUser(),
    getMaxExpiryDays: (env: unknown): number => AppConfiguration.fromEnv(env).getMaxTokenExpiryDays(),
  };

  public static readonly davCredentials = {
    getMaxPerVolume: (env: unknown): number => AppConfiguration.fromEnv(env).getMaxCredentialsPerVolume(),
    getDefaultExpiryDays: (env: unknown): number => AppConfiguration.fromEnv(env).getDefaultCredentialExpiryDays(),
    getMaxExpiryDays: (env: unknown): number => AppConfiguration.fromEnv(env).getMaxCredentialExpiryDays(),
  };

  public static readonly repo = {
    getMaxPerUser: (env: unknown): number => AppConfiguration.fromEnv(env).getMaxReposPerUser(),    getDoDeviceBytes: (env: unknown): number => AppConfiguration.fromEnv(env).getDoDeviceBytes(),
    getMaxPackObjects: (env: unknown): number => AppConfiguration.fromEnv(env).getMaxPackObjects(),
    getCacheTtlSeconds: (env: unknown): number => AppConfiguration.fromEnv(env).getGitCacheTtlSeconds(),
    getMaxFetchWants: (env: unknown): number => AppConfiguration.fromEnv(env).getMaxFetchWants(),
    getMaxFetchHaves: (env: unknown): number => AppConfiguration.fromEnv(env).getMaxFetchHaves(),
    getMaxPushCommands: (env: unknown): number => AppConfiguration.fromEnv(env).getMaxPushCommands(),
    getMaxPackBytes: (env: unknown): number => AppConfiguration.fromEnv(env).getMaxPackBytes(),
    getMaxFetchBodyBytes: (env: unknown): number => AppConfiguration.fromEnv(env).getMaxFetchBodyBytes(),
    getMaxMergeDiffFiles: (env: unknown): number => AppConfiguration.fromEnv(env).getMaxMergeDiffFiles(),
    getMaxFileBytes: (env: unknown): number => AppConfiguration.fromEnv(env).getMaxFileBytes(),
    getMaxRulesPerRepo: (env: unknown): number => AppConfiguration.fromEnv(env).getMaxRulesPerRepo(),
  };

  public static readonly site = {
    getSiteUrl: (env: unknown): string => AppConfiguration.fromEnv(env).getSiteUrl(),
  };

  public static readonly processing = {
    getTaskRunRetentionDays: (env: unknown): number => AppConfiguration.fromEnv(env).getTaskRunRetentionDays(),
    getAuditLogRetentionDays: (env: unknown): number => AppConfiguration.fromEnv(env).getAuditLogRetentionDays(),
    getSearchBackfillIntervalSeconds: (env: unknown): number => AppConfiguration.fromEnv(env).getSearchBackfillIntervalSeconds(),
    getSearchBackfillReposPerTick: (env: unknown): number => AppConfiguration.fromEnv(env).getSearchBackfillReposPerTick(),
    getSearchBackfillFilesPerRepo: (env: unknown): number => AppConfiguration.fromEnv(env).getSearchBackfillFilesPerRepo(),
  };

  public static readonly webhooks = {
    getMaxPerRepo: (env: unknown): number => AppConfiguration.fromEnv(env).getMaxHooksPerRepo(),
    getDeliveryRetentionDays: (env: unknown): number => AppConfiguration.fromEnv(env).getWebhookDeliveryRetentionDays(),
    getMaxAttempts: (env: unknown): number => AppConfiguration.fromEnv(env).getWebhookMaxAttempts(),
    getTimeoutMs: (env: unknown): number => AppConfiguration.fromEnv(env).getWebhookTimeoutMs(),
    getMaxConsecutiveFailures: (env: unknown): number => AppConfiguration.fromEnv(env).getWebhookMaxConsecutiveFailures(),
    getMaxPayloadBytes: (env: unknown): number => AppConfiguration.fromEnv(env).getWebhookMaxPayloadBytes(),
  };

  public static readonly releases = {
    getMaxPerRepo: (env: unknown): number => AppConfiguration.fromEnv(env).getMaxReleasesPerRepo(),
    getMaxAssetsPerRelease: (env: unknown): number => AppConfiguration.fromEnv(env).getMaxAssetsPerRelease(),
    getMaxAssetBytes: (env: unknown): number => AppConfiguration.fromEnv(env).getMaxAssetBytes(),
  };

  public static readonly collabSurfaces = {
    getMaxProjectsPerRepo: (env: unknown): number => AppConfiguration.fromEnv(env).getMaxProjectsPerRepo(),
    getMaxColumnsPerProject: (env: unknown): number => AppConfiguration.fromEnv(env).getMaxColumnsPerProject(),
    getMaxCardsPerColumn: (env: unknown): number => AppConfiguration.fromEnv(env).getMaxCardsPerColumn(),
    getMaxDiscussionsPerRepo: (env: unknown): number => AppConfiguration.fromEnv(env).getMaxDiscussionsPerRepo(),
    getMaxWikiPagesPerRepo: (env: unknown): number => AppConfiguration.fromEnv(env).getMaxWikiPagesPerRepo(),
    getMaxWikiBodyBytes: (env: unknown): number => AppConfiguration.fromEnv(env).getMaxWikiBodyBytes(),
    getMaxSnippetsPerUser: (env: unknown): number => AppConfiguration.fromEnv(env).getMaxSnippetsPerUser(),
    getMaxFilesPerSnippet: (env: unknown): number => AppConfiguration.fromEnv(env).getMaxFilesPerSnippet(),
    getMaxSnippetBytes: (env: unknown): number => AppConfiguration.fromEnv(env).getMaxSnippetBytes(),
  };

  public static readonly teams = {
    getMaxPerOrg: (env: unknown): number => AppConfiguration.fromEnv(env).getMaxTeamsPerOrg(),
    getMaxMembers: (env: unknown): number => AppConfiguration.fromEnv(env).getMaxTeamMembers(),
    getMaxGrants: (env: unknown): number => AppConfiguration.fromEnv(env).getMaxTeamGrants(),
  };

  public static readonly transfer = {
    getMaxImportBytes: (env: unknown): number => AppConfiguration.fromEnv(env).getMaxImportBytes(),
    getMaxImportRefs: (env: unknown): number => AppConfiguration.fromEnv(env).getMaxImportRefs(),
    getMaxExportBytes: (env: unknown): number => AppConfiguration.fromEnv(env).getMaxExportBytes(),
    getMaxDeployKeysPerRepo: (env: unknown): number => AppConfiguration.fromEnv(env).getMaxDeployKeysPerRepo(),
    getMaxTokenVolumeGrants: (env: unknown): number => AppConfiguration.fromEnv(env).getMaxTokenVolumeGrants(),
    getMaxTokenRepoGrants: (env: unknown): number => AppConfiguration.fromEnv(env).getMaxTokenRepoGrants(),
    getMaxMirrorFailures: (env: unknown): number => AppConfiguration.fromEnv(env).getMaxMirrorFailures(),
    getImportClaimStaleSeconds: (env: unknown): number => AppConfiguration.fromEnv(env).getImportClaimStaleSeconds(),
  };

  public static readonly dav = {
    getMaxVolumesPerUser: (env: unknown): number => AppConfiguration.fromEnv(env).getMaxVolumesPerUser(),
    getMaxTokenVolumeGrants: (env: unknown): number => AppConfiguration.fromEnv(env).getMaxTokenVolumeGrants(),
    getCacheTtlSeconds: (env: unknown): number => AppConfiguration.fromEnv(env).getDavCacheTtlSeconds(),
  };

  public static getDebugMode(env: unknown): boolean {
    return AppConfiguration.fromEnv(env).getDebugMode();
  }

  public static readonly checks = {
    getMaxPerSha: (env: unknown): number => AppConfiguration.fromEnv(env).getMaxChecksPerSha(),
    getTimeoutSeconds: (env: unknown): number => AppConfiguration.fromEnv(env).getCheckTimeoutSeconds(),
    getRetentionDays: (env: unknown): number => AppConfiguration.fromEnv(env).getCheckRetentionDays(),
    isCustomJsEnabled: (env: unknown): boolean => AppConfiguration.fromEnv(env).isCheckCustomJsEnabled(),
    getCustomJsMaxCpuMs: (env: unknown): number => AppConfiguration.fromEnv(env).getCheckCustomJsMaxCpuMs(),
    getCustomJsMaxScriptBytes: (env: unknown): number => AppConfiguration.fromEnv(env).getCheckCustomJsMaxScriptBytes(),
    getCustomJsMaxFetches: (env: unknown): number => AppConfiguration.fromEnv(env).getCheckCustomJsMaxFetches(),
    getCustomJsMemoryMb: (env: unknown): number => AppConfiguration.fromEnv(env).getCheckCustomJsMemoryMb(),
  };

  public static readonly realtime = {
    isEnabled: (env: unknown): boolean => AppConfiguration.fromEnv(env).isRealtimeEnabled(),
    getTicketTtlSeconds: (env: unknown): number => AppConfiguration.fromEnv(env).getRealtimeTicketTtlSeconds(),
    getMaxConnPerRepoShard: (env: unknown): number => AppConfiguration.fromEnv(env).getRealtimeMaxConnPerRepoShard(),
    getMaxConnPerInboxShard: (env: unknown): number => AppConfiguration.fromEnv(env).getRealtimeMaxConnPerInboxShard(),
  };
}

export { ConfigurationManager };
