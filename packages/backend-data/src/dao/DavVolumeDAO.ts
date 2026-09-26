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
    // Owner-only buckets: owned rows plus public rows. No collaborators.
    const result = await this.database
      .prepare(
        `SELECT * FROM dav_volumes
         WHERE is_private = 0 OR lower(owner_email) = lower(?)
         ORDER BY updated_at DESC LIMIT ?`,
      )
      .bind(userEmail, limit)
      .all<DavVolumeRow>();
    return result.results ?? [];
  }

  public async listPublicByOwner(owner: string, limit = 100): Promise<DavVolumeRow[]> {
    const result = await this.database
      .prepare('SELECT * FROM dav_volumes WHERE owner_ci = ? AND is_private = 0 ORDER BY updated_at DESC LIMIT ?')
      .bind(owner.toLowerCase(), limit)
      .all<DavVolumeRow>();
    return result.results ?? [];
  }

  public async update(
    id: string,
    patch: { description?: string | null; isPrivate?: boolean; now: number },
  ): Promise<void> {
    const sets: string[] = ['updated_at = ?'];
    const bindings: unknown[] = [patch.now];
    if (patch.description !== undefined) {
      sets.push('description = ?');
      bindings.push(patch.description);
    }
    if (patch.isPrivate !== undefined) {
      sets.push('is_private = ?');
      bindings.push(patch.isPrivate ? 1 : 0);
    }
    bindings.push(id);
    await this.withRetry(
      () => this.database.prepare(`UPDATE dav_volumes SET ${sets.join(', ')} WHERE id = ?`).bind(...bindings).run(),
      'update dav volume',
    );
  }

  public async listByOwnerEmail(ownerEmail: string, limit = 1000): Promise<DavVolumeRow[]> {
    const result = await this.database
      .prepare('SELECT * FROM dav_volumes WHERE lower(owner_email) = lower(?) ORDER BY updated_at DESC LIMIT ?')
      .bind(ownerEmail, limit)
      .all<DavVolumeRow>();
    return result.results ?? [];
  }

  public async renameOwner(oldOwnerCi: string, newOwner: string, now: number): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare('UPDATE dav_volumes SET owner = ?, owner_ci = ?, updated_at = ? WHERE owner_ci = ?')
          .bind(newOwner, newOwner.toLowerCase(), now, oldOwnerCi.toLowerCase())
          .run(),
      'rename volume owner',
    );
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
