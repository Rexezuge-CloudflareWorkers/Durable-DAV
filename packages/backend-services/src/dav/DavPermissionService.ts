import { DavCollaboratorDAO } from '@durable-dav/backend-data/dao';
import type { DavVolumeRow, DavRole } from '@durable-dav/backend-data/dao';
import type { D1Queryable } from '@durable-dav/backend-data/utils';
import { isMissingSchemaError } from '@durable-dav/backend-data/utils';
import { DatabaseError } from '@durable-dav/backend-errors';

type DavPermission = DavRole;

interface DavPermissionServiceEnv {
  DB: D1Queryable;
}

interface DavPermissionServiceDeps {
  davCollaboratorDAO?: () => Promise<DavCollaboratorDAO>;
  strictSchema?: boolean;
  /**
  @deprecated Org volumes removed; accepted for backward compat and ignored.
  */
  organizationDAO?: () => Promise<unknown>;
  /**
  @deprecated Org volumes removed; accepted for backward compat and ignored.
  */
  organizationMemberDAO?: () => Promise<unknown>;
}

class DavPermissionService {
  private readonly deps: Required<Pick<DavPermissionServiceDeps, 'davCollaboratorDAO' | 'strictSchema'>>;

  constructor(env: DavPermissionServiceEnv, deps: DavPermissionServiceDeps = {}) {
    // User-only buckets: no org volumes. D1 keeps the legacy org_id column
    // for compat, but it is ignored here (deprecated deps above are dropped).
    const { davCollaboratorDAO, strictSchema } = deps;
    this.deps = {
      davCollaboratorDAO: davCollaboratorDAO ?? (() => Promise.resolve(new DavCollaboratorDAO(env.DB))),
      strictSchema: strictSchema ?? false,
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
      // User buckets: collaborators only, then public read.
      if (viewerEmail) {
        try {
          const collaboratorDao = await this.deps.davCollaboratorDAO();
          const collab = await collaboratorDao.get(volume.id, viewerEmail);
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
