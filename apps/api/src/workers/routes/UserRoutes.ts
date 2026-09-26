import type { Hono } from 'hono';
import { Tokens } from '@durable-dav/backend-services/composition';
import { BaseRoute } from '@/endpoints/IBaseRoute';

type UserApp = Hono<{ Bindings: Env; Variables: { AuthenticatedUserEmailAddress: string } }>;

function registerUserProfileRoutes(app: UserApp): void {
  app.get('/user/me', async (c) => {
    const email = c.get('AuthenticatedUserEmailAddress');
    const scope = BaseRoute.getScope(c);
    const profile = await scope.get(Tokens.UserService).getProfileByEmail(email).catch(() => null);
    return c.json({ email, username: (profile as { username?: string } | null)?.username ?? null });
  });

  app.patch('/user/me/username', async (c) => {
    const email = c.get('AuthenticatedUserEmailAddress');
    const { malformed, oversized, body } = await BaseRoute.readJson<{ username?: string }>(c as never);
    if (oversized) return BaseRoute.jsonError(c as never, 'Payload too large', 413);
    if (malformed) return BaseRoute.jsonError(c as never, 'Invalid JSON body', 400);
    if (!body.username || typeof body.username !== 'string') {
      return BaseRoute.jsonError(c as never, 'username is required', 400);
    }
    try {
      const scope = BaseRoute.getScope(c);
      const before = await scope.get(Tokens.UserService).getProfileByEmail(email).catch(() => null);
      // Snapshot owned volumes BEFORE the D1 rename — afterwards `owner_ci`
      // already reads new, so a post-rename filter by the old name matches
      // nothing and the DO move silently never runs.
      const snapshot: Array<{ id: string; name: string }> = [];
      if (before?.username) {
        try {
          const dao = await scope.get(Tokens.DavVolumeDAO)();
          const rows = await dao.listByOwnerEmail(email, 1000).catch(() => []);
          const seen = new Set<string>();
          for (const row of rows) {
            if (!row.id || !row.name || seen.has(row.id)) continue;
            seen.add(row.id);
            snapshot.push({ id: row.id, name: row.name });
          }
        } catch {
          // ignore — empty snapshot still renames D1; DO move is skipped.
        }
      }
      const renamed = await scope.get(Tokens.UserService).renameUsername(email, body.username);
      // Fail-closed DO move: volume files + dead props are copied old→new
      // and the old isolate is purged only after the copy verifies. On copy
      // failure D1 is rolled back to the old handle and the request
      // surfaces 500 instead of an empty volume.
      if (before?.username && before.username.toLowerCase() !== renamed.username.toLowerCase()) {
        const moves = snapshot.map((volume) => ({
          id: volume.id,
          name: volume.name,
          oldFull: `${before.username as string}/${volume.name}`,
          newFull: `${renamed.username}/${volume.name}`,
        }));
        if (moves.length > 0) {
          const { moveVolumeDosForRename } = await import('./VolumeMove');
          try {
            await moveVolumeDosForRename(c.env, moves);
          } catch {
            await scope
              .get(Tokens.UserService)
              .renameUsername(email, before.username)
              .catch(() => undefined);
            return BaseRoute.jsonError(c as never, 'Failed to move volume data', 500);
          }
          try {
            const cache = scope.get(Tokens.KvCache);
            const { invalidateVolumeListCache, invalidateVolumeDetailCache, invalidateVolumeCaches } =
              await import('./DavReadCache');
            await invalidateVolumeListCache(cache, email);
            for (const move of moves) {
              const [oldOwner = '', oldVolume = ''] = move.oldFull.split('/', 2);
              const [newOwner = '', newVolume = ''] = move.newFull.split('/', 2);
              await invalidateVolumeDetailCache(cache, oldOwner, oldVolume);
              await invalidateVolumeCaches(cache, oldOwner, oldVolume);
              await invalidateVolumeDetailCache(cache, newOwner, newVolume);
              await invalidateVolumeCaches(cache, newOwner, newVolume);
            }
          } catch {
            // Best-effort cache invalidation; D1/DO are already consistent.
          }
        } else {
          try {
            const cache = scope.get(Tokens.KvCache);
            const { invalidateVolumeListCache } = await import('./DavReadCache');
            await invalidateVolumeListCache(cache, email);
          } catch {
            // ignore
          }
        }
      }
      const profile = await scope.get(Tokens.UserService).getProfileByEmail(email);
      return c.json({ email: profile.email, username: profile.username });
    } catch (error) {
      return BaseRoute.toErrorResponse(c as never, error);
    }
  });

  app.get('/users/:username', async (c) => {
    const username = c.req.param('username') ?? '';
    const scope = BaseRoute.getScope(c);
    try {
      const user = await scope.get(Tokens.UserService).getByUsername(username);
      return c.json({ username: (user as { username?: string })?.username ?? username });
    } catch (error) {
      return BaseRoute.toErrorResponse(c as never, error);
    }
  });
}

export { registerUserProfileRoutes };
