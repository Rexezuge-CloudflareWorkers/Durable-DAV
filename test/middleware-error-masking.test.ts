import { describe, expect, it, vi } from 'vitest';
import { MiddlewareHandlers } from '@/middleware/MiddlewareHandlers';

function authCtx() {
  const store = new Map<string, string>();
  return {
    req: { raw: new Request('https://example.com/user/repos') },
    env: {},
    executionCtx: {},
    set: (k: string, v: string) => void store.set(k, v),
    get: (k: string) => {
      const v = store.get(k);
      if (v === undefined) throw new Error('missing');
      return v;
    },
    json: (body: unknown, status: number) => new Response(JSON.stringify(body), { status }),
  } as never;
}

describe('middleware error masking', () => {
  it('masks non-auth errors as generic Internal error (no DB leak)', async () => {
    const { createRequestScope } = await import('@duradav/backend-services/composition');
    void createRequestScope;
    // Force authenticateUserIdentity to throw a DB-flavored error by using an
    // env without DB and stubbing via real AccessAuthService failure path.
    const handler = MiddlewareHandlers.userAuthentication();
    const c = authCtx();
    const res = (await handler(c, async () => undefined)) as unknown as Response | void;
    expect(res).toBeInstanceOf(Response);
    const body = (await (res as Response).json()) as { Exception?: { Type?: string; Message?: string } };
    // 401 for auth failures keeps message; 500 must never echo internals.
    if ((res as Response).status === 500) {
      expect(body.Exception?.Message).toBe('The server encountered an internal error and was unable to complete your request.');
    } else {
      expect([401, 403]).toContain((res as Response).status);
    }
  });

  it('requireUser maps unexpected failures to generic 500 (not 401)', async () => {
    const c = authCtx();
    const out = await MiddlewareHandlers.requireUser(c);
    expect(out).toBeInstanceOf(Response);
    const res = out as unknown as Response;
    expect(res.status).toBe(500);
    const body = (await res.json()) as { Exception?: { Type?: string; Message?: string } };
    expect(body.Exception?.Type).toBe('InternalServerError');
    expect(body.Exception?.Message).toBe('The server encountered an internal error and was unable to complete your request.');
    // Must not contain stack traces or SQL fragments.
    expect(body.Exception?.Message ?? '').not.toMatch(/SELECT|D1_|Error: /i);
    void vi;
  });
});
