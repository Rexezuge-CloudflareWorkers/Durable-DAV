import { BaseDAO } from './BaseDAO';
import type { D1Queryable } from '../utils/D1Types';
import type { CheckConclusion, CheckRunMetadata, CheckRunStatus } from '@duradav/shared';

export interface CheckRunRow {
  id: string;
  repository_id: string;
  head_sha: string;
  context: string;
  status: string;
  conclusion: string | null;
  details_url: string | null;
  output_title: string | null;
  output_summary: string | null;
  creator_email: string;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
}

function toMetadata(row: CheckRunRow): CheckRunMetadata {
  return {
    id: row.id,
    repositoryId: row.repository_id,
    headSha: row.head_sha,
    context: row.context,
    status: row.status === 'in_progress' || row.status === 'completed' ? row.status : 'queued',
    conclusion: (row.conclusion ?? null) as CheckConclusion | null,
    detailsUrl: row.details_url,
    outputTitle: row.output_title,
    outputSummary: row.output_summary,
    creatorEmail: row.creator_email,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

class CheckRunDAO extends BaseDAO {
  constructor(database: D1Queryable) {
    super(database);
  }

  public async create(input: {
    id: string;
    repositoryId: string;
    headSha: string;
    context: string;
    creatorEmail: string;
    now: number;
  }): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare(
            'INSERT INTO check_runs (id, repository_id, head_sha, context, status, conclusion, details_url, output_title, output_summary, creator_email, created_at, updated_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .bind(
            input.id,
            input.repositoryId,
            input.headSha,
            input.context,
            'queued',
            null,
            null,
            null,
            null,
            input.creatorEmail.toLowerCase(),
            input.now,
            input.now,
            null,
          )
          .run(),
      'create check run',
    );
  }

  public async getById(id: string, repositoryId: string): Promise<CheckRunMetadata | null> {
    const row = await this.database
      .prepare('SELECT * FROM check_runs WHERE id = ? AND repository_id = ? LIMIT 1')
      .bind(id, repositoryId)
      .first<CheckRunRow>();
    return row ? toMetadata(row) : null;
  }

  public async getByRepoShaContext(repositoryId: string, headSha: string, context: string): Promise<CheckRunMetadata | null> {
    const row = await this.database
      .prepare('SELECT * FROM check_runs WHERE repository_id = ? AND head_sha = ? AND context = ? LIMIT 1')
      .bind(repositoryId, headSha, context)
      .first<CheckRunRow>();
    return row ? toMetadata(row) : null;
  }

  public async listBySha(repositoryId: string, headSha: string): Promise<CheckRunMetadata[]> {
    const result = await this.database
      .prepare('SELECT * FROM check_runs WHERE repository_id = ? AND head_sha = ? ORDER BY context ASC')
      .bind(repositoryId, headSha)
      .all<CheckRunRow>();
    return (result.results ?? []).map(toMetadata);
  }

  public async countBySha(repositoryId: string, headSha: string): Promise<number> {
    const row = await this.database
      .prepare('SELECT COUNT(*) AS n FROM check_runs WHERE repository_id = ? AND head_sha = ?')
      .bind(repositoryId, headSha)
      .first<{ n: number }>();
    return row?.n ?? 0;
  }

  public async listStale(statuses: readonly string[], olderThan: number, limit: number): Promise<CheckRunRow[]> {
    const placeholders = statuses.map(() => '?').join(',');
    const result = await this.database
      .prepare(`SELECT * FROM check_runs WHERE status IN (${placeholders}) AND updated_at < ? ORDER BY updated_at ASC LIMIT ?`)
      .bind(...statuses, olderThan, limit)
      .all<CheckRunRow>();
    return result.results ?? [];
  }

  public async updateStatus(
    id: string,
    repositoryId: string,
    patch: {
      status: CheckRunStatus;
      conclusion?: CheckConclusion | null;
      detailsUrl?: string | null;
      outputTitle?: string | null;
      outputSummary?: string | null;
      now: number;
      completedAt?: number | null;
    },
  ): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare(
            'UPDATE check_runs SET status = ?, conclusion = ?, details_url = ?, output_title = ?, output_summary = ?, updated_at = ?, completed_at = ? WHERE id = ? AND repository_id = ?',
          )
          .bind(
            patch.status,
            patch.conclusion ?? null,
            patch.detailsUrl ?? null,
            patch.outputTitle ?? null,
            patch.outputSummary ?? null,
            patch.now,
            patch.completedAt ?? (patch.status === 'completed' ? patch.now : null),
            id,
            repositoryId,
          )
          .run(),
      'update check run',
    );
  }

  public async pruneOlderThan(cutoff: number, limit: number): Promise<number> {
    return this.deleteRowsOlderThan('check_runs', 'created_at', cutoff, limit, 'id');
  }

  public async deleteByRepo(repositoryId: string): Promise<void> {
    await this.withRetry(
      () => this.database.prepare('DELETE FROM check_runs WHERE repository_id = ?').bind(repositoryId).run(),
      'delete check runs by repo',
    );
  }
}

export { CheckRunDAO, toMetadata as toCheckRunMetadata };
