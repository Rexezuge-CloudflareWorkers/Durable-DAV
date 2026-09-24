import { NumberingDAO, PullRequestDAO } from '@duradav/backend-data/dao';
import type { PullRequestCommentRow, PullRequestReviewRow, PullRequestRow } from '@duradav/backend-data/dao';
import type { D1Queryable } from '@duradav/backend-data/utils';
import { BadRequestError, NotFoundError } from '@duradav/backend-errors';
import { TimestampUtil, UUIDUtil, isValidBranchName } from '@duradav/shared/utils';
import { allocateNumberWithFallback } from '../numbering/numberAllocator';
import { isBlockedByReviews } from './PullReviewGate';
import type { ReviewGateInput } from './PullReviewGate';

interface PullRequestServiceEnv {
  DB: D1Queryable;
}

interface PullRequestServiceDeps {
  pullRequestDAO?: () => Promise<PullRequestDAO>;
  numberingDAO?: () => Promise<NumberingDAO>;
}

type ReviewState = 'approved' | 'changes_requested' | 'commented';

const REVIEW_STATES: ReadonlySet<string> = new Set(['approved', 'changes_requested', 'commented']);

class PullRequestService {
  private readonly deps: Required<PullRequestServiceDeps>;

  constructor(
    private readonly env: PullRequestServiceEnv,
    deps: PullRequestServiceDeps = {},
  ) {
    this.deps = {
      pullRequestDAO: () => Promise.resolve(new PullRequestDAO(env.DB)),
      numberingDAO: () => Promise.resolve(new NumberingDAO(env.DB)),
      ...deps,
    };
  }

  /**
   * A pull request is merge-blocked when any reviewer's latest review requests
   * changes. Delegates to the pure `PullReviewGate` helper (see
   * `./PullReviewGate.ts`) so the rule is unit testable without D1.
   * @deprecated Import isBlockedByReviews from PullReviewGate directly;
   * kept for route/test compat.
   */
  public static isBlockedByReviews(reviews: ReviewGateInput[]): boolean {
    return isBlockedByReviews(reviews);
  }

  /**
   * @deprecated Import isValidBranchName from @duradav/shared/utils directly;
   * kept for route/test compat.
   */
  public static isValidBranchName(branch: string): boolean {
    return isValidBranchName(branch);
  }

  public async listByRepo(repositoryId: string, limit = 50): Promise<PullRequestRow[]> {
    const dao = await this.deps.pullRequestDAO();
    return dao.listByRepo(repositoryId, limit);
  }

