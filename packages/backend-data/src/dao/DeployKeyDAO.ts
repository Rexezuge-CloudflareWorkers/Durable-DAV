import { BaseDAO } from './BaseDAO';
import type { D1Queryable } from '../utils/D1Types';

type DeployKeyPermission = 'read' | 'write';

interface DeployKeyRow {
  id: string;
  repository_id: string;
  name: string;
  token_hash: string;
  token_prefix: string | null;
  permission: DeployKeyPermission;
  expires_at: number;
  last_used_at: number | null;
  created_by: string;
  created_at: number;
}

class DeployKeyDAO extends BaseDAO {
  constructor(database: D1Queryable) {
    super(database);
  }

  public async create(input: {
    id: string;
    repositoryId: string;
    name: string;
    tokenHash: string;
    tokenPrefix: string;
    permission: DeployKeyPermission;
    expiresAt: number;
    createdBy: string;
    now: number;
  }): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare(
            'INSERT INTO deploy_keys (id, repository_id, name, token_hash, token_prefix, permission, expires_at, last_used_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)',
          )
          .bind(
            input.id,
            input.repositoryId,
            input.name,
            input.tokenHash,
            input.tokenPrefix,
            input.permission,
            input.expiresAt,
            input.createdBy,
            input.now,
          )
          .run(),
      'create deploy key',
    );
  }

  public async listByRepo(repositoryId: string): Promise<DeployKeyRow[]> {
    const result = await this.database
      .prepare('SELECT * FROM deploy_keys WHERE repository_id = ? ORDER BY created_at DESC, id DESC')
      .bind(repositoryId)
      .all<DeployKeyRow>();
    return result.results ?? [];
  }

  public async getByIdAndRepo(id: string, repositoryId: string): Promise<DeployKeyRow | null> {
    const row = await this.database
      .prepare('SELECT * FROM deploy_keys WHERE id = ? AND repository_id = ? LIMIT 1')
      .bind(id, repositoryId)
      .first<DeployKeyRow>();
    return row ?? null;
  }

  public async getByTokenHash(tokenHash: string, now: number): Promise<DeployKeyRow | null> {
    const row = await this.database
      .prepare('SELECT * FROM deploy_keys WHERE token_hash = ? AND expires_at > ? LIMIT 1')
      .bind(tokenHash, now)
      .first<DeployKeyRow>();
    return row ?? null;
  }

  public async updateLastUsedByHash(tokenHash: string, now: number): Promise<void> {
    await this.withRetry(
      () => this.database.prepare('UPDATE deploy_keys SET last_used_at = ? WHERE token_hash = ?').bind(now, tokenHash).run(),
      'update deploy key last used',
    );
  }

  public async countByRepo(repositoryId: string): Promise<number> {
    const row = await this.database
      .prepare('SELECT COUNT(*) AS n FROM deploy_keys WHERE repository_id = ?')
      .bind(repositoryId)
      .first<{ n: number }>();
    return row?.n ?? 0;
  }

  public async deleteByIdAndRepo(id: string, repositoryId: string): Promise<void> {
    await this.withRetry(
      () => this.database.prepare('DELETE FROM deploy_keys WHERE id = ? AND repository_id = ?').bind(id, repositoryId).run(),
      'delete deploy key',
    );
  }

  public async pruneExpired(now: number, limit: number): Promise<number> {
    return this.deleteRowsOlderThan('deploy_keys', 'expires_at', now, limit, 'id');
  }

  public async deleteByRepo(repositoryId: string): Promise<void> {
    await this.withRetry(
      () => this.database.prepare('DELETE FROM deploy_keys WHERE repository_id = ?').bind(repositoryId).run(),
      'delete deploy keys',
    );
  }
}

export { DeployKeyDAO };
export type { DeployKeyPermission, DeployKeyRow };
