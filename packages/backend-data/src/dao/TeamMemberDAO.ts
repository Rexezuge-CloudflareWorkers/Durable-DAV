import { BaseDAO } from './BaseDAO';
import type { D1Queryable } from '../utils/D1Types';

export type TeamMemberRole = 'admin' | 'member';

export interface TeamMemberRow {
  team_id: string;
  user_email: string;
  role: TeamMemberRole;
  joined_at: number;
}

class TeamMemberDAO extends BaseDAO {
  constructor(database: D1Queryable) {
    super(database);
  }

  public async upsert(teamId: string, userEmail: string, role: TeamMemberRole, now: number): Promise<void> {
    const normalized = userEmail.toLowerCase();
    await this.withRetry(async () => {
      // Collapse legacy mixed-case duplicates so `lower(user_email)` reads stay unique.
      await this.database
        .prepare('DELETE FROM team_members WHERE team_id = ? AND lower(user_email) = ? AND user_email != ?')
        .bind(teamId, normalized, normalized)
        .run()
        .catch(() => undefined);
      return this.database
        .prepare(
          'INSERT INTO team_members (team_id, user_email, role, joined_at) VALUES (?, ?, ?, ?) ON CONFLICT(team_id, user_email) DO UPDATE SET role = excluded.role',
        )
        .bind(teamId, normalized, role, now)
        .run();
    }, 'upsert team member');
  }

  public async get(teamId: string, userEmail: string): Promise<TeamMemberRow | null> {
    return this.database
      .prepare('SELECT * FROM team_members WHERE team_id = ? AND lower(user_email) = lower(?) LIMIT 1')
      .bind(teamId, userEmail)
      .first<TeamMemberRow>();
  }

  public async listByTeam(teamId: string, limit = 200): Promise<TeamMemberRow[]> {
    const result = await this.database
      .prepare('SELECT * FROM team_members WHERE team_id = ? ORDER BY joined_at ASC LIMIT ?')
      .bind(teamId, limit)
      .all<TeamMemberRow>();
    return result.results ?? [];
  }

  public async listTeamsByUser(userEmail: string, limit = 200): Promise<TeamMemberRow[]> {
    const result = await this.database
      .prepare('SELECT * FROM team_members WHERE lower(user_email) = lower(?) ORDER BY joined_at ASC LIMIT ?')
      .bind(userEmail, limit)
      .all<TeamMemberRow>();
    return result.results ?? [];
  }

  public async remove(teamId: string, userEmail: string): Promise<void> {
    await this.withRetry(
      () =>
        this.database.prepare('DELETE FROM team_members WHERE team_id = ? AND lower(user_email) = lower(?)').bind(teamId, userEmail).run(),
      'remove team member',
    );
  }

  public async deleteByTeam(teamId: string): Promise<void> {
    await this.withRetry(
      () => this.database.prepare('DELETE FROM team_members WHERE team_id = ?').bind(teamId).run(),
      'delete members by team',
    );
  }

  public async countAdmins(teamId: string): Promise<number> {
    const row = await this.database
      .prepare("SELECT COUNT(*) AS n FROM team_members WHERE team_id = ? AND role = 'admin'")
      .bind(teamId)
      .first<{ n: number }>();
    return row?.n ?? 0;
  }
}

export { TeamMemberDAO };
