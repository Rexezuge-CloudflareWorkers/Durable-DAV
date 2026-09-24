import { BaseDAO } from './BaseDAO';
import type { D1Queryable } from '../utils/D1Types';

export interface PullRequestRow {
  id: string;
  repository_id: string;
  // Computed aliases (`repositories` joins) — the stored `full_name` /
  // `head_full_name` copies were dropped in 0024; never written, selected.
  full_name: string;
  number: number;
  title: string;
  body: string | null;
  status: string;
  base_branch: string;
  head_branch: string;
  base_oid: string | null;
  head_oid: string | null;
  merge_base_oid: string | null;
  creator_email: string;
  merged_by: string | null;
  merged_at: number | null;
  created_at: number;
  updated_at: number;
  head_repository_id?: string | null;
  head_full_name?: string | null;
  milestone_id?: string | null;
  is_draft?: number | null;
}

export interface PullRequestReviewRow {
  id: string;
  pull_request_id: string;
  author_email: string;
  state: string;
  body: string | null;
  commit_oid: string | null;
  created_at: number;
  dismissed?: number | null;
  dismissed_by?: string | null;
  dismissed_at?: number | null;
  dismiss_reason?: string | null;
}

export interface PullRequestCommentRow {
  id: string;
  pull_request_id: string;
  author_email: string;
  body: string;
  created_at: number;
}

class PullRequestDAO extends BaseDAO {
  constructor(database: D1Queryable) {
    super(database);
  }

