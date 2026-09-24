import { DiscussionDAO, NumberingDAO } from '@duradav/backend-data/dao';
import type { DiscussionCommentRow, DiscussionRow } from '@duradav/backend-data/dao';
import type { D1Queryable } from '@duradav/backend-data/utils';
import { BadRequestError, NotFoundError } from '@duradav/backend-errors';
import { ConfigurationManager } from '@duradav/backend-runtime/config';
import type { DiscussionCategoryMetadata, DiscussionCommentMetadata, DiscussionMetadata } from '@duradav/shared';
import { SLUG_RE, TimestampUtil, UUIDUtil } from '@duradav/shared/utils';
import { allocateNumberWithFallback } from '../numbering/numberAllocator';

interface DiscussionServiceEnv {
  DB: D1Queryable;
  MAX_DISCUSSIONS_PER_REPO?: string;
}

interface DiscussionServiceDeps {
  discussionDAO?: () => Promise<DiscussionDAO>;
  numberingDAO?: () => Promise<NumberingDAO>;
}

const MAX_TITLE = 200;
const MAX_BODY = 20_000;
const MAX_COMMENT_BODY = 10_000;
// Canonical slug rule shared with org/team names (`@duradav/shared/utils`);
// previously a divergent local `/^[a-z0-9-]{1,50}$/` that allowed
// leading/trailing hyphens. Default categories all satisfy the canonical rule.

function isUniqueViolation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /unique|constraint/i.test(message);
}

function toCategoryMetadata(row: {
  id: string;
  repository_id: string;
  slug: string;
  title: string;
  description: string | null;
  kind: string;
  created_at: number;
}): DiscussionCategoryMetadata {
  return {
    id: row.id,
    repositoryId: row.repository_id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    kind: row.kind as DiscussionCategoryMetadata['kind'],
    createdAt: row.created_at,
  };
}

