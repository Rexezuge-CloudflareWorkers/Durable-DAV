import { BaseDAO } from './BaseDAO';
import type { D1Queryable } from '../utils/D1Types';

export interface OrganizationRow {
  id: string;
  username: string;
  username_ci: string;
  creator_email: string;
  created_at: number;
  updated_at: number;
}

class OrganizationDAO extends BaseDAO {
  constructor(database: D1Queryable) {
    super(database);
  }

  public async create(input: { id: string; username: string; creatorEmail: string; now: number }): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare('INSERT INTO organizations (id, username, username_ci, creator_email, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
          .bind(input.id, input.username, input.username.toLowerCase(), input.creatorEmail, input.now, input.now)
          .run(),
      'create organization',
    );
  }

  public async getById(id: string): Promise<OrganizationRow | null> {
    return this.findRowById<OrganizationRow>('organizations', 'id', id);
  }

  public async getByUsernameCi(usernameCi: string): Promise<OrganizationRow | null> {
    return this.database.prepare('SELECT * FROM organizations WHERE username_ci = ? LIMIT 1').bind(usernameCi).first<OrganizationRow>();
  }

  public async rename(id: string, username: string, now: number): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare('UPDATE organizations SET username = ?, username_ci = ?, updated_at = ? WHERE id = ?')
          .bind(username, username.toLowerCase(), now, id)
          .run(),
      'rename organization',
    );
  }

  public async deleteById(id: string): Promise<void> {
    await this.withRetry(() => this.database.prepare('DELETE FROM organizations WHERE id = ?').bind(id).run(), 'delete organization');
  }
}

export { OrganizationDAO };
