import type { DavVolumeRow, DavRole } from '@durable-dav/backend-data/dao';

type DavPermission = DavRole;

interface DavPermissionServiceEnv {
  DB?: unknown;
}

// Owner-only Policy: owner is implicit admin, public buckets allow anon
// reads, private buckets hide existence. No collaborators, orgs, or grants.
class DavPermissionService {
  constructor(_env?: DavPermissionServiceEnv) {}

  public getRole(viewerEmail: string | null, volume: DavVolumeRow): Promise<DavPermission | null> {
    const isPrivate = Number(volume.is_private) === 1;
    if (viewerEmail && viewerEmail.toLowerCase() === volume.owner_email.toLowerCase()) return Promise.resolve('admin');
    if (!isPrivate) return Promise.resolve('read');
    return Promise.resolve(null);
  }
}

export { DavPermissionService };
export type { DavPermission };
