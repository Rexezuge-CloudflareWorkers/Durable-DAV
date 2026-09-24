import { BaseDAO } from './BaseDAO';
import type { D1Queryable } from '../utils/D1Types';

export interface PullReviewThreadRow {
  id: string;
  pull_request_id: string;
  path: string;
  line: number | null;
  side: string;
  commit_oid: string | null;
  status: string;
  author_email: string;
  created_at: number;
  resolved_by: string | null;
  resolved_at: number | null;
}

export interface PullThreadCommentRow {
  id: string;
  thread_id: string;
  author_email: string;
  body: string;
  created_at: number;
}

class PullThreadDAO extends BaseDAO {
  constructor(database: D1Queryable) {
    super(database);
  }

  public async openThread(input: {
    id: string;
    pullRequestId: string;
    path: string;
    line: number | null;
    side: 'old' | 'new';
    commitOid: string | null;
    authorEmail: string;
    now: number;
  }): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare(
            'INSERT INTO pull_review_threads (id, pull_request_id, path, line, side, commit_oid, status, author_email, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .bind(input.id, input.pullRequestId, input.path, input.line, input.side, input.commitOid, 'open', input.authorEmail, input.now)
          .run(),
      'open pull review thread',
    );
  }

  public async listThreads(pullRequestId: string): Promise<PullReviewThreadRow[]> {
    const result = await this.database
      .prepare('SELECT * FROM pull_review_threads WHERE pull_request_id = ? ORDER BY created_at ASC')
      .bind(pullRequestId)
      .all<PullReviewThreadRow>();
    return result.results ?? [];
  }

  public async getThread(pullRequestId: string, threadId: string): Promise<PullReviewThreadRow | null> {
    return this.database
      .prepare('SELECT * FROM pull_review_threads WHERE pull_request_id = ? AND id = ? LIMIT 1')
      .bind(pullRequestId, threadId)
      .first<PullReviewThreadRow>();
  }

  public async resolveThread(threadId: string, resolvedBy: string, resolved: boolean, now: number): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare('UPDATE pull_review_threads SET status = ?, resolved_by = ?, resolved_at = ? WHERE id = ?')
          .bind(resolved ? 'resolved' : 'open', resolved ? resolvedBy : null, resolved ? now : null, threadId)
          .run(),
      'resolve pull review thread',
    );
  }

  public async addThreadComment(id: string, threadId: string, authorEmail: string, body: string, now: number): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare('INSERT INTO pull_thread_comments (id, thread_id, author_email, body, created_at) VALUES (?, ?, ?, ?, ?)')
          .bind(id, threadId, authorEmail, body, now)
          .run(),
      'add pull thread comment',
    );
  }

  public async listThreadComments(threadId: string): Promise<PullThreadCommentRow[]> {
    const result = await this.database
      .prepare('SELECT * FROM pull_thread_comments WHERE thread_id = ? ORDER BY created_at ASC')
      .bind(threadId)
      .all<PullThreadCommentRow>();
    return result.results ?? [];
  }

  public async deleteByRepo(repositoryId: string): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare(
            'DELETE FROM pull_thread_comments WHERE thread_id IN (SELECT id FROM pull_review_threads WHERE pull_request_id IN (SELECT id FROM pull_requests WHERE repository_id = ?))',
          )
          .bind(repositoryId)
          .run(),
      'delete pull thread comments by repo',
    ).catch(() => undefined);
    await this.withRetry(
      () =>
        this.database
          .prepare('DELETE FROM pull_review_threads WHERE pull_request_id IN (SELECT id FROM pull_requests WHERE repository_id = ?)')
          .bind(repositoryId)
          .run(),
      'delete pull review threads by repo',
    ).catch(() => undefined);
  }
}

export { PullThreadDAO };
