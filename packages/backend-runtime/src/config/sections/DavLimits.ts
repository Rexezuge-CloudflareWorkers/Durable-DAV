import { EnvParser } from '../EnvParser';
import { DEFAULT_DAV_CACHE_TTL_SECONDS, DEFAULT_MAX_FILE_BYTES } from '../ConfigurationDefaults';

// WebDAV transfer + front read-cache limits (Strategy: one section per
// config concern so `AppConfiguration` stays a thin Facade).
class DavLimits {
  constructor(private readonly env: unknown) {}

  public getDavCacheTtlSeconds(): number {
    // New `DAV_CACHE_TTL_SECONDS` wins; legacy `GIT_CACHE_TTL_SECONDS`
    // (copied from the Git template) still honored when explicitly set.
    const record = this.env as Record<string, string | undefined>;
    if (record['DAV_CACHE_TTL_SECONDS'] !== undefined) {
      return EnvParser.positiveInt(this.env, 'DAV_CACHE_TTL_SECONDS', DEFAULT_DAV_CACHE_TTL_SECONDS);
    }
    return record['GIT_CACHE_TTL_SECONDS'] === undefined ? EnvParser.positiveInt(this.env, 'DAV_CACHE_TTL_SECONDS', DEFAULT_DAV_CACHE_TTL_SECONDS) : EnvParser.positiveInt(this.env, 'GIT_CACHE_TTL_SECONDS', DEFAULT_DAV_CACHE_TTL_SECONDS);
  }

  public getMaxFileBytes(): number {
    return EnvParser.positiveInt(this.env, 'MAX_FILE_BYTES', DEFAULT_MAX_FILE_BYTES);
  }
}

export { DavLimits };
