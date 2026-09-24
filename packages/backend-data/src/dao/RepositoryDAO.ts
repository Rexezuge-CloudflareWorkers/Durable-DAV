import { BaseDAO } from './BaseDAO';
import type { D1Queryable } from '../utils/D1Types';
import { DatabaseError } from '@duradav/backend-errors';
import { buildSetClause } from './UpdateClause';

export interface RepositoryRow {
  id: string;
  owner_email: string;
  owner: string;
  name: string;
  description: string | null;
  is_private: number;
  created_at: number;
  updated_at: number;
  owner_type?: string | null;
  owner_ci?: string | null;
  name_ci?: string | null;
  owner_user_email?: string | null;
  org_id?: string | null;
  forked_from_repo_id?: string | null;
  // Computed alias (`repositories` self-join) — the stored copy was dropped
  // in 0024; never written, only selected.
  forked_from_full_name?: string | null;
}

class RepositoryDAO extends BaseDAO {
  constructor(database: D1Queryable) {
    super(database);
  }

  // Fork lineage is computed live (`repositories` self-join) — the stored
  // `forked_from_full_name` copy was dropped in 0024, so renames need no
  // refresh of fork rows.
  private static readonly FORK_ALIAS =
    "(SELECT owner || '/' || name FROM repositories AS f WHERE f.id = repositories.forked_from_repo_id) AS forked_from_full_name";

  public async create(input: {
    id: string;
    ownerEmail: string;
    owner: string;
    name: string;
    description: string | null;
    isPrivate: boolean;
    now: number;
    ownerType?: string;
    orgId?: string | null;
    ownerUserEmail?: string | null;
    forkedFromRepoId?: string | null;
  }): Promise<void> {
    const ownerType = input.ownerType ?? 'user';
    const ownerCi = input.owner.toLowerCase();
    const nameCi = input.name.toLowerCase();
    const ownerUserEmail = input.ownerUserEmail ?? (ownerType === 'user' ? input.ownerEmail : null);
    await this.withRetry(
      () =>
        this.database
          .prepare(
            'INSERT INTO repositories (id, owner_email, owner, name, description, is_private, created_at, updated_at, owner_type, owner_ci, name_ci, owner_user_email, org_id, forked_from_repo_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
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
            ownerType,
            ownerCi,
            nameCi,
            ownerUserEmail,
            input.orgId ?? null,
            input.forkedFromRepoId ?? null,
          )
          .run(),
      'create repository',
    );
  }