  public async nextNumber(repositoryId: string): Promise<number> {
    const row = await this.database
      .prepare('SELECT COALESCE(MAX(number), 0) AS max_n FROM pull_requests WHERE repository_id = ?')
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
    baseBranch: string;
    headBranch: string;
    baseOid: string | null;
    headOid: string | null;
    mergeBaseOid: string | null;
    creatorEmail: string;
    now: number;
    headRepositoryId?: string | null;
  }): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare(
            'INSERT INTO pull_requests (id, repository_id, number, title, body, status, base_branch, head_branch, base_oid, head_oid, merge_base_oid, creator_email, merged_by, merged_at, created_at, updated_at, head_repository_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)',
          )
          .bind(
            input.id,
            input.repositoryId,
            input.number,
            input.title,
            input.body,
            'open',
            input.baseBranch,
            input.headBranch,
            input.baseOid,
            input.headOid,
            input.mergeBaseOid,
            input.creatorEmail,
            input.now,
            input.now,
            input.headRepositoryId ?? null,
          )
          .run(),
      'create pull request',
    );
  }

  // `full_name` / `head_full_name` are computed from `repositories` (0024
  // dropped the stored copies): renames need no cascade — FTS via triggers.
  private static readonly NAME_ALIASES =
    "(SELECT owner || '/' || name FROM repositories WHERE id = pull_requests.repository_id) AS full_name, " +
    "(SELECT owner || '/' || name FROM repositories WHERE id = pull_requests.head_repository_id) AS head_full_name";

  public async listByRepo(repositoryId: string, limit = 50): Promise<PullRequestRow[]> {
    const result = await this.database
      .prepare(`SELECT pull_requests.*, ${PullRequestDAO.NAME_ALIASES} FROM pull_requests WHERE repository_id = ? ORDER BY number DESC LIMIT ?`)
      .bind(repositoryId, limit)
      .all<PullRequestRow>();
    return result.results ?? [];
  }

  public async getByNumber(repositoryId: string, number: number): Promise<PullRequestRow | null> {
    return this.database
      .prepare(`SELECT pull_requests.*, ${PullRequestDAO.NAME_ALIASES} FROM pull_requests WHERE repository_id = ? AND number = ? LIMIT 1`)
      .bind(repositoryId, number)
      .first<PullRequestRow>();
  }

  public async getById(id: string): Promise<PullRequestRow | null> {
    return this.database
      .prepare(`SELECT pull_requests.*, ${PullRequestDAO.NAME_ALIASES} FROM pull_requests WHERE id = ? LIMIT 1`)
      .bind(id)
      .first<PullRequestRow>();
  }

  public async setStatus(id: string, status: 'open' | 'closed' | 'merged', now: number): Promise<void> {
    await this.withRetry(
      () => this.database.prepare('UPDATE pull_requests SET status = ?, updated_at = ? WHERE id = ?').bind(status, now, id).run(),
      'update pull request status',
    );
  }

  public async markMerged(id: string, mergedBy: string, commitOid: string | null, now: number): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare(
            'UPDATE pull_requests SET status = ?, merged_by = ?, merged_at = ?, head_oid = COALESCE(?, head_oid), updated_at = ? WHERE id = ?',
          )
          .bind('merged', mergedBy, now, commitOid, now, id)
          .run(),
      'mark pull request merged',
    );
  }

  public async updateOids(
    id: string,
    oids: { baseOid?: string | null; headOid?: string | null; mergeBaseOid?: string | null },
    now: number,
  ): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare(
            'UPDATE pull_requests SET base_oid = COALESCE(?, base_oid), head_oid = COALESCE(?, head_oid), merge_base_oid = COALESCE(?, merge_base_oid), updated_at = ? WHERE id = ?',
          )
          .bind(oids.baseOid ?? null, oids.headOid ?? null, oids.mergeBaseOid ?? null, now, id)
          .run(),
      'update pull request oids',
    );
  }

  public async setDraft(id: string, isDraft: boolean, now: number): Promise<void> {
    await this.database
      .prepare('UPDATE pull_requests SET is_draft = ?, updated_at = ? WHERE id = ?')
      .bind(isDraft ? 1 : 0, now, id)
      .run()
      .catch(() => undefined);
  }

  public async setMilestone(id: string, milestoneId: string | null, now: number): Promise<void> {
    await this.database
      .prepare('UPDATE pull_requests SET milestone_id = ?, updated_at = ? WHERE id = ?')
      .bind(milestoneId, id, now)
      .run()
      .catch(() => undefined);
  }

  public async deleteByRepo(repositoryId: string): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare('DELETE FROM pull_request_reviews WHERE pull_request_id IN (SELECT id FROM pull_requests WHERE repository_id = ?)')
          .bind(repositoryId)
          .run(),
      'delete pull request reviews by repo',
    );
    await this.withRetry(
      () =>
        this.database
          .prepare('DELETE FROM pull_request_comments WHERE pull_request_id IN (SELECT id FROM pull_requests WHERE repository_id = ?)')
          .bind(repositoryId)
          .run(),
      'delete pull request comments by repo',
    );
    await this.withRetry(
      () => this.database.prepare('DELETE FROM pull_requests WHERE repository_id = ?').bind(repositoryId).run(),
      'delete pull requests by repo',
    );
  }

  public async addReview(input: {
    id: string;
    pullRequestId: string;
    authorEmail: string;
    state: 'approved' | 'changes_requested' | 'commented';
    body: string | null;
    commitOid: string | null;
    now: number;
  }): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare(
            'INSERT INTO pull_request_reviews (id, pull_request_id, author_email, state, body, commit_oid, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          )
          .bind(input.id, input.pullRequestId, input.authorEmail, input.state, input.body, input.commitOid, input.now)
          .run(),
      'add pull request review',
    );
  }

  public async listReviews(pullRequestId: string): Promise<PullRequestReviewRow[]> {
    const result = await this.database
      .prepare('SELECT * FROM pull_request_reviews WHERE pull_request_id = ? ORDER BY created_at ASC')
      .bind(pullRequestId)
      .all<PullRequestReviewRow>();
    return result.results ?? [];
  }

  public async addComment(id: string, pullRequestId: string, authorEmail: string, body: string, now: number): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare('INSERT INTO pull_request_comments (id, pull_request_id, author_email, body, created_at) VALUES (?, ?, ?, ?, ?)')
          .bind(id, pullRequestId, authorEmail, body, now)
          .run(),
      'add pull request comment',
    );
  }

  public async listComments(pullRequestId: string): Promise<PullRequestCommentRow[]> {
    const result = await this.database
      .prepare('SELECT * FROM pull_request_comments WHERE pull_request_id = ? ORDER BY created_at ASC')
      .bind(pullRequestId)
      .all<PullRequestCommentRow>();
    return result.results ?? [];
  }

  public async getReviewById(pullRequestId: string, reviewId: string): Promise<PullRequestReviewRow | null> {
    return this.database
      .prepare('SELECT * FROM pull_request_reviews WHERE pull_request_id = ? AND id = ? LIMIT 1')
      .bind(pullRequestId, reviewId)
      .first<PullRequestReviewRow>();
  }

  public async dismissReview(reviewId: string, dismissedBy: string, reason: string | null, now: number): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare('UPDATE pull_request_reviews SET dismissed = 1, dismissed_by = ?, dismissed_at = ?, dismiss_reason = ? WHERE id = ?')
          .bind(dismissedBy, now, reason, reviewId)
          .run(),
      'dismiss pull request review',
    );
  }
}

export { PullRequestDAO };
