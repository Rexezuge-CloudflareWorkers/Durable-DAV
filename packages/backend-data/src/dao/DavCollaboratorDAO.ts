import { BaseDAO } from './BaseDAO';
import type { D1Queryable } from '../utils/D1Types';

export type DavRole = 'admin' | 'write' | 'read';

export interface DavCollaboratorRow {
  volume_id: string;
  user_email: string;
  role: DavRole;
  granted_by: string | null;
  created_at: number;
}

class DavCollaboratorDAO extends BaseDAO {
  constructor(database: D1Queryable) {
    super(database);
  }

  public async upsert(volumeId: string, userEmail: string, role: DavRole, grantedBy: string | null, now: number): Promise<void> {
    const normalized = userEmail.toLowerCase();
    await this.withRetry(
      () =>
        this.database
          .prepare(
            'INSERT INTO dav_collaborators (volume_id, user_email, role, granted_by, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(volume_id, user_email) DO UPDATE SET role = excluded.role, granted_by = excluded.granted_by',
          )
          .bind(volumeId, normalized, role, grantedBy?.toLowerCase() ?? null, now)
          .run(),
      'upsert dav collaborator',
    );
  }

  public async get(volumeId: string, userEmail: string): Promise<DavCollaboratorRow | null> {
    const result = await this.database
      .prepare('SELECT * FROM dav_collaborators WHERE volume_id = ? AND lower(user_email) = lower(?) LIMIT 1')
      .bind(volumeId, userEmail)
      .first<DavCollaboratorRow>();
    return result ?? null;
  }

  public async delete(volumeId: string, userEmail: string): Promise<void> {
    await this.withRetry(
      () => this.database.prepare('DELETE FROM dav_collaborators WHERE volume_id = ? AND lower(user_email) = lower(?)').bind(volumeId, userEmail).run(),
      'delete dav collaborator',
    );
  }
}

export { DavCollaboratorDAO };
