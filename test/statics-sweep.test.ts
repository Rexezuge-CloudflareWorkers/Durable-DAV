import { describe, expect, it } from 'vitest';
import { ConfigurationManager } from '@duradav/backend-runtime/config';

// Facade sweep (Slice 5): every `ConfigurationManager` static getter in one
// place. These one-line delegates were covered only when call sites happened
// to use the static form; most code injects `AppConfiguration` directly,
// leaving 9 statics at zero hits. Calling each with empty + override envs
// also locks default-vs-override parity with the instance facade.
describe('slice5: ConfigurationManager facade parity', () => {
  it('serves every namespace from defaults', () => {
    const env = {};
    expect(ConfigurationManager.auth.isDemoMode(env)).toBe(false);
    expect(ConfigurationManager.auth.getEnvironment(env)).toBe('production');
    expect(ConfigurationManager.auth.isBypassAllowed(env)).toBe(false);
    expect(ConfigurationManager.token.getMaxPerUser(env)).toBe(5);
    expect(ConfigurationManager.token.getMaxExpiryDays(env)).toBe(90);
    expect(ConfigurationManager.repo.getMaxPerUser(env)).toBe(100);
    expect(ConfigurationManager.repo.getDoDeviceBytes(env)).toBe(5 * 1024 * 1024 * 1024);
    expect(ConfigurationManager.repo.getMaxPackObjects(env)).toBe(10_000);
    expect(ConfigurationManager.repo.getCacheTtlSeconds(env)).toBe(3600);
    expect(ConfigurationManager.repo.getMaxFetchWants(env)).toBe(16);
    expect(ConfigurationManager.repo.getMaxFetchHaves(env)).toBe(100);
    expect(ConfigurationManager.repo.getMaxPushCommands(env)).toBe(100);
    expect(ConfigurationManager.repo.getMaxPackBytes(env)).toBe(52_428_800);
    expect(ConfigurationManager.repo.getMaxFetchBodyBytes(env)).toBe(1_048_576);
    expect(ConfigurationManager.repo.getMaxMergeDiffFiles(env)).toBe(500);
    expect(ConfigurationManager.repo.getMaxFileBytes(env)).toBe(1_048_576);
    expect(ConfigurationManager.repo.getMaxRulesPerRepo(env)).toBe(10);
    expect(ConfigurationManager.site.getSiteUrl(env)).toBe('');
    expect(ConfigurationManager.processing.getTaskRunRetentionDays(env)).toBe(30);
    expect(ConfigurationManager.processing.getAuditLogRetentionDays(env)).toBe(90);
    expect(ConfigurationManager.processing.getSearchBackfillIntervalSeconds(env)).toBe(14_400);
    expect(ConfigurationManager.processing.getSearchBackfillReposPerTick(env)).toBe(4);
    expect(ConfigurationManager.processing.getSearchBackfillFilesPerRepo(env)).toBe(25);
    expect(ConfigurationManager.webhooks.getMaxPerRepo(env)).toBe(10);
    expect(ConfigurationManager.webhooks.getDeliveryRetentionDays(env)).toBe(30);
    expect(ConfigurationManager.webhooks.getMaxAttempts(env)).toBe(5);
    expect(ConfigurationManager.webhooks.getTimeoutMs(env)).toBe(10_000);
    expect(ConfigurationManager.webhooks.getMaxConsecutiveFailures(env)).toBe(20);
    expect(ConfigurationManager.webhooks.getMaxPayloadBytes(env)).toBe(262_144);
    expect(ConfigurationManager.releases.getMaxPerRepo(env)).toBe(20);
    expect(ConfigurationManager.releases.getMaxAssetsPerRelease(env)).toBe(10);
    expect(ConfigurationManager.releases.getMaxAssetBytes(env)).toBe(26_214_400);
    expect(ConfigurationManager.collabSurfaces.getMaxProjectsPerRepo(env)).toBe(20);
    expect(ConfigurationManager.collabSurfaces.getMaxColumnsPerProject(env)).toBe(10);
    expect(ConfigurationManager.collabSurfaces.getMaxCardsPerColumn(env)).toBe(200);
    expect(ConfigurationManager.collabSurfaces.getMaxDiscussionsPerRepo(env)).toBe(2000);
    expect(ConfigurationManager.collabSurfaces.getMaxWikiPagesPerRepo(env)).toBe(100);
    expect(ConfigurationManager.collabSurfaces.getMaxWikiBodyBytes(env)).toBe(102_400);
    expect(ConfigurationManager.collabSurfaces.getMaxSnippetsPerUser(env)).toBe(100);
    expect(ConfigurationManager.collabSurfaces.getMaxFilesPerSnippet(env)).toBe(10);
    expect(ConfigurationManager.collabSurfaces.getMaxSnippetBytes(env)).toBe(102_400);
    expect(ConfigurationManager.teams.getMaxPerOrg(env)).toBe(20);
    expect(ConfigurationManager.teams.getMaxMembers(env)).toBe(100);
    expect(ConfigurationManager.teams.getMaxGrants(env)).toBe(100);
    expect(ConfigurationManager.transfer.getMaxImportBytes(env)).toBe(52_428_800);
    expect(ConfigurationManager.transfer.getMaxImportRefs(env)).toBe(2000);
    expect(ConfigurationManager.transfer.getMaxExportBytes(env)).toBe(26_214_400);
    expect(ConfigurationManager.transfer.getMaxDeployKeysPerRepo(env)).toBe(10);
    expect(ConfigurationManager.transfer.getMaxTokenRepoGrants(env)).toBe(50);
    expect(ConfigurationManager.transfer.getMaxMirrorFailures(env)).toBe(5);
    expect(ConfigurationManager.transfer.getImportClaimStaleSeconds(env)).toBe(600);
    expect(ConfigurationManager.getDebugMode(env)).toBe(false);
    expect(ConfigurationManager.checks.getMaxPerSha(env)).toBe(50);
    expect(ConfigurationManager.checks.getTimeoutSeconds(env)).toBe(3600);
    expect(ConfigurationManager.checks.getRetentionDays(env)).toBe(90);
    expect(ConfigurationManager.checks.isCustomJsEnabled(env)).toBe(true);
    expect(ConfigurationManager.checks.getCustomJsMaxCpuMs(env)).toBe(5000);
    expect(ConfigurationManager.checks.getCustomJsMaxScriptBytes(env)).toBe(65_536);
    expect(ConfigurationManager.checks.getCustomJsMaxFetches(env)).toBe(5);
    expect(ConfigurationManager.checks.getCustomJsMemoryMb(env)).toBe(16);
    expect(ConfigurationManager.realtime.isEnabled(env)).toBe(false);
    expect(ConfigurationManager.realtime.getTicketTtlSeconds(env)).toBe(30);
    expect(ConfigurationManager.realtime.getMaxConnPerRepoShard(env)).toBe(100);
    expect(ConfigurationManager.realtime.getMaxConnPerInboxShard(env)).toBe(1000);
  });

  it('honors overrides', () => {
    const env = {
      MAX_REPOS_PER_USER: '3',
      DO_DEVICE_BYTES: '456',
      CHECK_CUSTOMJS_ENABLED: 'false',
      REALTIME_ENABLED: 'true',
      DEBUG_MODE: 'true',
      SITE_URL: 'https://example.com/',
    };
    expect(ConfigurationManager.repo.getMaxPerUser(env)).toBe(3);
    expect(ConfigurationManager.repo.getDoDeviceBytes(env)).toBe(456);
    expect(ConfigurationManager.checks.isCustomJsEnabled(env)).toBe(false);
    expect(ConfigurationManager.realtime.isEnabled(env)).toBe(true);
    expect(ConfigurationManager.getDebugMode(env)).toBe(true);
    expect(ConfigurationManager.site.getSiteUrl(env)).toBe('https://example.com');
  });
});
