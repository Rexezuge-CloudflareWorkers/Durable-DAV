import { PullRequestDAO, PullThreadDAO } from '@duradav/backend-data/dao';
import type { PullReviewThreadRow, PullThreadCommentRow } from '@duradav/backend-data/dao';
import type { D1Queryable } from '@duradav/backend-data/utils';
import { BadRequestError, NotFoundError } from '@duradav/backend-errors';
import { TimestampUtil, UUIDUtil } from '@duradav/shared/utils';

interface PullThreadServiceEnv {
  DB: D1Queryable;
}

interface PullThreadServiceDeps {
  pullRequestDAO?: () => Promise<PullRequestDAO>;
  pullThreadDAO?: () => Promise<PullThreadDAO>;
}

const MAX_THREAD_BODY_LENGTH = 10_000;
const MAX_THREAD_PATH_LENGTH = 512;

function normalizeThreadPath(raw: string): string {
  const path = raw.trim().replace(/^\/+/, '');
  if (!path || path.length > MAX_THREAD_PATH_LENGTH) throw new BadRequestError('path must be 1-512 characters');
  if (path.includes('..') || path.includes(String.fromCodePoint(0))) throw new BadRequestError('invalid thread path');
  return path;
}

function normalizeThreadLine(raw: unknown): number | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 1) throw new BadRequestError('line must be a positive integer');
  return raw;
}

function normalizeThreadSide(raw: unknown): 'old' | 'new' {
  if (raw === undefined || raw === null) return 'new';
  if (raw !== 'old' && raw !== 'new') throw new BadRequestError("side must be 'old' or 'new'");
  return raw;
}

function normalizeThreadBody(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) throw new BadRequestError('body is required');
  if (raw.trim().length > MAX_THREAD_BODY_LENGTH) throw new BadRequestError('body must be at most 10000 characters');
  return raw.trim();
}

type ThreadWithComments = PullReviewThreadRow & { comments: PullThreadCommentRow[] };

class PullThreadService {
  private readonly deps: Required<PullThreadServiceDeps>;

  constructor(
    private readonly env: PullThreadServiceEnv,
    deps: PullThreadServiceDeps = {},
  ) {
    this.deps = {
      pullRequestDAO: () => Promise.resolve(new PullRequestDAO(env.DB)),
      pullThreadDAO: () => Promise.resolve(new PullThreadDAO(env.DB)),
      ...deps,
    };
  }

  private async requireOpenPull(pullRequestId: string): Promise<void> {
    const dao = await this.deps.pullRequestDAO();
    const pr = await dao.getById(pullRequestId);
    if (!pr) throw new NotFoundError('Pull request not found');
    if (pr.status === 'merged') throw new BadRequestError('cannot comment on a merged pull request');
  }

  public async openThread(input: {
    pullRequestId: string;
    authorEmail: string;
    path: string;
    line?: number | null;
    side?: string | null;
    commitOid?: string | null;
    body: string;
  }): Promise<ThreadWithComments> {
    await this.requireOpenPull(input.pullRequestId);
    const path = normalizeThreadPath(input.path);
    const line = normalizeThreadLine(input.line);
    const side = normalizeThreadSide(input.side);
    const body = normalizeThreadBody(input.body);
    const dao = await this.deps.pullThreadDAO();
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    const threadId = UUIDUtil.getRandomUUID();
    await dao.openThread({
      id: threadId,
      pullRequestId: input.pullRequestId,
      path,
      line,
      side,
      commitOid: input.commitOid ?? null,
      authorEmail: input.authorEmail,
      now,
    });
    const comment: PullThreadCommentRow = {
      id: UUIDUtil.getRandomUUID(),
      thread_id: threadId,
      author_email: input.authorEmail,
      body,
      created_at: now,
    };
    await dao.addThreadComment(comment.id, threadId, input.authorEmail, body, now);
    return {
      id: threadId,
      pull_request_id: input.pullRequestId,
      path,
      line,
      side,
      commit_oid: input.commitOid ?? null,
      status: 'open',
      author_email: input.authorEmail,
      created_at: now,
      resolved_by: null,
      resolved_at: null,
      comments: [comment],
    };
  }

  public async listThreads(pullRequestId: string): Promise<ThreadWithComments[]> {
    const dao = await this.deps.pullThreadDAO();
    const threads = await dao.listThreads(pullRequestId);
    const out: ThreadWithComments[] = [];
    for (const thread of threads) {
      const comments = await dao.listThreadComments(thread.id).catch(() => []);
      out.push({ ...thread, comments });
    }
    return out;
  }

  public async getThread(pullRequestId: string, threadId: string): Promise<ThreadWithComments> {
    const dao = await this.deps.pullThreadDAO();
    const thread = await dao.getThread(pullRequestId, threadId);
    if (!thread) throw new NotFoundError('Thread not found');
    const comments = await dao.listThreadComments(thread.id).catch(() => []);
    return { ...thread, comments };
  }

  public async replyThread(input: {
    pullRequestId: string;
    threadId: string;
    authorEmail: string;
    body: string;
  }): Promise<PullThreadCommentRow> {
    await this.requireOpenPull(input.pullRequestId);
    const body = normalizeThreadBody(input.body);
    const dao = await this.deps.pullThreadDAO();
    const thread = await dao.getThread(input.pullRequestId, input.threadId);
    if (!thread) throw new NotFoundError('Thread not found');
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    const id = UUIDUtil.getRandomUUID();
    await dao.addThreadComment(id, thread.id, input.authorEmail, body, now);
    return { id, thread_id: thread.id, author_email: input.authorEmail, body, created_at: now };
  }

  public async resolveThread(input: {
    pullRequestId: string;
    threadId: string;
    resolvedBy: string;
    resolved: boolean;
  }): Promise<PullReviewThreadRow> {
    const dao = await this.deps.pullThreadDAO();
    const thread = await dao.getThread(input.pullRequestId, input.threadId);
    if (!thread) throw new NotFoundError('Thread not found');
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    await dao.resolveThread(thread.id, input.resolvedBy.toLowerCase(), input.resolved, now);
    return {
      ...thread,
      status: input.resolved ? 'resolved' : 'open',
      resolved_by: input.resolved ? input.resolvedBy.toLowerCase() : null,
      resolved_at: input.resolved ? now : null,
    };
  }
}

export { PullThreadService };
export type { PullThreadServiceDeps, PullThreadServiceEnv, ThreadWithComments };
