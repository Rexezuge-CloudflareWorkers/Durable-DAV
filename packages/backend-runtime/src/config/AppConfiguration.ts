import { EnvParser } from './EnvParser';
import { DEFAULT_DEBUG_MODE, DEFAULT_SITE_URL } from './ConfigurationDefaults';

import { AuthConfig } from './sections/AuthConfig';
import { DavLimits } from './sections/DavLimits';
import { VolumeLimits } from './sections/VolumeLimits';

/**
 * Injectable instance view over Durable-DAV environment configuration.
 *
 * Composed of focused section objects (`VolumeLimits`, `DavLimits`,
 * `AuthConfig`) so the facade stays thin. `ConfigurationManager` statics
 * delegate here for backward compatibility. New code should accept
 * `AppConfiguration` via constructor injection so env parsing is stubbable.
 */
class AppConfiguration {
  private readonly volumes: VolumeLimits;
  private readonly dav: DavLimits;
  private readonly auth: AuthConfig;

  constructor(private readonly env: unknown) {
    this.volumes = new VolumeLimits(env);
    this.dav = new DavLimits(env);
    this.auth = new AuthConfig(env);
  }

  public static fromEnv(env: unknown): AppConfiguration {
    return new AppConfiguration(env);
  }

  public get volumeLimits(): VolumeLimits {
    return this.volumes;
  }

  public get davLimits(): DavLimits {
    return this.dav;
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

  public getMaxVolumesPerUser(): number {
    return this.volumes.getMaxVolumesPerUser();
  }

  public getMaxCredentialsPerVolume(): number {
    return this.volumes.getMaxCredentialsPerVolume();
  }

  public getDefaultCredentialExpiryDays(): number {
    return this.volumes.getDefaultCredentialExpiryDays();
  }

  public getMaxCredentialExpiryDays(): number {
    return this.volumes.getMaxCredentialExpiryDays();
  }

  public getDoDeviceBytes(): number {
    return this.volumes.getDoDeviceBytes();
  }

  public getDavCacheTtlSeconds(): number {
    return this.dav.getDavCacheTtlSeconds();
  }

  public getMaxFileBytes(): number {
    return this.dav.getMaxFileBytes();
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

  /**
   * Fail-fast misconfiguration report (why: `EnvParser` silent fallback hid
   * typos like `MAX_FILE_BYTES=banana`). Returns human-readable warnings
   * for explicitly-set but malformed numeric vars; empty means clean.
   * Call at worker startup or in tests — never per-request.
   */
  public validate(): string[] {
    const warnings: string[] = [];
    const numericKeys = [
      'MAX_VOLUMES_PER_USER',
      'MAX_CREDENTIALS_PER_VOLUME',
      'DEFAULT_CREDENTIAL_EXPIRY_DAYS',
      'MAX_CREDENTIAL_EXPIRY_DAYS',
      'MAX_FILE_BYTES',
      'DAV_CACHE_TTL_SECONDS',
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
