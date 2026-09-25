import type { Hono } from 'hono';
import { Tokens } from '@durable-dav/backend-services/composition';
import { tokenIdSchema } from '@durable-dav/shared/validation';
import { BaseRoute } from '@/endpoints/IBaseRoute';

type TokenApp = Hono<{ Bindings: Env; Variables: { AuthenticatedUserEmailAddress: string } }>;

function scopeOf(c: { get(k: string): unknown; env: unknown }): ReturnType<typeof BaseRoute.getScope> {
  return BaseRoute.getScope(c);
}

function registerTokenRoutes(app: TokenApp): void {

  app.get('/user/tokens', async (c) => {
    const email = c.get('AuthenticatedUserEmailAddress');
    const svc = scopeOf(c as never).get(Tokens.TokenService);
    const tokens = await svc.listTokens(email);
    return c.json({
      tokens: tokens.map((t) => ({
        tokenId: t.tokenId,
        name: t.name,
        expiresAt: t.expiresAt,
        lastUsedAt: t.lastUsedAt,
        createdAt: t.createdAt,
        scopes: t.scopes,
        tokenPrefix: t.tokenPrefix,
        volumeGrants: t.volumeGrants ?? [],
      })),
    });
  });

  app.post('/user/tokens', async (c) => {
    const email = c.get('AuthenticatedUserEmailAddress');
    const body = (await c.req.json().catch(() => null)) as {
      name?: string;
      expiresInDays?: number;
      scopes?: unknown;
      volumeGrants?: unknown;
    } | null;
    if (!body) return c.json({ Exception: { Type: 'BadRequest', Message: 'Invalid JSON body' } }, 400);
    if (!body.name) return c.json({ Exception: { Type: 'BadRequest', Message: 'name is required' } }, 400);
    try {
      const svc = scopeOf(c as never).get(Tokens.TokenService);
      const created = await svc.createToken(email, body.name, body.expiresInDays, body.scopes, body.volumeGrants);
      return c.json(created, 201);
    } catch (error) {
      return BaseRoute.toErrorResponse(c as never, error);
    }
  });

  app.post('/user/tokens/:id/rotate', async (c) => {
    const email = c.get('AuthenticatedUserEmailAddress');
    if (!tokenIdSchema.safeParse(c.req.param('id')).success) {
      return c.json({ Exception: { Type: 'BadRequest', Message: 'Invalid token id' } }, 400);
    }
    try {
      const svc = scopeOf(c as never).get(Tokens.TokenService);
      const rotated = await svc.rotateToken(c.req.param('id'), email);
      return c.json(rotated, 201);
    } catch (error) {
      return BaseRoute.toErrorResponse(c as never, error);
    }
  });

  app.delete('/user/tokens/:id', async (c) => {
    const email = c.get('AuthenticatedUserEmailAddress');
    if (!tokenIdSchema.safeParse(c.req.param('id')).success) {
      return c.json({ Exception: { Type: 'BadRequest', Message: 'Invalid token id' } }, 400);
    }
    try {
      const svc = scopeOf(c as never).get(Tokens.TokenService);
      await svc.deleteToken(c.req.param('id'), email);
      return c.json({ ok: true });
    } catch (error) {
      return BaseRoute.toErrorResponse(c as never, error);
    }
  });
}

export { registerTokenRoutes };