  public async createPull(input: {
    repositoryId: string;
    fullName: string;
    title: string;
    body?: string | null;
    baseBranch: string;
    headBranch: string;
    baseOid?: string | null;
    headOid?: string | null;
    mergeBaseOid?: string | null;
    creatorEmail: string;
    headRepositoryId?: string | null;
    headFullName?: string | null;
    isDraft?: boolean;
  }): Promise<{ id: string; number: number }> {
    const title = input.title.trim();
    if (!title) throw new BadRequestError('title is required');
    if (title.length > 200) throw new BadRequestError('title must be at most 200 characters');
    const baseBranch = input.baseBranch.trim();
    const headBranch = input.headBranch.trim();
    if (!baseBranch || !headBranch) throw new BadRequestError('baseBranch and headBranch are required');
    if (!isValidBranchName(baseBranch) || !isValidBranchName(headBranch)) throw new BadRequestError('invalid branch name');
    if (baseBranch === headBranch && !input.headRepositoryId) throw new BadRequestError('baseBranch and headBranch must differ');
    if (input.body !== undefined && input.body !== null && input.body.length > 10_000) {
      throw new BadRequestError('body must be at most 10000 characters');
    }
    const headRepositoryId = input.headRepositoryId?.trim() ? input.headRepositoryId.trim() : null;
    const headFullName = input.headFullName?.trim() ? input.headFullName.trim() : null;
    if ((headRepositoryId === null) !== (headFullName === null)) {
      throw new BadRequestError('headRepositoryId and headFullName must be provided together');
    }
    if (headFullName && headFullName.toLowerCase() === input.fullName.toLowerCase()) {
      throw new BadRequestError('headFullName must differ from the base repository for cross-fork pull requests');
    }
    const dao = await this.deps.pullRequestDAO();
    // Atomic allocator first; legacy MAX+1 loop on fallback (see IssueService).
    // Retry on UNIQUE(repository_id, number) races from concurrent POSTs.
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const number = await allocateNumberWithFallback(
        this.deps.numberingDAO,
        () => dao.nextNumber(input.repositoryId),
        input.repositoryId,
        'pull',
      );
      const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
      const id = UUIDUtil.getRandomUUID();
      try {
        await dao.create({
          id,
          repositoryId: input.repositoryId,
          number,
          title,
          body: input.body ?? null,
          baseBranch,
          headBranch,
          baseOid: input.baseOid ?? null,
          headOid: input.headOid ?? null,
          mergeBaseOid: input.mergeBaseOid ?? null,
          creatorEmail: input.creatorEmail,
          now,
          headRepositoryId,
        });
        if (input.isDraft === true) {
          await dao.setDraft(id, true, now).catch(() => undefined);
        }
        return { id, number };
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        if (!/unique|number/i.test(message)) throw error;
      }
    }
    throw lastError instanceof Error ? lastError : new BadRequestError('Failed to create pull request');
  }

  public async getByNumber(repositoryId: string, number: number): Promise<PullRequestRow> {
    const dao = await this.deps.pullRequestDAO();
    const row = await dao.getByNumber(repositoryId, number);
    if (!row) throw new NotFoundError('Pull request not found');
    return row;
  }

  public async updateStatus(input: { repositoryId: string; number: number; status: string }): Promise<PullRequestRow> {
    if (input.status !== 'open' && input.status !== 'closed') {
      throw new BadRequestError('status must be open or closed');
    }
    const pr = await this.getByNumber(input.repositoryId, input.number);
    if (pr.status === 'merged') throw new BadRequestError('merged pull requests cannot be reopened');
    const dao = await this.deps.pullRequestDAO();
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    await dao.setStatus(pr.id, input.status, now);
    const updated = await dao.getByNumber(input.repositoryId, input.number);
    if (!updated) throw new NotFoundError('Pull request not found');
    return updated;
  }

  public async markMerged(input: {
    repositoryId: string;
    number: number;
    mergedBy: string;
    commitOid?: string | null;
  }): Promise<PullRequestRow> {
    const pr = await this.getByNumber(input.repositoryId, input.number);
    if (pr.status === 'merged') throw new BadRequestError('pull request is already merged');
    if (pr.status === 'closed') throw new BadRequestError('closed pull requests cannot be merged');
    if ((pr as { is_draft?: number | null }).is_draft === 1) throw new BadRequestError('draft pull requests cannot be merged');
    // changes_requested blocks merge: any latest blocking review vetoes.
    const dao = await this.deps.pullRequestDAO();
    const reviews = await dao.listReviews(pr.id);
    if (isBlockedByReviews(reviews)) throw new BadRequestError('pull request has unresolved change requests');
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    await dao.markMerged(pr.id, input.mergedBy, input.commitOid ?? null, now);
    const updated = await dao.getByNumber(input.repositoryId, input.number);
    if (!updated) throw new NotFoundError('Pull request not found');
    return updated;
  }

  public async addReview(input: {
    repositoryId: string;
    number: number;
    authorEmail: string;
    state: string;
    body?: string | null;
    commitOid?: string | null;
  }): Promise<PullRequestReviewRow> {
    if (!REVIEW_STATES.has(input.state)) throw new BadRequestError('state must be approved, changes_requested, or commented');
    const pr = await this.getByNumber(input.repositoryId, input.number);
    if (pr.status === 'merged') throw new BadRequestError('cannot review a merged pull request');
    const body = input.body?.trim() ? input.body.trim() : null;
    if (body && body.length > 10_000) throw new BadRequestError('body must be at most 10000 characters');
    const dao = await this.deps.pullRequestDAO();
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    const id = UUIDUtil.getRandomUUID();
    await dao.addReview({
      id,
      pullRequestId: pr.id,
      authorEmail: input.authorEmail,
      state: input.state as ReviewState,
      body,
      commitOid: input.commitOid ?? null,
      now,
    });
    return {
      id,
      pull_request_id: pr.id,
      author_email: input.authorEmail,
      state: input.state,
      body,
      commit_oid: input.commitOid ?? null,
      created_at: now,
    };
  }

  public async listReviews(repositoryId: string, number: number): Promise<PullRequestReviewRow[]> {
    const pr = await this.getByNumber(repositoryId, number);
    const dao = await this.deps.pullRequestDAO();
    return dao.listReviews(pr.id);
  }

  public async addComment(input: {
    repositoryId: string;
    number: number;
    authorEmail: string;
    body: string;
  }): Promise<PullRequestCommentRow> {
    const trimmed = input.body.trim();
    if (!trimmed) throw new BadRequestError('body is required');
    if (trimmed.length > 10_000) throw new BadRequestError('body must be at most 10000 characters');
    const pr = await this.getByNumber(input.repositoryId, input.number);
    const dao = await this.deps.pullRequestDAO();
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    const id = UUIDUtil.getRandomUUID();
    await dao.addComment(id, pr.id, input.authorEmail, trimmed, now);
    return { id, pull_request_id: pr.id, author_email: input.authorEmail, body: trimmed, created_at: now };
  }

  public async listComments(repositoryId: string, number: number): Promise<PullRequestCommentRow[]> {
    const pr = await this.getByNumber(repositoryId, number);
    const dao = await this.deps.pullRequestDAO();
    return dao.listComments(pr.id);
  }

  public async dismissReview(input: {
    repositoryId: string;
    number: number;
    reviewId: string;
    dismissedBy: string;
    reason?: string | null;
  }): Promise<PullRequestReviewRow> {
    const pr = await this.getByNumber(input.repositoryId, input.number);
    if (pr.status === 'merged') throw new BadRequestError('cannot dismiss a review on a merged pull request');
    const dao = await this.deps.pullRequestDAO();
    const review = await dao.getReviewById(pr.id, input.reviewId);
    if (!review) throw new NotFoundError('Review not found');
    if (review.dismissed === 1) throw new BadRequestError('review is already dismissed');
    const reason = input.reason?.trim() ? input.reason.trim().slice(0, 1000) : null;
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    await dao.dismissReview(review.id, input.dismissedBy.toLowerCase(), reason, now);
    return { ...review, dismissed: 1, dismissed_by: input.dismissedBy.toLowerCase(), dismissed_at: now, dismiss_reason: reason };
  }

  public async refreshOids(input: {
    repositoryId: string;
    number: number;
    baseOid?: string | null;
    headOid?: string | null;
    mergeBaseOid?: string | null;
  }): Promise<PullRequestRow> {
    const pr = await this.getByNumber(input.repositoryId, input.number);
    if (pr.status === 'merged') return pr;
    const dao = await this.deps.pullRequestDAO();
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    await dao.updateOids(pr.id, { baseOid: input.baseOid, headOid: input.headOid, mergeBaseOid: input.mergeBaseOid }, now);
    const updated = await dao.getByNumber(input.repositoryId, input.number);
    if (!updated) throw new NotFoundError('Pull request not found');
    return updated;
  }

  public async setDraft(repositoryId: string, number: number, isDraft: boolean): Promise<PullRequestRow> {
    const pr = await this.getByNumber(repositoryId, number);
    if (pr.status === 'merged') throw new BadRequestError('merged pull requests cannot be drafted');
    const dao = await this.deps.pullRequestDAO();
    await dao.setDraft(pr.id, isDraft, TimestampUtil.getCurrentUnixTimestampInSeconds());
    const updated = await dao.getByNumber(repositoryId, number);
    if (!updated) throw new NotFoundError('Pull request not found');
    return updated;
  }
}

export { PullRequestService };
export type { PullRequestServiceDeps, PullRequestServiceEnv, ReviewState };
