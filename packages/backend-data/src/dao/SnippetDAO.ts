import { BaseDAO } from './BaseDAO';
import type { D1Queryable } from '../utils/D1Types';

export interface SnippetRow {
  id: string;
  owner_email: string;
  title: string;
  visibility: string;
  created_at: number;
  updated_at: number;
}

export interface SnippetFileRow {
  id: string;
  snippet_id: string;
  filename: string;
  body: string;
  created_at: number;
}

class SnippetDAO extends BaseDAO {
  constructor(database: D1Queryable) {
    super(database);
  }

  public async createSnippet(input: { id: string; ownerEmail: string; title: string; visibility: string; now: number }): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare('INSERT INTO snippets (id, owner_email, title, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
          .bind(input.id, input.ownerEmail, input.title, input.visibility, input.now, input.now)
          .run(),
      'create snippet',
    );
  }

  public async addFile(input: { id: string; snippetId: string; filename: string; body: string; now: number }): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare('INSERT INTO snippet_files (id, snippet_id, filename, body, created_at) VALUES (?, ?, ?, ?, ?)')
          .bind(input.id, input.snippetId, input.filename, input.body, input.now)
          .run(),
      'add snippet file',
    );
  }

  public async getById(id: string): Promise<SnippetRow | null> {
    return this.database
      .prepare('SELECT * FROM snippets WHERE id = ? LIMIT 1')
      .bind(id)
      .first<SnippetRow>()
      .catch(() => null);
  }

  public async listByOwner(ownerEmail: string, includeSecret: boolean): Promise<SnippetRow[]> {
    const result = includeSecret
      ? await this.database
          .prepare('SELECT * FROM snippets WHERE owner_email = ? ORDER BY updated_at DESC, id DESC')
          .bind(ownerEmail)
          .all<SnippetRow>()
          .catch(() => ({ results: [] }))
      : await this.database
          .prepare("SELECT * FROM snippets WHERE owner_email = ? AND visibility = 'public' ORDER BY updated_at DESC, id DESC")
          .bind(ownerEmail)
          .all<SnippetRow>()
          .catch(() => ({ results: [] }));
    return result.results ?? [];
  }

  public async listPublic(limit: number): Promise<SnippetRow[]> {
    const result = await this.database
      .prepare("SELECT * FROM snippets WHERE visibility = 'public' ORDER BY updated_at DESC, id DESC LIMIT ?")
      .bind(limit)
      .all<SnippetRow>()
      .catch(() => ({ results: [] }));
    return result.results ?? [];
  }

  public async countByOwner(ownerEmail: string): Promise<number> {
    const row = await this.database
      .prepare('SELECT COUNT(*) AS count FROM snippets WHERE owner_email = ?')
      .bind(ownerEmail)
      .first<{ count: number }>()
      .catch(() => ({ count: 0 }));
    return row?.count ?? 0;
  }

  public async listFiles(snippetId: string): Promise<SnippetFileRow[]> {
    const result = await this.database
      .prepare('SELECT * FROM snippet_files WHERE snippet_id = ? ORDER BY filename ASC')
      .bind(snippetId)
      .all<SnippetFileRow>()
      .catch(() => ({ results: [] }));
    return result.results ?? [];
  }

  public async updateSnippet(id: string, patch: { title?: string; visibility?: string }, now: number): Promise<void> {
    const sets: string[] = [];
    const values: Array<string> = [];
    if (patch.title !== undefined) {
      sets.push('title = ?');
      values.push(patch.title);
    }
    if (patch.visibility !== undefined) {
      sets.push('visibility = ?');
      values.push(patch.visibility);
    }
    if (sets.length === 0) return;
    sets.push('updated_at = ?');
    await this.withRetry(
      () =>
        this.database
          .prepare(`UPDATE snippets SET ${sets.join(', ')} WHERE id = ?`)
          .bind(...values, now, id)
          .run(),
      'update snippet',
    );
  }

  public async replaceFiles(snippetId: string, files: Array<{ filename: string; body: string }>, now: number): Promise<void> {
    await this.database
      .prepare('DELETE FROM snippet_files WHERE snippet_id = ?')
      .bind(snippetId)
      .run()
      .catch(() => undefined);
    for (const [index, file] of files.entries()) {
      await this.withRetry(
        () =>
          this.database
            .prepare('INSERT INTO snippet_files (id, snippet_id, filename, body, created_at) VALUES (?, ?, ?, ?, ?)')
            .bind(`${snippetId}:${index}:${file.filename}`, snippetId, file.filename, file.body, now)
            .run(),
        'replace snippet file',
      );
    }
  }

  public async deleteSnippet(id: string): Promise<void> {
    await this.database
      .prepare('DELETE FROM snippet_files WHERE snippet_id = ?')
      .bind(id)
      .run()
      .catch(() => undefined);
    await this.withRetry(() => this.database.prepare('DELETE FROM snippets WHERE id = ?').bind(id).run(), 'delete snippet');
  }

  public async searchPublic(term: string, limit: number): Promise<SnippetRow[]> {
    const pattern = `%${term.replaceAll(/[%_]/g, '').toLowerCase()}%`;
    const result = await this.database
      .prepare("SELECT * FROM snippets WHERE visibility = 'public' AND lower(title) LIKE ? ORDER BY updated_at DESC LIMIT ?")
      .bind(pattern, limit)
      .all<SnippetRow>()
      .catch(() => ({ results: [] }));
    return result.results ?? [];
  }
}

export { SnippetDAO };