  public async getByOwnerAndName(owner: string, name: string): Promise<RepositoryRow | null> {
    // Indexed case-insensitive lookup on `owner_ci/name_ci` (0021 baseline).
    // Non-schema failures wrap as DatabaseError (never raw): git auth maps
    // DatabaseError → 503 (outage, retryable) vs 401 (bad credentials), so a
    // raw D1 error must not leak through as a confusing 500.
    const ownerCi = owner.toLowerCase();
    const nameCi = name.toLowerCase();
    try {
      return await this.database
        .prepare(`SELECT repositories.*, ${RepositoryDAO.FORK_ALIAS} FROM repositories WHERE owner_ci = ? AND name_ci = ? LIMIT 1`)
        .bind(ownerCi, nameCi)
        .first<RepositoryRow>();
    } catch (error) {
      throw new DatabaseError(`Failed to look up repository: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  public async getById(id: string): Promise<RepositoryRow | null> {
    return this.database
      .prepare(`SELECT repositories.*, ${RepositoryDAO.FORK_ALIAS} FROM repositories WHERE id = ? LIMIT 1`)
      .bind(id)
      .first<RepositoryRow>();
  }

  public async listByOwner(owner: string, limit = 100): Promise<RepositoryRow[]> {
    const ownerCi = owner.toLowerCase();
    const result = await this.database
      .prepare(`SELECT repositories.*, ${RepositoryDAO.FORK_ALIAS} FROM repositories WHERE owner_ci = ? ORDER BY updated_at DESC LIMIT ?`)
      .bind(ownerCi, limit)
      .all<RepositoryRow>();
    return result.results ?? [];
  }

  public async listByOwnerEmail(ownerEmail: string, limit = 100): Promise<RepositoryRow[]> {
    const result = await this.database
      .prepare(
        `SELECT repositories.*, ${RepositoryDAO.FORK_ALIAS} FROM repositories WHERE lower(owner_email) = lower(?) ORDER BY updated_at DESC LIMIT ?`,
      )
      .bind(ownerEmail, limit)
      .all<RepositoryRow>();
    return result.results ?? [];
  }

  public async listByOrgId(orgId: string, limit = 200): Promise<RepositoryRow[]> {
    const result = await this.database
      .prepare(`SELECT repositories.*, ${RepositoryDAO.FORK_ALIAS} FROM repositories WHERE org_id = ? ORDER BY updated_at DESC LIMIT ?`)
      .bind(orgId, limit)
      .all<RepositoryRow>();
    return result.results ?? [];
  }

  public async listByCollaboratorEmail(userEmail: string, limit = 500): Promise<RepositoryRow[]> {
    const result = await this.database
      .prepare(
        `SELECT r.*, (SELECT owner || '/' || name FROM repositories AS f WHERE f.id = r.forked_from_repo_id) AS forked_from_full_name FROM repositories r JOIN repo_collaborators c ON c.repo_id = r.id WHERE lower(c.user_email) = lower(?) ORDER BY r.updated_at DESC LIMIT ?`,
      )
      .bind(userEmail, limit)
      .all<RepositoryRow>();
    return result.results ?? [];
  }

  public async renameOwner(oldOwnerCi: string, newOwner: string, now?: number): Promise<void> {
    const newCi = newOwner.toLowerCase();
    const stamp = now ?? Math.floor(Date.now() / 1000);
    await this.withRetry(
      () =>
        this.database
          .prepare('UPDATE repositories SET owner = ?, owner_ci = ?, updated_at = ? WHERE owner_ci = ?')
          .bind(newOwner, newCi, stamp, oldOwnerCi.toLowerCase())
          .run(),
      'rename repo owner',
    );
  }

  public async listForks(sourceRepoId: string, limit = 100): Promise<RepositoryRow[]> {
    try {
      const result = await this.database
        .prepare(
          `SELECT repositories.*, ${RepositoryDAO.FORK_ALIAS} FROM repositories WHERE forked_from_repo_id = ? ORDER BY updated_at DESC LIMIT ?`,
        )
        .bind(sourceRepoId, limit)
        .all<RepositoryRow>();
      return result.results ?? [];
    } catch (error) {
      throw new DatabaseError(`Failed to list forks: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  public async countForks(sourceRepoId: string): Promise<number> {
    try {
      const row = await this.database
        .prepare('SELECT COUNT(*) AS n FROM repositories WHERE forked_from_repo_id = ?')
        .bind(sourceRepoId)
        .first<{ n: number }>();
      return row?.n ?? 0;
    } catch (error) {
      throw new DatabaseError(`Failed to count forks: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  public async update(id: string, patch: { description?: string | null; isPrivate?: boolean; now: number }): Promise<void> {
    const assignments: Array<{ column: string; value: unknown }> = [{ column: 'updated_at', value: patch.now }];
    if (patch.description !== undefined) assignments.push({ column: 'description', value: patch.description });
    if (patch.isPrivate !== undefined) assignments.push({ column: 'is_private', value: patch.isPrivate ? 1 : 0 });
    const { clause, values } = buildSetClause(assignments);
    await this.withRetry(
      () =>
        this.database
          .prepare(`UPDATE repositories SET ${clause} WHERE id = ?`)
          .bind(...values, id)
          .run(),
      'update repository',
    );
  }

  public async deleteById(id: string): Promise<void> {
    await this.withRetry(() => this.database.prepare('DELETE FROM repositories WHERE id = ?').bind(id).run(), 'delete repository');
  }

  // Backfill support: most-recently-updated repos first. Offset pagination is
  // fine here (cron iterates slowly, exact cursors unnecessary).
  public async listRecent(limit = 50, offset = 0): Promise<RepositoryRow[]> {
    try {
      const result = await this.database
        .prepare(`SELECT repositories.*, ${RepositoryDAO.FORK_ALIAS} FROM repositories ORDER BY updated_at DESC LIMIT ? OFFSET ?`)
        .bind(limit, offset)
        .all<RepositoryRow>();
      return result.results ?? [];
    } catch (error) {
      throw new DatabaseError(`Failed to list recent repositories: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

export { RepositoryDAO };
