import { BaseDAO } from './BaseDAO';
import type { D1Queryable } from '../utils/D1Types';

export interface WikiPageRow {
  id: string;
  repository_id: string;
  slug: string;
  title: string;
  body: string;
  revision: number;
  updated_by: string;
  created_at: number;
  updated_at: number;
}

export interface WikiRevisionRow {
  id: string;
  page_id: string;
  revision: number;
  body: string;
  author_email: string;
  created_at: number;
}

class WikiDAO extends BaseDAO {
  constructor(database: D1Queryable) {
    super(database);
  }

  public async createPage(input: {
    id: string;
    repositoryId: string;
    slug: string;
    title: string;
    body: string;
    authorEmail: string;
    now: number;
  }): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare(
            'INSERT INTO wiki_pages (id, repository_id, slug, title, body, revision, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)',
          )
          .bind(input.id, input.repositoryId, input.slug, input.title, input.body, input.authorEmail, input.now, input.now)
          .run(),
      'create wiki page',
    );
    await this.database
      .prepare('INSERT INTO wiki_revisions (id, page_id, revision, body, author_email, created_at) VALUES (?, ?, 1, ?, ?, ?)')
      .bind(`${input.id}:1`, input.id, input.body, input.authorEmail, input.now)
      .run()
      .catch(() => undefined);
  }

  public async listByRepo(repositoryId: string): Promise<WikiPageRow[]> {
    const result = await this.database
      .prepare('SELECT * FROM wiki_pages WHERE repository_id = ? ORDER BY slug ASC')
      .bind(repositoryId)
      .all<WikiPageRow>()
      .catch(() => ({ results: [] }));
    return result.results ?? [];
  }

  public async getBySlug(repositoryId: string, slug: string): Promise<WikiPageRow | null> {
    return this.database
      .prepare('SELECT * FROM wiki_pages WHERE repository_id = ? AND slug = ? LIMIT 1')
      .bind(repositoryId, slug)
      .first<WikiPageRow>()
      .catch(() => null);
  }

  public async countByRepo(repositoryId: string): Promise<number> {
    const row = await this.database
      .prepare('SELECT COUNT(*) AS count FROM wiki_pages WHERE repository_id = ?')
      .bind(repositoryId)
      .first<{ count: number }>()
      .catch(() => ({ count: 0 }));
    return row?.count ?? 0;
  }

  public async updatePage(
    id: string,
    repositoryId: string,
    input: { title?: string; body?: string; expectedRevision?: number },
    authorEmail: string,
    now: number,
  ): Promise<WikiPageRow> {
    const current = await this.database
      .prepare('SELECT * FROM wiki_pages WHERE id = ? AND repository_id = ? LIMIT 1')
      .bind(id, repositoryId)
      .first<WikiPageRow>();
    if (!current) throw new Error('Wiki page not found');
    if (input.expectedRevision !== undefined && current.revision !== input.expectedRevision) {
      throw new Error(`revision conflict: expected ${input.expectedRevision} but found ${current.revision}`);
    }
    const nextRevision = current.revision + 1;
    const nextTitle = input.title ?? current.title;
    const nextBody = input.body ?? current.body;
    await this.withRetry(
      () =>
        this.database
          .prepare(
            'UPDATE wiki_pages SET title = ?, body = ?, revision = ?, updated_by = ?, updated_at = ? WHERE id = ? AND repository_id = ?',
          )
          .bind(nextTitle, nextBody, nextRevision, authorEmail, now, id, repositoryId)
          .run(),
      'update wiki page',
    );
    await this.database
      .prepare('INSERT OR IGNORE INTO wiki_revisions (id, page_id, revision, body, author_email, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(`${id}:${nextRevision}`, id, nextRevision, nextBody, authorEmail, now)
      .run()
      .catch(() => undefined);
    const updated = await this.database
      .prepare('SELECT * FROM wiki_pages WHERE id = ? AND repository_id = ? LIMIT 1')
      .bind(id, repositoryId)
      .first<WikiPageRow>();
    if (!updated) throw new Error('Wiki page not found');
    return updated;
  }

  public async deletePage(id: string, repositoryId: string): Promise<void> {
    await this.database
      .prepare('DELETE FROM wiki_revisions WHERE page_id = ?')
      .bind(id)
      .run()
      .catch(() => undefined);
    await this.withRetry(
      () => this.database.prepare('DELETE FROM wiki_pages WHERE id = ? AND repository_id = ?').bind(id, repositoryId).run(),
      'delete wiki page',
    );
  }

  public async listRevisions(pageId: string): Promise<WikiRevisionRow[]> {
    const result = await this.database
      .prepare('SELECT * FROM wiki_revisions WHERE page_id = ? ORDER BY revision DESC')
      .bind(pageId)
      .all<WikiRevisionRow>()
      .catch(() => ({ results: [] }));
    return result.results ?? [];
  }

  public async searchByRepo(repositoryId: string, term: string, limit: number): Promise<WikiPageRow[]> {
    const pattern = `%${term.replaceAll(/[%_]/g, '').toLowerCase()}%`;
    const result = await this.database
      .prepare(
        'SELECT * FROM wiki_pages WHERE repository_id = ? AND (lower(title) LIKE ? OR lower(body) LIKE ?) ORDER BY updated_at DESC LIMIT ?',
      )
      .bind(repositoryId, pattern, pattern, limit)
      .all<WikiPageRow>()
      .catch(() => ({ results: [] }));
    return result.results ?? [];
  }

  public async deleteByRepo(repositoryId: string): Promise<void> {
    const pages = await this.listByRepo(repositoryId).catch(() => []);
    for (const page of pages) {
      await this.deletePage(page.id, repositoryId).catch(() => undefined);
    }
  }
}

export { WikiDAO };
