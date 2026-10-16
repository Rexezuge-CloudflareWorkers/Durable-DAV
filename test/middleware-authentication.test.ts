import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { Container, setRequestScope } from '@rexezuge/runtime';
import { Tokens } from '@durable-dav/backend-services/composition';
import { UnauthorizedError } from '@rexezuge/errors';
import { MiddlewareHandlers } from '../apps/api/src/middleware/MiddlewareHandlers';

/**
 * The `/user/*` authentication middleware: one resolution per request.
 *
 * The address is resolved to its account before any handler runs, so handlers
 * read an identity instead of re-running authentication. A failure answers in
 * the AWS envelope rather than throwing into `app.onError` as a masked 500.
 */
function buildApp(
  auth: { getAuthenticatedUserEmail: () => Promise<string> },
  upsert: (email: string) => Promise<{ id: string }>,
): Hono<{
  Bindings: Env;
  Variables: { AuthenticatedUserEmailAddress: string };
}> {
  const app = new Hono<{ Bindings: Env; Variables: { AuthenticatedUserEmailAddress: string } }>();
  app.use('*', async (c, next) => {
    const scope = new Container();
    scope.bindValue(Tokens.AccessAuthService, auth as never);
    scope.bindValue(Tokens.UserService, { upsertUser: upsert } as never);
    setRequestScope(c, scope);
    await next();
  });
  app.use('/user/*', MiddlewareHandlers.userAuthentication());
  app.get('/user/me', (c) => c.json({ email: c.get('AuthenticatedUserEmailAddress') }));
  return app;
}

// `app.request` without one throws on `c.executionCtx`, which the middleware
// reads for the platform-identity fallback. Production always has one.
const EXEC_CTX = {} as never;

describe('userAuthentication', () => {
  it('stores both the sign-in address and the account key, then continues', async () => {
    const app = buildApp({ getAuthenticatedUserEmail: () => Promise.resolve('Alice@Example.com') }, (email: string) =>
      Promise.resolve({ id: 'usr_alice', email }),
    );
    const res = await app.request('https://h/user/me', {}, {} as never, EXEC_CTX);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ email: 'Alice@Example.com' });
  });

  it('answers 401 in the AWS envelope when authentication fails', async () => {
    const app = buildApp(
      {
        getAuthenticatedUserEmail: () => Promise.reject(new UnauthorizedError('Cloudflare Access authentication failed.')),
      },
      () => Promise.resolve({ id: 'usr_alice' }),
    );
    const res = await app.request('https://h/user/me', {}, {} as never, EXEC_CTX);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { Exception: { Type: string } };
    expect(body.Exception.Type).toBe('Unauthorized');
  });
});
