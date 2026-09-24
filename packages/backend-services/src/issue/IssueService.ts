import { IssueDAO, NumberingDAO } from '@duradav/backend-data/dao';
import type { CommentRow, IssueRow } from '@duradav/backend-data/dao';
import type { D1Queryable } from '@duradav/backend-data/utils';
import { BadRequestError, NotFoundError } from '@duradav/backend-errors';
import { TimestampUtil, UUIDUtil } from '@duradav/shared/utils';
import { allocateNumberWithFallback } from '../numbering/numberAllocator';

interface IssueServiceEnv {
  DB: D1Queryable;
}

interface IssueServiceDeps {
  issueDAO?: () => Promise<IssueDAO>;
  numberingDAO?: () => Promise<NumberingDAO>;
}

function isUniqueViolation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /unique|constraint/i.test(message);
}

class IssueService {
  private readonly deps: Required<IssueServiceDeps>;

  constructor(
    private readonly env: IssueServiceEnv,
    deps: IssueServiceDeps = {},
  ) {
    this.deps = {
      issueDAO: () => Promise.resolve(new IssueDAO(env.DB)),
      numberingDAO: () => Promise.resolve(new NumberingDAO(env.DB)),
      ...deps,
    };
  }

  public async listByRepo(repositoryId: string, limit = 50): Promise<IssueRow[]> {
    const dao = await this.deps.issueDAO();
    return dao.listByRepo(repositoryId, limit);
  }

  public async createIssue(input: {
    repositoryId: string;
    title: string;
    body?: string | null;
    creatorEmail: string;
  }): Promise<{ id: string; number: number }> {
    const title = input.title.trim();
    if (!title) throw new BadRequestError('title is required');
    if (title.length > 200) throw new BadRequestError('title must be at most 200 characters');
    const body = input.body?.trim() ? input.body.trim() : null;
    if (body && body.length > 10_000) throw new BadRequestError('body must be at most 10000 characters');
    const dao = await this.deps.issueDAO();
    // Atomic allocator first (single UPSERT ... RETURNING stays distinct
    // under concurrency); legacy MAX+1 loop on fallback. The UNIQUE index +
    // retry below stays as the backstop either way.
    // Retry on UNIQUE(repository_id, number) races from concurrent POSTs:
    // re-read MAX(number)+1 after a conflict (3 attempts, then surface).
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const number = await allocateNumberWithFallback(
        this.deps.numberingDAO,
        () => dao.nextNumber(input.repositoryId),
        input.repositoryId,
        'issue',
      );
      const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
      const id = UUIDUtil.getRandomUUID();
      try {
        await dao.create({
          id,
          repositoryId: input.repositoryId,
          number,
          title,
          body,
          creatorEmail: input.creatorEmail,
          now,
        });
        return { id, number };
      } catch (error) {
        lastError = error;
        if (!isUniqueViolation(error)) throw error;
      }
    }
    throw lastError instanceof Error ? lastError : new BadRequestError('Failed to create issue');
  }

  public async getByNumber(repositoryId: string, number: number): Promise<IssueRow> {
    const dao = await this.deps.issueDAO();
    const row = await dao.getByNumber(repositoryId, number);
    if (!row) throw new NotFoundError('Issue not found');
    return row;
  }

  public async updateStatus(input: { repositoryId: string; number: number; status: string }): Promise<IssueRow> {
    if (input.status !== 'open' && input.status !== 'closed') {
      throw new BadRequestError('status must be open or closed');
    }
    const issue = await this.getByNumber(input.repositoryId, input.number);
    const dao = await this.deps.issueDAO();
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    await dao.setStatus(issue.id, input.status, now);
    const updated = await dao.getByNumber(input.repositoryId, input.number);
    if (!updated) throw new NotFoundError('Issue not found');
    return updated;
  }

  public async addComment(input: { repositoryId: string; number: number; authorEmail: string; body: string }): Promise<CommentRow> {
    const trimmed = input.body.trim();
    if (!trimmed) throw new BadRequestError('body is required');
    if (trimmed.length > 10_000) throw new BadRequestError('body must be at most 10000 characters');
    const issue = await this.getByNumber(input.repositoryId, input.number);
    const dao = await this.deps.issueDAO();
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    const id = UUIDUtil.getRandomUUID();
    await dao.addComment(id, issue.id, input.authorEmail, trimmed, now);
    return { id, issue_id: issue.id, author_email: input.authorEmail, body: trimmed, created_at: now };
  }

  public async listComments(repositoryId: string, number: number): Promise<CommentRow[]> {
    const issue = await this.getByNumber(repositoryId, number);
    const dao = await this.deps.issueDAO();
    return dao.listComments(issue.id);
  }
}

export { IssueService };
export type { IssueServiceDeps, IssueServiceEnv };
