import { EnvParser } from '../EnvParser';
import {
  DEFAULT_MAX_PACK_OBJECTS,
  DEFAULT_GIT_CACHE_TTL_SECONDS,
  DEFAULT_DAV_CACHE_TTL_SECONDS,
  DEFAULT_MAX_FETCH_WANTS,
  DEFAULT_MAX_FETCH_HAVES,
  DEFAULT_MAX_PUSH_COMMANDS,
  DEFAULT_MAX_PACK_BYTES,
  DEFAULT_MAX_FETCH_BODY_BYTES,
  DEFAULT_MAX_MERGE_DIFF_FILES,
  DEFAULT_MAX_FILE_BYTES,
} from '../ConfigurationDefaults';

// Git protocol / pack limits.
class GitLimits {
  constructor(private readonly env: unknown) {}

  public getMaxPackObjects(): number {
    return EnvParser.positiveInt(this.env, 'MAX_PACK_OBJECTS', DEFAULT_MAX_PACK_OBJECTS);
  }

  public getGitCacheTtlSeconds(): number {
    return this.getDavCacheTtlSeconds();
  }

  public getDavCacheTtlSeconds(): number {
    // New `DAV_CACHE_TTL_SECONDS` wins; legacy `GIT_CACHE_TTL_SECONDS`
    // (copy-paste from ../Git) still honored when explicitly set.
    const record = this.env as Record<string, string | undefined>;
    if (record['DAV_CACHE_TTL_SECONDS'] !== undefined) {
      return EnvParser.positiveInt(this.env, 'DAV_CACHE_TTL_SECONDS', DEFAULT_DAV_CACHE_TTL_SECONDS);
    }
    if (record['GIT_CACHE_TTL_SECONDS'] !== undefined) {
      return EnvParser.positiveInt(this.env, 'GIT_CACHE_TTL_SECONDS', DEFAULT_GIT_CACHE_TTL_SECONDS);
    }
    return EnvParser.positiveInt(this.env, 'DAV_CACHE_TTL_SECONDS', DEFAULT_DAV_CACHE_TTL_SECONDS);
  }

  public getMaxFetchWants(): number {
    return EnvParser.positiveInt(this.env, 'MAX_FETCH_WANTS', DEFAULT_MAX_FETCH_WANTS);
  }

  public getMaxFetchHaves(): number {
    return EnvParser.positiveInt(this.env, 'MAX_FETCH_HAVES', DEFAULT_MAX_FETCH_HAVES);
  }

  public getMaxPushCommands(): number {
    return EnvParser.positiveInt(this.env, 'MAX_PUSH_COMMANDS', DEFAULT_MAX_PUSH_COMMANDS);
  }

  public getMaxPackBytes(): number {
    return EnvParser.positiveInt(this.env, 'MAX_PACK_BYTES', DEFAULT_MAX_PACK_BYTES);
  }

  public getMaxFetchBodyBytes(): number {
    return EnvParser.positiveInt(this.env, 'MAX_FETCH_BODY_BYTES', DEFAULT_MAX_FETCH_BODY_BYTES);
  }

  public getMaxMergeDiffFiles(): number {
    return EnvParser.positiveInt(this.env, 'MAX_MERGE_DIFF_FILES', DEFAULT_MAX_MERGE_DIFF_FILES);
  }

  public getMaxFileBytes(): number {
    return EnvParser.positiveInt(this.env, 'MAX_FILE_BYTES', DEFAULT_MAX_FILE_BYTES);
  }
}

export { GitLimits };
