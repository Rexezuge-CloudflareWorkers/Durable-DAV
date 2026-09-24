import { BaseDAO } from './BaseDAO';
import type { D1Queryable } from '../utils/D1Types';

export interface ReleaseRow {
  id: string;
  repository_id: string;
  tag_name: string;
  name: string;
  body: string;
  is_draft: number;
  is_prerelease: number;
  created_by: string;
  created_at: number;
  published_at: number | null;
}

export interface ReleaseAssetRow {
  id: string;
  release_id: string;
  repository_id: string;
  name: string;
  size: number;
  content_type: string;
  sha256: string;
  created_by: string;
  created_at: number;
}

class ReleaseDAO extends BaseDAO {
  constructor(database: D1Queryable) {
    super(database);
  }

  public async createRelease(input: {
    id: string;
    repositoryId: string;
    tagName: string;
    name: string;
    body: string;
    isDraft: boolean;
    isPrerelease: boolean;
    createdBy: string;
    now: number;
    publishedAt?: number | null;
  }): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare(
            'INSERT INTO releases (id, repository_id, tag_name, name, body, is_draft, is_prerelease, created_by, created_at, published_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .bind(
            input.id,
            input.repositoryId,
            input.tagName,
            input.name,
            input.body,
            input.isDraft ? 1 : 0,
            input.isPrerelease ? 1 : 0,
            input.createdBy,
            input.now,
            input.publishedAt ?? (input.isDraft ? null : input.now),
          )
          .run(),
      'create release',
    );
  }

  public async listByRepo(repositoryId: string): Promise<ReleaseRow[]> {
    const result = await this.database
      .prepare('SELECT * FROM releases WHERE repository_id = ? ORDER BY created_at DESC, id DESC')
      .bind(repositoryId)
      .all<ReleaseRow>();
    return result.results ?? [];
  }

  public async getByTag(repositoryId: string, tagName: string): Promise<ReleaseRow | null> {
    return this.database
      .prepare('SELECT * FROM releases WHERE repository_id = ? AND tag_name = ? LIMIT 1')
      .bind(repositoryId, tagName)
      .first<ReleaseRow>();
  }

  public async getById(id: string, repositoryId: string): Promise<ReleaseRow | null> {
    return this.database
      .prepare('SELECT * FROM releases WHERE id = ? AND repository_id = ? LIMIT 1')
      .bind(id, repositoryId)
      .first<ReleaseRow>();
  }

  public async countByRepo(repositoryId: string): Promise<number> {
    const row = await this.database
      .prepare('SELECT COUNT(*) AS count FROM releases WHERE repository_id = ?')
      .bind(repositoryId)
      .first<{ count: number }>();
    return row?.count ?? 0;
  }

  public async updateRelease(
    id: string,
    repositoryId: string,
    patch: { name?: string; body?: string; isDraft?: boolean; isPrerelease?: boolean; publishedAt?: number | null },
  ): Promise<void> {
    const sets: string[] = [];
    const values: Array<string | number | null> = [];
    if (patch.name !== undefined) {
      sets.push('name = ?');
      values.push(patch.name);
    }
    if (patch.body !== undefined) {
      sets.push('body = ?');
      values.push(patch.body);
    }
    if (patch.isDraft !== undefined) {
      sets.push('is_draft = ?');
      values.push(patch.isDraft ? 1 : 0);
    }
    if (patch.isPrerelease !== undefined) {
      sets.push('is_prerelease = ?');
      values.push(patch.isPrerelease ? 1 : 0);
    }
    if (patch.publishedAt !== undefined) {
      sets.push('published_at = ?');
      values.push(patch.publishedAt);
    }
    if (sets.length === 0) return;
    await this.withRetry(
      () =>
        this.database
          .prepare(`UPDATE releases SET ${sets.join(', ')} WHERE id = ? AND repository_id = ?`)
          .bind(...values, id, repositoryId)
          .run(),
      'update release',
    );
  }

  public async deleteRelease(id: string, repositoryId: string): Promise<void> {
    await this.withRetry(
      () => this.database.prepare('DELETE FROM release_assets WHERE release_id = ?').bind(id).run(),
      'delete release assets',
    ).catch(() => undefined);
    await this.withRetry(
      () => this.database.prepare('DELETE FROM releases WHERE id = ? AND repository_id = ?').bind(id, repositoryId).run(),
      'delete release',
    );
  }

  public async createAsset(input: {
    id: string;
    releaseId: string;
    repositoryId: string;
    name: string;
    size: number;
    contentType: string;
    sha256: string;
    createdBy: string;
    now: number;
  }): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare(
            'INSERT INTO release_assets (id, release_id, repository_id, name, size, content_type, sha256, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .bind(
            input.id,
            input.releaseId,
            input.repositoryId,
            input.name,
            input.size,
            input.contentType,
            input.sha256,
            input.createdBy,
            input.now,
          )
          .run(),
      'create release asset',
    );
  }

  public async listAssets(releaseId: string): Promise<ReleaseAssetRow[]> {
    const result = await this.database
      .prepare('SELECT * FROM release_assets WHERE release_id = ? ORDER BY created_at ASC, id ASC')
      .bind(releaseId)
      .all<ReleaseAssetRow>();
    return result.results ?? [];
  }

  public async countAssets(releaseId: string): Promise<number> {
    const row = await this.database
      .prepare('SELECT COUNT(*) AS count FROM release_assets WHERE release_id = ?')
      .bind(releaseId)
      .first<{ count: number }>();
    return row?.count ?? 0;
  }

  public async getAsset(assetId: string, releaseId: string): Promise<ReleaseAssetRow | null> {
    return this.database
      .prepare('SELECT * FROM release_assets WHERE id = ? AND release_id = ? LIMIT 1')
      .bind(assetId, releaseId)
      .first<ReleaseAssetRow>();
  }

  public async getAssetByName(releaseId: string, name: string): Promise<ReleaseAssetRow | null> {
    return this.database
      .prepare('SELECT * FROM release_assets WHERE release_id = ? AND name = ? LIMIT 1')
      .bind(releaseId, name)
      .first<ReleaseAssetRow>();
  }

  public async deleteAsset(assetId: string, releaseId: string): Promise<void> {
    await this.withRetry(
      () => this.database.prepare('DELETE FROM release_assets WHERE id = ? AND release_id = ?').bind(assetId, releaseId).run(),
      'delete release asset',
    );
  }

  public async deleteByRepo(repositoryId: string): Promise<void> {
    await this.database
      .prepare('DELETE FROM release_assets WHERE repository_id = ?')
      .bind(repositoryId)
      .run()
      .catch(() => undefined);
    await this.database
      .prepare('DELETE FROM releases WHERE repository_id = ?')
      .bind(repositoryId)
      .run()
      .catch(() => undefined);
  }
}

export { ReleaseDAO };
