import { BaseDAO } from './BaseDAO';
import type { D1Queryable } from '../utils/D1Types';

export interface DiscussionCategoryRow {
  id: string;
  repository_id: string;
  slug: string;
  title: string;
  description: string | null;
  kind: string;
  created_at: number;
}

export interface DiscussionRow {
  id: string;
  repository_id: string;
  category_id: string | null;
  number: number;
  title: string;
  body: string | null;
  author_email: string;
  status: string;
  created_at: number;
  updated_at: number;
}

export interface DiscussionCommentRow {
  id: string;
  discussion_id: string;
  author_email: string;
  body: string;
  created_at: number;
  updated_at: number;
}

class DiscussionDAO extends BaseDAO {
  constructor(database: D1Queryable) {
    super(database);
  }

  public async nextNumber(repositoryId: string): Promise<number> {
    const row = await this.database
      .prepare('SELECT COALESCE(MAX(number), 0) + 1 AS next_number FROM discussions WHERE repository_id = ?')
      .bind(repositoryId)
      .first<{ next_number: number }>()
      .catch(() => ({ next_number: 1 }));
    return row?.next_number ?? 1;
  }

  public async listCategories(repositoryId: string): Promise<DiscussionCategoryRow[]> {
    const result = await this.database
      .prepare('SELECT * FROM discussion_categories WHERE repository_id = ? ORDER BY title ASC')
      .bind(repositoryId)
      .all<DiscussionCategoryRow>()
      .catch(() => ({ results: [] }));
    return result.results ?? [];
  }

  public async getCategoryBySlug(repositoryId: string, slug: string): Promise<DiscussionCategoryRow | null> {
    return this.database
      .prepare('SELECT * FROM discussion_categories WHERE repository_id = ? AND slug = ? LIMIT 1')
      .bind(repositoryId, slug)
      .first<DiscussionCategoryRow>()
      .catch(() => null);
  }

  public async getCategoryById(id: string, repositoryId: string): Promise<DiscussionCategoryRow | null> {
    return this.database
      .prepare('SELECT * FROM discussion_categories WHERE id = ? AND repository_id = ? LIMIT 1')
      .bind(id, repositoryId)
      .first<DiscussionCategoryRow>()
      .catch(() => null);
  }

