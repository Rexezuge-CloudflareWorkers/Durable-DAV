import { describe, expect, it } from 'vitest';
import { DeployKeyService } from '@duradav/backend-services/deploykey';

function fakeDao(opts: { count?: number; rows?: Array<Record<string, unknown>> } = {}) {
  return {
    countByRepo: async () => opts.count ?? 0,
    create: async () => undefined,
    listByRepo: async () => opts.rows ?? [],
  } as never;
}

const env = { DB: {} } as never;

describe('DeployKeyService hardening', () => {
  it('normalizePermission defaults to read, rejects unknown', () => {
    expect(DeployKeyService.normalizePermission(undefined)).toBe('read');
    expect(DeployKeyService.normalizePermission(null)).toBe('read');
    expect(DeployKeyService.normalizePermission('read')).toBe('read');
    expect(DeployKeyService.normalizePermission('write')).toBe('write');
    expect(() => DeployKeyService.normalizePermission('owner')).toThrow();
    expect(() => DeployKeyService.normalizePermission('')).toThrow();
  });

  it('rejects empty/overlong names', async () => {
    const svc = new DeployKeyService(env, { deployKeyDAO: async () => fakeDao() });
    await expect(svc.createKey('r1', '', 'read', 'a@example.com')).rejects.toThrow();
    await expect(svc.createKey('r1', 'x'.repeat(101), 'read', 'a@example.com')).rejects.toThrow();
  });

  it('enforces max keys per repo', async () => {
    const svc = new DeployKeyService({ DB: {}, MAX_DEPLOY_KEYS_PER_REPO: '1' } as never, {
      deployKeyDAO: async () => fakeDao({ count: 1 }),
    });
    await expect(svc.createKey('r1', 'k', 'read', 'a@example.com')).rejects.toThrow(/Maximum 1/);
  });

  it('rejects out-of-range expiresInDays', async () => {
    const svc = new DeployKeyService(env, { deployKeyDAO: async () => fakeDao() });
    await expect(svc.createKey('r1', 'k', 'read', 'a@example.com', 0)).rejects.toThrow();
    await expect(svc.createKey('r1', 'k', 'read', 'a@example.com', 9999)).rejects.toThrow();
  });

  it('hashKey is namespaced (differs from PAT hash)', async () => {
    const svc = new (await import('@duradav/backend-services/auth')).TokenService({ DB: {} } as never);
    void svc;
    const deployHash = await DeployKeyService.hashKey('secret');
    const { CryptoUtil } = await import('@duradav/shared/utils');
    const patHash = await CryptoUtil.sha256Hex('duradav-pat:secret');
    expect(deployHash).not.toBe(patHash);
    expect(deployHash).toHaveLength(64);
  });
});
