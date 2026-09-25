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

  public static readonly davCredentials = {
    getMaxPerVolume: (env: unknown): number => AppConfiguration.fromEnv(env).getMaxCredentialsPerVolume(),
    getDefaultExpiryDays: (env: unknown): number => AppConfiguration.fromEnv(env).getDefaultCredentialExpiryDays(),
    getMaxExpiryDays: (env: unknown): number => AppConfiguration.fromEnv(env).getMaxCredentialExpiryDays(),
  };

  public static readonly dav = {
    getMaxVolumesPerUser: (env: unknown): number => AppConfiguration.fromEnv(env).getMaxVolumesPerUser(),
    getMaxFileBytes: (env: unknown): number => AppConfiguration.fromEnv(env).getMaxFileBytes(),
    getDoDeviceBytes: (env: unknown): number => AppConfiguration.fromEnv(env).getDoDeviceBytes(),
    getCacheTtlSeconds: (env: unknown): number => AppConfiguration.fromEnv(env).getDavCacheTtlSeconds(),
  };

  public static readonly site = {
    getSiteUrl: (env: unknown): string => AppConfiguration.fromEnv(env).getSiteUrl(),
  };

  public static getDebugMode(env: unknown): boolean {
    return AppConfiguration.fromEnv(env).getDebugMode();
  }
}

export { ConfigurationManager };
