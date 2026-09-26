import { Tokens } from '@durable-dav/backend-services/composition';
import type { DavVolumeRow } from '@durable-dav/backend-data/dao';
import type { Container } from '@durable-dav/backend-runtime/di';
import { BaseRoute } from '@/endpoints/IBaseRoute';
import type { ApiContext } from '@/types/ApiContext';

/**
Everything a volume-scoped handler needs after the guard has run.
*/
export interface VolumeRequestContext {
  scope: Container;
  /**
  Authenticated caller's email, lowercased.
  */
  email: string;
  /**
  Canonical owner handle from D1 (not the raw URL segment).
  */
  owner: string;
  /**
  Canonical volume name from D1.
  */
  volume: string;
  /**
  The resolved volume row.
  */
  row: DavVolumeRow;
}

/**
 * How a volume-scoped plane reports "not yours".
 *
 * The two planes deliberately differ: the session-authenticated browser plane
 * hides existence (404) so a stranger cannot probe which buckets exist, while
 * the credential plane returns 403. Centralising the choice here is what keeps
 * that documented invariant from drifting — it had already drifted once, with
 * `CredentialRoutes` returning 403 on a foreign volume while the browser plane
 * returned 404.
 */
type NotOwnerStatus = 403 | 404;

const UNAUTHORIZED_BODY = { Exception: { Type: 'Unauthorized', Message: 'Unauthorized' } } as const;
const NOT_FOUND_BODY = { Exception: { Type: 'NotFound', Message: 'Volume not found' } } as const;
const FORBIDDEN_BODY = { Exception: { Type: 'Forbidden', Message: 'Forbidden' } } as const;

/**
 * Resolve the authenticated caller, or answer 401.
 *
 * `/user/*` is already behind `userAuthentication()`, so this reads the value
 * that middleware stored rather than re-running the whole authentication
 * chain. `VolumeRoutes` used to call `getAuthenticatedUserEmail` a *second*
 * time on five handlers — two full passes per request, each potentially a JWKS
 * resolve or `ctx.access.getIdentity()` round trip, with a hardcoded
 * non-i18n `'Unauthorized'` body instead of the shared one.
 */
function requireUser(c: ApiContext): string | Response {
  const email = c.get('AuthenticatedUserEmailAddress');
  // Typed as always-present, but the value is absent if middleware ordering
  // ever changes; the guard turns a would-be TypeError (500) into a 401.
  return typeof email !== 'string' || email === '' ? c.json(UNAUTHORIZED_BODY, 401) : email.toLowerCase();
}

/**
 * Template method for every `/user/volumes/:owner/:volume/...` handler.
 *
 * Seven handlers across three route files each opened with the same six lines:
 * resolve scope, resolve identity, look the volume up, 404 if missing, 403/404
 * if not the owner. That preamble is where the bugs lived — one copy swallowed
 * the volume lookup so a D1 outage looked like a 404, another used 403 where
 * the plane's contract said 404.
 *
 * Subclasses implement `run`; this class owns the guard and the error mapping.
 */
abstract class VolumeScopedRoute {
  constructor(private readonly notOwnerStatus: NotOwnerStatus = 403) {}

  /**
  The per-handler work, after authentication and ownership are established.
  */
  protected abstract run(c: ApiContext, ctx: VolumeRequestContext): Promise<Response>;

  public async handle(c: ApiContext): Promise<Response> {
    try {
      return await this.guard(c);
    } catch (error) {
      return BaseRoute.toErrorResponse(c, error);
    }
  }

  private async guard(c: ApiContext): Promise<Response> {
    const email = requireUser(c);
    if (email instanceof Response) return email;

    const scope = BaseRoute.getScope(c);
    const owner = (c.req.param('owner') ?? '').trim();
    const volume = (c.req.param('volume') ?? '').trim();
    // No `.catch(() => null)`: that made a D1 outage indistinguishable from a
    // missing bucket, so clients cached a 404 for a bucket that still existed.
    const row = await scope.get(Tokens.VolumeService).getVolume(owner, volume);
    if (!row) return c.json(NOT_FOUND_BODY, 404);
    if (row.owner_email.toLowerCase() !== email) {
      return this.notOwnerStatus === 404 ? c.json(NOT_FOUND_BODY, 404) : c.json(FORBIDDEN_BODY, 403);
    }
    return this.run(c, { scope, email, owner: row.owner, volume: row.name, row });
  }
}

/**
 * Map thrown domain errors to the AWS error envelope.
 *
 * Handlers that are not volume-scoped still need this: `createVolume` throws
 * `ForbiddenError` for a foreign owner and `BadRequestError` for a duplicate
 * name, and without the mapping both escape to `app.onError` as a masked 500.
 */
async function withErrorMapping(c: ApiContext, run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    return BaseRoute.toErrorResponse(c, error);
  }
}

export { VolumeScopedRoute, requireUser, withErrorMapping };
export type { NotOwnerStatus };
