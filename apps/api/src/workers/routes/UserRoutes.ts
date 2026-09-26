import { Tokens } from '@durable-dav/backend-services/composition';
import { BaseRoute } from '@/endpoints/IBaseRoute';
import type { ApiApp, ApiContext } from '@/types/ApiContext';
import { invalidateVolumeCaches, invalidateVolumeListCache } from './DavReadCache';
import { moveVolumeDosForRename, splitFull } from './VolumeMove';
import { requireUser, withErrorMapping } from './VolumeScopedRoute';

type App = ApiApp;

async function handleMe(c: ApiContext): Promise<Response> {
  const email = requireUser(c);
  if (email instanceof Response) return email;
  const scope = BaseRoute.getScope(c);
  // No `.catch(() => null)`: a D1 outage was reported as `username: null`,
  // which the SPA reads as "you still need to pick a handle" and pushes the
  // user into the rename flow during an incident.
  const profile = await scope.get(Tokens.UserService).getProfileByEmail(email);
  return c.json({ email, username: (profile as { username?: string } | null)?.username ?? null });
}

/**
Owned volume ids+names, snapshotted *before* the D1 rename.
*/
async function snapshotOwnedVolumes(c: ApiContext, email: string): Promise<Array<{ id: string; name: string }>> {
  const scope = BaseRoute.getScope(c);
  try {
    const dao = await scope.get(Tokens.DavVolumeDAO)();
    const rows = await dao.listByOwnerEmail(email, 1000);
    const seen = new Set<string>();
    const out: Array<{ id: string; name: string }> = [];
    for (const row of rows) {
      if (!row.id || !row.name || seen.has(row.id)) continue;
      seen.add(row.id);
      out.push({ id: row.id, name: row.name });
    }
    return out;
  } catch {
    // An empty snapshot still renames in D1; the DO move is simply skipped.
    return [];
  }
}

/**
Drop every cached read for the volumes a rename moved.
*/
async function invalidateRenamedCaches(
  c: ApiContext,
  email: string,
  moves: ReadonlyArray<{ oldFull: string; newFull: string }>,
): Promise<void> {
  try {
    const cache = BaseRoute.getScope(c).get(Tokens.KvCache);
    await invalidateVolumeListCache(cache, email);
    for (const move of moves) {
      const { owner: oldOwner, volume: oldVolume } = splitFull(move.oldFull);
      const { owner: newOwner, volume: newVolume } = splitFull(move.newFull);
      await invalidateVolumeCaches(cache, oldOwner, oldVolume);
      await invalidateVolumeCaches(cache, newOwner, newVolume);
    }
  } catch {
    // Best-effort; D1 and the DOs are already consistent.
  }
}

/**
 * `PATCH /user/me/username`.
 *
 * Fail-closed DO move: volume files + dead props are copied old→new and the old
 * isolate is purged only after the copy verifies. On copy failure the D1 rename
 * is rolled back so the request surfaces 500 rather than an empty volume.
 */
async function handleRenameUsername(c: ApiContext): Promise<Response> {
  const email = requireUser(c);
  if (email instanceof Response) return email;
  const { malformed, oversized, body } = await BaseRoute.readJson<{ username?: string }>(c);
  if (oversized) return BaseRoute.jsonError(c, 'Payload too large', 413);
  if (malformed) return BaseRoute.jsonError(c, 'Invalid JSON body', 400);
  if (!body.username || typeof body.username !== 'string') return BaseRoute.jsonError(c, 'username is required', 400);

  const scope = BaseRoute.getScope(c);
  const before = await scope
    .get(Tokens.UserService)
    .getProfileByEmail(email)
    .catch(() => null);
  // Snapshot BEFORE the D1 rename: afterwards `owner_ci` already reads the new
  // handle, so a post-rename filter by the old name matches nothing and the DO
  // move would silently never run.
  const snapshot = before?.username ? await snapshotOwnedVolumes(c, email) : [];

  const renamed = await scope.get(Tokens.UserService).renameUsername(email, body.username);
  const beforeUsername = before?.username;
  const handleChanged = Boolean(beforeUsername) && (beforeUsername as string).toLowerCase() !== renamed.username.toLowerCase();
  if (handleChanged && beforeUsername !== null && snapshot.length > 0) {
    const moves = snapshot.map((volume) => ({
      id: volume.id,
      name: volume.name,
      oldFull: `${beforeUsername}/${volume.name}`,
      newFull: `${renamed.username}/${volume.name}`,
    }));
    try {
      await moveVolumeDosForRename(c.env, moves);
    } catch {
      await scope
        .get(Tokens.UserService)
        .renameUsername(email, beforeUsername ?? '')
        .catch(() => undefined);
      return BaseRoute.jsonError(c, 'Failed to move volume data', 500);
    }
    await invalidateRenamedCaches(c, email, moves);
  } else if (handleChanged) {
    await invalidateRenamedCaches(c, email, []);
  }

  const profile = await scope.get(Tokens.UserService).getProfileByEmail(email);
  return c.json({ email: profile.email, username: profile.username });
}

/**
 * `GET /users/:username`.
 *
 * Returns 404 for an unknown or reserved handle. It previously answered 200
 * echoing whatever the caller asked for, because `getByUsername` swallowed its
 * own errors and returned null — so the endpoint could not be used to test
 * whether a handle is available while looking like a success.
 */
async function handleUserProfile(c: ApiContext): Promise<Response> {
  const username = (c.req.param('username') ?? '').trim();
  try {
    const user = await BaseRoute.getScope(c).get(Tokens.UserService).getByUsername(username);
    return user
      ? c.json({ username: (user as { username?: string }).username ?? username })
      : c.json({ Exception: { Type: 'NotFound', Message: 'User not found' } }, 404);
  } catch (error) {
    return BaseRoute.toErrorResponse(c, error);
  }
}

function registerUserProfileRoutes(app: App): void {
  app.get('/user/me', (c) => withErrorMapping(c, () => handleMe(c)));
  app.patch('/user/me/username', (c) => withErrorMapping(c, () => handleRenameUsername(c)));
  app.get('/users/:username', (c) => withErrorMapping(c, () => handleUserProfile(c)));
}

export { registerUserProfileRoutes };
