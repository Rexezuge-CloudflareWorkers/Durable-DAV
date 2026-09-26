import type { Context } from 'hono';
import { Tokens } from '@durable-dav/backend-services/composition';
import { DavCredentialUtil } from '@durable-dav/shared/utils';
import { DatabaseError } from '@durable-dav/backend-errors';
import { BaseRoute } from '../endpoints/IBaseRoute';

type RequestContext = Context<{ Bindings: Env; Variables: { AuthenticatedUserEmailAddress: string } }>;

function getScope(c: RequestContext): ReturnType<typeof BaseRoute.getScope> {
  return BaseRoute.getScope(c);
}

/**
 * Outcome of a successful WebDAV authorization.
 *
 * Only the fields the forward path actually reads are modelled. `role`,
 * `volumeId`, `isPrivate`, `credentialId` and `credentialName` were populated
 * here and consumed nowhere — the entire authorization model reduces to "is
 * this a valid credential bound to this volume id" plus the `is_private` bit
 * that produced the decision.
 */
export interface DavAuthResult {
  /**
  Authenticated owner email, or `null` for an anonymous read of a public bucket.
  */
  userEmail: string | null;
  /**
  Canonical (DB-resolved) owner handle, for the `X-Dav-Base` prefix.
  */
  owner: string;
  /**
  Canonical volume name.
  */
  volume: string;
}

/**
 * Parse a `Basic` Authorization header.
 *
 * Note the password is not trimmed: the credential is `ddav_` + base64url, and
 * trimming would silently accept a mistyped credential with surrounding
 * whitespace.
 */
function getBasicCredentials(header: string | null): { username: string; password: string } | null {
  if (!header || !header.startsWith('Basic ')) return null;
  try {
    const decoded = atob(header.slice(6).trim());
    const idx = decoded.indexOf(':');
    if (idx === -1) return null;
    const username = decoded.slice(0, idx).trim();
    const password = decoded.slice(idx + 1);
    return !username || !password ? null : { username, password };
  } catch {
    return null;
  }
}

function unauthorizedDav(): Response {
  return new Response('Unauthorized', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Durable-DAV"' },
  });
}

async function davAuthForVolume(
  c: RequestContext,
  owner: string,
  volumeName: string,
  needWrite: boolean,
): Promise<DavAuthResult | Response> {
  try {
    return await davAuthForVolumeInner(c, owner, volumeName, needWrite);
  } catch (error: unknown) {
    if (error instanceof DatabaseError) return new Response('Authentication unavailable', { status: 503 });
    throw error;
  }
}

async function davAuthForVolumeInner(
  c: RequestContext,
  owner: string,
  volumeName: string,
  needWrite: boolean,
): Promise<DavAuthResult | Response> {
  const scope = getScope(c);
  const volume = await scope.get(Tokens.VolumeService).getVolume(owner, volumeName);
  if (!volume) return new Response('Not Found', { status: 404 });

  const isPrivate = Number(volume.is_private) === 1;
  const authHeader = c.req.header('Authorization') ?? null;
  const basic = getBasicCredentials(authHeader);

  if (basic) {
    // Bucket-level credential: username AND password both validated, bound
    // to this volume id (CalDAV-style). No Bearer, no user-level PAT.
    const passwordHash = await DavCredentialUtil.hashPassword(basic.password);
    const credentialDAO = await scope.get(Tokens.DavCredentialDAO)();
    // No `.catch` on the lookup: swallowing it here turned a D1 outage into a
    // 401 (and a native Basic re-prompt loop) instead of the 503 the wrapper
    // above maps `DatabaseError` to.
    const credential = await credentialDAO.getByUsernameAndHash(basic.username, passwordHash, true);
    if (!credential || credential.volumeId !== volume.id) return unauthorizedDav();
    // `last_used_at` is genuinely best-effort telemetry; a failure here must
    // not fail an otherwise-valid request.
    await credentialDAO.updateLastUsed(credential.credentialId).catch(() => undefined);
    return { userEmail: volume.owner_email, owner: volume.owner, volume: volume.name };
  }

  // No credential: public buckets allow anonymous reads only; all writes
  // and all private access require a bucket credential.
  if (!needWrite && !isPrivate) {
    const role = await scope.get(Tokens.DavPermissionService).getRole(null, volume);
    return role ? { userEmail: null, owner: volume.owner, volume: volume.name } : unauthorizedDav();
  }
  return unauthorizedDav();
}

export { davAuthForVolume, unauthorizedDav };
export type { RequestContext };
