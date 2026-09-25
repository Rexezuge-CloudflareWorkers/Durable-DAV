import { describe, expect, it } from 'vitest';
import { AppConfiguration } from '@durable-dav/backend-runtime/config';
import { DavLimits } from '@durable-dav/backend-runtime/config';
import { VolumeLimits } from '@durable-dav/backend-runtime/config';

describe('DAV configuration (hardened defaults)', () => {
  it('defaults file uploads to 50MB (matches wrangler template)', () => {
    expect(AppConfiguration.fromEnv({}).getMaxFileBytes()).toBe(52_428_800);
  });

  it('honors explicit env overrides', () => {
    const config = AppConfiguration.fromEnv({ MAX_FILE_BYTES: '1024', MAX_VOLUMES_PER_USER: '3', DO_DEVICE_BYTES: '1024' });
    expect(config.getMaxFileBytes()).toBe(1024);
    expect(config.getMaxVolumesPerUser()).toBe(3);
    expect(config.getDoDeviceBytes()).toBe(1024);
  });

  it('falls back to defaults on malformed values (fail-open parsing)', () => {
    const config = AppConfiguration.fromEnv({ MAX_FILE_BYTES: 'banana' });
    expect(config.getMaxFileBytes()).toBe(52_428_800);
  });

  it('reports malformed numeric vars via validate() (fail-fast audit)', () => {
    expect(AppConfiguration.fromEnv({}).validate()).toEqual([]);
    const warnings = AppConfiguration.fromEnv({ MAX_FILE_BYTES: 'banana', DO_DEVICE_BYTES: '0' }).validate();
    expect(warnings).toContain('Invalid configuration: MAX_FILE_BYTES must be a positive integer');
    expect(warnings).toContain('Invalid configuration: DO_DEVICE_BYTES must be a positive integer');
  });

  it('prefers DAV_CACHE_TTL_SECONDS with GIT fallback (Git-template compat)', () => {
    expect(new DavLimits({}).getDavCacheTtlSeconds()).toBe(300);
    expect(new DavLimits({ DAV_CACHE_TTL_SECONDS: '120' }).getDavCacheTtlSeconds()).toBe(120);
    expect(new DavLimits({ GIT_CACHE_TTL_SECONDS: '60' }).getDavCacheTtlSeconds()).toBe(60);
    expect(new DavLimits({ DAV_CACHE_TTL_SECONDS: '120', GIT_CACHE_TTL_SECONDS: '60' }).getDavCacheTtlSeconds()).toBe(120);
  });

  it('exposes volume + credential quotas', () => {
    const limits = new VolumeLimits({ MAX_VOLUMES_PER_USER: '7', MAX_CREDENTIALS_PER_VOLUME: '3' });
    expect(limits.getMaxVolumesPerUser()).toBe(7);
    expect(limits.getMaxCredentialsPerVolume()).toBe(3);
    expect(new VolumeLimits({}).getDefaultCredentialExpiryDays()).toBe(365);
    expect(new VolumeLimits({}).getMaxCredentialExpiryDays()).toBe(365);
  });
});