  public async createCategory(input: {
    id: string;
    repositoryId: string;
    slug: string;
    title: string;
    description: string | null;
    kind: string;
    now: number;
  }): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare(
            'INSERT INTO discussion_categories (id, repository_id, slug, title, description, kind, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          )
          .bind(input.id, input.repositoryId, input.slug, input.title, input.description, input.kind, input.now)
          .run(),
      'create discussion category',
    );
  }

  public async ensureDefaultCategories(repositoryId: string, now: number): Promise<DiscussionCategoryRow[]> {
    const existing = await this.listCategories(repositoryId);
    if (existing.length > 0) return existing;
    const defaults: Array<{ slug: string; title: string; description: string; kind: string }> = [
      { slug: 'announcements', title: 'Announcements', description: 'Updates from the maintainers.', kind: 'announcement' },
      { slug: 'qa', title: 'Q&A', description: 'Ask questions and mark answers.', kind: 'qa' },
      { slug: 'ideas', title: 'Ideas', description: 'Propose and discuss new ideas.', kind: 'ideas' },
      { slug: 'general', title: 'General', description: 'Open discussion about this repository.', kind: 'general' },
    ];
    for (const def of defaults) {
      const id = `${repositoryId}:${def.slug}`;
      await this.database
        .prepare(
          'INSERT OR IGNORE INTO discussion_categories (id, repository_id, slug, title, description, kind, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .bind(id, repositoryId, def.slug, def.title, def.description, def.kind, now)
        .run()
        .catch(() => undefined);
    }
    return this.listCategories(repositoryId);
  }

  public async createDiscussion(input: {
    id: string;
    repositoryId: string;
    categoryId: string | null;
    number: number;
    title: string;
    body: string | null;
    authorEmail: string;
    now: number;
  }): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare(
            "INSERT INTO discussions (id, repository_id, category_id, number, title, body, author_email, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)",
          )
          .bind(
            input.id,
            input.repositoryId,
            input.categoryId,
            input.number,
            input.title,
            input.body,
            input.authorEmail,
            input.now,
            input.now,
          )
          .run(),
      'create discussion',
    );
  }

  public async listByRepo(repositoryId: string, categoryId?: string): Promise<DiscussionRow[]> {
    const result = categoryId
      ? await this.database
          .prepare('SELECT * FROM discussions WHERE repository_id = ? AND category_id = ? ORDER BY number DESC')
          .bind(repositoryId, categoryId)
          .all<DiscussionRow>()
          .catch(() => ({ results: [] }))
      : await this.database
          .prepare('SELECT * FROM discussions WHERE repository_id = ? ORDER BY number DESC')
          .bind(repositoryId)
          .all<DiscussionRow>()
          .catch(() => ({ results: [] }));
    return result.results ?? [];
  }

  public async getByNumber(repositoryId: string, number: number): Promise<DiscussionRow | null> {
    return this.database
      .prepare('SELECT * FROM discussions WHERE repository_id = ? AND number = ? LIMIT 1')
      .bind(repositoryId, number)
      .first<DiscussionRow>()
      .catch(() => null);
  }

  public async getById(id: string): Promise<DiscussionRow | null> {
    return this.database
      .prepare('SELECT * FROM discussions WHERE id = ? LIMIT 1')
      .bind(id)
      .first<DiscussionRow>()
      .catch(() => null);
  }

  public async countByRepo(repositoryId: string): Promise<number> {
    const row = await this.database
      .prepare('SELECT COUNT(*) AS count FROM discussions WHERE repository_id = ?')
      .bind(repositoryId)
      .first<{ count: number }>()
      .catch(() => ({ count: 0 }));
    return row?.count ?? 0;
  }

  public async setStatus(id: string, status: 'open' | 'locked' | 'answered', now: number): Promise<void> {
    await this.withRetry(
      () => this.database.prepare('UPDATE discussions SET status = ?, updated_at = ? WHERE id = ?').bind(status, now, id).run(),
      'update discussion status',
    );
  }

  public async updateDiscussion(
    id: string,
    patch: { title?: string; body?: string | null; categoryId?: string | null },
    now: number,
  ): Promise<void> {
    const sets: string[] = [];
    const values: Array<string | null> = [];
    if (patch.title !== undefined) {
      sets.push('title = ?');
      values.push(patch.title);
    }
    if (patch.body !== undefined) {
      sets.push('body = ?');
      values.push(patch.body);
    }
    if (patch.categoryId !== undefined) {
      sets.push('category_id = ?');
      values.push(patch.categoryId);
    }
    if (sets.length === 0) return;
    sets.push('updated_at = ?');
    await this.withRetry(
      () =>
        this.database
          .prepare(`UPDATE discussions SET ${sets.join(', ')} WHERE id = ?`)
          .bind(...values, now, id)
          .run(),
      'update discussion',
    );
  }

  public async deleteDiscussion(id: string): Promise<void> {
    await this.database
      .prepare('DELETE FROM discussion_comments WHERE discussion_id = ?')
      .bind(id)
      .run()
      .catch(() => undefined);
    await this.withRetry(() => this.database.prepare('DELETE FROM discussions WHERE id = ?').bind(id).run(), 'delete discussion');
  }

  public async createComment(input: { id: string; discussionId: string; authorEmail: string; body: string; now: number }): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare(
            'INSERT INTO discussion_comments (id, discussion_id, author_email, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
          )
          .bind(input.id, input.discussionId, input.authorEmail, input.body, input.now, input.now)
          .run(),
      'create discussion comment',
    );
  }

  public async listComments(discussionId: string): Promise<DiscussionCommentRow[]> {
    const result = await this.database
      .prepare('SELECT * FROM discussion_comments WHERE discussion_id = ? ORDER BY created_at ASC, id ASC')
      .bind(discussionId)
      .all<DiscussionCommentRow>()
      .catch(() => ({ results: [] }));
    return result.results ?? [];
  }

  public async getComment(id: string, discussionId: string): Promise<DiscussionCommentRow | null> {
    return this.database
      .prepare('SELECT * FROM discussion_comments WHERE id = ? AND discussion_id = ? LIMIT 1')
      .bind(id, discussionId)
      .first<DiscussionCommentRow>()
      .catch(() => null);
  }

  public async updateComment(id: string, discussionId: string, body: string, now: number): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare('UPDATE discussion_comments SET body = ?, updated_at = ? WHERE id = ? AND discussion_id = ?')
          .bind(body, now, id, discussionId)
          .run(),
      'update discussion comment',
    );
  }

  public async deleteComment(id: string, discussionId: string): Promise<void> {
    await this.withRetry(
      () => this.database.prepare('DELETE FROM discussion_comments WHERE id = ? AND discussion_id = ?').bind(id, discussionId).run(),
      'delete discussion comment',
    );
  }

  public async deleteByRepo(repositoryId: string): Promise<void> {
    const rows = await this.listByRepo(repositoryId).catch(() => []);
    for (const row of rows) {
      await this.deleteDiscussion(row.id).catch(() => undefined);
    }
    await this.database
      .prepare('DELETE FROM discussion_categories WHERE repository_id = ?')
      .bind(repositoryId)
      .run()
      .catch(() => undefined);
  }
}

export { DiscussionDAO };
