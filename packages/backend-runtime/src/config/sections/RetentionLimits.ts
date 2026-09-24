import { EnvParser } from '../EnvParser';
import {
  DEFAULT_AUDIT_LOG_RETENTION_DAYS,
  DEFAULT_BACKGROUND_TASK_RUN_RETENTION_DAYS,
  DEFAULT_SEARCH_BACKFILL_FILES_PER_REPO,
  DEFAULT_SEARCH_BACKFILL_INTERVAL_SECONDS,
  DEFAULT_SEARCH_BACKFILL_REPOS_PER_TICK,
} from '../ConfigurationDefaults';

// Processing / retention limits (background pruning, audit retention,
// code-search backfill). Extracted from the `AppConfiguration` facade
// (god-file guard) — mirrors the `ConfigurationManager.processing` namespace.
class RetentionLimits {
  constructor(private readonly env: unknown) {}

  public getTaskRunRetentionDays(): number {
    return EnvParser.positiveInt(this.env, 'BACKGROUND_TASK_RUN_RETENTION_DAYS', DEFAULT_BACKGROUND_TASK_RUN_RETENTION_DAYS);
  }

  public getAuditLogRetentionDays(): number {
    return EnvParser.positiveInt(this.env, 'AUDIT_LOG_RETENTION_DAYS', DEFAULT_AUDIT_LOG_RETENTION_DAYS);
  }

  public getSearchBackfillIntervalSeconds(): number {
    return EnvParser.positiveInt(this.env, 'SEARCH_BACKFILL_INTERVAL_SECONDS', DEFAULT_SEARCH_BACKFILL_INTERVAL_SECONDS);
  }

  public getSearchBackfillReposPerTick(): number {
    return EnvParser.positiveInt(this.env, 'SEARCH_BACKFILL_REPOS_PER_TICK', DEFAULT_SEARCH_BACKFILL_REPOS_PER_TICK);
  }

  public getSearchBackfillFilesPerRepo(): number {
    return EnvParser.positiveInt(this.env, 'SEARCH_BACKFILL_FILES_PER_REPO', DEFAULT_SEARCH_BACKFILL_FILES_PER_REPO);
  }
}

export { RetentionLimits };
