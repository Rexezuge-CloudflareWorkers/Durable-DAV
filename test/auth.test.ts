import { describe, expect, it } from 'vitest';
import { AccessAuthService } from '@durable-dav/backend-services/auth';

describe('AccessAuthService', () => {
  it('returns DEV_AUTH_EMAIL bypass', async () => {
    const svc = new AccessAuthService({ ENVIRONMENT: 'development', DEV_AUTH_EMAIL: 'dev@example.com' });
    await expect(svc.getAuthenticatedUserEmail(new Request('https://example.com/'))).resolves.toBe('dev@example.com');
  });

  it('falls back to platform identity when vars unset', async () => {
    const svc = new AccessAuthService({});
    const req = new Request('https://example.com/');
    await expect(
      svc.getAuthenticatedUserEmail(req, { access: { getIdentity: async () => ({ email: 'user@example.com' }) } }),
    ).resolves.toBe('user@example.com');
  });

  it('rejects missing JWT with no platform identity', async () => {
    const svc = new AccessAuthService({});
    await expect(svc.getAuthenticatedUserEmail(new Request('https://example.com/'))).rejects.toThrow();
  });

  it('never trusts spoofed Cf-Access-Authenticated-User-Email header', async () => {
    const svc = new AccessAuthService({});
    const req = new Request('https://example.com/', { headers: { 'Cf-Access-Authenticated-User-Email': 'spoof@example.com' } });
    await expect(svc.getAuthenticatedUserEmail(req)).rejects.toThrow();
  });
});
