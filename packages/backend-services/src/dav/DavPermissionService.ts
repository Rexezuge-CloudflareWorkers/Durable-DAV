import type { DavVolumeRow, DavRole } from '@durable-dav/backend-data/dao';

type DavPermission = DavRole;

interface DavPermissionServiceEnv {
  DB?: unknown;
}

interface DavPermissionServiceDeps {
  /**
   * @deprecated Bucket collaborators removed; accepted for backward compat and ignored.
   */
  davCollaboratorDAO?: () => Promise<unknown>;
  strictSchema?: boolean;
  /**
   * @deprecated Org volumes removed; accepted for backward compat and ignored.
   */
  organizationDAO?: () => Promise<unknown>;
  /**
   * @deprecated Org volumes removed; accepted for backward compat and ignored.
   */
  organizationMemberDAO?: () => Promise<unknown>;
}

class DavPermissionService {
  constructor(_env?: DavPermissionServiceEnv, _deps?: DavPermissionServiceDeps) {}

  public getRole(viewerEmail: string | null, volume: DavVolumeRow): Promise<DavPermission | null> {
    const isPrivate = Number(volume.is_private) === 1;
    // Owner-only buckets: owner is implicit admin, no collaborators.
    if (viewerEmail && viewerEmail.toLowerCase() === volume.owner_email.toLowerCase()) return Promise.resolve('admin');
    // Public buckets allow anonymous reads; private hides existence.
    if (!isPrivate) return Promise.resolve('read');
    return Promise.resolve(null);
  }
}

export { DavPermissionService };
export type { DavPermission };
