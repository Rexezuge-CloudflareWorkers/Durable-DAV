import type { Hono } from 'hono';
import { Tokens } from '@durable-dav/backend-services/composition';
import { BaseRoute } from '@/endpoints/IBaseRoute';
import { getVolumeStub } from '../doStubs';

type App = Hono<{ Bindings: Env; Variables: { AuthenticatedUserEmailAddress: string } }>;

function toVolumeJson(r: { owner: string; name: string; description: string | null; is_private: number }) {
  return {
    owner: r.owner,
    name: r.name,
    fullName: `${r.owner}/${r.name}`,
    description: r.description,
    isPrivate: Number(r.is_private) === 1,
    href: `/${r.owner}/${r.name}/`,
  };
}

function registerVolumeRoutes(app: App): void {
  // List buckets owned by the authenticated user.
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
    const rows = await dao.listByOwnerEmail(email, 100).catch(() => []);
    return c.json({ volumes: rows.map(toVolumeJson) });
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
    const body = (await c.req.json().catch(() => ({}))) as {
      owner?: string;
      name?: string;
      isPrivate?: boolean;
      description?: string | null;
    };
    if (!body.owner || !body.name) {
      return c.json({ Exception: { Type: 'BadRequest', Message: 'owner and name are required' } }, 400);
    }
    try {
      const created = await scope.get(Tokens.VolumeService).createVolume({
        owner: body.owner,
        name: body.name,
        description: body.description ?? null,
        isPrivate: body.isPrivate ?? true,
        creatorEmail: email,
      });
      const stub = getVolumeStub(c.env, created.owner, created.name);
      await stub.setVolumeKey(`${created.owner}/${created.name}`).catch(() => undefined);
      return c.json(toVolumeJson(created), 201);
    } catch (error) {
      return BaseRoute.toErrorResponse(c as never, error);
    }
  });

  // Per-bucket detail for the settings tab (owner-only).
  app.get('/user/volumes/:owner/:volume', async (c) => {
    const scope = BaseRoute.getScope(c);
    let email: string;
    try {
      email = await scope.get(Tokens.AccessAuthService).getAuthenticatedUserEmail(c.req.raw, c.executionCtx as never);
    } catch {
      return c.json({ Exception: { Type: 'Unauthorized', Message: 'Unauthorized' } }, 401);
    }
    const row = await scope.get(Tokens.VolumeService).getVolume(c.req.param('owner') ?? '', c.req.param('volume') ?? '').catch(() => null);
    if (!row) return c.json({ Exception: { Type: 'NotFound', Message: 'Volume not found' } }, 404);
    if (row.owner_email.toLowerCase() !== email.toLowerCase()) {
      return c.json({ Exception: { Type: 'Forbidden', Message: 'Forbidden' } }, 403);
    }
    return c.json(toVolumeJson(row));
  });

  // Per-bucket settings patch (description + isPrivate) — Git-style general card.
  app.patch('/user/volumes/:owner/:volume', async (c) => {
    const scope = BaseRoute.getScope(c);
    let email: string;
    try {
      email = await scope.get(Tokens.AccessAuthService).getAuthenticatedUserEmail(c.req.raw, c.executionCtx as never);
    } catch {
      return c.json({ Exception: { Type: 'Unauthorized', Message: 'Unauthorized' } }, 401);
    }
    const body = (await c.req.json().catch(() => ({}))) as { description?: string | null; isPrivate?: boolean };
    const patch: { description?: string | null; isPrivate?: boolean } = {};
    if ('description' in body) patch.description = body.description ?? null;
    if ('isPrivate' in body) patch.isPrivate = body.isPrivate;
    try {
      const updated = await scope
        .get(Tokens.VolumeService)
        .updateVolume(c.req.param('owner') ?? '', c.req.param('volume') ?? '', email, patch);
      return c.json(toVolumeJson(updated));
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
    if (row.owner_email.toLowerCase() !== email.toLowerCase()) {
      return c.json({ Exception: { Type: 'Forbidden', Message: 'Forbidden' } }, 403);
    }
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
