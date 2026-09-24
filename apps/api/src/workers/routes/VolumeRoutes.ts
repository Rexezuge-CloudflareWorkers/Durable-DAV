import type { Hono } from 'hono';
import { Tokens } from '@duradav/backend-services/composition';
import { BaseRoute } from '@/endpoints/IBaseRoute';
import { getVolumeStub } from '../doStubs';

type App = Hono<{ Bindings: Env; Variables: { AuthenticatedUserEmailAddress: string } }>;

function registerVolumeRoutes(app: App): void {
  // List volumes visible to the authenticated user (minimal JSON API for the browser UI).
  app.get('/user/volumes', async (c) => {
    const scope = BaseRoute.getScope(c);
    let email: string;
    try {
      email = await scope.get(Tokens.AccessAuthService).getAuthenticatedUserEmail(c.req.raw, c.executionCtx as never);
      await scope.get(Tokens.UserService).upsertUser(email).catch(() => undefined);
    } catch {
      return c.json({ Exception: { Type: 'Unauthorized', Message: 'Unauthorized' } }, 401);
    }
    const dao = await scope.get(Tokens.DavVolumeDAO)();
    const rows = await dao.listVisibleForUser(email, 100).catch(() => []);
    return c.json({
      volumes: rows.map((r) => ({
        owner: r.owner,
        name: r.name,
        isPrivate: Number(r.is_private) === 1,
        href: `/${r.owner}/${r.name}/`,
      })),
    });
  });

  app.post('/user/volumes', async (c) => {
    const scope = BaseRoute.getScope(c);
    let email: string;
    try {
      email = await scope.get(Tokens.AccessAuthService).getAuthenticatedUserEmail(c.req.raw, c.executionCtx as never);
      await scope.get(Tokens.UserService).upsertUser(email).catch(() => undefined);
    } catch {
      return c.json({ Exception: { Type: 'Unauthorized', Message: 'Unauthorized' } }, 401);
    }
    const body = (await c.req.json().catch(() => ({}))) as { owner?: string; name?: string; isPrivate?: boolean; description?: string | null };
    if (!body.owner || !body.name) {
      return c.json({ Exception: { Type: 'BadRequest', Message: 'owner and name are required' } }, 400);
    }
    try {
      const created = await scope.get(Tokens.VolumeService).createVolume({
        owner: body.owner,
        name: body.name,
        description: body.description ?? null,
        isPrivate: body.isPrivate ?? false,
        creatorEmail: email,
      });
      const stub = getVolumeStub(c.env, created.owner, created.name);
      await stub.setVolumeKey(`${created.owner}/${created.name}`).catch(() => undefined);
      return c.json({ owner: created.owner, name: created.name, href: `/${created.owner}/${created.name}/` }, 201);
    } catch (error) {
      return BaseRoute.toErrorResponse(c as never, error);
    }
  });

  app.delete('/user/volumes/:owner/:volume', async (c) => {
    const scope = BaseRoute.getScope(c);
    let email: string;
    try {
      email = await scope.get(Tokens.AccessAuthService).getAuthenticatedUserEmail(c.req.raw, c.executionCtx as never);
    } catch {
      return c.json({ Exception: { Type: 'Unauthorized', Message: 'Unauthorized' } }, 401);
    }
    const owner = c.req.param('owner') ?? '';
    const volume = c.req.param('volume') ?? '';
    const row = await scope.get(Tokens.VolumeService).getVolume(owner, volume).catch(() => null);
    if (!row) return c.json({ Exception: { Type: 'NotFound', Message: 'Volume not found' } }, 404);
    const role = await scope.get(Tokens.DavPermissionService).getRole(email, row);
    if (role !== 'admin') return c.json({ Exception: { Type: 'Forbidden', Message: 'Forbidden' } }, 403);
    await scope.get(Tokens.VolumeService).deleteVolume(owner, volume).catch(() => undefined);
    try {
      const stub = getVolumeStub(c.env, row.owner, row.name);
      await stub.deleteVolume().catch(() => undefined);
    } catch {
      // ignore DO cleanup failure; D1 row is already gone
    }
    return c.json({ ok: true });
  });
}

export { registerVolumeRoutes };
