import { BaseDAO } from './BaseDAO';
import type { D1Queryable } from '../utils/D1Types';
import type { RepoRole } from './RepoCollaboratorDAO';

export interface TeamRepoGrantRow {
  team_id: string;
  repo_id: string;
  role: RepoRole;
  granted_by: string | null;
  created_at: number;
}

class TeamRepoGrantDAO extends BaseDAO {
  constructor(database: D1Queryable) {
    super(database);
  }

  public async upsert(teamId: string, repoId: string, role: RepoRole, grantedBy: string | null, now: number): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare(
            'INSERT INTO team_repo_grants (team_id, repo_id, role, granted_by, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(team_id, repo_id) DO UPDATE SET role = excluded.role',
          )
          .bind(teamId, repoId, role, grantedBy, now)
          .run(),
      'upsert team repo grant',
    );
  }

  public async get(teamId: string, repoId: string): Promise<TeamRepoGrantRow | null> {
    return this.database
      .prepare('SELECT * FROM team_repo_grants WHERE team_id = ? AND repo_id = ? LIMIT 1')
      .bind(teamId, repoId)
      .first<TeamRepoGrantRow>();
  }

  public async listByTeam(teamId: string, limit = 200): Promise<TeamRepoGrantRow[]> {
    const result = await this.database
      .prepare('SELECT * FROM team_repo_grants WHERE team_id = ? ORDER BY created_at ASC LIMIT ?')
      .bind(teamId, limit)
      .all<TeamRepoGrantRow>();
    return result.results ?? [];
  }

  public async listByRepo(repoId: string, limit = 200): Promise<TeamRepoGrantRow[]> {
    const result = await this.database
      .prepare('SELECT * FROM team_repo_grants WHERE repo_id = ? ORDER BY created_at ASC LIMIT ?')
      .bind(repoId, limit)
      .all<TeamRepoGrantRow>();
    return result.results ?? [];
  }

  public async countByTeam(teamId: string): Promise<number> {
    const row = await this.database
      .prepare('SELECT COUNT(*) AS n FROM team_repo_grants WHERE team_id = ?')
      .bind(teamId)
      .first<{ n: number }>();
    return row?.n ?? 0;
  }

  public async remove(teamId: string, repoId: string): Promise<void> {
    await this.withRetry(
      () => this.database.prepare('DELETE FROM team_repo_grants WHERE team_id = ? AND repo_id = ?').bind(teamId, repoId).run(),
      'remove team repo grant',
    );
  }

  public async deleteByTeam(teamId: string): Promise<void> {
    await this.withRetry(
      () => this.database.prepare('DELETE FROM team_repo_grants WHERE team_id = ?').bind(teamId).run(),
      'delete grants by team',
    );
  }

  public async deleteByRepo(repoId: string): Promise<void> {
    await this.withRetry(
      () => this.database.prepare('DELETE FROM team_repo_grants WHERE repo_id = ?').bind(repoId).run(),
      'delete grants by repo',
    );
  }
}

export { TeamRepoGrantDAO };