function toMetadata(row: DiscussionRow): DiscussionMetadata {
  return {
    id: row.id,
    repositoryId: row.repository_id,
    categoryId: row.category_id,
    number: row.number,
    title: row.title,
    body: row.body,
    authorEmail: row.author_email,
    status: row.status as DiscussionMetadata['status'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toCommentMetadata(row: DiscussionCommentRow): DiscussionCommentMetadata {
  return {
    id: row.id,
    discussionId: row.discussion_id,
    authorEmail: row.author_email,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeTitle(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) throw new BadRequestError('title is required');
  const title = raw.trim();
  if (title.length > MAX_TITLE) throw new BadRequestError(`title must be at most ${MAX_TITLE} characters`);
  return title;
}

function normalizeBody(raw: unknown, field: string): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string') throw new BadRequestError(`${field} must be a string`);
  if (!raw.trim()) return null;
  return raw.slice(0, MAX_BODY);
}

class DiscussionService {
  private readonly deps: Required<DiscussionServiceDeps>;

  constructor(
    private readonly env: DiscussionServiceEnv,
    deps: DiscussionServiceDeps = {},
  ) {
    this.deps = {
      discussionDAO: () => Promise.resolve(new DiscussionDAO(env.DB)),
      numberingDAO: () => Promise.resolve(new NumberingDAO(env.DB)),
      ...deps,
    };
  }

  public async listCategories(repositoryId: string): Promise<DiscussionCategoryMetadata[]> {
    const dao = await this.deps.discussionDAO();
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    const rows = await dao.ensureDefaultCategories(repositoryId, now).catch(() => dao.listCategories(repositoryId));
    return rows.map(toCategoryMetadata);
  }

  public async createDiscussion(
    repositoryId: string,
    input: { title: unknown; body?: unknown; categorySlug?: unknown },
    authorEmail: string,
  ): Promise<DiscussionMetadata> {
    const title = normalizeTitle(input.title);
    const body = normalizeBody(input.body, 'body');
    const dao = await this.deps.discussionDAO();
    const max = ConfigurationManager.collabSurfaces.getMaxDiscussionsPerRepo(this.env);
    const count = await dao.countByRepo(repositoryId).catch(() => 0);
    if (count >= max) throw new BadRequestError(`Maximum ${max} discussions per repository`);
    let categoryId: string | null = null;
    if (input.categorySlug !== undefined && input.categorySlug !== null) {
      if (typeof input.categorySlug !== 'string' || !SLUG_RE.test(input.categorySlug.trim().toLowerCase()))
        throw new BadRequestError('categorySlug must be a valid category slug');
      const slug = input.categorySlug.trim().toLowerCase();
      const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
      await dao.ensureDefaultCategories(repositoryId, now).catch(() => undefined);
      const category = await dao.getCategoryBySlug(repositoryId, slug);
      if (!category) throw new BadRequestError('unknown category');
      categoryId = category.id;
    }
    // Atomic allocator first; legacy MAX+1 loop on fallback (see IssueService).
    // Retry on UNIQUE(repository_id, number) races from concurrent POSTs:
    // re-read MAX(number)+1 after a conflict (3 attempts, then surface).
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const id = UUIDUtil.getRandomUUID();
      const attemptNow = TimestampUtil.getCurrentUnixTimestampInSeconds();
      const number = await allocateNumberWithFallback(
        this.deps.numberingDAO,
        () => dao.nextNumber(repositoryId),
        repositoryId,
        'discussion',
      );
      try {
        await dao.createDiscussion({
          id,
          repositoryId,
          categoryId,
          number,
          title,
          body,
          authorEmail: authorEmail.toLowerCase(),
          now: attemptNow,
        });
        const row = await dao.getByNumber(repositoryId, number);
        if (!row) throw new NotFoundError('Discussion not found');
        return toMetadata(row);
      } catch (error) {
        if (error instanceof NotFoundError) throw error;
        lastError = error;
        if (!isUniqueViolation(error)) throw error;
      }
    }
    throw lastError instanceof Error ? lastError : new BadRequestError('Failed to create discussion');
  }

  public async listDiscussions(repositoryId: string, categorySlug?: string): Promise<DiscussionMetadata[]> {
    const dao = await this.deps.discussionDAO();
    if (categorySlug) {
      const category = await dao.getCategoryBySlug(repositoryId, categorySlug).catch(() => null);
      if (!category) return [];
      const rows = await dao.listByRepo(repositoryId, category.id).catch(() => []);
      return rows.map(toMetadata);
    }
    const rows = await dao.listByRepo(repositoryId).catch(() => []);
    return rows.map(toMetadata);
  }

  public async getDiscussion(repositoryId: string, number: number): Promise<DiscussionMetadata> {
    const dao = await this.deps.discussionDAO();
    const row = await dao.getByNumber(repositoryId, number);
    if (!row) throw new NotFoundError('Discussion not found');
    return toMetadata(row);
  }

  public async getDiscussionWithComments(
    repositoryId: string,
    number: number,
  ): Promise<{ discussion: DiscussionMetadata; comments: DiscussionCommentMetadata[] }> {
    const dao = await this.deps.discussionDAO();
    const row = await dao.getByNumber(repositoryId, number);
    if (!row) throw new NotFoundError('Discussion not found');
    const comments = await dao.listComments(row.id).catch(() => []);
    return { discussion: toMetadata(row), comments: comments.map(toCommentMetadata) };
  }

  public async updateDiscussion(
    repositoryId: string,
    number: number,
    input: { title?: unknown; body?: unknown; categorySlug?: unknown },
  ): Promise<DiscussionMetadata> {
    const dao = await this.deps.discussionDAO();
    const row = await dao.getByNumber(repositoryId, number);
    if (!row) throw new NotFoundError('Discussion not found');
    if (row.status === 'locked') throw new BadRequestError('discussion is locked');
    const patch: { title?: string; body?: string | null; categoryId?: string | null } = {};
    if (input.title !== undefined) patch.title = normalizeTitle(input.title);
    if (input.body !== undefined) {
      if (input.body !== null && typeof input.body !== 'string') throw new BadRequestError('body must be a string');
      patch.body = input.body === null ? null : input.body.slice(0, MAX_BODY) || null;
    }
    if (input.categorySlug !== undefined) {
      if (input.categorySlug === null) {
        patch.categoryId = null;
      } else {
        if (typeof input.categorySlug !== 'string') throw new BadRequestError('categorySlug must be a string');
        const category = await dao.getCategoryBySlug(repositoryId, input.categorySlug);
        if (!category) throw new BadRequestError('unknown category');
        patch.categoryId = category.id;
      }
    }
    await dao.updateDiscussion(row.id, patch, TimestampUtil.getCurrentUnixTimestampInSeconds());
    const updated = await dao.getByNumber(repositoryId, number);
    if (!updated) throw new NotFoundError('Discussion not found');
    return toMetadata(updated);
  }

  public async setStatus(repositoryId: string, number: number, status: unknown): Promise<DiscussionMetadata> {
    if (status !== 'open' && status !== 'locked' && status !== 'answered')
      throw new BadRequestError('status must be open, locked, or answered');
    const dao = await this.deps.discussionDAO();
    const row = await dao.getByNumber(repositoryId, number);
    if (!row) throw new NotFoundError('Discussion not found');
    await dao.setStatus(row.id, status, TimestampUtil.getCurrentUnixTimestampInSeconds());
    const updated = await dao.getByNumber(repositoryId, number);
    if (!updated) throw new NotFoundError('Discussion not found');
    return toMetadata(updated);
  }

  public async deleteDiscussion(repositoryId: string, number: number): Promise<{ id: string }> {
    const dao = await this.deps.discussionDAO();
    const row = await dao.getByNumber(repositoryId, number);
    if (!row) throw new NotFoundError('Discussion not found');
    await dao.deleteDiscussion(row.id);
    return { id: row.id };
  }

  public async addComment(
    repositoryId: string,
    number: number,
    input: { body: unknown },
    authorEmail: string,
  ): Promise<DiscussionCommentMetadata> {
    if (typeof input.body !== 'string' || !input.body.trim()) throw new BadRequestError('body is required');
    const body = input.body.slice(0, MAX_COMMENT_BODY);
    const dao = await this.deps.discussionDAO();
    const row = await dao.getByNumber(repositoryId, number);
    if (!row) throw new NotFoundError('Discussion not found');
    if (row.status === 'locked') throw new BadRequestError('discussion is locked');
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    const id = UUIDUtil.getRandomUUID();
    await dao.createComment({ id, discussionId: row.id, authorEmail: authorEmail.toLowerCase(), body, now });
    const created = await dao.getComment(id, row.id);
    if (!created) throw new NotFoundError('Discussion comment not found');
    return toCommentMetadata(created);
  }

  public async updateComment(
    repositoryId: string,
    number: number,
    commentId: string,
    input: { body: unknown },
  ): Promise<DiscussionCommentMetadata> {
    if (typeof input.body !== 'string' || !input.body.trim()) throw new BadRequestError('body is required');
    const dao = await this.deps.discussionDAO();
    const row = await dao.getByNumber(repositoryId, number);
    if (!row) throw new NotFoundError('Discussion not found');
    const comment = await dao.getComment(commentId, row.id);
    if (!comment) throw new NotFoundError('Discussion comment not found');
    await dao.updateComment(commentId, row.id, input.body.slice(0, MAX_COMMENT_BODY), TimestampUtil.getCurrentUnixTimestampInSeconds());
    const updated = await dao.getComment(commentId, row.id);
    if (!updated) throw new NotFoundError('Discussion comment not found');
    return toCommentMetadata(updated);
  }

  public async deleteComment(repositoryId: string, number: number, commentId: string): Promise<{ id: string }> {
    const dao = await this.deps.discussionDAO();
    const row = await dao.getByNumber(repositoryId, number);
    if (!row) throw new NotFoundError('Discussion not found');
    const comment = await dao.getComment(commentId, row.id);
    if (!comment) throw new NotFoundError('Discussion comment not found');
    await dao.deleteComment(commentId, row.id);
    return { id: commentId };
  }
}

export { DiscussionService };
export type { DiscussionServiceDeps, DiscussionServiceEnv };
