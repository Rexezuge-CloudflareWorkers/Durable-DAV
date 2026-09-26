import type { Hono } from 'hono';
import { Tokens } from '@durable-dav/backend-services/composition';
import { BaseRoute } from '@/endpoints/IBaseRoute';
import { getVolumeStub } from '../doStubs';
import {
  cacheControlFor,
  getCachedVolumeDetail,
  getCachedVolumeList,
  invalidateVolumeCaches,
  invalidateVolumeDetailCache,
  invalidateVolumeListCache,
  putCachedVolumeDetail,
  putCachedVolumeList,
} from './DavReadCache';

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
  // List buckets owned by the authenticated user (KV-cached per email, 60s).
  app.get('/user/volumes', async (c) => {
    const scope = BaseRoute.getScope(c);
    let email: string;
    try {
      email = await scope.get(Tokens.AccessAuthService).getAuthenticatedUserEmail(c.req.raw, c.executionCtx as never);
      await scope.get(Tokens.UserService).upsertUser(email).catch(() => undefined);
    } catch {
      return c.json({ Exception: { Type: 'Unauthorized', Message: 'Unauthorized' } }, 401);
    }
    const cache = scope.get(Tokens.KvCache);
    try {
      const cached = await getCachedVolumeList<Array<ReturnType<typeof toVolumeJson>>>(cache, email);
      if (cached) {
        return c.json({ volumes: cached }, 200, { 'Cache-Control': cacheControlFor('meta') });
      }
    } catch {
      // Fail-soft: fall through to D1.
    }
    const dao = await scope.get(Tokens.DavVolumeDAO)();
    const rows = await dao.listByOwnerEmail(email, 100).catch(() => []);
    const volumes = rows.map(toVolumeJson);
    await putCachedVolumeList(cache, email, volumes);
    return c.json({ volumes }, 200, { 'Cache-Control': cacheControlFor('meta') });
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
      const cache = scope.get(Tokens.KvCache);
      await invalidateVolumeListCache(cache, email);
      await putCachedVolumeDetail(cache, created.owner, created.name, created);
      return c.json(toVolumeJson(created), 201);
    } catch (error) {
      return BaseRoute.toErrorResponse(c as never, error);
    }
  });

  // Per-bucket detail for the settings tab (owner-only, KV-cached 60s).
  app.get('/user/volumes/:owner/:volume', async (c) => {
    const scope = BaseRoute.getScope(c);
    let email: string;
    try {
      email = await scope.get(Tokens.AccessAuthService).getAuthenticatedUserEmail(c.req.raw, c.executionCtx as never);
    } catch {
      return c.json({ Exception: { Type: 'Unauthorized', Message: 'Unauthorized' } }, 401);
    }
    const cache = scope.get(Tokens.KvCache);
    try {
      const cached = await getCachedVolumeDetail<{
        owner: string;
        name: string;
        description: string | null;
        is_private: number;
        owner_email: string;
        id: string;
      }>(cache, c.req.param('owner') ?? '', c.req.param('volume') ?? '');
      if (cached && cached.owner_email.toLowerCase() === email.toLowerCase()) {
        return c.json(toVolumeJson(cached), 200, { 'Cache-Control': cacheControlFor('meta') });
      }
    } catch {
      // Fail-soft: fall through to the service.
    }
    const row = await scope.get(Tokens.VolumeService).getVolume(c.req.param('owner') ?? '', c.req.param('volume') ?? '').catch(() => null);
    if (!row) return c.json({ Exception: { Type: 'NotFound', Message: 'Volume not found' } }, 404);
    if (row.owner_email.toLowerCase() !== email.toLowerCase()) {
      return c.json({ Exception: { Type: 'Forbidden', Message: 'Forbidden' } }, 403);
    }
    await putCachedVolumeDetail(cache, row.owner, row.name, row);
    return c.json(toVolumeJson(row), 200, { 'Cache-Control': cacheControlFor('meta') });
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
      const cache = scope.get(Tokens.KvCache);
      await invalidateVolumeListCache(cache, email);
      await putCachedVolumeDetail(cache, updated.owner, updated.name, updated);
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
    // The D1 delete is the authoritative step. It must NOT be swallowed:
    // swallowing it let the route destroy the DO filesystem and answer
    // `{ok:true}` while the D1 row (and therefore the whole WebDAV surface)
    // survived — a "deleted" bucket that was still live.
    try {
      await scope.get(Tokens.VolumeService).deleteVolume(owner, volume);
    } catch (error) {
      return BaseRoute.toErrorResponse(c as never, error);
    }
    // DO cleanup is now pure garbage collection — the bucket is already gone
    // from D1, so a failure is safe to absorb, but the caller is told so it
    // can be retried/GC'd rather than silently leaving orphaned bytes.
    let doCleanupFailed = false;
    try {
      await getVolumeStub(c.env, row.owner, row.name).deleteVolume();
    } catch (error) {
      doCleanupFailed = true;
      console.error('Volume DO cleanup failed after D1 delete', {
        owner: row.owner,
        volume: row.name,
        error: error instanceof Error ? (error.stack ?? error.message) : error,
      });
    }
    const cache = scope.get(Tokens.KvCache);
    await invalidateVolumeListCache(cache, email);
    await invalidateVolumeDetailCache(cache, row.owner, row.name);
    await invalidateVolumeCaches(cache, row.owner, row.name);
    return c.json({ ok: true, doCleanupFailed });
  });
}

export { registerVolumeRoutes };
