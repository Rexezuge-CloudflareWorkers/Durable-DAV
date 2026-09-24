import { EnvParser } from '../EnvParser';
import {
  DEFAULT_CHECK_CUSTOMJS_ENABLED,
  DEFAULT_CHECK_CUSTOMJS_MAX_CPU_MS,
  DEFAULT_CHECK_CUSTOMJS_MAX_FETCHES,
  DEFAULT_CHECK_CUSTOMJS_MAX_SCRIPT_BYTES,
  DEFAULT_CHECK_CUSTOMJS_MEMORY_MB,
  DEFAULT_CHECK_RETENTION_DAYS,
  DEFAULT_CHECK_TIMEOUT_SECONDS,
  DEFAULT_IMPORT_CLAIM_STALE_SECONDS,
  DEFAULT_MAX_DEPLOY_KEYS_PER_REPO,
  DEFAULT_MAX_EXPORT_BYTES,
  DEFAULT_MAX_ASSETS_PER_RELEASE,
  DEFAULT_MAX_ASSET_BYTES,
  DEFAULT_MAX_CARDS_PER_COLUMN,
  DEFAULT_MAX_CHECKS_PER_SHA,
  DEFAULT_MAX_COLUMNS_PER_PROJECT,
  DEFAULT_MAX_DISCUSSIONS_PER_REPO,
  DEFAULT_MAX_IMPORT_BYTES,
  DEFAULT_MAX_IMPORT_REFS,
  DEFAULT_MAX_MIRROR_FAILURES,
  DEFAULT_MAX_PROJECTS_PER_REPO,
  DEFAULT_MAX_RELEASES_PER_REPO,
  DEFAULT_MAX_WIKI_BODY_BYTES,
  DEFAULT_MAX_WIKI_PAGES_PER_REPO,
} from '../ConfigurationDefaults';

// Domain-content limits (releases, projects, discussions, wiki, transfer,
// checks). Extracted from the `AppConfiguration` facade (god-file guard) —
// same `EnvParser` semantics, one method per setting.
class ContentLimits {
  constructor(private readonly env: unknown) {}

  public getMaxReleasesPerRepo(): number {
    return EnvParser.positiveInt(this.env, 'MAX_RELEASES_PER_REPO', DEFAULT_MAX_RELEASES_PER_REPO);
  }

  public getMaxAssetsPerRelease(): number {
    return EnvParser.positiveInt(this.env, 'MAX_ASSETS_PER_RELEASE', DEFAULT_MAX_ASSETS_PER_RELEASE);
  }

  public getMaxAssetBytes(): number {
    return EnvParser.positiveInt(this.env, 'MAX_ASSET_BYTES', DEFAULT_MAX_ASSET_BYTES);
  }

  public getMaxProjectsPerRepo(): number {
    return EnvParser.positiveInt(this.env, 'MAX_PROJECTS_PER_REPO', DEFAULT_MAX_PROJECTS_PER_REPO);
  }

  public getMaxColumnsPerProject(): number {
    return EnvParser.positiveInt(this.env, 'MAX_COLUMNS_PER_PROJECT', DEFAULT_MAX_COLUMNS_PER_PROJECT);
  }

  public getMaxCardsPerColumn(): number {
    return EnvParser.positiveInt(this.env, 'MAX_CARDS_PER_COLUMN', DEFAULT_MAX_CARDS_PER_COLUMN);
  }

  public getMaxDiscussionsPerRepo(): number {
    return EnvParser.positiveInt(this.env, 'MAX_DISCUSSIONS_PER_REPO', DEFAULT_MAX_DISCUSSIONS_PER_REPO);
  }

  public getMaxWikiPagesPerRepo(): number {
    return EnvParser.positiveInt(this.env, 'MAX_WIKI_PAGES_PER_REPO', DEFAULT_MAX_WIKI_PAGES_PER_REPO);
  }

  public getMaxWikiBodyBytes(): number {
    return EnvParser.positiveInt(this.env, 'MAX_WIKI_BODY_BYTES', DEFAULT_MAX_WIKI_BODY_BYTES);
  }

  public getMaxImportBytes(): number {
    return EnvParser.positiveInt(this.env, 'MAX_IMPORT_BYTES', DEFAULT_MAX_IMPORT_BYTES);
  }

  public getMaxImportRefs(): number {
    return EnvParser.positiveInt(this.env, 'MAX_IMPORT_REFS', DEFAULT_MAX_IMPORT_REFS);
  }

  public getMaxExportBytes(): number {
    return EnvParser.positiveInt(this.env, 'MAX_EXPORT_BYTES', DEFAULT_MAX_EXPORT_BYTES);
  }

  public getMaxDeployKeysPerRepo(): number {
    return EnvParser.positiveInt(this.env, 'MAX_DEPLOY_KEYS_PER_REPO', DEFAULT_MAX_DEPLOY_KEYS_PER_REPO);
  }

  public getMaxMirrorFailures(): number {
    return EnvParser.positiveInt(this.env, 'MAX_MIRROR_FAILURES', DEFAULT_MAX_MIRROR_FAILURES);
  }

  public getImportClaimStaleSeconds(): number {
    return EnvParser.positiveInt(this.env, 'IMPORT_CLAIM_STALE_SECONDS', DEFAULT_IMPORT_CLAIM_STALE_SECONDS);
  }

  public getMaxChecksPerSha(): number {
    return EnvParser.positiveInt(this.env, 'MAX_CHECKS_PER_SHA', DEFAULT_MAX_CHECKS_PER_SHA);
  }

  public getCheckTimeoutSeconds(): number {
    return EnvParser.positiveInt(this.env, 'CHECK_TIMEOUT_SECONDS', DEFAULT_CHECK_TIMEOUT_SECONDS);
  }

  public getCheckRetentionDays(): number {
    return EnvParser.positiveInt(this.env, 'CHECK_RETENTION_DAYS', DEFAULT_CHECK_RETENTION_DAYS);
  }

  public isCheckCustomJsEnabled(): boolean {
    return EnvParser.boolean(this.env, 'CHECK_CUSTOMJS_ENABLED', DEFAULT_CHECK_CUSTOMJS_ENABLED);
  }

  public getCheckCustomJsMaxCpuMs(): number {
    return EnvParser.positiveInt(this.env, 'CHECK_CUSTOMJS_MAX_CPU_MS', DEFAULT_CHECK_CUSTOMJS_MAX_CPU_MS);
  }

  public getCheckCustomJsMaxScriptBytes(): number {
    return EnvParser.positiveInt(this.env, 'CHECK_CUSTOMJS_MAX_SCRIPT_BYTES', DEFAULT_CHECK_CUSTOMJS_MAX_SCRIPT_BYTES);
  }

  public getCheckCustomJsMaxFetches(): number {
    return EnvParser.positiveInt(this.env, 'CHECK_CUSTOMJS_MAX_FETCHES', DEFAULT_CHECK_CUSTOMJS_MAX_FETCHES);
  }

  public getCheckCustomJsMemoryMb(): number {
    return EnvParser.positiveInt(this.env, 'CHECK_CUSTOMJS_MEMORY_MB', DEFAULT_CHECK_CUSTOMJS_MEMORY_MB);
  }
}

export { ContentLimits };
