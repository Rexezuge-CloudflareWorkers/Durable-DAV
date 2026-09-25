import type { Context } from 'hono';
import { Tokens } from '@durable-dav/backend-services/composition';
import { DavCredentialUtil } from '@durable-dav/shared/utils';
import { DatabaseError } from '@durable-dav/backend-errors';
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
  credentialId: string;
  credentialName: string;
}

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
    const credential = await credentialDAO.getByUsernameAndHash(basic.username, passwordHash, true).catch(() => undefined);
    if (!credential || credential.volumeId !== volume.id) return unauthorizedDav();
    await credentialDAO.updateLastUsed(credential.credentialId).catch(() => undefined);
    return {
      userEmail: volume.owner_email,
      owner: volume.owner,
      volume: volume.name,
      role: 'admin',
      volumeId: volume.id,
      isPrivate,
      credentialId: credential.credentialId,
      credentialName: credential.name,
    };
  }

  // No credential: public buckets allow anonymous reads only; all writes
  // and all private access require a bucket credential.
  if (!needWrite && !isPrivate) {
    const role = await scope.get(Tokens.DavPermissionService).getRole(null, volume);
    if (!role) return unauthorizedDav();
    return {
      userEmail: null,
      owner: volume.owner,
      volume: volume.name,
      role,
      volumeId: volume.id,
      isPrivate,
      credentialId: '',
      credentialName: '',
    };
  }
  return unauthorizedDav();
}

export { davAuthForVolume, unauthorizedDav, getBasicCredentials };
export type { RequestContext };
