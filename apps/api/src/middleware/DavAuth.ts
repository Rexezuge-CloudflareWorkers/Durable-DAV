import type { Context } from 'hono';
import { Tokens } from '@duradav/backend-services/composition';
import type { AuthenticatedToken } from '@duradav/backend-services/auth';
import { coversScope } from '@duradav/backend-services/auth';
import { DatabaseError } from '@duradav/backend-errors';
import { BaseRoute } from '../endpoints/IBaseRoute';

type RequestContext = Context<{ Bindings: Env; Variables: { AuthenticatedUserEmailAddress: string } }>;

function getScope(c: RequestContext): ReturnType<typeof BaseRoute.getScope> {
  return BaseRoute.getScope(c);
}

export interface DavAuthResult {
  userEmail: string | null;
  owner: string;
  volume: string;
  role: 'admin' | 'write' | 'read';
  volumeId: string;
  isPrivate: boolean;
}

function getBasicCredentials(header: string | null): { username: string; password: string } | null {
  if (!header || !header.startsWith('Basic ')) return null;
  try {
    const decoded = atob(header.slice(6).trim());
    const idx = decoded.indexOf(':');
    if (idx === -1) return null;
    return { username: decoded.slice(0, idx), password: decoded.slice(idx + 1) };
  } catch {
    return null;
  }
}

function getBearerToken(header: string | null): string | null {
  if (!header || !header.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token === '' ? null : token;
}

function unauthorizedDav(): Response {
  return new Response('Unauthorized', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="DuraDAV"' },
  });
}

async function resolveViewerEmail(c: RequestContext): Promise<string | null> {
  // Best-effort Access identity for public-volume reads; never throws.
  try {
    const scope = getScope(c);
    const email = await scope
      .get(Tokens.AccessAuthService)
      .getAuthenticatedUserEmail(c.req.raw, c.executionCtx as unknown as never);
    if (email) {
      await scope.get(Tokens.UserService).upsertUser(email).catch(() => undefined);
      return email;
    }
  } catch {
    // ignore; fall through to PAT/anon
  }
  return null;
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
  if (!volume) {
    // Hide existence of private volumes: try auth first, else 401 (not 404).
    // For scaffold: unknown volume -> 404 only if anon would see nothing; else 401 to avoid probing.
    const authHeader = c.req.header('Authorization');
    if (!authHeader) return unauthorizedDav();
    // fall through to PAT check which will 401 on bad token
  }
  const authHeader = c.req.header('Authorization');
  let patEmail: string | null = null;
  if (authHeader) {
    const basic = getBasicCredentials(authHeader);
    const bearer = getBearerToken(authHeader);
    const pat = bearer ?? basic?.password ?? null;
    if (pat) {
      let authenticated: AuthenticatedToken;
      try {
        authenticated = await scope.get(Tokens.TokenService).authenticateWithPAT(pat);
      } catch {
        return unauthorizedDav();
      }
      const required = needWrite ? 'dav:write' : 'dav:read';
      if (!coversScope(authenticated.scopes, required)) {
        return new Response('Forbidden', { status: 403 });
      }
      // Per-bucket scoping: unscoped PATs keep full access; scoped PATs must
      // hold a matching grant for this volume id with a covering scope.
      if (volume && authenticated.volumeGrants.length > 0) {
        const allowed = authenticated.volumeGrants.some(
          (g) => g.volumeId === volume.id && coversScope([g.scope], required),
        );
        if (!allowed) return new Response('Forbidden', { status: 403 });
      }
      patEmail = authenticated.email;
    }
  }
  const viewerEmail = patEmail ?? (await resolveViewerEmail(c));
  if (!volume) return new Response('Not Found', { status: 404 });
  const role = await scope.get(Tokens.DavPermissionService).getRole(viewerEmail, volume);
  if (!role) {
    // Private hides existence for anon (401), forbidden for authenticated
    if (!viewerEmail) return unauthorizedDav();
    // Authenticated but no access: 404 to hide existence (Edge-Git public-read-model parity)
    return new Response('Not Found', { status: 404 });
  }
  if (needWrite && role === 'read') return new Response('Forbidden', { status: 403 });
  if (viewerEmail) {
    try {
      c.set('AuthenticatedUserEmailAddress', viewerEmail);
    } catch {
      // ignore
    }
  }
  return {
    userEmail: viewerEmail,
    owner: volume.owner,
    volume: volume.name,
    role,
    volumeId: volume.id,
    isPrivate: Number(volume.is_private) === 1,
  };
}

export { davAuthForVolume, unauthorizedDav, getBasicCredentials, getBearerToken };
export type { RequestContext };
