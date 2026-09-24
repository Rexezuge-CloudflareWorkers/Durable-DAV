import { BaseDAO } from './BaseDAO';
import type { D1Queryable } from '../utils/D1Types';
import { buildSetClause } from './UpdateClause';

export interface ProjectRow {
  id: string;
  repository_id: string;
  number: number;
  title: string;
  description: string | null;
  status: string;
  creator_email: string;
  created_at: number;
  updated_at: number;
}

export interface ProjectColumnRow {
  id: string;
  project_id: string;
  title: string;
  position: number;
  created_at: number;
}

export interface ProjectCardRow {
  id: string;
  project_id: string;
  column_id: string;
  kind: string;
  note_title: string | null;
  note_body: string | null;
  issue_id: string | null;
  pull_request_id: string | null;
  position: number;
  archived: number;
  creator_email: string;
  created_at: number;
  updated_at: number;
}

class ProjectDAO extends BaseDAO {
  constructor(database: D1Queryable) {
    super(database);
  }

  public async nextNumber(repositoryId: string): Promise<number> {
    const row = await this.database
      .prepare('SELECT COALESCE(MAX(number), 0) + 1 AS next_number FROM projects WHERE repository_id = ?')
      .bind(repositoryId)
      .first<{ next_number: number }>()
      .catch(() => ({ next_number: 1 }));
    return row?.next_number ?? 1;
  }

