import { BaseDAO } from './BaseDAO';
import type { D1Queryable } from '../utils/D1Types';

export interface DavVolumeRow {
  id: string;
  owner_email: string;
  owner: string;
  name: string;
  description: string | null;
  is_private: number;
  created_at: number;
  updated_at: number;
  owner_ci: string;
  name_ci: string;
}

class DavVolumeDAO extends BaseDAO {
  constructor(database: D1Queryable) {
    super(database);
  }

  public async create(input: {
    id: string;
    ownerEmail: string;
    owner: string;
    name: string;
    description: string | null;
    isPrivate: boolean;
    now: number;
  }): Promise<void> {
    const ownerCi = input.owner.toLowerCase();
    const nameCi = input.name.toLowerCase();
    await this.withRetry(
      () =>
        this.database
          .prepare(
            'INSERT INTO dav_volumes (id, owner_email, owner, name, description, is_private, created_at, updated_at, owner_ci, name_ci) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .bind(
            input.id,
            input.ownerEmail,
            input.owner,
            input.name,
            input.description,
            input.isPrivate ? 1 : 0,
            input.now,
            input.now,
            ownerCi,
            nameCi,
          )
          .run(),
      'create dav volume',
    );
  }

  public async getByOwnerName(owner: string, name: string): Promise<DavVolumeRow | null> {
    const result = await this.database
      .prepare('SELECT * FROM dav_volumes WHERE owner_ci = ? AND name_ci = ? LIMIT 1')
      .bind(owner.toLowerCase(), name.toLowerCase())
      .first<DavVolumeRow>();
    return result ?? null;
  }

  public async getById(id: string): Promise<DavVolumeRow | null> {
    const result = await this.database
      .prepare('SELECT * FROM dav_volumes WHERE id = ? LIMIT 1')
      .bind(id)
      .first<DavVolumeRow>();
    return result ?? null;
  }

  public async listVisibleForUser(userEmail: string | null, limit = 100): Promise<DavVolumeRow[]> {
    if (userEmail === null) {
      const result = await this.database
        .prepare('SELECT * FROM dav_volumes WHERE is_private = 0 ORDER BY updated_at DESC LIMIT ?')
        .bind(limit)
        .all<DavVolumeRow>();
      return result.results ?? [];
    }
    const result = await this.database
      .prepare(
        `SELECT DISTINCT v.* FROM dav_volumes v
         LEFT JOIN dav_collaborators c ON c.volume_id = v.id AND lower(c.user_email) = lower(?)
         WHERE v.is_private = 0 OR lower(v.owner_email) = lower(?) OR c.user_email IS NOT NULL
         ORDER BY v.updated_at DESC LIMIT ?`,
      )
      .bind(userEmail, userEmail, limit)
      .all<DavVolumeRow>();
    return result.results ?? [];
  }

  public async listByOwnerEmail(ownerEmail: string, limit = 1000): Promise<DavVolumeRow[]> {
    const result = await this.database
      .prepare('SELECT * FROM dav_volumes WHERE lower(owner_email) = lower(?) ORDER BY updated_at DESC LIMIT ?')
      .bind(ownerEmail, limit)
      .all<DavVolumeRow>();
    return result.results ?? [];
  }

  public async countByOwnerEmail(ownerEmail: string): Promise<number> {
    const row = await this.database
      .prepare('SELECT COUNT(*) AS cnt FROM dav_volumes WHERE lower(owner_email) = lower(?)')
      .bind(ownerEmail)
      .first<{ cnt: number }>();
    return row?.cnt ?? 0;
  }

  public async deleteById(id: string): Promise<void> {
    await this.withRetry(() => this.database.prepare('DELETE FROM dav_volumes WHERE id = ?').bind(id).run(), 'delete dav volume');
  }
}

export { DavVolumeDAO };
