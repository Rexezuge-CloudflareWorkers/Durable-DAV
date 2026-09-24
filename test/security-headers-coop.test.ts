import { describe, expect, it } from 'vitest';
import { SECURITY_HEADERS, isSensitiveJsonPath } from '@/middleware';

describe('security headers hardening', () => {
  it('includes cross-origin isolation headers', () => {
    expect(SECURITY_HEADERS['Cross-Origin-Opener-Policy']).toBe('same-origin');
    expect(SECURITY_HEADERS['Cross-Origin-Resource-Policy']).toBe('same-origin');
  });

  it('uses expanded permissions policy', () => {
    const policy = SECURITY_HEADERS['Permissions-Policy'];
    expect(policy).toContain('camera=()');
    expect(policy).toContain('microphone=()');
    expect(policy).toContain('payment=()');
    expect(policy).toContain('usb=()');
  });

  it('keeps baseline clickjacking/sniffing guards', () => {
    expect(SECURITY_HEADERS['X-Content-Type-Options']).toBe('nosniff');
    expect(SECURITY_HEADERS['X-Frame-Options']).toBe('DENY');
    expect(SECURITY_HEADERS['Referrer-Policy']).toBe('same-origin');
  });

  it('marks bearer-secret paths as sensitive', () => {
    expect(isSensitiveJsonPath('/user/tokens')).toBe(true);
    expect(isSensitiveJsonPath('/user/repos/a/b/hooks')).toBe(true);
    expect(isSensitiveJsonPath('/user/repos/a/b/hooks/h1/deliveries')).toBe(true);
    expect(isSensitiveJsonPath('/user/realtime/ticket')).toBe(true);
    expect(isSensitiveJsonPath('/health')).toBe(false);
  });

  it('marks private JSON paths as no-store to avoid cross-user cache leaks', () => {
    expect(isSensitiveJsonPath('/user/me')).toBe(true);
    expect(isSensitiveJsonPath('/user/repos')).toBe(true);
    expect(isSensitiveJsonPath('/user/repos/a/b')).toBe(true);
    expect(isSensitiveJsonPath('/user/audit')).toBe(true);
    expect(isSensitiveJsonPath('/user/orgs/acme/audit')).toBe(true);
    expect(isSensitiveJsonPath('/user/repos/a/b/issues')).toBe(true);
    expect(isSensitiveJsonPath('/user/repos/a/b/pulls/1')).toBe(true);
    expect(isSensitiveJsonPath('/repos/a/b/issues')).toBe(true);
    expect(isSensitiveJsonPath('/health')).toBe(false);
    expect(isSensitiveJsonPath('/search')).toBe(false);
  });
});
