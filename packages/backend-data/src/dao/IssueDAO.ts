import { BaseDAO } from './BaseDAO';
import type { D1Queryable } from '../utils/D1Types';

export interface IssueRow {
  id: string;
  repository_id: string;
  // Computed `full_name` alias (`repositories` join) — the stored copy was
  // dropped in 0024; never written, only selected.
  full_name: string;
  number: number;
  title: string;
  body: string | null;
  status: string;
  creator_email: string;
  created_at: number;
  updated_at: number;
  milestone_id?: string | null;
}

export interface CommentRow {
  id: string;
  issue_id: string | null;
  author_email: string;
  body: string;
  created_at: number;
}

class IssueDAO extends BaseDAO {
  constructor(database: D1Queryable) {
    super(database);
  }

  public async nextNumber(repositoryId: string): Promise<number> {
    const row = await this.database
      .prepare('SELECT COALESCE(MAX(number), 0) AS max_n FROM issues WHERE repository_id = ?')
      .bind(repositoryId)
      .first<{ max_n: number }>();
    return (row?.max_n ?? 0) + 1;
  }

  public async create(input: {
    id: string;
    repositoryId: string;
    number: number;
    title: string;
    body: string | null;
    creatorEmail: string;
    now: number;
  }): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare(
            'INSERT INTO issues (id, repository_id, number, title, body, status, creator_email, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .bind(input.id, input.repositoryId, input.number, input.title, input.body, 'open', input.creatorEmail, input.now, input.now)
          .run(),
      'create issue',
    );
  }

  // `full_name` is computed from `repositories` (0024 dropped the stored
  // copy): renames need no cascade here — FTS follows via triggers.
  private static readonly FULL_NAME_ALIAS =
    "(SELECT owner || '/' || name FROM repositories WHERE id = issues.repository_id) AS full_name";

  public async listByRepo(repositoryId: string, limit = 50): Promise<IssueRow[]> {
    const result = await this.database
      .prepare(`SELECT issues.*, ${IssueDAO.FULL_NAME_ALIAS} FROM issues WHERE repository_id = ? ORDER BY number DESC LIMIT ?`)
      .bind(repositoryId, limit)
      .all<IssueRow>();
    return result.results ?? [];
  }

  public async getByNumber(repositoryId: string, number: number): Promise<IssueRow | null> {
    return this.database
      .prepare(`SELECT issues.*, ${IssueDAO.FULL_NAME_ALIAS} FROM issues WHERE repository_id = ? AND number = ? LIMIT 1`)
      .bind(repositoryId, number)
      .first<IssueRow>();
  }

  public async setStatus(id: string, status: 'open' | 'closed', now: number): Promise<void> {
    await this.withRetry(
      () => this.database.prepare('UPDATE issues SET status = ?, updated_at = ? WHERE id = ?').bind(status, now, id).run(),
      'update issue status',
    );
  }

  public async deleteByRepo(repositoryId: string): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare('DELETE FROM comments WHERE issue_id IN (SELECT id FROM issues WHERE repository_id = ?)')
          .bind(repositoryId)
          .run(),
      'delete comments by repo',
    );
    await this.withRetry(
      () => this.database.prepare('DELETE FROM issues WHERE repository_id = ?').bind(repositoryId).run(),
      'delete issues by repo',
    );
  }

  public async addComment(id: string, issueId: string, authorEmail: string, body: string, now: number): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare('INSERT INTO comments (id, issue_id, author_email, body, created_at) VALUES (?, ?, ?, ?, ?)')
          .bind(id, issueId, authorEmail, body, now)
          .run(),
      'add comment',
    );
  }

  public async listComments(issueId: string): Promise<CommentRow[]> {
    const result = await this.database
      .prepare('SELECT * FROM comments WHERE issue_id = ? ORDER BY created_at ASC')
      .bind(issueId)
      .all<CommentRow>();
    return result.results ?? [];
  }
}

export { IssueDAO };
