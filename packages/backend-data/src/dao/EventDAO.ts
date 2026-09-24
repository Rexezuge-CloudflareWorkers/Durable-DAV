import { BaseDAO } from './BaseDAO';
import type { D1Queryable } from '../utils/D1Types';

export type RepoEventType =
  | 'repo_created'
  | 'push'
  | 'issue_opened'
  | 'issue_closed'
  | 'issue_reopened'
  | 'issue_commented'
  | 'pr_opened'
  | 'pr_closed'
  | 'pr_merged'
  | 'pr_reviewed'
  | 'pr_commented'
  | 'fork_created'
  | 'release_created'
  | 'release_published'
  | 'project_created'
  | 'project_closed'
  | 'project_reopened'
  | 'discussion_opened'
  | 'discussion_answered'
  | 'discussion_locked'
  | 'discussion_commented'
  | 'wiki_created'
  | 'wiki_updated'
  | 'snippet_created';

export interface RepoEventRow {
  id: string;
  repository_id: string;
  // Computed `full_name` alias (`repositories` join) — the stored copy was
  // dropped in 0024; never written, only selected.
  full_name: string;
  actor_email: string;
  type: RepoEventType;
  subject_type: string | null;
  subject_number: number | null;
  subject_oid: string | null;
  payload: string;
  created_at: number;
}

class EventDAO extends BaseDAO {
  constructor(database: D1Queryable) {
    super(database);
  }

  public async append(input: {
    id: string;
    repositoryId: string;
    actorEmail: string;
    type: RepoEventType;
    subjectType?: string | null;
    subjectNumber?: number | null;
    subjectOid?: string | null;
    payload?: string;
    now: number;
  }): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare(
            'INSERT INTO repo_events (id, repository_id, actor_email, type, subject_type, subject_number, subject_oid, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .bind(
            input.id,
            input.repositoryId,
            input.actorEmail,
            input.type,
            input.subjectType ?? null,
            input.subjectNumber ?? null,
            input.subjectOid ?? null,
            input.payload ?? '{}',
            input.now,
          )
          .run(),
      'append repo event',
    );
  }

  // `full_name` is computed from `repositories` (0024 dropped the stored
  // copy): renames need no cascade here.
  private static readonly FULL_NAME_ALIAS =
    "(SELECT owner || '/' || name FROM repositories WHERE id = repo_events.repository_id) AS full_name";

  public async listByRepo(
    repositoryId: string,
    limit = 50,
    cursor?: string,
  ): Promise<{ events: RepoEventRow[]; nextCursor: string | null }> {
    const decoded = this.decodeCursorOrThrow<{ created_at: number; id: string }>(cursor);
    const pageSize = limit + 1;
    const result =
      decoded === undefined
        ? await this.database
            .prepare(`SELECT repo_events.*, ${EventDAO.FULL_NAME_ALIAS} FROM repo_events WHERE repository_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`)
            .bind(repositoryId, pageSize)
            .all<RepoEventRow>()
        : await this.database
            .prepare(
              `SELECT repo_events.*, ${EventDAO.FULL_NAME_ALIAS} FROM repo_events WHERE repository_id = ? AND (created_at < ? OR (created_at = ? AND id < ?)) ORDER BY created_at DESC, id DESC LIMIT ?`,
            )
            .bind(repositoryId, decoded.created_at, decoded.created_at, decoded.id, pageSize)
            .all<RepoEventRow>();
    const rows = result.results ?? [];
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page.at(-1);
    return { events: page, nextCursor: hasMore && last ? this.encodeCursor({ created_at: last.created_at, id: last.id }) : null };
  }

  public async deleteByRepo(repositoryId: string): Promise<void> {
    await this.withRetry(
      () => this.database.prepare('DELETE FROM repo_events WHERE repository_id = ?').bind(repositoryId).run(),
      'delete events by repo',
    );
  }

  public async pruneOlderThan(cutoff: number, limit: number): Promise<number> {
    return this.deleteRowsOlderThan('repo_events', 'created_at', cutoff, limit, 'id');
  }
}

export { EventDAO };
