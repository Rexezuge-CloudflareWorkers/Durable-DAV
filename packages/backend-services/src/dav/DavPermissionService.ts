import {
  DavCollaboratorDAO,
  OrganizationDAO,
  OrganizationMemberDAO,
} from '@duradav/backend-data/dao';
import type { DavVolumeRow, DavRole } from '@duradav/backend-data/dao';
import type { D1Queryable } from '@duradav/backend-data/utils';
import { isMissingSchemaError } from '@duradav/backend-data/utils';
import { DatabaseError } from '@duradav/backend-errors';

type DavPermission = DavRole;

interface DavPermissionServiceEnv {
  DB: D1Queryable;
}

interface DavPermissionServiceDeps {
  organizationDAO?: () => Promise<OrganizationDAO>;
  organizationMemberDAO?: () => Promise<OrganizationMemberDAO>;
  davCollaboratorDAO?: () => Promise<DavCollaboratorDAO>;
  strictSchema?: boolean;
}

class DavPermissionService {
  private readonly deps: Required<DavPermissionServiceDeps>;

  constructor(env: DavPermissionServiceEnv, deps: DavPermissionServiceDeps = {}) {
    this.deps = {
      organizationDAO: () => Promise.resolve(new OrganizationDAO(env.DB)),
      organizationMemberDAO: () => Promise.resolve(new OrganizationMemberDAO(env.DB)),
      davCollaboratorDAO: () => Promise.resolve(new DavCollaboratorDAO(env.DB)),
      strictSchema: false,
      ...deps,
    };
  }

  private isTolerable(error: unknown): boolean {
    if (this.deps.strictSchema) return false;
    return isMissingSchemaError(error);
  }

  public async getRole(viewerEmail: string | null, volume: DavVolumeRow): Promise<DavPermission | null> {
    try {
      const isPrivate = Number(volume.is_private) === 1;
      // Owner always admin
      if (viewerEmail && viewerEmail.toLowerCase() === volume.owner_email.toLowerCase()) return 'admin';
      // Org volumes: org owners admin, members read (write via collaborator grant)
      if (volume.org_id) {
        if (viewerEmail) {
          try {
            const memberDao = await this.deps.organizationMemberDAO();
            const membership = await memberDao.get(volume.org_id, viewerEmail).catch(() => null);
            const role = (membership as { role?: string } | null)?.role;
            if (role === 'owner') return 'admin';
            if (role === 'member') {
              const collab = await (await this.deps.davCollaboratorDAO()).get(volume.id, viewerEmail).catch(() => null);
              if (collab) return collab.role;
              return isPrivate ? 'read' : 'read';
            }
          } catch (error) {
            if (!this.isTolerable(error)) throw new DatabaseError('Failed to resolve org membership');
          }
        }
        if (!isPrivate) return 'read';
        return null;
      }
      // User volumes: collaborators
      if (viewerEmail) {
        try {
          const collab = await (await this.deps.davCollaboratorDAO()).get(volume.id, viewerEmail);
          if (collab) return collab.role;
        } catch (error) {
          if (!this.isTolerable(error)) throw new DatabaseError('Failed to resolve collaborator');
        }
      }
      if (!isPrivate) return 'read';
      return null;
    } catch (error) {
      if (error instanceof DatabaseError) throw error;
      if (!this.isTolerable(error)) throw error;
      return Number(volume.is_private) === 1 ? null : 'read';
    }
  }
}

export { DavPermissionService };
export type { DavPermission };