  public async createProject(input: {
    id: string;
    repositoryId: string;
    number: number;
    title: string;
    description: string | null;
    creatorEmail: string;
    now: number;
  }): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare(
            "INSERT INTO projects (id, repository_id, number, title, description, status, creator_email, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?)",
          )
          .bind(input.id, input.repositoryId, input.number, input.title, input.description, input.creatorEmail, input.now, input.now)
          .run(),
      'create project',
    );
  }

  public async listByRepo(repositoryId: string): Promise<ProjectRow[]> {
    const result = await this.database
      .prepare('SELECT * FROM projects WHERE repository_id = ? ORDER BY number DESC')
      .bind(repositoryId)
      .all<ProjectRow>()
      .catch(() => ({ results: [] }));
    return result.results ?? [];
  }

  public async getByNumber(repositoryId: string, number: number): Promise<ProjectRow | null> {
    return this.database
      .prepare('SELECT * FROM projects WHERE repository_id = ? AND number = ? LIMIT 1')
      .bind(repositoryId, number)
      .first<ProjectRow>()
      .catch(() => null);
  }

  public async getById(id: string, repositoryId: string): Promise<ProjectRow | null> {
    return this.database
      .prepare('SELECT * FROM projects WHERE id = ? AND repository_id = ? LIMIT 1')
      .bind(id, repositoryId)
      .first<ProjectRow>()
      .catch(() => null);
  }

  public async countByRepo(repositoryId: string): Promise<number> {
    const row = await this.database
      .prepare('SELECT COUNT(*) AS count FROM projects WHERE repository_id = ?')
      .bind(repositoryId)
      .first<{ count: number }>()
      .catch(() => ({ count: 0 }));
    return row?.count ?? 0;
  }

  public async setStatus(id: string, repositoryId: string, status: 'open' | 'closed', now: number): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare('UPDATE projects SET status = ?, updated_at = ? WHERE id = ? AND repository_id = ?')
          .bind(status, now, id, repositoryId)
          .run(),
      'update project status',
    );
  }

  public async updateProject(
    id: string,
    repositoryId: string,
    patch: { title?: string; description?: string | null },
    now: number,
  ): Promise<void> {
    const assignments: Array<{ column: string; value: unknown }> = [];
    if (patch.title !== undefined) assignments.push({ column: 'title', value: patch.title });
    if (patch.description !== undefined) assignments.push({ column: 'description', value: patch.description });
    if (assignments.length === 0) return;
    assignments.push({ column: 'updated_at', value: now });
    const { clause, values } = buildSetClause(assignments);
    await this.withRetry(
      () =>
        this.database
          .prepare(`UPDATE projects SET ${clause} WHERE id = ? AND repository_id = ?`)
          .bind(...values, id, repositoryId)
          .run(),
      'update project',
    );
  }

  public async deleteProject(id: string, repositoryId: string): Promise<void> {
    await this.database
      .prepare('DELETE FROM project_cards WHERE project_id = ?')
      .bind(id)
      .run()
      .catch(() => undefined);
    await this.database
      .prepare('DELETE FROM project_columns WHERE project_id = ?')
      .bind(id)
      .run()
      .catch(() => undefined);
    await this.withRetry(
      () => this.database.prepare('DELETE FROM projects WHERE id = ? AND repository_id = ?').bind(id, repositoryId).run(),
      'delete project',
    );
  }

  public async createColumn(input: { id: string; projectId: string; title: string; position: number; now: number }): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare('INSERT INTO project_columns (id, project_id, title, position, created_at) VALUES (?, ?, ?, ?, ?)')
          .bind(input.id, input.projectId, input.title, input.position, input.now)
          .run(),
      'create project column',
    );
  }

  public async listColumns(projectId: string): Promise<ProjectColumnRow[]> {
    const result = await this.database
      .prepare('SELECT * FROM project_columns WHERE project_id = ? ORDER BY position ASC, created_at ASC')
      .bind(projectId)
      .all<ProjectColumnRow>()
      .catch(() => ({ results: [] }));
    return result.results ?? [];
  }

  public async getColumn(id: string, projectId: string): Promise<ProjectColumnRow | null> {
    return this.database
      .prepare('SELECT * FROM project_columns WHERE id = ? AND project_id = ? LIMIT 1')
      .bind(id, projectId)
      .first<ProjectColumnRow>()
      .catch(() => null);
  }

  public async renameColumn(id: string, projectId: string, title: string): Promise<void> {
    await this.withRetry(
      () => this.database.prepare('UPDATE project_columns SET title = ? WHERE id = ? AND project_id = ?').bind(title, id, projectId).run(),
      'rename project column',
    );
  }

  public async deleteColumn(id: string, projectId: string): Promise<void> {
    await this.database
      .prepare('DELETE FROM project_cards WHERE column_id = ?')
      .bind(id)
      .run()
      .catch(() => undefined);
    await this.withRetry(
      () => this.database.prepare('DELETE FROM project_columns WHERE id = ? AND project_id = ?').bind(id, projectId).run(),
      'delete project column',
    );
  }

  public async createCard(input: {
    id: string;
    projectId: string;
    columnId: string;
    kind: string;
    noteTitle: string | null;
    noteBody: string | null;
    issueId: string | null;
    pullRequestId: string | null;
    position: number;
    creatorEmail: string;
    now: number;
  }): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare(
            'INSERT INTO project_cards (id, project_id, column_id, kind, note_title, note_body, issue_id, pull_request_id, position, archived, creator_email, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)',
          )
          .bind(
            input.id,
            input.projectId,
            input.columnId,
            input.kind,
            input.noteTitle,
            input.noteBody,
            input.issueId,
            input.pullRequestId,
            input.position,
            input.creatorEmail,
            input.now,
            input.now,
          )
          .run(),
      'create project card',
    );
  }

  public async listCards(projectId: string, includeArchived = false): Promise<ProjectCardRow[]> {
    const result = includeArchived
      ? await this.database
          .prepare('SELECT * FROM project_cards WHERE project_id = ? ORDER BY position ASC, created_at ASC')
          .bind(projectId)
          .all<ProjectCardRow>()
          .catch(() => ({ results: [] }))
      : await this.database
          .prepare('SELECT * FROM project_cards WHERE project_id = ? AND archived = 0 ORDER BY position ASC, created_at ASC')
          .bind(projectId)
          .all<ProjectCardRow>()
          .catch(() => ({ results: [] }));
    return result.results ?? [];
  }

  public async getCard(id: string, projectId: string): Promise<ProjectCardRow | null> {
    return this.database
      .prepare('SELECT * FROM project_cards WHERE id = ? AND project_id = ? LIMIT 1')
      .bind(id, projectId)
      .first<ProjectCardRow>()
      .catch(() => null);
  }

  public async moveCard(id: string, projectId: string, columnId: string, position: number, now: number): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare('UPDATE project_cards SET column_id = ?, position = ?, updated_at = ? WHERE id = ? AND project_id = ?')
          .bind(columnId, position, now, id, projectId)
          .run(),
      'move project card',
    );
  }

  public async setCardArchived(id: string, projectId: string, archived: boolean, now: number): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare('UPDATE project_cards SET archived = ?, updated_at = ? WHERE id = ? AND project_id = ?')
          .bind(archived ? 1 : 0, now, id, projectId)
          .run(),
      'archive project card',
    );
  }

  public async deleteCard(id: string, projectId: string): Promise<void> {
    await this.withRetry(
      () => this.database.prepare('DELETE FROM project_cards WHERE id = ? AND project_id = ?').bind(id, projectId).run(),
      'delete project card',
    );
  }

  public async countCardsInColumn(columnId: string): Promise<number> {
    const row = await this.database
      .prepare('SELECT COUNT(*) AS count FROM project_cards WHERE column_id = ? AND archived = 0')
      .bind(columnId)
      .first<{ count: number }>()
      .catch(() => ({ count: 0 }));
    return row?.count ?? 0;
  }

  public async deleteByRepo(repositoryId: string): Promise<void> {
    const projects = await this.listByRepo(repositoryId).catch(() => []);
    for (const project of projects) {
      await this.deleteProject(project.id, repositoryId).catch(() => undefined);
    }
  }
}

export { ProjectDAO };
